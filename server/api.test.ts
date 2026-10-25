import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, levelURL, normalizeAddress, selectPhoto } from './api.ts';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
async function withApp(options: Parameters<typeof createApp>[0], run: (url: string) => Promise<void>) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const offline = (async () => { throw new Error('offline'); }) as typeof fetch;
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-ufrag:test\r\n';
test('normalizes accented demo address', () => { assert.equal(normalizeAddress('4 Rue Traversière, 75012 Paris'), '4 rue traversiere 75012 paris'); });
test('level converts millimetres to metres and caches a successful observation', async () => {
  let calls = 0;
  await withApp({ fetcher: (async url => { assert.equal(url, levelURL); calls++; return Response.json({ data: [{ code_station: 'F700000103', resultat_obs: 1021, date_obs: '2026-10-25T09:00:00Z' }] }); }) as typeof fetch }, async url => {
    const first = await (await fetch(`${url}/api/niveau`)).json(); assert.equal(first.hauteur_m, 1.021); assert.equal(first.stale, false);
    const second = await (await fetch(`${url}/api/niveau`)).json(); assert.deepEqual(first, second); assert.equal(calls, 1);
  });
});
test('level uses explicitly stale bundled snapshot on network, empty or invalid response', async () => {
  for (const fetcher of [offline, (async () => Response.json({ data: [] })) as typeof fetch, (async () => Response.json({ data: [{ resultat_obs: null }] })) as typeof fetch]) await withApp({ fetcher }, async url => { const result = await (await fetch(`${url}/api/niveau`)).json(); assert.equal(result.stale, true); assert.equal(result.station_code, 'F700000103'); assert.equal(typeof result.hauteur_m, 'number'); });
});
test('geocoding uses only IGN and caches the result', async () => {
  let calls = 0;
  await withApp({ fetcher: (async url => { assert.match(String(url), /^https:\/\/data.geopf.fr\/geocodage\/search\?/); calls++; return Response.json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [2.369632, 48.844929] }, properties: { label: '4 Rue Traversière 75012 Paris' } }] }); }) as typeof fetch }, async url => {
    const result = await (await fetch(`${url}/api/geocode?q=4%20Rue%20Traversi%C3%A8re%20Paris`)).json(); assert.equal(result.source, 'Géoplateforme IGN'); assert.equal(result.offline, false);
    await fetch(`${url}/api/geocode?q=4%20rue%20traversiere%20Paris`); assert.equal(calls, 1);
  });
});
test('geocoding falls back only to bundled demo addresses, not unrelated queries', async () => {
  await withApp({ fetcher: offline }, async url => {
    const result = await (await fetch(`${url}/api/geocode?q=4%20Rue%20Traversi%C3%A8re%20Paris`)).json(); assert.equal(result.offline, true); assert.deepEqual(result.features[0].geometry.coordinates, [2.369632, 48.844929]);
    assert.equal((await fetch(`${url}/api/geocode?q=unknown%20address`)).status, 503);
    assert.equal((await fetch(`${url}/api/geocode`)).status, 400);
  });
});
test('geocoding empty response is not an invented location', async () => {
  await withApp({ fetcher: (async () => Response.json({ features: [] })) as typeof fetch }, async url => { assert.equal((await fetch(`${url}/api/geocode?q=unknown`)).status, 404); });
});
test('photo absent manifest and invalid input return useful errors', async () => {
  await withApp({ photosPath: '/nonexistent/zouave-manifest.json' }, async url => {
    const response = await fetch(`${url}/api/photo?lat=48.84&lon=2.36&h=2`); assert.equal(response.status, 404); assert.match((await response.json()).error, /pas encore/);
    assert.equal((await fetch(`${url}/api/photo`)).status, 400); assert.equal((await fetch(`${url}/api/photo?lat=100&lon=2&h=2`)).status, 400);
  });
});
test('photo selects nearest entry and actual available height, preserving attribution', () => {
  const photo = selectPhoto({ home: { lat: 48.844929, lon: 2.369632, address_label: 'Home', clean: 'home/clean.jpg', heights: { '1': 'home/1.jpg', '2': 'home/2.jpg' }, credit: 'Photographer', license: 'CC BY' }, far: { lat: 49, lon: 3, heights: { '2': 'far.jpg' } } }, 48.8449, 2.3696, 1.8);
  assert.equal(photo?.url, '/photos/home/2.jpg'); assert.equal(photo?.hauteur_m, 2); assert.equal(photo?.url_clean, '/photos/home/clean.jpg'); assert.equal(photo?.credit, 'Photographer'); assert.equal(photo?.simulation, true);
  assert.equal(selectPhoto({}, 48, 2, 2), null); assert.equal(selectPhoto([{ lat: 48, lon: 2, heights: {} }], 48, 2, 2), null);
});
test('photo supports the street-photo locations/files schema and nested license', () => {
  const result = selectPhoto({ locations: [{ lat: 48.844929, lon: 2.369632, label: '4 Rue Traversière, 75012 Paris', heights: ['0.5', '1.5', '2.5'], files: { original: '/photos/demo/original.jpg', flood: { '0.5': '/photos/demo/half.jpg', '1.5': '/photos/demo/one-half.jpg', '2.5': '/photos/demo/two-half.jpg' } }, credit: 'Lejun / Panoramax', photo: { license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' } }] }, 48.844929, 2.369632, 2);
  assert.equal(result?.hauteur_m, 1.5);
  assert.equal(result?.url, '/photos/demo/one-half.jpg');
  assert.equal(result?.url_clean, '/photos/demo/original.jpg');
  assert.equal(result?.url_depth, null); assert.deepEqual(result?.view, { fov: 80, pitch: 0, camera_height_m: 2 });
  assert.equal(result?.license, 'CC BY-SA 4.0');
  assert.equal(result?.address_label, '4 Rue Traversière, 75012 Paris');
  assert.equal(selectPhoto({ locations: [] }, 48.84, 2.37, 1.5), null);
});
test('bundled photos never expose an email and credits use each original photo license', async () => {
  const manifest = JSON.parse(await readFile(new URL('../web/public/photos/manifest.json', import.meta.url), 'utf8'));
  for (const entry of manifest.locations) {
    const result = selectPhoto(manifest, entry.lat, entry.lon, 1.5);
    assert.doesNotMatch(JSON.stringify(result), /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    assert.equal(result?.license, entry.photo.license);
    assert.equal(result?.license_url, entry.photo.license_url);
    assert.ok(result?.credit.endsWith(entry.photo.license));
    assert.equal(selectPhoto([{ ...entry, license: 'Incorrect license', license_url: 'https://example.org/wrong', credit: 'Incorrect credit' }], entry.lat, entry.lon, 1.5)?.credit, result?.credit);
  }
  const photo = selectPhoto(manifest, 48.846486, 2.370073, 1.5);
  assert.equal(photo?.credit, 'Photo : contributeur Panoramax, Etalab Open Licence 2.0');
  assert.equal(photo?.license, 'Etalab Open Licence 2.0');
  assert.equal(photo?.source_url, 'https://api.panoramax.xyz/#focus=pic&pic=36b6c9a3-afa5-495b-93f5-f1fba410d144');
  const legacy = selectPhoto([{ lat: 48, lon: 2, heights: { '1': '/photos/example.jpg' }, credit: 'Photo: author@example.org' }], 48, 2, 1);
  assert.equal(legacy?.credit, 'Photo: contributeur Panoramax');
});
test('session validates SDP and explicitly disables voice without a key', async () => {
  await withApp({ apiKey: '' }, async url => {
    assert.equal((await fetch(`${url}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp: 'invalid' }) })).status, 400);
    const response = await fetch(`${url}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp }) }); assert.equal(response.status, 503); assert.match((await response.json()).error, /OPENAI_API_KEY/);
    assert.equal((await (await fetch(`${url}/api/config`)).json()).voice, false);
  });
});
test('realtime passes multipart SDP and returns answer and session id', async () => {
  await withApp({ apiKey: 'test-not-a-key', mode: 'realtime', fetcher: (async (url, init) => { assert.equal(url, 'https://api.openai.com/v1/realtime/calls'); assert.equal((init?.body as FormData).get('sdp'), sdp); assert.match(String((init?.body as FormData).get('session')), /niveau_seine/); return new Response('v=0\r\nanswer', { headers: { location: '/v1/realtime/calls/call_test' } }); }) as typeof fetch }, async url => {
    const response = await fetch(`${url}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp }) }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { sdp: 'v=0\r\nanswer', id: 'call_test', mode: 'realtime' });
  });
});
test('realtime upstream errors are not reported as successful SDP', async () => {
  await withApp({ apiKey: 'test-not-a-key', mode: 'realtime', fetcher: (async () => Response.json({ error: { message: 'Model unavailable' } }, { status: 403 })) as typeof fetch }, async url => {
    const response = await fetch(`${url}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sdp }) }); assert.equal(response.status, 502); assert.match((await response.json()).error, /403/);
  });
});
test('malformed JSON and unknown API routes are handled', async () => { await withApp({}, async url => { assert.equal((await fetch(`${url}/api/unknown`)).status, 404); assert.equal((await fetch(`${url}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400); }); });
