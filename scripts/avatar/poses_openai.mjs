#!/usr/bin/env node
// Generates new poses and angles of the Zouave mascot with OpenAI image edits of the current avatar (same statue,
// face, stone and framing; transparent background), so the interface can react: greeting, pointing at the map,
// worried, thinking, reassuring, soaked, facing the visitor. Writes web/public/zouave/<variant>/poses/<pose>.webp
// (1024 and 512) and poses.json, which web/src/mascot.ts loads; without them the interface falls back to CSS motion.
// Usage: OPENAI_API_KEY=... node scripts/avatar/poses_openai.mjs [--variant living-stone] [--poses wave,point] [--quality high]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
export const POSES = {
  facing: 'His head and gaze now turn to face the viewer directly, attentive and friendly, as if listening to a question.',
  point: 'He raises his right arm and points with his index finger up and towards the viewer\'s left, as if showing something on a big map beside him; head turned in the same direction.',
  wave: 'He raises one open hand at shoulder height in a warm greeting, a slight welcoming smile.',
  worried: 'Worried expression, eyebrows raised, looking down as if flood water were rising around him, one hand pressed to his chest.',
  thinking: 'Thoughtful: one hand on his chin, eyes looking up and to the side, as if checking his memory.',
  reassure: 'A calm, reassuring smile, one open palm turned towards the viewer as if saying "no panic, here is what to do".',
  soaked: 'The same statue drenched after a flood: wet darker stone, water droplets running down his face, beard and robe, a resigned but good-humoured look.',
};
const BASE = 'Edit this image of a stone statue bust of a 19th-century French Zouave soldier. Keep the same statue: identical face, beard, headgear, robe, carved details, stone material and colours, same lighting, same bust framing, size and position in the frame, cut off at the same height. Transparent background, no pedestal, no added text. New pose: ';

export function editForm({ image, pose, model, quality }) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ model, prompt: BASE + POSES[pose], quality, size: '1024x1024', n: 1, background: 'transparent', input_fidelity: 'high', output_format: 'png' })) form.append(key, String(value));
  form.append('image[]', new Blob([image], { type: 'image/png' }), 'avatar.png');
  return form;
}

export async function generatePoses({ variant = 'living-stone', poses = Object.keys(POSES), model = 'gpt-image-2.5-sunburst', quality = 'high', key = process.env.OPENAI_API_KEY, fetcher = fetch, root = path.join(here, '..', '..', 'web', 'public', 'zouave'), log = console.log } = {}) {
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const dir = path.join(root, variant);
  const image = await readFile(path.join(dir, 'avatar@2x.png'));
  await mkdir(path.join(dir, 'poses'), { recursive: true });
  const manifestFile = path.join(dir, 'poses.json');
  const manifest = await readFile(manifestFile, 'utf8').then(JSON.parse).catch(() => ({ poses: {} }));
  const results = await Promise.allSettled(poses.map(async pose => {
    if (!POSES[pose]) throw new Error(`unknown pose ${pose}`);
    const response = await fetcher('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: editForm({ image, pose, model, quality }) });
    const body = await response.json();
    if (!response.ok) throw new Error(`${pose}: ${response.status} ${body.error?.message ?? ''}`);
    const png = Buffer.from(body.data[0].b64_json, 'base64');
    await writeFile(path.join(dir, 'poses', `${pose}.png`), png);
    await sharp(png).resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 88 }).toFile(path.join(dir, 'poses', `${pose}@2x.webp`));
    await sharp(png).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85 }).toFile(path.join(dir, 'poses', `${pose}.webp`));
    manifest.poses[pose] = `poses/${pose}@2x.webp`;
    return pose;
  }));
  for (const result of results) result.status === 'fulfilled' ? log(`✓ ${result.value}`) : log(`✗ ${result.reason.message}`);
  manifest.model = model; manifest.generated = new Date().toISOString();
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`poses.json: ${Object.keys(manifest.poses).join(', ') || 'none'} — review the images before committing.`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { variant: { type: 'string', default: 'living-stone' }, poses: { type: 'string', default: Object.keys(POSES).join(',') }, model: { type: 'string', default: 'gpt-image-2.5-sunburst' }, quality: { type: 'string', default: 'high' } } });
  try { await generatePoses({ variant: values.variant, poses: values.poses.split(','), model: values.model, quality: values.quality }); }
  catch (error) { console.error(error.message); process.exit(1); }
}
