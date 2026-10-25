import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { flattenFootprints, timelineFootprints, scenarioFootprints, footprintStyle } from '../web/src/water-footprints.ts';
import { timelineBands, REFERENCE_LEVEL } from '../web/src/flood-level.ts';

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
const multi = { type: 'Feature', properties: { classe: '1-2' }, geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0, 10), square(4, 4, 2)], [square(20, 0, 5)]] } };
const single = { type: 'Feature', properties: { classe: '0-1' }, geometry: { type: 'Polygon', coordinates: [square(40, 0, 3)] } };

test('every MultiPolygon component and every hole reach the 3D layer', () => {
  const polygons = flattenFootprints([multi, single]);
  assert.equal(polygons.length, 3);
  assert.deepEqual(polygons[0].polygon, [square(0, 0, 10), square(4, 4, 2)]);
  assert.deepEqual(polygons[1].polygon, [square(20, 0, 5)]);
  assert.equal(polygons[2].properties.classe, '0-1');
});

test('the Google view receives the footprints of each scenario, not only wet PPRI classes', () => {
  const sdrif = { ...multi, properties: {} };
  const datasets = { aleas: [multi, single], banks: [{ ...single, properties: { nom: 'Zone rouge' } }], sdrif: [sdrif], extra: [{ ...single, properties: {} }] };
  const at610 = timelineFootprints(6.10, timelineBands(6.10), datasets);
  assert.ok(at610.some(f => f.properties.classe === 'banks'), 'low banks at 6.10 m');
  const at9 = timelineFootprints(9.0, timelineBands(9.0), datasets);
  assert.ok(at9.some(f => f.properties.classe === 'possible'), 'SDRIF footprint above 8.62 m');
  assert.ok(!at9.some(f => f.properties.classe === 'banks'));
  assert.ok(at9.filter(f => f.properties.classe === '1-2' || f.properties.classe === '0-1').length === 2);
  const pire = scenarioFootprints('pire', datasets);
  assert.equal(pire.level, REFERENCE_LEVEL); assert.equal(pire.features.length, 1); assert.equal(pire.features[0].geometry, sdrif.geometry); assert.ok(pire.features.every(f => f.properties.status === 'possible'));
  assert.deepEqual(scenarioFootprints('aujourdhui', datasets), { features: [], level: null });
  assert.equal(scenarioFootprints('1910', datasets).features.length, 2);
});

test('an uncertain PPRI class is styled as « peut-être », not as its flooded class', () => {
  const at712 = timelineFootprints(7.12, timelineBands(7.12), { aleas: [multi], banks: [], extra: [] }).find(f => f.properties.classe === '1-2');
  assert.equal(at712.properties.status, 'possible');
  const possible = footprintStyle(at712.properties), flooded = footprintStyle({ classe: '1-2', status: 'flooded' });
  assert.equal(possible.status, 'possible'); assert.equal(flooded.status, 'flooded');
  assert.notDeepEqual(possible.colour, flooded.colour);
  assert.ok(possible.colour[3] < flooded.colour[3]);
  assert.equal(footprintStyle({ classe: 'banks', status: 'flooded' }).status, 'flooded');
});

test('the « pire » scenario exposes exactly the SDRIF footprint used by MapLibre and the exposure card', () => {
  const load = name => JSON.parse(readFileSync(new URL(`../web/public/data/${name}.geojson`, import.meta.url), 'utf8')).features;
  const sdrif = load('sdrife_zone_inondable'), aleas = load('ppri_aleas');
  const pire = scenarioFootprints('pire', { aleas, sdrif }).features;
  const inside = (features, point) => features.some(feature => booleanPointInPolygon(point, feature));
  for (const point of [[2.297125230468744, 48.8616845], [2.369632, 48.844929], [2.3, 48.86], [2.35, 48.85]]) {
    assert.equal(inside(pire, point), inside(sdrif, point), `membership parity at ${point}`);
  }
  assert.equal(inside(pire, [2.297125230468744, 48.8616845]), false);
  assert.equal(inside(aleas, [2.297125230468744, 48.8616845]), true, 'the point is PPRI-only, so the old SDRIF ∪ PPRI union would have shown it');
});
