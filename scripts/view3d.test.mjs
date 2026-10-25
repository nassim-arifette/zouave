import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { scenarioFootprints, timelineFootprints } from '../web/src/water-footprints.ts';
import { timelineBands } from '../web/src/flood-level.ts';

// Exercise the real view controller and its actual layer props, without a GPU or Google requests.
const decks = [];
class Deck {
  constructor(props) { this.props = props; decks.push(this); }
  setProps(props) { this.props = { ...this.props, ...props }; }
  finalize() {}
}
class Layer {
  constructor(props) { this.props = props; }
}
mock.module('@deck.gl/core', { exports: { Deck, MapView: class {}, FlyToInterpolator: class {} } });
mock.module('@deck.gl/geo-layers', { exports: { Tile3DLayer: Layer } });
mock.module('@deck.gl/layers', { exports: { SolidPolygonLayer: Layer } });
const { createView3D } = await import('../web/src/view3d.ts');

const element = () => ({ hidden: true, textContent: '', setAttribute() {}, classList: { toggle() {} } });
function harness(t) {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, '/api/google/status');
    return { json: async () => ({ tiles3d: true }) };
  });
  const elements = Object.fromEntries(['container', 'toggle', 'status', 'attribution', 'legend', 'body'].map(name => [name, element()]));
  const view = createView3D(elements);
  let deck;
  return {
    view,
    legend: elements.legend,
    status: elements.status,
    async activate() { await view.toggle(true); deck = decks.at(-1); },
    layer(id) {
      const found = deck.props.layers.find(layer => layer.props.id === id);
      assert.ok(found, `the view renders layer ${id}`);
      return found.props;
    },
  };
}

const square = (x, y, side) => [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]];
const uncertain = {
  type: 'Feature', properties: { id: 'uncertain', classe: '1-2' },
  geometry: { type: 'MultiPolygon', coordinates: [[square(2.35, 48.85, 0.01), square(2.353, 48.853, 0.002)], [square(2.37, 48.85, 0.005)]] },
};
const flooded = {
  type: 'Feature', properties: { id: 'flooded', classe: '2+' },
  geometry: { type: 'Polygon', coordinates: [square(2.38, 48.85, 0.005)] },
};
const datasets = { aleas: [uncertain, flooded], banks: [], extra: [] };
const atLevel = level => timelineFootprints(level, timelineBands(level), datasets);

test('the actual 3D layers separate uncertain and flooded footprints and preserve every ring', async t => {
  const h = harness(t);
  // Water selected in the offline map must survive first activation of the optional view.
  h.view.setWater(atLevel(7.12), 7.12, 'timeline');
  await h.activate();
  const possible = h.layer('flood-water-possible');
  const solid = h.layer('flood-water');
  assert.deepEqual(possible.data.map(d => d.properties.id), ['uncertain', 'uncertain']);
  assert.deepEqual(solid.data.map(d => d.properties.id), ['flooded']);
  assert.deepEqual(possible.data.map(possible.getPolygon), uncertain.geometry.coordinates);
  assert.deepEqual(solid.getPolygon(solid.data[0]), flooded.geometry.coordinates);
  assert.equal(possible.wireframe, true, 'uncertainty has an outline in the rendered layer');
  assert.notEqual(solid.wireframe, true);
  assert.ok(possible.getFillColor(possible.data[0])[3] < solid.getFillColor(solid.data[0])[3], 'uncertain water is more translucent');
  assert.equal(h.legend.hidden, false);
  assert.match(h.legend.textContent, /Solid: flooded/);
  assert.match(h.legend.textContent, /Translucent outline: possibly/);

  h.view.setWater(atLevel(8.62), 8.62, 'timeline');
  assert.equal(h.layer('flood-water-possible').data.length, 0, 'raising the level migrates the uncertain class to confirmed water');
  assert.equal(h.layer('flood-water').data.length, 3);
  assert.equal(h.legend.textContent, 'Solid: flooded');
});

test('clearing the water also clears both layers and hides the 3D legend', async t => {
  const h = harness(t);
  await h.activate();
  for (const clear of [() => h.view.setWater([], 7.12, 'outside'), () => h.view.setWater(atLevel(7.12), null, 'aujourdhui')]) {
    h.view.setWater(atLevel(7.12), 7.12, 'timeline');
    assert.equal(h.legend.hidden, false);
    clear();
    assert.equal(h.layer('flood-water').data.length, 0);
    assert.equal(h.layer('flood-water-possible').data.length, 0);
    assert.equal(h.legend.hidden, true);
    assert.equal(h.legend.textContent, '', 'no stale flooded/possibly labels remain');
  }
});

test('the rendered extreme scenario keeps the exact SDRIF geometry and excludes the PPRI-only regression point', async t => {
  const load = name => JSON.parse(readFileSync(new URL(`../web/public/data/${name}.geojson`, import.meta.url), 'utf8')).features;
  const aleas = load('ppri_aleas');
  const sdrif = load('sdrife_zone_inondable');
  const scenario = scenarioFootprints('pire', { aleas, sdrif });
  const h = harness(t);
  h.view.setWater(scenario.features, scenario.level, 'pire');
  await h.activate();
  const possible = h.layer('flood-water-possible');
  const renderedPolygons = possible.data.map(possible.getPolygon);
  assert.deepEqual(renderedPolygons, sdrif.flatMap(f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
  assert.equal(h.layer('flood-water').data.length, 0);
  assert.equal(h.legend.textContent, 'Translucent outline: possibly');
  const point = [2.297125230468744, 48.8616845];
  assert.equal(aleas.some(f => booleanPointInPolygon(point, f)), true, 'this point would expose the old SDRIF/PPRI union');
  assert.equal(renderedPolygons.some(coordinates => booleanPointInPolygon(point, { type: 'Polygon', coordinates })), false);
});

test('turning the Google view back on clears the loading status (the tileset does not load twice)', async t => {
  const view = harness(t);
  await view.activate();
  assert.equal(view.status.hidden, false, 'loading status while the first tileset loads');
  view.layer('google-3d-tiles').onTilesetLoad();
  assert.equal(view.status.hidden, true);
  await view.view.toggle(false);
  await view.view.toggle(true);
  assert.equal(view.status.hidden, true, 'no stale "Loading Google 3D tiles…" after switching back');
});
