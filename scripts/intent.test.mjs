import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const state = { scenario: '1910', timeline: null };
const aller_a = mock.fn(async ({ adresse }) => ({ lat: 48.84, lon: 2.37, label: adresse }));
const afficher_crue = mock.fn(async () => ({ description: 'Crue sélectionnée' }));
const afficher_scenario = mock.fn(async ({ scenario }) => {
  state.scenario = scenario;
  return { description: 'Scénario sélectionné', source: 'DRIEAT' };
});
const exposition = mock.fn(async () => ({ hauteur_visuelle_m: null, hauteur_texte: 'Au sec' }));
mock.module('../web/src/tools.ts', { exports: {
  state, aller_a, afficher_crue, afficher_scenario, exposition,
  niveau_seine: mock.fn(), photo_inondee: mock.fn(), consignes: mock.fn(),
} });
const { routeIntent } = await import('../web/src/intent.ts');

beforeEach(() => {
  state.scenario = '1910';
  for (const fn of [aller_a, afficher_crue, afficher_scenario, exposition]) fn.mock.resetCalls();
});

for (const address of [
  '115 Rue de Bercy, 75012 Paris', '1955 rue X', '1910 avenue X',
  '1658 boulevard X', '1740 quai X', '2016 place X', '2026 allée X',
  '115 impasse X', '115 passage X', '115 route X', '115 chemin X',
  '115 cours X', '115 square X', '115 voie X', '115 sentier X',
  '115 faubourg X', '115 X 75012 Paris',
]) test(`address takes priority over flood numbers: ${address}`, async () => {
  await routeIntent(address);
  assert.deepEqual(aller_a.mock.calls.map(call => call.arguments), [[{ adresse: address }]]);
  assert.equal(exposition.mock.callCount(), 1);
  assert.equal(afficher_crue.mock.callCount(), 0);
  assert.equal(afficher_scenario.mock.callCount(), 0);
});

for (const [message, annee] of [
  ['Montre-moi la crue de 115 %', '115'], ['scénario 115 %', '115'],
  ['crue de 1955', '1955'], ['en 2016', '2016'], ['février 2026', '2026'],
]) test(`historical request selects flood preset: ${message}`, async () => {
  assert.equal(await routeIntent(message), 'Crue sélectionnée');
  assert.deepEqual(afficher_crue.mock.calls.map(call => call.arguments), [[{ annee }]]);
  assert.equal(aller_a.mock.callCount(), 0);
});

test('1910 still selects the classic reference scenario', async () => {
  await routeIntent('1910');
  assert.deepEqual(afficher_scenario.mock.calls[0].arguments, [{ scenario: '1910' }]);
  assert.equal(aller_a.mock.callCount(), 0);
});

test('empty or unrelated queries do not call address or flood tools', async () => {
  for (const [message, reply] of [['', /I can show the 1910 flood/], ['hello', /^Bonjour!/], ['bonjour', /^Bonjour!/], ['Who are you?', /Zouave of the Pont de l’Alma/], ['thanks!', /With pleasure/], ['goodbye', /À bientôt/]]) assert.match(await routeIntent(message), reply);
  assert.equal(aller_a.mock.callCount(), 0);
  assert.equal(afficher_crue.mock.callCount(), 0);
});

test('geocoding errors propagate without falling through to flood selection', async () => {
  aller_a.mock.mockImplementationOnce(async () => { throw new Error('Adresse introuvable'); });
  await assert.rejects(routeIntent('115 rue X'), /Adresse introuvable/);
  assert.equal(afficher_crue.mock.callCount(), 0);
  assert.equal(exposition.mock.callCount(), 0);
});

test('English demo chips reach the same tools', async () => {
  await routeIntent('What about my home?');
  assert.equal(aller_a.mock.callCount(), 1);
  assert.equal(exposition.mock.callCount(), 1);
  await routeIntent('Show me 1910');
  assert.deepEqual(afficher_scenario.mock.calls.at(-1).arguments, [{ scenario: '1910' }]);
  await routeIntent('And the worst case?');
  assert.deepEqual(afficher_scenario.mock.calls.at(-1).arguments, [{ scenario: 'pire' }]);
  assert.equal(afficher_crue.mock.callCount(), 0);
});
