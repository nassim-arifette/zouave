// Real OpenAI check of the narrated voice: /api/tts must return a playable MP3 for a Story line, then replay it from
// the disk cache. Needs OPENAI_API_KEY (CI secret or .env). Billable: one short text-to-speech request.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createApp } from '../server/api.ts';
if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is not set.'); process.exit(2); }
const cache = `${await mkdtemp(`${tmpdir()}/zouave-tts-`)}/`;
const server = createApp({ tts: { cache } }).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  assert.equal((await (await fetch(`${url}/api/config`)).json()).tts, true, 'narrated voice enabled with a key');
  const text = 'Bonjour! I am the Zouave of the Pont de l’Alma. In January 1910, the Seine reached 8.62 metres at Austerlitz.';
  const post = () => fetch(`${url}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  let started = Date.now();
  const first = await post();
  const audio = Buffer.from(await first.arrayBuffer());
  assert.equal(first.status, 200, audio.toString().slice(0, 300));
  assert.equal(first.headers.get('content-type'), 'audio/mpeg');
  assert.ok(audio.length > 8000, `MP3 too small: ${audio.length} bytes`);
  assert.ok(audio.subarray(0, 3).toString() === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0), 'MP3 header');
  console.log(`OpenAI speech OK: ${audio.length} bytes in ${Date.now() - started} ms`);
  started = Date.now();
  const second = await post();
  assert.equal(Buffer.from(await second.arrayBuffer()).length, audio.length);
  console.log(`Replayed from the disk cache in ${Date.now() - started} ms`);
  await writeFile('voice-smoke.mp3', audio);
} finally { server.close(); }
