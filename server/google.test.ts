import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './api.ts';
import { upstreamTileURL } from './google.ts';

async function withApp(options: Parameters<typeof createApp>[0], run: (url: string) => Promise<void>) {
  const server = createApp(options).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`); } finally { server.close(); }
}

test('upstreamTileURL keeps path and session query and sets the server key', () => {
  const url = upstreamTileURL('v1/3dtiles/datasets/abc/files/tile.glb', new URLSearchParams('session=S1&key=leaked'), 'SERVER');
  assert.equal(url.origin + url.pathname, 'https://tile.googleapis.com/v1/3dtiles/datasets/abc/files/tile.glb');
  assert.equal(url.searchParams.get('session'), 'S1');
  assert.equal(url.searchParams.get('key'), 'SERVER');
});

test('/api/google/status reports what is configured without exposing the tiles key; 3D proxy is key-gated', async () => {
  await withApp({ google: {} }, async url => {
    assert.deepEqual(await (await fetch(`${url}/api/google/status`)).json(), { tiles3d: false, streetview: false, browser_key: null });
    const missing = await fetch(`${url}/api/google/3d/v1/3dtiles/root.json`);
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /Clé Google manquante/);
  });
  await withApp({ google: { tilesKey: 'SERVER-KEY', browserKey: 'BROWSER-KEY' } }, async url => {
    const status = await (await fetch(`${url}/api/google/status`)).json();
    assert.deepEqual(status, { tiles3d: true, streetview: true, browser_key: 'BROWSER-KEY' });
  });
});

test('/api/google/3d proxies root and child tiles with the key appended server-side and streams binary bodies', async () => {
  const seen: string[] = [];
  const fetcher = (async (input: string | URL) => {
    const url = new URL(String(input)); seen.push(url.toString());
    if (url.pathname.endsWith('/root.json')) return new Response(JSON.stringify({ asset: { version: '1.0' }, root: { content: { uri: '/v1/3dtiles/datasets/d/files/a.glb?session=S1' } } }), { headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=60' } });
    return new Response(new Uint8Array([103, 108, 84, 70, 0, 1, 2, 3]), { headers: { 'content-type': 'model/gltf-binary' } });
  }) as typeof fetch;
  await withApp({ fetcher, google: { tilesKey: 'SERVER-KEY' } }, async url => {
    const root = await fetch(`${url}/api/google/3d/v1/3dtiles/root.json`);
    assert.equal(root.status, 200);
    assert.equal(root.headers.get('cache-control'), 'private, max-age=60');
    assert.ok(JSON.stringify(await root.json()).includes('a.glb'));
    const tile = await fetch(`${url}/api/google/3d/v1/3dtiles/datasets/d/files/a.glb?session=S1`);
    assert.equal(tile.headers.get('content-type'), 'model/gltf-binary');
    assert.deepEqual(Array.from(new Uint8Array(await tile.arrayBuffer())), [103, 108, 84, 70, 0, 1, 2, 3]);
    assert.equal(seen[0], 'https://tile.googleapis.com/v1/3dtiles/root.json?key=SERVER-KEY');
    assert.equal(seen[1], 'https://tile.googleapis.com/v1/3dtiles/datasets/d/files/a.glb?session=S1&key=SERVER-KEY');
  });
});
