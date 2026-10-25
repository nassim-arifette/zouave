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

// Integration: real createHero.show() with simulated WebGL / loading adapters.
function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
function harness() {
  const { default: THREE } = { default: null };
  void THREE;
  return import('three').then(three => {
    const frames = new Set(); let nextFrame = 1;
    const renderer = { domElement: {}, setPixelRatio() {}, setSize() {}, getDrawingBufferSize: v => v.set(16, 9), setRenderTarget() {}, render() {} };
    const depth = { data: new Float32Array(8 * 4).fill(10), width: 8, height: 4 };
    const texture = () => Object.assign(new three.Texture(), { disposed: 0, dispose() { this.disposed++; } });
    const container = { clientWidth: 160, replaceChildren() {} };
    const loads = new Map();
    const adapters = {
      createRenderer: () => renderer,
      loadTexture: url => { const d = deferred(); loads.set(url, d); return d.promise; },
      loadDepth: async () => depth,
      roadColour: () => new three.Color(0x333333),
      requestFrame: () => { const id = nextFrame++; frames.add(id); return id; },
      cancelFrame: id => frames.delete(id),
      observeResize: () => () => {},
    };
    return { three, adapters, container, loads, frames, texture };
  });
}
const options = url => ({ photoUrl: url, depthUrl: 'depth.png', fov: 80, pitch: -4, cameraHeight: 2, target: 1.5 });

test('a stale opening that fails late neither stops the newer scene nor reports an error', async () => {
  const { createHero } = await import('../web/src/hero.ts');
  const { adapters, container, loads, frames, texture } = await harness();
  const hero = createHero(container, adapters);
  const a = hero.show(options('a.jpg'));
  const b = hero.show(options('b.jpg'));
  await new Promise(r => setTimeout(r, 0));
  loads.get('b.jpg').resolve(texture());
  assert.equal(await b, true);
  assert.equal(frames.size, 1, 'B renders');
  loads.get('a.jpg').reject(new Error('network'));
  assert.equal(await a, false, 'A is reported as superseded, not as a failure');
  assert.equal(frames.size, 1, 'B still renders');
  hero.stop();
  assert.equal(frames.size, 0, 'nothing renders after closing');
});

test('a stale opening that succeeds late frees its texture and leaves a single render loop', async () => {
  const { createHero } = await import('../web/src/hero.ts');
  const { adapters, container, loads, frames, texture } = await harness();
  const hero = createHero(container, adapters);
  const a = hero.show(options('a.jpg'));
  const b = hero.show(options('b.jpg'));
  await new Promise(r => setTimeout(r, 0));
  loads.get('b.jpg').resolve(texture());
  assert.equal(await b, true);
  const late = texture();
  loads.get('a.jpg').resolve(late);
  assert.equal(await a, false);
  assert.equal(late.disposed, 1);
  assert.equal(frames.size, 1);
});

test('a current opening that fails still throws so the caller can fall back to the photo', async () => {
  const { createHero } = await import('../web/src/hero.ts');
  const { adapters, container, loads } = await harness();
  const hero = createHero(container, adapters);
  const a = hero.show(options('a.jpg'));
  await new Promise(r => setTimeout(r, 0));
  loads.get('a.jpg').reject(new Error('network'));
  await assert.rejects(a, /network/);
});
