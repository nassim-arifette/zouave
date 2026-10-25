import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depthAtLevel, photoHeight, outsidePpri, timelineBands, floodPresets } from '../web/src/flood-level.ts';
for (const [level, status, label, photo] of [
  [8.62, 'flooded', '1 à 2 m', 1.5],
  [8.96, 'flooded', '1,3 à 2,3 m', 1.5],
  [8.05, 'flooded', '0,4 à 1,4 m', 0.5],
  [7.12, 'possible', 'au sec ou jusqu’à 0,5 m', 0.5],
  [6.10, 'dry', 'Au sec (estimation)', 0],
  [3.54, 'dry', 'Au sec (estimation)', 0],
  [9.10, 'flooded', '1,5 à 2,5 m', 2.5],
]) test(`Traversière table at ${level} m`, () => {
  const band = depthAtLevel('1-2', level);
  assert.equal(band.status, status); assert.equal(band.label, label); assert.equal(photoHeight(band, level), photo);
  assert.equal(band.evidence, level === 8.62 ? 'Officiel' : 'Estimé');
});
test('2016 has no inland flood in any class; only the bank proxy is applicable', () => {
  assert.ok(Object.values(timelineBands(6.10)).every(b => b.status === 'dry'));
});
test('open-ended class stays open; exact zero is not positive, official reference remains official', () => {
  assert.equal(depthAtLevel('2+', 7.12).max, null);
  assert.equal(depthAtLevel('2+', 6.62).status, 'possible');
  assert.equal(depthAtLevel('0-1', 7.62).status, 'dry');
  assert.equal(depthAtLevel('0-1', 8.62).status, 'flooded');
});
test('extra footprint is possible shallow water only above reference and inside SDRIF', () => {
  assert.equal(outsidePpri(8.62, true).status, 'dry');
  assert.equal(outsidePpri(9.1, true).label, 'moins de 50 cm (estimation)');
  assert.equal(outsidePpri(9.1, false).status, 'dry');
});
test('empty/invalid input never produces a depth', () => {
  for (const level of [undefined, NaN, Infinity, -1, 13]) assert.throws(() => depthAtLevel('1-2', level));
  assert.throws(() => depthAtLevel('unknown', 8.62));
});
test('presets match exactly the eight requested entries, in order', () => {
  assert.deepEqual(floodPresets.map(({ id, level }) => [id, level]), [
    ['1658', 8.96], ['1740', 8.05], ['1910', 8.62], ['1955', 7.12],
    ['2016', 6.10], ['2026', 3.54], ['today', null], ['115', 9.10],
  ]);
  assert.equal(floodPresets.find(p => p.id === 'today').label, 'Direct');
  for (const preset of floodPresets) if (preset.id !== 'today') assert.ok(preset.source);
});

test('seineAltitude turns an Austerlitz gauge level into an ellipsoidal altitude for the Google 3D view', async () => {
  const { seineAltitude } = await import('../web/src/flood-level.ts');
  assert.equal(seineAltitude(8.62), 26.0 + 8.62 + 44.5);
  assert.equal(seineAltitude(0, { austerlitzZeroNgf: 26.2, geoidUndulationM: 44.4 }), 70.6);
});

test('sceneHeight maps an estimated band to a continuous 0–2.5 m water height for the 3D street scene', async () => {
  const { sceneHeight, depthAtLevel, outsidePpri } = await import('../web/src/flood-level.ts');
  assert.equal(sceneHeight(depthAtLevel('1-2', 8.62)), 1.5);
  assert.equal(sceneHeight(depthAtLevel('0-1', 8.62)), 0.5);
  assert.equal(sceneHeight(depthAtLevel('2+', 8.62)), 2.5);
  assert.equal(sceneHeight(depthAtLevel('1-2', 6.1)), 0);
  assert.equal(sceneHeight(outsidePpri(9.1, true)), 0.3);
  assert.ok(sceneHeight(depthAtLevel('1-2', 9.1)) > 1.5 && sceneHeight(depthAtLevel('1-2', 9.1)) <= 2.5);
});
