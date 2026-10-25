import './style.css';
import { map, mapReady } from './map.ts';
import { $, niveau_seine, notify } from './tools.ts';
import { routeIntent } from './intent.ts';
import { initializeTimeline } from './timeline.ts';
import { initializeImmersion } from './immersion.ts';
import { attachView3D } from './map.ts';
import { createView3D } from './view3d.ts';
import { loadGoogleStatus } from './tools.ts';
import { initializeVoice, isVoiceSessionActive, toggleVoice } from './voice.ts';
import { browserVoice, setSpeakEnabled, speak, speakEnabled, stopSpeaking } from './speech.ts';
import { initializeAvatar, animateAnswer, setSpeaking } from './avatar.ts';
import { formatArgs, type ToolTrace } from './trace.ts';
let running = false;
/** Moves the Zouave's previous reply into the conversation thread and adds the visitor's message. */
function pushHistory(message: string) {
  const thread = $('thread'), trace = $('trace');
  const bubble = (who: 'user' | 'zouave', text: string) => { const p = document.createElement('p'); p.className = `bubble bubble-${who}`; p.textContent = text; thread.append(p); };
  // The previous answer keeps its tool calls above it in the history: question → tools → answer.
  if (trace.childElementCount) { const calls = document.createElement('div'); calls.className = 'trace trace-past'; calls.append(...trace.children); thread.append(calls); }
  const previous = $('caption').textContent?.trim();
  if (previous) bubble('zouave', previous);
  bubble('user', message);
  while (thread.children.length > 16) thread.firstElementChild!.remove();
  $('input-caption').hidden = true;
}
/** Shows each tool call behind the current answer: function, arguments, and the official figure it returned. */
function showTrace({ name, args, ok, summary, ms, via }: ToolTrace) {
  const row = document.createElement('div'); row.className = `trace-call${ok ? '' : ' trace-failed'}`;
  row.title = `${name}(${JSON.stringify(args)}) · ${ms} ms${via === 'voice' ? ' · called by the OpenAI voice agent' : ''}`;
  const part = (className: string, text: string) => { const span = document.createElement('span'); span.className = className; span.textContent = text; row.append(span); };
  part('trace-fn', `ƒ ${name}`); part('trace-args', `(${formatArgs(args)})`); part('trace-out', `→ ${summary}`);
  if (via === 'voice') part('trace-via', 'Realtime');
  const trace = $('trace'); trace.append(row);
  while (trace.childElementCount > 6) trace.firstElementChild!.remove();
}
window.addEventListener('zouave:trace', event => showTrace((event as CustomEvent<ToolTrace>).detail));
function reply(text: string) {
  $('caption').textContent = text;
  if (isVoiceSessionActive() || !speak(text)) animateAnswer(text);
}
export async function runIntent(message: string) {
  if (running || !message.trim()) return;
  running = true;
  setSpeaking(false); stopSpeaking();
  pushHistory(message.trim());
  $('caption').textContent = 'Checking the official data…';
  try { reply(await routeIntent(message)); }
  catch (error) { const text = error instanceof Error ? error.message : 'That data is unavailable.'; reply(text); notify(text); }
  finally { running = false; }
}
window.addEventListener('zouave:heard', event => { void runIntent((event as CustomEvent<string>).detail); });
const speakToggle = $<HTMLButtonElement>('speak-toggle');
const syncSpeakToggle = () => { const on = speakEnabled(); speakToggle.setAttribute('aria-pressed', String(on)); speakToggle.title = `Zouave voice: ${on ? 'on' : 'off'}`; };
if (!browserVoice.canSpeak) speakToggle.hidden = true;
speakToggle.addEventListener('click', () => { setSpeakEnabled(!speakEnabled()); syncSpeakToggle(); });
syncSpeakToggle();
document.querySelectorAll<HTMLButtonElement>('[data-intent]').forEach(button => button.addEventListener('click', () => { void runIntent(button.dataset.intent!); }));
document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => button.addEventListener('click', () => { void runIntent(button.dataset.scenario === 'pire' ? 'worst case' : button.dataset.scenario === '1910' ? '1910' : 'today'); }));
$('chat-form').addEventListener('submit', event => { event.preventDefault(); const input = $<HTMLInputElement>('chat'); const message = input.value; input.value = ''; void runIntent(message); });
window.addEventListener('keydown', event => { if ((event.target as HTMLElement)?.matches('input,textarea,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey || $<HTMLDialogElement>('photo-dialog').open || $<HTMLDialogElement>('hero-dialog').open) return; const button = document.querySelectorAll<HTMLButtonElement>('[data-intent]')[Number(event.key) - 1]; if (button) { event.preventDefault(); void runIntent(button.dataset.intent!); } });
$('mic').addEventListener('click', () => { void toggleVoice(); });
$('photo-close').addEventListener('click', () => $<HTMLDialogElement>('photo-dialog').close());
$('hero-close').addEventListener('click', () => $<HTMLDialogElement>('hero-dialog').close());
initializeAvatar();
initializeTimeline();
initializeImmersion(map);
void initializeVoice();
void niveau_seine().catch(error => notify(error.message));
setInterval(() => { void niveau_seine().catch(error => notify(error.message)); }, 15 * 60_000);
void mapReady.catch(error => notify(`${error.message} — reload the page to try again.`));
map.on('error', event => { console.warn('Map data error:', event.error.message); });

const view3d = createView3D({ container: $('google-3d'), toggle: $<HTMLButtonElement>('view-3d-toggle'), status: $('google-3d-status'), attribution: $('google-3d-attribution'), legend: $('google-3d-legend'), body: document.body });
attachView3D(view3d);
$('view-3d-toggle').addEventListener('click', () => { void view3d.toggle(); });
void loadGoogleStatus();
$('streetview-close').addEventListener('click', () => $<HTMLDialogElement>('streetview-dialog').close());
