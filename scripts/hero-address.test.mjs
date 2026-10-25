import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
// Address change while the 3D street scene is open: the scene must be reloaded for the new address, never just relabelled.
const shows = [];
const fakeHero = { show: mock.fn(async options => { shows.push(options.photoUrl); return true; }), stop() {}, setLevel() {}, animateTo: mock.fn(), level: 0 };
mock.module('../web/src/hero.ts', { exports: { createHero: () => fakeHero } });
const square = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { classe: '1-2', h_min: 1 }, geometry: { type: 'Polygon', coordinates: [[[2, 48], [3, 48], [3, 49], [2, 49], [2, 48]]] } }] };
mock.module('../web/src/map.ts', { exports: { mapReady: Promise.resolve(), showScenario: async () => {}, showFloodLevel: () => {}, goTo: async () => {}, showCaves: () => {}, datasets: { ppri_aleas: square, caves_1910: square, sdrife_zone_inondable: square } } });
const { state, photo_inondee, timelineExposure } = await import('../web/src/tools.ts');
const elements = new Map();
const element = () => ({ hidden: false, textContent: '', innerHTML: '', open: false, showModal() { this.open = true; }, close() { this.open = false; }, addEventListener() {}, insertAdjacentHTML() {}, querySelector: () => ({ addEventListener() {} }), setAttribute() {}, classList: { toggle() {}, contains: () => false } });
globalThis.document = { getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll: () => [] };
globalThis.matchMedia = () => ({ matches: true });
const photoFor = (lat, lon) => lat > 48.846 ? { slug: '230-rue-de-bercy', label: '230 Rue de Bercy' } : { slug: '4-rue-traversiere', label: '4 Rue Traversière' };
globalThis.fetch = async url => {
  const params = new URL(String(url), 'http://x').searchParams; const { slug, label } = photoFor(Number(params.get('lat')), Number(params.get('lon')));
  return { ok: true, json: async () => ({ url: `/photos/${slug}/flood_1.5m.jpg`, url_clean: `/photos/${slug}/original.jpg`, url_depth: `/photos/${slug}/depth.png`, hauteur_m: 1.5, address_label: label, credit: 'Photo : x, CC BY-SA 4.0', license: 'CC BY-SA 4.0', source_url: null, view: { fov: 80, pitch: -4, camera_height_m: 2 } }) };
};

test('changing the address while the scene is open reloads the scene instead of relabelling the old street', async () => {
  state.timeline = { id: '1955', label: '1955', level: 7.12, evidence: 'Mesuré' };
  state.address = { label: '4 Rue Traversière', lat: 48.844929, lon: 2.369632 };
  const opened = await photo_inondee({ hauteur: 1.5 });
  assert.equal(opened.rendu, 'relief-3d');
  assert.deepEqual(shows, ['/photos/4-rue-traversiere/original.jpg']);
  assert.equal(document.getElementById('hero-dialog').open, true);
  // Same address, new level: animated in place.
  state.timeline = { id: '1910', label: '1910', level: 8.62, evidence: 'Mesuré' };
  await timelineExposure(48.844929, 2.369632);
  assert.equal(fakeHero.animateTo.mock.callCount(), 1);
  assert.equal(shows.length, 1);
  // Voice flow: aller_a → exposition for another street while the dialog is still open.
  state.address = { label: '230 Rue de Bercy', lat: 48.846486, lon: 2.370073 };
  await timelineExposure(48.846486, 2.370073);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(shows, ['/photos/4-rue-traversiere/original.jpg', '/photos/230-rue-de-bercy/original.jpg']);
  assert.equal(fakeHero.animateTo.mock.callCount(), 1, 'the old scene is not animated as if it were the new street');
  assert.match(document.getElementById('hero-label').innerHTML, /230 Rue de Bercy/);
});

test('a late answer for an older address neither replaces nor closes the newer scene', async () => {
  const pending = new Map();
  const baseFetch = globalThis.fetch;
  // For a held address the scene reload (issued first by timelineExposure) is deferred; the exposure-card request that follows answers normally.
  globalThis.fetch = url => { const lat = new URL(String(url), 'http://x').searchParams.get('lat'); const entry = pending.get(lat); if (entry && entry.skip++ === 0) return entry.promise; return baseFetch(url); };
  const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject, skip: 0 }; };
  const bercy = deferred(), hold = (lat) => pending.set(lat, deferred());
  pending.set('48.846486', bercy);
  shows.length = 0;
  state.timeline = { id: '1910', label: '1910', level: 8.62, evidence: 'Mesuré' };
  state.address = { label: '4 Rue Traversière', lat: 48.844929, lon: 2.369632 };
  await photo_inondee({ hauteur: 1.5 });
  // B (Bercy) starts and hangs on the network; C (another point) completes first.
  state.address = { label: '230 Rue de Bercy', lat: 48.846486, lon: 2.370073 };
  await timelineExposure(48.846486, 2.370073);
  state.address = { label: 'Rue C', lat: 48.8441, lon: 2.3650 };
  await timelineExposure(48.8441, 2.3650);
  await new Promise(resolve => setTimeout(resolve, 0));
  const afterC = shows.length;
  assert.equal(shows.at(-1), '/photos/4-rue-traversiere/original.jpg', 'C got its own scene (nearest catalogue photo)');
  assert.doesNotMatch(document.getElementById('hero-label').innerHTML, /Bercy/);
  // B succeeds late: ignored.
  bercy.resolve({ ok: true, json: async () => ({ url: '/photos/230-rue-de-bercy/flood_1.5m.jpg', url_clean: '/photos/230-rue-de-bercy/original.jpg', url_depth: '/photos/230-rue-de-bercy/depth.png', hauteur_m: 1.5, address_label: '230 Rue de Bercy', credit: 'Photo : x, CC BY-SA 4.0', license: 'CC BY-SA 4.0', source_url: null, view: { fov: 80, pitch: -4, camera_height_m: 2 } }) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(shows.length, afterC, 'the stale Bercy answer does not open a scene');
  assert.doesNotMatch(document.getElementById('hero-label').innerHTML, /Bercy/);
  // B fails late: the open scene of C stays open.
  const failing = deferred(); pending.set('48.846486', failing);
  state.address = { label: '230 Rue de Bercy', lat: 48.846486, lon: 2.370073 };
  await timelineExposure(48.846486, 2.370073);
  state.address = { label: 'Rue C', lat: 48.8441, lon: 2.3650 };
  await timelineExposure(48.8441, 2.3650);
  await new Promise(resolve => setTimeout(resolve, 0));
  failing.reject(new Error('network'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.getElementById('hero-dialog').open, true, 'a stale failure does not close the newer scene');
  void hold;
  globalThis.fetch = baseFetch;
});
