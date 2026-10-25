#!/usr/bin/env node
// Builds a single-file before/after page from scripts/compare-google.mjs output: one slider per viewpoint (default view
// vs Google), the measured load and data figures, and an optional verdict written after looking at the images.
//   node scripts/compare-page.mjs [--dir docs/google-compare] [--notes docs/google-compare/notes.html]
// Writes <dir>/index.html with the images inlined, so it can be sent or published as is.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { dir: { type: 'string', default: 'docs/google-compare' }, notes: { type: 'string' } } });
const dir = path.resolve(values.dir);
const metrics = JSON.parse(await readFile(path.join(dir, 'metrics.json'), 'utf8'));
const notesFile = values.notes ?? path.join(dir, 'notes.html');
const notes = existsSync(notesFile) ? await readFile(notesFile, 'utf8') : '';
const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const image = async name => existsSync(path.join(dir, `${name}.jpg`)) ? `data:image/jpeg;base64,${(await readFile(path.join(dir, `${name}.jpg`))).toString('base64')}` : null;
const seconds = ms => `${(ms / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} s`;

const VIEWS = [
  { id: 'home', title: 'Your street from above', place: '4 rue Traversière, 1910 scenario', before: 'home-maplibre', after: 'home-google', beforeLabel: 'Today: MapLibre 3D', afterLabel: 'Google Photorealistic 3D', stats: metrics.views.home?.google },
  { id: 'overview', title: 'The flooded neighbourhood', place: 'Around 4 rue Traversière (Gare de Lyon), zoomed out', before: 'overview-maplibre', after: 'overview-google', beforeLabel: 'Today: MapLibre 3D', afterLabel: 'Google Photorealistic 3D', stats: metrics.views.overview },
  { id: 'alma', title: 'A landmark', place: 'Place de l’Alma, the Zouave’s bridge', before: 'alma-maplibre', after: 'alma-google', beforeLabel: 'Today: MapLibre 3D', afterLabel: 'Google Photorealistic 3D', stats: metrics.views.alma?.google },
  { id: 'street', title: 'Street level', place: '4 rue Traversière, water at the estimated height', before: 'street-panoramax', after: 'street-streetview', beforeLabel: 'Today: Panoramax photo + depth', afterLabel: 'Google Street View + water plane', stats: metrics.views.street, clean: false },
];

async function section(view) {
  const [before, after, beforeClean, afterClean] = await Promise.all([image(view.before), image(view.after), view.clean === false ? null : image(`${view.before}-clean`), view.clean === false ? null : image(`${view.after}-clean`)]);
  if (!before && !after) return '';
  const stats = view.stats;
  const facts = stats?.problem ? [`Google view failed: ${escape(stats.problem)}`]
    : view.id === 'street' ? (stats ? [`Street View ready in ${seconds(stats.streetview_ms)}`, escape(stats.status)] : [])
    : stats ? [`Tileset in ${seconds(stats.tileset_ms)}`, `settled in ${seconds(stats.settled_ms)}`, `${stats.tile_requests} tile requests`, `${stats.megabytes} MB`, stats.failed ? `${stats.failed} failed` : ''].filter(Boolean) : [];
  const pair = (b, a, extra = '') => a
    ? `<div class="compare${extra}" style="--split:50%"><img src="${b}" alt="${escape(view.beforeLabel)}"><div class="after"><img src="${a}" alt="${escape(view.afterLabel)}"></div><i class="divider"></i><span class="tag left">${escape(view.beforeLabel)}</span><span class="tag right">${escape(view.afterLabel)}</span><input type="range" min="0" max="100" value="50" aria-label="Move the divider between ${escape(view.beforeLabel)} and ${escape(view.afterLabel)}"></div>`
    : `<div class="compare single${extra}"><img src="${b}" alt="${escape(view.beforeLabel)}"><span class="tag left">${escape(view.beforeLabel)}</span><span class="tag right muted">Google: not captured</span></div>`;
  return `<section id="${view.id}">
  <header><h2>${escape(view.title)}</h2><p>${escape(view.place)}</p>${beforeClean ? '<label class="clean"><input type="checkbox"> Hide the interface</label>' : ''}</header>
  ${pair(before, after)}${beforeClean ? pair(beforeClean, afterClean, ' is-clean') : ''}
  ${facts.length ? `<ul class="facts">${facts.map(fact => `<li>${fact}</li>`).join('')}</ul>` : ''}
</section>`;
}

const google = metrics.google ?? {};
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Google Maps comparison</title>
<style>
:root { --bg:#f4f7f6; --panel:#ffffff; --text:#11202a; --muted:#566872; --line:#d5dfe0; --accent:#2f7d62; --water:#1d6f8f; --warn:#9a6a1c; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#081219; --panel:#0f1d26; --text:#eef4f0; --muted:#9fb3b3; --line:#22343d; --accent:#a4d6bc; --water:#8fd3e2; --warn:#edce9d; } }
:root[data-theme="dark"] { --bg:#081219; --panel:#0f1d26; --text:#eef4f0; --muted:#9fb3b3; --line:#22343d; --accent:#a4d6bc; --water:#8fd3e2; --warn:#edce9d; }
* { box-sizing:border-box; margin:0; }
body { background:var(--bg); color:var(--text); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding:32px 16px 64px; }
main { max-width:1180px; margin:0 auto; display:grid; gap:40px; }
h1 { font:400 clamp(32px, 5vw, 52px)/1.1 Georgia, "Times New Roman", serif; letter-spacing:-.02em; }
h1 em { color:var(--water); }
.lede { color:var(--muted); max-width:70ch; margin-top:10px; }
.status { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; padding:0; list-style:none; }
.status li { border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:14px; }
.status .on { color:var(--accent); } .status .off { color:var(--warn); }
.notes { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:20px 24px; }
.notes h2 { font:600 20px/1.3 system-ui, sans-serif; margin-bottom:8px; }
.notes p + p, .notes ul { margin-top:8px; } .notes ul { padding-left:20px; }
section header { display:flex; flex-wrap:wrap; align-items:baseline; gap:6px 16px; margin-bottom:12px; }
section h2 { font:400 28px/1.2 Georgia, serif; }
section header p { color:var(--muted); flex:1 1 auto; }
.clean { font-size:14px; color:var(--muted); cursor:pointer; display:flex; gap:6px; align-items:center; }
.compare { position:relative; border-radius:14px; overflow:hidden; border:1px solid var(--line); background:#000; aspect-ratio:16/9; user-select:none; }
.compare img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
.compare .after { position:absolute; inset:0; clip-path:inset(0 0 0 var(--split)); }
.compare .divider { position:absolute; top:0; bottom:0; left:var(--split); width:2px; margin-left:-1px; background:#fff; box-shadow:0 0 12px rgba(0,0,0,.6); pointer-events:none; }
.compare input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:ew-resize; margin:0; }
.compare.is-clean { display:none; }
section.clean-on .compare:not(.is-clean) { display:none; } section.clean-on .compare.is-clean { display:block; }
.tag { position:absolute; top:12px; padding:4px 10px; border-radius:8px; background:rgba(4,10,15,.78); color:#eef4f0; font-size:13px; font-weight:600; pointer-events:none; }
.tag.left { left:12px; } .tag.right { right:12px; } .tag.muted { color:#edce9d; }
.facts { display:flex; flex-wrap:wrap; gap:8px; list-style:none; padding:0; margin-top:10px; color:var(--muted); font-size:14px; }
.facts li { border:1px solid var(--line); border-radius:8px; padding:3px 10px; }
footer { color:var(--muted); font-size:13px; }
@media (max-width:600px) { body { padding-top:20px; } section h2 { font-size:22px; } .tag { font-size:11px; top:8px; } }
</style>
</head>
<body>
<main>
  <div>
    <h1>Google Maps, <em>before and after</em></h1>
    <p class="lede">The same viewpoints of the Zouave app with the current open-data rendering and with Google (Photorealistic 3D Tiles, Street View), captured by <code>scripts/compare-google.mjs</code> on ${escape(new Date(metrics.generated).toLocaleString('en-GB', { timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'short' }))} (Paris). Drag across each image to compare.</p>
    <ul class="status"><li class="${google.tiles3d ? 'on' : 'off'}">Photorealistic 3D: ${google.tiles3d ? 'enabled' : 'no key'}</li><li class="${google.streetview ? 'on' : 'off'}">Street View: ${google.streetview ? 'enabled' : 'no key'}</li><li>${escape(metrics.viewport)}</li></ul>
  </div>
  ${notes ? `<div class="notes">${notes}</div>` : ''}
  ${(await Promise.all(VIEWS.map(section))).join('\n')}
  <footer>Load times come from a software renderer (no GPU) and are slower than on a laptop; tile requests and megabytes are what a visitor's browser would download for that view. Google imagery © Google.${metrics.errors?.length ? ` Page errors during capture: ${escape(metrics.errors.join(' · '))}` : ''}</footer>
</main>
<script>
document.querySelectorAll('.compare input').forEach(input => input.addEventListener('input', () => input.parentElement.style.setProperty('--split', input.value + '%')));
document.querySelectorAll('.clean input').forEach(box => box.addEventListener('change', () => box.closest('section').classList.toggle('clean-on', box.checked)));
</script>
</body>
</html>
`;
await writeFile(path.join(dir, 'index.html'), html);
console.log(`${path.join(dir, 'index.html')} · ${Math.round(html.length / 1024)} KB`);
