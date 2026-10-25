import { test } from 'node:test';
import assert from 'node:assert/strict';
const { createLifecycle } = await import('../web/src/hero.ts');

const handle = () => { const h = { stopped: 0, stop() { h.stopped++; } }; return h; };

test('a newer opening supersedes a load still in flight and keeps a single scene running', () => {
  const lifecycle = createLifecycle();
  const first = lifecycle.begin();
  const second = lifecycle.begin();
  assert.equal(lifecycle.isCurrent(first), false);
  assert.equal(lifecycle.isCurrent(second), true);
  const stale = handle(), current = handle();
  assert.equal(lifecycle.commit(first, stale), false);
  assert.equal(stale.stopped, 1);
  assert.equal(lifecycle.commit(second, current), true);
  assert.equal(current.stopped, 0);
  assert.equal(lifecycle.running, true);
});

test('stop() releases the running scene and invalidates pending loads, so nothing renders after closing', () => {
  const lifecycle = createLifecycle();
  const running = handle();
  assert.equal(lifecycle.commit(lifecycle.begin(), running), true);
  const pending = lifecycle.begin();
  assert.equal(running.stopped, 1);
  lifecycle.stop();
  const late = handle();
  assert.equal(lifecycle.isCurrent(pending), false);
  assert.equal(lifecycle.commit(pending, late), false);
  assert.equal(late.stopped, 1);
  assert.equal(lifecycle.running, false);
});
