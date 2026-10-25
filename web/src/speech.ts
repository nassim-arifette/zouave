// The Zouave's browser voice: speechSynthesis reads his answers aloud (fr-FR) and SpeechRecognition turns the microphone
// into a typed intent. Used when the server has no OpenAI voice; both are optional browser features and fail silently.
import { setSpeaking } from './avatar.ts';

type Recognizer = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null };
const synth = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis;
const Recognition = (window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognizer }).webkitSpeechRecognition;
export const browserVoice = { canSpeak: Boolean(synth), canListen: Boolean(Recognition) };

const PREF = 'zouave:speak';
let enabled = (() => { try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; } })();
export const speakEnabled = () => enabled && browserVoice.canSpeak;
export function setSpeakEnabled(on: boolean) {
  enabled = on;
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* private mode: keep the in-memory choice */ }
  if (!on) stopSpeaking();
}

function frenchVoice() {
  const voices = synth?.getVoices().filter(voice => voice.lang.toLowerCase().startsWith('fr')) ?? [];
  return voices.find(voice => voice.lang === 'fr-FR' && /thomas|daniel|paul|henri|male|homme/i.test(voice.name)) ?? voices.find(voice => voice.lang === 'fr-FR') ?? voices[0];
}

/** Reads `text` aloud with the mouth animation synced to the utterance; returns false when it cannot speak. */
export function speak(text: string) {
  if (!speakEnabled() || !text.trim()) return false;
  synth!.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/https?:\/\/\S+/g, '').replace(/[↗↑·]/g, ' ').replace(/\s+/g, ' ').trim());
  utterance.lang = 'fr-FR'; utterance.rate = 1.02; utterance.pitch = 0.92;
  const voice = frenchVoice(); if (voice) utterance.voice = voice;
  utterance.onstart = utterance.onboundary = () => setSpeaking(true);
  utterance.onend = utterance.onerror = () => setSpeaking(false);
  synth!.speak(utterance);
  return true;
}
export function stopSpeaking() { if (synth?.speaking || synth?.pending) synth.cancel(); setSpeaking(false); }

let recognizer: Recognizer | undefined;
export const isListening = () => Boolean(recognizer);
/** Listens for one French sentence; `onText` receives the final transcript, `onInterim` the words so far. */
export function listen(handlers: { onText: (text: string) => void; onInterim: (text: string) => void; onEnd: () => void; onError: (message: string) => void }) {
  if (!Recognition || recognizer) return;
  stopSpeaking();
  const current = recognizer = new Recognition();
  current.lang = 'fr-FR'; current.interimResults = true; current.continuous = false;
  current.onresult = event => {
    let interim = '', final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) (event.results[i].isFinal ? (final += event.results[i][0].transcript) : (interim += event.results[i][0].transcript));
    if (final.trim()) handlers.onText(final.trim()); else handlers.onInterim(interim);
  };
  current.onerror = event => { if (event.error !== 'no-speech' && event.error !== 'aborted') handlers.onError(event.error === 'not-allowed' ? 'Autorisez le microphone pour parler au Zouave.' : 'Je n’ai pas bien entendu. Réessayez ou écrivez-moi.'); };
  current.onend = () => { if (recognizer === current) recognizer = undefined; handlers.onEnd(); };
  try { current.start(); } catch { recognizer = undefined; handlers.onEnd(); }
}
export function stopListening() { recognizer?.stop(); }
