import './style.css';
import { map, mapReady } from './map.ts';
import { $, niveau_seine, notify } from './tools.ts';
import { routeIntent } from './intent.ts';
import { initializeTimeline } from './timeline.ts';
import { initializeVoice, toggleVoice } from './voice.ts';
import { initializeAvatar, animateAnswer, setSpeaking } from './avatar.ts';
let running = false;
export async function runIntent(message: string) {
  if (running || !message.trim()) return;
  running = true;
  setSpeaking(false);
  $('caption').textContent = 'Je consulte les données officielles…';
  $('input-caption').textContent = `Vous · ${message}`; $('input-caption').hidden = false;
  try { const answer = await routeIntent(message); $('caption').textContent = answer; animateAnswer(answer); }
  catch (error) { const text = error instanceof Error ? error.message : 'La donnée est indisponible.'; $('caption').textContent = text; notify(text); }
  finally { running = false; }
}
document.querySelectorAll<HTMLButtonElement>('[data-intent]').forEach(button => button.addEventListener('click', () => { void runIntent(button.dataset.intent!); }));
document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => button.addEventListener('click', () => { void runIntent(button.dataset.scenario === 'pire' ? 'pire' : button.dataset.scenario === '1910' ? '1910' : 'aujourd’hui'); }));
$('chat-form').addEventListener('submit', event => { event.preventDefault(); const input = $<HTMLInputElement>('chat'); const message = input.value; input.value = ''; void runIntent(message); });
window.addEventListener('keydown', event => { if ((event.target as HTMLElement)?.matches('input,textarea,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey || $<HTMLDialogElement>('photo-dialog').open || $<HTMLDialogElement>('hero-dialog').open) return; const button = document.querySelectorAll<HTMLButtonElement>('[data-intent]')[Number(event.key) - 1]; if (button) { event.preventDefault(); void runIntent(button.dataset.intent!); } });
$('mic').addEventListener('click', () => { void toggleVoice(); });
$('photo-close').addEventListener('click', () => $<HTMLDialogElement>('photo-dialog').close());
$('hero-close').addEventListener('click', () => $<HTMLDialogElement>('hero-dialog').close());
initializeAvatar();
initializeTimeline();
void initializeVoice();
void niveau_seine().catch(error => notify(error.message));
setInterval(() => { void niveau_seine().catch(error => notify(error.message)); }, 15 * 60_000);
void mapReady.catch(error => notify(`${error.message} — rechargez la page pour réessayer.`));
map.on('error', event => { console.warn('Map data error:', event.error.message); });
