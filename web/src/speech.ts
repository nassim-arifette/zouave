// The Zouave's browser voice: speechSynthesis reads his answers aloud (English, local voices first) and SpeechRecognition turns the microphone
// into a typed intent. Used when the server has no OpenAI voice; both are optional browser features and fail silently.
import { setSpeaking } from './avatar.ts';

type Recognizer = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null };
const synth = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis;
const Recognition = (window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognizer }).webkitSpeechRecognition;
export const browserVoice = { canSpeak: Boolean(synth), canListen: Boolean(Recognition) };

const PREF = 'zouave:speak';
let enabled = (() => { try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; } })();
export const speakEnabled = () => enabled && (browserVoice.canSpeak || serverVoice);
export function setSpeakEnabled(on: boolean) {
  enabled = on;
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* private mode: keep the in-memory choice */ }
  if (!on) stopSpeaking();
}

function zouaveVoice() {
  // Offline-capable (local) voices first: the demo must not depend on the venue's network.
  const voices = (synth?.getVoices().filter(voice => voice.lang.toLowerCase().startsWith('en')) ?? []).sort((a, b) => Number(b.localService) - Number(a.localService));
  return voices.find(voice => /^en-GB/i.test(voice.lang) && /daniel|arthur|george|male/i.test(voice.name)) ?? voices.find(voice => /^en-GB/i.test(voice.lang)) ?? voices.find(voice => /^en-US/i.test(voice.lang)) ?? voices[0];
}

/** With ELEVENLABS_API_KEY or OPENAI_API_KEY on the server, the Zouave speaks with a narrated voice (cached server-side); otherwise the browser voice. */
let serverVoice = false;
export function useServerVoice(on: boolean) { serverVoice = on; }
let playing: HTMLAudioElement | undefined, fetching: AbortController | undefined, serverBusy = false, paused = false;
const clean = (text: string) => text.replace(/https?:\/\/\S+/g, '').replace(/[↗↑·]/g, ' ').replace(/\s+/g, ' ').trim();
/** ElevenLabs v3 audio tags ([excited], [whispers]…) steer the expressive voice; captions and the browser voice never show or read them. */
export const stripTags = (text: string) => text.replace(/\[[a-z][a-z '-]{0,30}\]\s*/gi, '').replace(/\s+/g, ' ').trim();

/** Reads `text` aloud with the mouth animation synced to the voice; returns false when it cannot speak.
 * `expressive` asks the server for the acted voice (ElevenLabs v3, audio tags kept). */
export function speak(text: string, options: { expressive?: boolean } = {}) {
  if (!speakEnabled() || !stripTags(text)) return false;
  stopSpeaking();
  paused = false;
  if (serverVoice) { void speakWithServer(clean(text), Boolean(options.expressive)); return true; }
  return speakWithBrowser(stripTags(clean(text)));
}
function speakWithBrowser(text: string) {
  if (!synth) return false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-GB'; utterance.rate = 1; utterance.pitch = 0.9;
  const voice = zouaveVoice(); if (voice) utterance.voice = voice;
  utterance.onstart = utterance.onboundary = () => setSpeaking(true);
  utterance.onend = utterance.onerror = () => setSpeaking(false);
  synth.speak(utterance);
  return true;
}
async function speakWithServer(text: string, expressive = false) {
  const controller = fetching = new AbortController();
  serverBusy = true;
  try {
    const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, expressive }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(expressive ? 9000 : 6000)]) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const url = URL.createObjectURL(await response.blob());
    if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
    const audio = playing = new Audio(url);
    const done = () => { if (playing === audio) { playing = undefined; serverBusy = false; } setSpeaking(false); URL.revokeObjectURL(url); };
    // Only an audible, playing line moves the mouth (pause() still fires a last timeupdate).
    audio.onplaying = audio.ontimeupdate = () => { if (playing === audio && !audio.paused) setSpeaking(true); };
    audio.onended = audio.onerror = done;
    if (!paused) await audio.play(); // paused while loading: resumeSpeaking() starts it
  } catch (error) {
    if (controller.signal.aborted && fetching !== controller) return;
    serverBusy = false;
    // One failure (network, quota) switches the session to the browser voice: no more waits on stage.
    if (browserVoice.canSpeak) serverVoice = false;
    console.warn('Narrated voice unavailable, using the browser voice:', error);
    if (speakWithBrowser(stripTags(text)) && paused) synth?.pause();
  }
}
/** True while the Zouave is speaking or about to (narrated audio still loading counts). */
export function isSpeaking() { return serverBusy || Boolean(synth && (synth.speaking || synth.pending)); }
export function pauseSpeaking() { paused = true; playing?.pause(); synth?.pause(); setSpeaking(false); }
export function resumeSpeaking() { paused = false; void playing?.play().catch(() => {}); synth?.resume(); if (synth?.speaking) setSpeaking(true); }
export function stopSpeaking() {
  fetching?.abort(); fetching = undefined;
  if (playing) { playing.onended = playing.onerror = playing.onplaying = playing.ontimeupdate = null; playing.pause(); playing.removeAttribute('src'); playing = undefined; }
  serverBusy = false; paused = false;
  if (synth?.speaking || synth?.pending) synth.cancel();
  setSpeaking(false);
}

let recognizer: Recognizer | undefined;
export const isListening = () => Boolean(recognizer);
/** Listens for one spoken sentence; `onText` receives the final transcript, `onInterim` the words so far. */
export function listen(handlers: { onText: (text: string) => void; onInterim: (text: string) => void; onEnd: () => void; onError: (message: string) => void }) {
  if (!Recognition || recognizer) return;
  stopSpeaking();
  const current = recognizer = new Recognition();
  current.lang = 'en-US'; current.interimResults = true; current.continuous = false;
  current.onresult = event => {
    let interim = '', final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) (event.results[i].isFinal ? (final += event.results[i][0].transcript) : (interim += event.results[i][0].transcript));
    if (final.trim()) handlers.onText(final.trim()); else handlers.onInterim(interim);
  };
  current.onerror = event => { if (event.error !== 'no-speech' && event.error !== 'aborted') handlers.onError(event.error === 'not-allowed' ? 'Allow the microphone to talk to the Zouave.' : 'I did not quite catch that. Try again or type to me.'); };
  current.onend = () => { if (recognizer === current) recognizer = undefined; handlers.onEnd(); };
  try { current.start(); } catch { recognizer = undefined; handlers.onEnd(); }
}
export function stopListening() { recognizer?.stop(); }
