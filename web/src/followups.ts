// What the Zouave suggests next, and the mood he answers with. Pure functions of the question and the answer text, so
// they never add a fact: every suggestion is a question the intent router already answers with a tool.
export type Pose = 'thinking' | 'worried' | 'reassure' | 'wave' | 'point' | 'facing';

const has = (pattern: RegExp, ...texts: string[]) => texts.some(text => pattern.test(text));

export function followUps(question: string, answer: string): string[] {
  const q = question.toLowerCase(), a = answer.toLowerCase();
  if (has(/of water in the reference scenario|cellar sector|picked/, a)) return ['Show my street flooded', 'What should I do?', 'Worse than 1910?'];
  if (has(/at the .* level, .* m at austerlitz/, a)) return ['What should I do?', 'Show me 1910', 'Seine level now'];
  if (has(/outside the mapped|footprint only|sdrif-e/, a)) return ['What about my home?', 'Show me 1910', 'What should I do?'];
  if (has(/authorities|refuge|cellar/, a) && has(/do|prepare|advice|safety|kids?|children/, q)) return ['What about my home?', 'Seine level now', 'Show me 1910'];
  if (has(/austerlitz, the seine reads/, a)) return ['Show me 1910', 'What about my home?', 'And in 2016?'];
  if (has(/reference flood, 1910|8\.62/, a)) return ['What about my home?', 'Worse than 1910?', 'And in 2016?'];
  if (has(/\b(1658|1740|1955|2016|2026)\b/, q)) return ['Show me 1910', 'What about my home?', 'What should I do?'];
  return ['Show me 1910', 'What about my home?', 'Seine level now'];
}

/** The Zouave's face for an answer: worried when water reaches the address, reassuring for advice or dry ground. */
export function moodFor(answer: string): Pose | null {
  const a = answer.toLowerCase();
  if (/unavailable|not found|invalid|first pick/.test(a)) return 'thinking';
  if (/over 2 m|1 to 2 m|0 to 1 m|of water|cellar sector exposed|inside the sdrif-e/.test(a)) return 'worried';
  if (/outside the mapped|outside the sdrif-e|authorities|refuge|with pleasure|bonjour|bientôt/.test(a)) return 'reassure';
  return null;
}

/** Said when someone pokes the statue: no figures, only an invitation to ask. */
export const QUIPS = [
  'Hé! Careful, mon ami, I am stone. Ask me about your street instead!',
  'Ha, that tickles! Shall I show you how high the Seine went in 1910?',
  'Bonjour! Press D and I will tell you my whole story.',
  'I do not forecast floods, I show the official ones. Try an address!',
  'Still standing, feet in the water. What shall we check?',
  'Click anywhere on the map and ask me: what about here?',
];
