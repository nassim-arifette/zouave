import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
// Real tools.ts + real createHero with deferred texture loads: ownership of a request covers HTTP, textures, render install, fallback and close.
const three = await import('three');
const real = await import('../web/src/hero.ts?real');
const frames = new Set(); let nextFrame = 1;
const loads = new Map();
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const texture = () => Object.assign(new three.Texture(), { disposed: 0, dispose() { this.disposed++; } });
const adapters = {
  createRenderer: () => ({ domElement: {}, setPixelRatio() {}, setSize() {}, getDrawingBufferSize: v => v.set(16, 9), setRenderTarget() {}, render() {} }),
  loadTexture: url => { const d = deferred(); loads.set(url, d); return d.promise; },
  loadDepth: async () => ({ data: new Float32Array(8 * 4).fill(10), width: 8, height: 4 }),
  roadColour: () => new three.Color(0x333333),
  requestFrame: () => { const id = nextFrame++; frames.add(id); return id; },
  cancelFrame: id => frames.delete(id),
  observeResize: () => () => {},
};
mock.module('../web/src/hero.ts', { exports: { createHero: container => real.createHero(container, adapters) } });
const square = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { classe: '1-2', h_min: 1 }, geometry: { type: 'Polygon', coordinates: [[[2, 48], [3, 48], [3, 49], [2, 49], [2, 48]]] } }] };
mock.module('../web/src/map.ts', { exports: { mapReady: Promise.resolve(), showScenario: async () => {}, showFloodLevel: () => {}, goTo: async () => {}, showCaves: () => {}, datasets: { ppri_aleas: square, caves_1910: square, sdrife_zone_inondable: square } } });
const { state, photo_inondee, timelineExposure } = await import('../web/src/tools.ts');
const elements = new Map();
const element = () => ({ hidden: false, textContent: '', innerHTML: '', open: false, onclose: null, clientWidth: 160, replaceChildren() {}, showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.onclose?.(); } }, addEventListener() {}, insertAdjacentHTML(_, html) { this.textContent += html; }, querySelector: () => ({ addEventListener() {} }), setAttribute() {}, classList: { toggle() {}, contains: () => false } });
const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
globalThis.document = { getElementById: $, querySelectorAll: () => [] };
globalThis.matchMedia = () => ({ matches: true });
const A = { label: '4 Rue Traversière', lat: 48.844929, lon: 2.369632 }, B = { label: '230 Rue de Bercy', lat: 48.846486, lon: 2.370073 };
const slugOf = lat => lat > 48.846 ? '230-rue-de-bercy' : '4-rue-traversiere';
const held = new Map();
let failing = false;
globalThis.fetch = async url => {
  const params = new URL(String(url), 'http://x').searchParams; const lat = params.get('lat'); const slug = slugOf(Number(lat));
  const entry = held.get(lat); if (entry && entry.skip++ === 0) await entry.promise;
  if (failing) throw new Error('network');
  return { ok: true, json: async () => ({ url: `/photos/${slug}/flood_1.5m.jpg`, url_clean: `/photos/${slug}/original.jpg`, url_depth: `/photos/${slug}/depth.png`, hauteur_m: 1.5, address_label: slug, credit: 'Photo : x, CC BY-SA 4.0', license: 'CC BY-SA 4.0', source_url: null, view: { fov: 80, pitch: -4, camera_height_m: 2 } }) };
};
const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const tex = slug => `/photos/${slug}/original.jpg`;
async function openA() {
  loads.clear(); frames.clear(); $('hero-dialog').close(); $('photo-dialog').open = false;
  state.timeline = { id: '1910', label: '1910', level: 8.62, evidence: 'Mesuré' };
  state.address = A;
  const opening = photo_inondee({ hauteur: 1.5 });
  await tick(); loads.get(tex('4-rue-traversiere')).resolve(texture());
  assert.equal((await opening).rendu, 'relief-3d');
  assert.equal(frames.size, 1);
}

test('a stale scene whose textures finish later never installs itself, and returning to the first address reloads it', async () => {
  await openA();
  state.address = B; await timelineExposure(B.lat, B.lon); await tick();
  assert.equal(frames.size, 0, 'A was released when B started loading');
  const bTexture = texture();
  state.address = A; await timelineExposure(A.lat, A.lon); await tick();
  assert.ok(loads.has(tex('4-rue-traversiere')), 'A is reloaded because no scene is rendering yet');
  const a2 = texture(); loads.get(tex('4-rue-traversiere')).resolve(a2); await tick();
  assert.equal(frames.size, 1, 'A2 renders');
  assert.match($('hero-label').innerHTML, /4-rue-traversiere/);
  loads.get(tex('230-rue-de-bercy')).resolve(bTexture); await tick();
  assert.equal(frames.size, 1, 'B did not install a second loop');
  assert.equal(bTexture.disposed, 1, 'B freed its texture');
  assert.match($('hero-label').innerHTML, /4-rue-traversiere/);
  assert.equal(a2.disposed, 0);
});

test('a stale scene whose texture fails later does not open its photo fallback', async () => {
  await openA();
  state.address = B; await timelineExposure(B.lat, B.lon); await tick();
  state.address = A; await timelineExposure(A.lat, A.lon); await tick();
  loads.get(tex('4-rue-traversiere')).resolve(texture()); await tick();
  loads.get(tex('230-rue-de-bercy')).reject(new Error('404')); await tick();
  assert.equal(frames.size, 1);
  assert.equal($('photo-dialog').open, false, 'no fallback for the stale load');
  assert.equal($('hero-dialog').open, true);
});

test('closing the dialog while a reload is waiting for the network cancels it', async () => {
  await openA();
  const hold = deferred(); held.set(String(B.lat), { promise: hold.promise, skip: 0 });
  state.address = B; const exposure = timelineExposure(B.lat, B.lon);
  await tick();
  $('hero-dialog').close();
  assert.equal(frames.size, 0);
  hold.resolve(); await exposure; await tick();
  assert.equal(loads.has(tex('230-rue-de-bercy')), false, 'the stale reload never started loading a scene');
  assert.equal($('hero-dialog').open, false);
  held.clear();
});

test('a new request whose network call fails still invalidates the previous load in flight', async () => {
  loads.clear(); frames.clear(); $('hero-dialog').close();
  state.address = A;
  const first = photo_inondee({ hauteur: 1.5 }); await tick();
  failing = true; state.address = B;
  const second = await photo_inondee({ hauteur: 1.5 }, B); failing = false;
  assert.equal(second.affichee, false);
  loads.get(tex('4-rue-traversiere')).resolve(texture());
  const result = await first;
  assert.equal(result.affichee, false);
  assert.equal(frames.size, 0, 'the superseded load did not install a render loop');
});
