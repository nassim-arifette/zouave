import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './api.ts';
import { upstreamTileURL, rewriteTileset, TilePathError } from './google.ts';

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
    assert.match((await missing.json()).error, /Google key missing/);
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

test('child tileset URIs are rewritten through the proxy so the renderer follows root → child without leaving /api/google/3d', async () => {
  const root = { asset: { version: '1.0' }, root: { boundingVolume: {}, content: { uri: '/v1/3dtiles/datasets/d/files/child.json?session=S1' }, children: [
    { content: { uri: 'https://tile.googleapis.com/v1/3dtiles/datasets/d/files/b.glb?session=S1' } },
    { contents: [{ uri: 'relative/c.glb' }, { uri: '/api/google/3d/v1/3dtiles/already.glb' }] },
  ] } };
  const rewritten = rewriteTileset(root) as typeof root & { root: { children: Array<{ content?: { uri: string }; contents?: Array<{ uri: string }> }> } };
  assert.equal(rewritten.root.content.uri, '/api/google/3d/v1/3dtiles/datasets/d/files/child.json?session=S1');
  assert.equal(rewritten.root.children[0].content?.uri, '/api/google/3d/v1/3dtiles/datasets/d/files/b.glb?session=S1');
  assert.deepEqual(rewritten.root.children[1].contents?.map(c => c.uri), ['relative/c.glb', '/api/google/3d/v1/3dtiles/already.glb']);
  const seen: string[] = [];
  const fetcher = (async (input: string | URL) => {
    const url = new URL(String(input)); seen.push(url.pathname + url.search);
    if (url.pathname.endsWith('/root.json')) return new Response(JSON.stringify(root), { headers: { 'content-type': 'application/json' } });
    if (url.pathname.endsWith('/child.json')) return new Response(JSON.stringify({ root: { content: { uri: '/v1/3dtiles/datasets/d/files/leaf.glb?session=S1' } } }), { headers: { 'content-type': 'application/json' } });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'model/gltf-binary' } });
  }) as typeof fetch;
  await withApp({ fetcher, google: { tilesKey: 'SERVER-KEY' } }, async url => {
    const rootJson = await (await fetch(`${url}/api/google/3d/v1/3dtiles/root.json`)).json();
    const childUri: string = rootJson.root.content.uri;
    assert.ok(childUri.startsWith('/api/google/3d/v1/3dtiles/'), childUri);
    const childJson = await (await fetch(url + childUri)).json();
    const leafUri: string = childJson.root.content.uri;
    assert.ok(leafUri.startsWith('/api/google/3d/v1/3dtiles/'), leafUri);
    const leaf = await fetch(url + leafUri);
    assert.equal(leaf.headers.get('content-type'), 'model/gltf-binary');
    assert.deepEqual(seen, ['/v1/3dtiles/root.json?key=SERVER-KEY', '/v1/3dtiles/datasets/d/files/child.json?session=S1&key=SERVER-KEY', '/v1/3dtiles/datasets/d/files/leaf.glb?session=S1&key=SERVER-KEY']);
  });
});

test('proxy destination is locked to the Google tiles origin: absolute URLs, other hosts, escapes and redirects never receive the key', async () => {
  for (const bad of ['https://attacker.invalid/collect', 'http://127.0.0.1:8080/admin', '//attacker.invalid/x', 'v1/3dtiles/../../other', 'v1/other/root.json', 'v1/3dtiles/root.json#x', 'https:/attacker.invalid/x']) {
    assert.throws(() => upstreamTileURL(bad, new URLSearchParams(), 'SERVER'), TilePathError, bad);
  }
  const seen: string[] = [];
  const fetcher = (async (input: string | URL) => { seen.push(String(input)); return new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/steal' } }); }) as typeof fetch;
  await withApp({ fetcher, google: { tilesKey: 'SERVER-KEY-FIXTURE' } }, async url => {
    for (const path of ['https://attacker.invalid/collect', 'http://127.0.0.1:8080/admin', '..%2F..%2Fother']) {
      const response = await fetch(`${url}/api/google/3d/${path}`);
      assert.equal(response.status, 400, path);
    }
    assert.equal(seen.length, 0, 'no upstream request for rejected paths');
    const redirected = await fetch(`${url}/api/google/3d/v1/3dtiles/root.json`);
    assert.equal(redirected.status, 502);
    assert.equal(seen.length, 1);
    assert.ok(String(seen[0]).startsWith('https://tile.googleapis.com/v1/3dtiles/root.json?key='));
  });
});
