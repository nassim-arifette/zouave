#!/usr/bin/env node
// Before / after for the Google Maps option: the same viewpoints in the default view (MapLibre 3D map, Panoramax street
// scene) and with Google (Photorealistic 3D Tiles, Street View with the water overlay), plus what each Google view
// costs in requests and data. Start the app first with the Google keys (npm start), then:
//   node scripts/compare-google.mjs [--out docs/google-compare] [--url http://127.0.0.1:3000]
// Writes <out>/<view>-<maplibre|google|panoramax|streetview>.jpg and <out>/metrics.json. Without keys, only the default
// views are captured and metrics.json says which Google features were unavailable.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({ options: { out: { type: 'string', default: 'docs/google-compare' }, url: { type: 'string', default: process.env.ZOUAVE_URL ?? 'http://127.0.0.1:3000' } } });
const out = path.resolve(values.out);
await mkdir(out, { recursive: true });

// The local app is reached directly; Google (Street View in the page) goes through the environment's proxy, if any.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
// Cloud sessions ship a Chromium at /opt/pw-browsers/chromium that matches any Playwright version.
const executablePath = process.env.CHROME_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, proxy, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(() => { try { localStorage.setItem('zouave:speak', 'off'); } catch {} });
const page = await context.newPage();
page.setDefaultTimeout(240_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));

// Google 3D tiles all pass through the server proxy: count them and their bytes per view.
let tiles = { requests: 0, bytes: 0, failed: 0, root: 0, last: 0 };
page.on('response', async response => {
  const url = response.url();
  if (!url.includes('/api/google/3d/')) return;
  tiles.requests++; tiles.last = Date.now();
  if (url.includes('/3dtiles/root.json')) tiles.root++;
  if (!response.ok()) { tiles.failed++; return; }
  try { tiles.bytes += (await response.body()).length; } catch { /* aborted */ }
});

const until = (fn, arg, timeout = 180_000) => page.waitForFunction(fn, arg, { timeout, polling: 500 });
const snap = async name => { await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86 }); console.log('shot', name); };
// Each view twice: as in the app, and "clean" (interface hidden) to compare the rendering itself.
const CLEAN = 'header.topbar, main, #toast, #immersion-exit, #view-3d-toggle, #hood, .maplibregl-ctrl-top-right, .zouave-nudge { opacity: 0 !important; transition: none !important; animation: none !important; }';
async function shot(name) {
  await snap(name);
  const style = await page.addStyleTag({ content: CLEAN });
  await page.waitForTimeout(400); await snap(`${name}-clean`);
  await style.evaluate(element => element.remove());
}
const closeDialogs = () => page.evaluate(() => { for (const id of ['hero-dialog', 'photo-dialog', 'streetview-dialog']) { const dialog = document.getElementById(id); if (dialog?.open) dialog.close(); } });
async function ask(message) {
  const before = await page.evaluate(() => document.getElementById('caption').textContent);
  await page.locator('#chat').fill(message); await page.locator('#chat').press('Enter');
  await until(previous => { const text = document.getElementById('caption').textContent; return text !== previous && !/^Checking/.test(text); }, before);
  return page.evaluate(() => document.getElementById('caption').textContent);
}
/** Turns the Google view on and waits until the tileset is loaded and no tile has arrived for 6 s (at most 150 s). */
async function google3d() {
  tiles = { requests: 0, bytes: 0, failed: 0, root: 0, last: Date.now() };
  const started = Date.now();
  await page.click('#view-3d-toggle');
  await until(() => { const status = document.getElementById('google-3d-status'); return status.hidden || /missing|unavailable/i.test(status.textContent); });
  const loaded = Date.now() - started;
  const problem = await page.evaluate(() => { const status = document.getElementById('google-3d-status'); return status.hidden ? null : status.textContent; });
  if (!problem) while (Date.now() - tiles.last < 6000 && Date.now() - started < 150_000) await page.waitForTimeout(1000);
  return { tileset_ms: loaded, settled_ms: Date.now() - started, tile_requests: tiles.requests, root_requests: tiles.root, failed: tiles.failed, megabytes: Math.round(tiles.bytes / 1e5) / 10, problem };
}
const mapOnly = () => page.click('#view-3d-toggle');
async function zoomOut(steps) {
  await page.mouse.move(800, 380);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(250); }
  await page.waitForTimeout(3500);
}

const metrics = { generated: new Date().toISOString(), viewport: '1600×900, software WebGL (SwiftShader)', views: {}, errors };
await page.goto(values.url, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);
metrics.google = await page.evaluate(() => fetch('/api/google/status').then(response => response.json()).then(status => ({ tiles3d: status.tiles3d, streetview: status.streetview })));
console.log('Google features:', metrics.google);

// 1 · Your street, 1910 scenario: the address close-up, then street level.
metrics.views.home = { answer: await ask('What about my home?') };
await until(() => document.getElementById('hero-dialog')?.open, undefined, 120_000).catch(() => null);
await page.waitForTimeout(9000);
if (await page.evaluate(() => document.getElementById('hero-dialog')?.open)) await snap('street-panoramax');
await closeDialogs(); await page.waitForTimeout(3000);
await shot('home-maplibre');
if (metrics.google.tiles3d) { metrics.views.home.google = await google3d(); await shot('home-google'); await mapOnly(); await page.waitForTimeout(1500); }
if (metrics.google.streetview && await page.locator('#show-streetview').count()) {
  const started = Date.now();
  await page.click('#show-streetview');
  await until(() => document.getElementById('streetview-dialog')?.open && document.getElementById('streetview-status').hidden, undefined, 90_000).catch(() => null);
  metrics.views.street = { streetview_ms: Date.now() - started, status: await page.evaluate(() => { const status = document.getElementById('streetview-status'); return status.hidden ? 'loaded' : status.textContent; }) };
  await page.waitForTimeout(6000);
  await snap('street-streetview');
  await closeDialogs();
}

// 2 · The flooded city around the address, zoomed out.
await zoomOut(6);
await shot('overview-maplibre');
if (metrics.google.tiles3d) { metrics.views.overview = await google3d(); await shot('overview-google'); await mapOnly(); await page.waitForTimeout(1500); }

// 3 · A landmark: the Alma bridge, home of the Zouave statue.
metrics.views.alma = { answer: await ask('fly to place de l’Alma, 75008 Paris') };
await page.waitForTimeout(4000); await closeDialogs(); await zoomOut(3);
await shot('alma-maplibre');
if (metrics.google.tiles3d) { metrics.views.alma.google = await google3d(); await shot('alma-google'); await mapOnly(); }

await writeFile(path.join(out, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));
await browser.close();
