import { writeFileSync, readFileSync } from 'node:fs';
const segs = JSON.parse(readFileSync(process.argv[2] ?? 'script.json', 'utf8'));
const instructions = "You are a talking stone statue: the Zouave of the Pont de l'Alma in Paris. Warm, deep, slightly cheeky male voice, like an old Parisian street-wise character, calm and amused. Short sentences, unhurried rhythm, crisp articulation. English with a light, charming French accent (a Parisian statue speaking English), still perfectly intelligible. Say French names (Pont de l'Alma, Austerlitz, Inès, rue Traversière, Institut Paris Région) with a French pronunciation.";
for (const s of segs) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'verse', input: s.text, instructions, response_format: 'wav' }) });
  if (!r.ok) { console.error(s.id, r.status, await r.text()); continue; }
  writeFileSync(`tts/${s.id}.raw.wav`, Buffer.from(await r.arrayBuffer())); console.log(s.id, 'ok');
}
