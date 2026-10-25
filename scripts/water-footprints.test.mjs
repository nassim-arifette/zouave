import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenFootprints, timelineFootprints, scenarioFootprints } from '../web/src/water-footprints.ts';
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
  const datasets = { aleas: [multi, single], banks: [{ ...single, properties: { nom: 'Zone rouge' } }], extra: [{ ...single, properties: {} }] };
  const at610 = timelineFootprints(6.10, timelineBands(6.10), datasets);
  assert.ok(at610.some(f => f.properties.classe === 'banks'), 'low banks at 6.10 m');
  const at9 = timelineFootprints(9.0, timelineBands(9.0), datasets);
  assert.ok(at9.some(f => f.properties.classe === 'possible'), 'SDRIF footprint above 8.62 m');
  assert.ok(!at9.some(f => f.properties.classe === 'banks'));
  assert.ok(at9.filter(f => f.properties.classe === '1-2' || f.properties.classe === '0-1').length === 2);
  const pire = scenarioFootprints('pire', datasets);
  assert.equal(pire.level, REFERENCE_LEVEL); assert.equal(pire.features.length, 3); assert.ok(pire.features.every(f => f.properties.classe === 'possible'));
  assert.deepEqual(scenarioFootprints('aujourdhui', datasets), { features: [], level: null });
  assert.equal(scenarioFootprints('1910', datasets).features.length, 2);
});
