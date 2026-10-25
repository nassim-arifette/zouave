import { $, api, executeTool, notify } from './tools.ts';
type ToolCall = { type: string; call_id: string; name: string; arguments: string };
let pc: RTCPeerConnection | undefined;
let stream: MediaStream | undefined;
let channel: RTCDataChannel | undefined;
let mode = 'live';
let busy = false;
let stopped = true;
let idleTimer: ReturnType<typeof setTimeout>;
const audio = new Audio();
audio.autoplay = true;
let speakingAvatar = false;
function setSpeaking(speaking: boolean) {
  $('avatar-ring').classList.toggle('speaking', speaking);
  if (speakingAvatar !== speaking) { speakingAvatar = speaking; const image = $<HTMLImageElement>('avatar'); image.src = speaking ? '/zouave/avatar-speaking.png' : '/zouave/avatar.png'; }
}
function send(event: object) { if (channel?.readyState === 'open') channel.send(JSON.stringify(event)); }
function resetIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { notify('La session vocale a été fermée après une période d’inactivité.'); void stopVoice(); }, 120_000); }
const seen = new Set<string>();
let queue = Promise.resolve();
async function runCalls(calls: ToolCall[]) {
  for (const call of calls) {
    if (seen.has(call.call_id)) continue;
    seen.add(call.call_id);
    let result: unknown;
    try { result = await executeTool(call.name, JSON.parse(call.arguments)); }
    catch (error) { result = { error: error instanceof Error ? error.message : 'Échec de l’outil.' }; }
    send({ type: mode === 'live' ? 'response.item.create' : 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) } });
    window.dispatchEvent(new CustomEvent('zouave:tool', { detail: { name: call.name, call_id: call.call_id, result, mode } }));
  }
  if (calls.length) send({ type: 'response.create' });
}
function handleMessage(raw: string) {
  let envelope;
  try { envelope = JSON.parse(raw); } catch { return; }
  window.dispatchEvent(new CustomEvent('zouave:voice-event', { detail: envelope }));
  if (envelope.type === 'session.closed') { cleanup(); return; }
  if (envelope.type === 'error') { notify(envelope.error?.message ?? 'Une erreur vocale est survenue.'); return; }
  const event = envelope.type === 'response.event' ? envelope.event : envelope;
  if (mode === 'live' && event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
    queue = queue.then(() => runCalls([event.item])).catch(error => notify(error.message));
  } else if (mode === 'realtime' && event.type === 'response.done') {
    queue = queue.then(() => runCalls((event.response?.output ?? []).filter((item: ToolCall) => item.type === 'function_call'))).catch(error => notify(error.message));
  }
  if (envelope.type === 'session.input_transcript.delta' || event.type === 'conversation.item.input_audio_transcription.delta') {
    const el = $('input-caption'); el.hidden = false; el.textContent = `${el.textContent ?? ''}${envelope.delta ?? event.delta ?? ''}`.slice(-350); resetIdle();
  }
  if (event.type === 'conversation.item.input_audio_transcription.completed') { $('input-caption').hidden = false; $('input-caption').textContent = event.transcript; resetIdle(); }
  if (envelope.type === 'session.output_transcript.delta' || event.type === 'response.output_audio_transcript.delta' || event.type === 'response.audio_transcript.delta') {
    if (!$('avatar-ring').classList.contains('speaking')) $('caption').textContent = '';
    setSpeaking(true); $('caption').textContent = `${$('caption').textContent ?? ''}${envelope.delta ?? event.delta ?? ''}`.slice(-700); resetIdle();
  }
  if (event.type === 'output_audio_buffer.stopped' || envelope.type === 'session.output_audio.done' || event.type === 'response.output_audio.done' || event.type === 'response.audio.done') { setSpeaking(false); }
  if (event.type === 'input_audio_buffer.speech_started') { $('input-caption').textContent = ''; setSpeaking(false); resetIdle(); }
}
function cleanup() {
  stopped = true; clearTimeout(idleTimer); stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  channel?.close(); channel = undefined; pc?.close(); pc = undefined; audio.pause(); audio.srcObject = null;
  $('avatar-ring').classList.remove('listening', 'speaking'); setSpeaking(false);
  $('mic').setAttribute('aria-pressed', 'false'); $('mic').setAttribute('aria-label', 'Activer la voix'); $('voice-state').textContent = 'Votre vigie parisienne';
}
export async function stopVoice() {
  if (mode === 'live' && channel?.readyState === 'open') {
    const active = channel;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { active.removeEventListener('message', listener); resolve(); }, 4000);
      const listener = (event: MessageEvent) => { if (JSON.parse(event.data).type === 'session.closed') { clearTimeout(timer); active.removeEventListener('message', listener); resolve(); } };
      active.addEventListener('message', listener); send({ type: 'session.close' });
    });
  }
  cleanup();
}
async function startVoice() {
  stopped = false;
  $('voice-state').textContent = 'Connexion au fleuve…';
  try {
    const settings = await api('/api/config');
    if (!settings.voice) throw new Error('La voix n’est pas configurée. Les boutons et le texte restent disponibles.');
    mode = settings.mode;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc = new RTCPeerConnection();
    pc.ontrack = event => { audio.srcObject = event.streams[0]; void audio.play().catch(() => notify('Autorisez la lecture audio dans votre navigateur.')); };
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    channel = pc.createDataChannel(mode === 'live' ? 'live-events' : 'oai-events');
    seen.clear(); queue = Promise.resolve();
    channel.onmessage = event => handleMessage(event.data);
    channel.onopen = () => {
      $('voice-state').textContent = 'À votre écoute'; $('avatar-ring').classList.add('listening'); $('mic').setAttribute('aria-pressed', 'true'); $('mic').setAttribute('aria-label', 'Arrêter la voix');
      resetIdle();
    };
    pc.onconnectionstatechange = () => { if (pc?.connectionState === 'failed' || pc?.connectionState === 'disconnected') { notify('La connexion vocale a été interrompue. Continuez avec les boutons.'); cleanup(); } };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const result = await api('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp: offer.sdp }) });
    if (stopped || !pc) return;
    await pc.setRemoteDescription({ type: 'answer', sdp: result.sdp });
  } catch (error) { cleanup(); notify(error instanceof Error ? error.message : 'Microphone indisponible.'); }
}
export async function toggleVoice() {
  if (busy) return;
  busy = true;
  try { if (pc) await stopVoice(); else await startVoice(); } finally { busy = false; }
}
export async function initializeVoice() {
  try {
    const result = await api('/api/config');
    if (!result.voice) { $('mic').setAttribute('disabled', ''); $('voice-state').textContent = 'Mode texte · sans micro'; $('connection-label').textContent = 'Mode texte · toutes les fonctions'; }
  } catch { $('voice-state').textContent = 'Mode texte disponible'; }
  window.addEventListener('pagehide', cleanup);
}
