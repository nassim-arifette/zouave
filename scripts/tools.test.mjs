import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const showScenario = mock.fn(async () => {});
const square = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { classe: '1-2', h_min: 1 }, geometry: { type: 'Polygon', coordinates: [[[2,48],[3,48],[3,49],[2,49],[2,48]]] } }] };
mock.module('../web/src/map.ts', { exports: { mapReady: Promise.resolve(), showScenario, goTo: async () => {}, showCaves: () => {}, datasets: { ppri_aleas: square, caves_1910: square, sdrife_zone_inondable: square } } });
const { state, aller_a, exposition, afficher_scenario } = await import('../web/src/tools.ts');

function element(scenario) {
  const classes = new Set();
  return { hidden: false, textContent: '', innerHTML: '', dataset: { scenario }, attributes: {}, classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) }, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener() {}, querySelector: () => ({ addEventListener() {} }) };
}
function reset() {
  const elements = new Map();
  const buttons = ['aujourdhui', '1910', 'pire'].map(element);
  globalThis.document = { getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, querySelectorAll: () => buttons };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ features: [{ geometry: { type: 'Point', coordinates: [2.369632,48.844929] }, properties: { label: '4 Rue Traversière' } }], source_url: 'https://data.geopf.fr/geocodage/search' }) });
  state.scenario = 'aujourdhui'; state.exposureShown = false;
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
test('outside all footprints still synchronizes scenario without inventing exposure', async () => {
  reset();
  const result = await exposition({ lat: 0, lon: 0, scenario: '1910' });
  assert.equal(result.en_zone, false);
  assert.equal(result.classe, null);
  assert.equal(state.scenario, '1910');
  assert.equal(showScenario.mock.callCount(), 1);
});
