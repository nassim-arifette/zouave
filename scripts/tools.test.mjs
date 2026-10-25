import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const showScenario = mock.fn(async () => {});
const showFloodLevel = mock.fn(async () => {});
const square = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { classe: '1-2', h_min: 1 }, geometry: { type: 'Polygon', coordinates: [[[2,48],[3,48],[3,49],[2,49],[2,48]]] } }] };
mock.module('../web/src/map.ts', { exports: { mapReady: Promise.resolve(), showScenario, showFloodLevel, goTo: async () => {}, showCaves: () => {}, datasets: { ppri_aleas: square, caves_1910: square, sdrife_zone_inondable: square } } });
const { state, aller_a, exposition, afficher_scenario, afficher_crue } = await import('../web/src/tools.ts');

function element(scenario) {
  const classes = new Set();
  const listeners = new Map();
  let html = '';
  return { hidden: false, textContent: '', htmlWrites: [], get innerHTML() { return html; }, set innerHTML(value) { html = value; this.htmlWrites.push(value); }, dataset: { scenario }, attributes: {}, classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) }, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(type, listener) { listeners.set(type, listener); }, click() { listeners.get('click')?.(); }, querySelector: () => ({ addEventListener() {} }), open: false, showModal() { this.open = true; }, close() { this.open = false; } };
}
function reset() {
  const elements = new Map();
  const buttons = ['aujourdhui', '1910', 'pire'].map(element);
  globalThis.document = { getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll: () => buttons };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ features: [{ geometry: { type: 'Point', coordinates: [2.369632,48.844929] }, properties: { label: '4 Rue Traversière' } }], source_url: 'https://data.geopf.fr/geocodage/search' }) });
  state.scenario = 'aujourdhui'; state.exposureShown = false; state.timeline = null;
  state.address = { label: '4 Rue Traversière', lat: 48.844929, lon: 2.369632 };
  globalThis.window = { dispatchEvent() {} };
  showFloodLevel.mock.resetCalls();
  showScenario.mock.resetCalls();
  return { elements, buttons };
}
for (const scenario of ['1910', 'pire']) {
  test(`fresh voice-style aller_a + exposition synchronizes ${scenario} once`, async () => {
    const { elements, buttons } = reset();
    const point = await aller_a({ adresse: '4 Rue Traversière' });
    await exposition({ ...point, scenario });
    assert.equal(showScenario.mock.callCount(), 1);
    assert.deepEqual(showScenario.mock.calls[0].arguments, [scenario]);
    assert.equal(state.scenario, scenario);
    for (const button of buttons) {
      assert.equal(button.classList.contains('active'), button.dataset.scenario === scenario);
      assert.equal(button.attributes['aria-pressed'], String(button.dataset.scenario === scenario));
    }
    assert.equal(elements.get('legend-depths').hidden, scenario !== '1910');
    assert.equal(elements.get('legend-note').hidden, scenario === '1910');
    assert.match(elements.get('legend-title').textContent, scenario === '1910' ? /COMPRENDRE/ : /AU-DELÀ/);
    if (scenario === 'pire') assert.match(elements.get('legend-note').textContent, /hauteurs non publiées/);
    await exposition({ ...point, scenario });
    assert.equal(showScenario.mock.callCount(), 1);
    await afficher_scenario({ scenario });
    assert.equal(showScenario.mock.callCount(), 2);
  });
}
test('invalid exposure arguments do not change scenario or layers', async () => {
  reset();
  await assert.rejects(exposition({ lat: NaN, lon: 2.37, scenario: '1910' }), /invalides/);
  await assert.rejects(exposition({ lat: 48.84, lon: 2.37, scenario: 'unknown' }), /invalides/);
  assert.equal(state.scenario, 'aujourdhui');
  assert.equal(showScenario.mock.callCount(), 0);
});
test('outside all footprints keeps one dry-view card whose button opens the original photo at zero metres', async () => {
  reset();
  state.address = { label: 'Adresse hors PPRI', lat: 0, lon: 0 };
  const result = await exposition({ lat: 0, lon: 0, scenario: '1910' });
  assert.equal(result.en_zone, false);
  assert.equal(result.classe, null);
  assert.equal(state.scenario, '1910');
  assert.equal(showScenario.mock.callCount(), 1);
  const exposureCard = document.getElementById('exposure-card');
  assert.equal(exposureCard.htmlWrites.length, 1, 'render the exposure card once so an older variant cannot replace the dry-view button');
  const card = exposureCard.innerHTML;
  assert.match(card, /id="show-photo"[^<]*au sec/, 'the Panoramax street button stays available outside the PPRI');
  assert.doesNotMatch(card, /show-streetview/, 'no Street View button without a browser key');
  const requestedPhotos = [];
  globalThis.fetch = async url => {
    const request = new URL(url, 'http://test');
    if (request.pathname === '/api/rue') return { ok: false, json: async () => ({ error: 'Live panorama unavailable' }) };
    assert.equal(request.pathname, '/api/photo');
    requestedPhotos.push(request.searchParams.get('h'));
    return { ok: true, json: async () => ({ url: '/photos/flood.jpg', url_clean: '/photos/original.jpg', hauteur_m: 1.5, address_label: 'Adresse hors PPRI', credit: 'Panoramax', license: 'CC BY-SA 4.0' }) };
  };
  document.getElementById('show-photo').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requestedPhotos, ['0']);
  assert.equal(document.getElementById('photo-dialog').open, true);
  assert.equal(document.getElementById('photo-image').src, '/photos/original.jpg');
  assert.match(document.getElementById('photo-label').textContent, /Vue originale/);
});
test('voice timeline tool returns derived numbers and updates the renderer and exposure', async () => {
  reset();
  const result = await afficher_crue({ annee: '1955', niveau_m: null });
  assert.equal(result.level, 7.12);
  assert.equal(result.exposure.status, 'possible');
  assert.equal(result.exposure.photo_height_m, 0.5);
  assert.deepEqual(showFloodLevel.mock.calls[0].arguments, [7.12]);
  assert.equal(state.timeline.id, '1955');
});
test('custom levels are estimated, unavailable photos do not prevent exposure and classic scenarios exit timeline', async () => {
  reset();
  globalThis.fetch = async () => { throw new Error('photo offline'); };
  const result = await afficher_crue({ annee: null, niveau_m: 9.1 });
  assert.equal(result.evidence, 'Estimé');
  assert.equal(result.exposure.photo_available_height_m, undefined);
  await afficher_scenario({ scenario: '1910' });
  assert.equal(state.timeline, null);
});
test('voice timeline rejects unknown or ambiguous requests without changing layers', async () => {
  reset();
  for (const args of [{}, { annee: 'future' }, { annee: '1910', niveau_m: 8.62 }, { niveau_m: NaN }]) await assert.rejects(afficher_crue(args));
  assert.equal(showFloodLevel.mock.callCount(), 0);
});

