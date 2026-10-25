import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
// Live street mode on the client: cancellation of the /api/rue request, stale answers and the flat-photo fallback.
let showImpl = async () => true;
const shows = [];
const fakeHero = { show: async options => { shows.push(options.photoUrl); return showImpl(options); }, stop: mock.fn(), setLevel() {}, animateTo() {}, level: 0 };
mock.module('../web/src/hero.ts', { exports: { createHero: () => fakeHero } });
const square = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { classe: '1-2', h_min: 1 }, geometry: { type: 'Polygon', coordinates: [[[2, 48], [3, 48], [3, 49], [2, 49], [2, 48]]] } }] };
mock.module('../web/src/map.ts', { exports: { mapReady: Promise.resolve(), showScenario: async () => {}, showFloodLevel: () => {}, goTo: async () => {}, showCaves: () => {}, datasets: { ppri_aleas: square, caves_1910: square, sdrife_zone_inondable: square } } });
const { state, photo_inondee } = await import('../web/src/tools.ts');
const elements = new Map();
const element = () => ({ hidden: false, textContent: '', innerHTML: '', open: false, onclose: null, showModal() { this.open = true; }, close() { if (this.open) { this.open = false; this.onclose?.(); } }, addEventListener() {}, insertAdjacentHTML(_, html) { this.textContent += html; }, querySelector: () => ({ addEventListener() {} }), setAttribute() {}, classList: { toggle() {}, contains: () => false } });
const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
globalThis.document = { getElementById: $, querySelectorAll: () => [] };
globalThis.matchMedia = () => ({ matches: true });
const deferred = () => { let resolve; const promise = new Promise(res => { resolve = res; }); return { promise, resolve }; };
const rue = new Map();
const liveAnswer = id => ({ ok: true, json: async () => ({ id, url_clean: `/cache/street/${id}/photo_90.jpg`, url_depth: `/cache/street/${id}/depth_90.png`, credit: 'Photo : x / Panoramax, CC-BY-SA-4.0', license: 'CC-BY-SA-4.0', source_url: 'https://panoramax/x', view: { fov: 80, pitch: -4, camera_height_m: 2 }, live: true, distance_m: 42 }) });
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url), 'http://x'); const lat = u.searchParams.get('lat');
  if (u.pathname === '/api/rue') { const d = deferred(); rue.set(lat, d); init?.signal?.addEventListener('abort', () => d.resolve('aborted')); const answer = await d.promise; if (answer === 'aborted') throw new Error('aborted'); return answer; }
  return { ok: true, json: async () => ({ url: '/photos/4-rue-traversiere/flood_1.5m.jpg', url_clean: '/photos/4-rue-traversiere/original.jpg', url_depth: null, hauteur_m: 1.5, address_label: '4 Rue Traversière', credit: 'Photo : y, CC BY-SA 4.0', license: 'CC BY-SA 4.0', source_url: null, view: { fov: 80, pitch: -4, camera_height_m: 2 } }) };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const A = { label: 'Rue A', lat: 48.8441, lon: 2.3650 }, B = { label: 'Rue B', lat: 48.8460, lon: 2.3800 };

test('closing the dialog during the search cancels the live request and nothing is shown afterwards', async () => {
  state.address = A;
  const opening = photo_inondee({ hauteur: 1.5 });
  await tick();
  assert.equal($('hero-dialog').open, true);
  assert.equal($('hero-status').hidden, false);
  $('hero-dialog').close();
  rue.get(String(A.lat)).resolve(liveAnswer('a'));
  const result = await opening;
  assert.equal(result.affichee, false);
  assert.deepEqual(shows, []);
  assert.equal($('hero-dialog').open, false);
});

test('an older live answer arriving after a newer one is ignored', async () => {
  shows.length = 0;
  state.address = A;
  const first = photo_inondee({ hauteur: 1.5 });
  await tick();
  $('hero-dialog').close();
  state.address = B;
  const second = photo_inondee({ hauteur: 1.5 });
  await tick();
  rue.get(String(B.lat)).resolve(liveAnswer('b'));
  assert.equal((await second).rendu, 'relief-3d');
  rue.get(String(A.lat)).resolve(liveAnswer('a'));
  assert.equal((await first).affichee, false);
  assert.deepEqual(shows, ['/cache/street/b/photo_90.jpg']);
  assert.match($('hero-label').innerHTML, /Rue B · photo à 42 m/);
  assert.equal($('hero-dialog').open, true);
  $('hero-dialog').close();
});

test('a valid live answer followed by a WebGL failure falls back to the live original view and closes the loading dialog', async () => {
  shows.length = 0;
  showImpl = async () => { throw new Error('WebGL unavailable'); };
  state.address = B;
  const opening = photo_inondee({ hauteur: 2 });
  await tick();
  rue.get(String(B.lat)).resolve(liveAnswer('b'));
  const result = await opening;
  assert.equal(result.affichee, true);
  assert.equal($('hero-dialog').open, false, 'loading dialog closed');
  assert.equal($('photo-dialog').open, true);
  assert.equal($('photo-image').src, '/cache/street/b/photo_90.jpg');
  assert.equal($('photo-label').textContent, 'Rue B · Vue originale');
  assert.match($('photo-credit').innerHTML, /Panoramax, CC-BY-SA-4.0/);
  showImpl = async () => true;
});
