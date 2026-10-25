import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followUps, moodFor, QUIPS } from '../web/src/followups.ts';

test('an address answer suggests the street simulation, the advice and the extreme scenario', () => {
  const answer = '4 Rue Traversière 75012 Paris: 1 to 2 m of water in the reference scenario. Sources: Paris PPRI.';
  assert.deepEqual(followUps('What about my home?', answer), ['Show my street flooded', 'What should I do?', 'Worse than 1910?']);
  assert.equal(moodFor(answer), 'worried');
});

test('advice and dry ground reassure; errors make him think', () => {
  assert.equal(moodFor('Plan a refuge up high. Stay out of the cellar. Always follow the authorities’ instructions.'), 'reassure');
  assert.equal(moodFor('Somewhere: outside the mapped PPRI footprint. Outside the mapped cellar sectors.'), 'reassure');
  assert.equal(moodFor('Address not found.'), 'thinking');
  assert.equal(moodFor('Here is a simulation, not a forecast.'), null);
});

test('every suggestion is a question the intent router answers, and quips carry no figures', async () => {
  const answers = ['At Austerlitz, the Seine reads 0.94 m', 'Reference flood, 1910 type: 8.62 m', 'Plan a refuge up high. Always follow the authorities.', 'anything'];
  const all = new Set(answers.flatMap(answer => followUps('What should I do?', answer)));
  for (const suggestion of all) assert.ok(suggestion.length < 30, suggestion);
  for (const quip of QUIPS) assert.doesNotMatch(quip.replace('1910', ''), /\d/, quip);
});
