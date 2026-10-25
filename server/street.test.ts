import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from './api.ts';
import { bearing, findNearestPicture, metricDepth, reproject, OUT_W, OUT_H } from './street.ts';

const address = { lat: 48.845905, lon: 2.382605 };
const feature = (id: string, lon: number, lat: number, extra: Record<string, unknown> = {}) => ({ id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { 'view:azimuth': 187, 'pers:interior_orientation': { field_of_view: 360 }, 'geovisio:producer': 'someone@example.org', license: 'CC-BY-SA-4.0', datetime: '2026-08-05T10:00:00Z', ...extra }, assets: { hd: { href: `https://img.test/${id}.jpg` } }, links: [{ rel: 'license', href: 'https://creativecommons.org/licenses/by-sa/4.0/' }] });
// A tiny equirectangular panorama: left half red, right half blue, dark bottom band.
const panorama = await sharp({ create: { width: 64, height: 32, channels: 3, background: { r: 200, g: 30, b: 30 } } })
  .composite([{ input: await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 30, g: 30, b: 200 } } }).png().toBuffer(), left: 32, top: 0 }, { input: await sharp({ create: { width: 64, height: 6, channels: 3, background: { r: 20, g: 20, b: 20 } } }).png().toBuffer(), left: 0, top: 26 }])
  .jpeg().toBuffer();

function mockFetch(features: unknown[], images = 0) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url.includes('/api/search')) return new Response(JSON.stringify({ type: 'FeatureCollection', features }), { headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://img.test/')) { images++; return new Response(panorama, { headers: { 'content-type': 'image/jpeg' } }); }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls, images: () => images };
}
const fakeDepth = async () => ({ data: new Float32Array(OUT_W * OUT_H).map((_, k) => 1 + 6 * Math.floor(k / OUT_W) / OUT_H), width: OUT_W, height: OUT_H });
async function withApp(options: Parameters<typeof createApp>[0], run: (url: string) => Promise<void>) {
  const server = createApp(options).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`); } finally { server.close(); }
}

test('bearing and nearest-panorama selection ignore flat pictures and anything beyond the radius', async () => {
  assert.equal(Math.round(bearing(48.0, 2.0, 48.001, 2.0)), 0);
  assert.equal(Math.round(bearing(48.0, 2.0, 48.0, 2.001)), 90);
  const { fetcher } = mockFetch([feature('far', 2.3840, 48.8459), feature('flat', 2.38262, 48.84592, { 'pers:interior_orientation': { field_of_view: 70 } }), feature('near', 2.38300, 48.84595)]);
  const picture = await findNearestPicture(address.lat, address.lon, 80, fetcher);
  assert.equal(picture?.id, 'near');
  assert.ok(picture!.distance_m > 20 && picture!.distance_m < 40);
  assert.equal(await findNearestPicture(address.lat, address.lon, 10, fetcher), null);
});

test('reprojection looks along the requested heading and metric fit puts the road about 2 m under the camera', async () => {
  const { data, info } = await sharp(panorama).raw().toBuffer({ resolveWithObject: true });
  const src = { data: new Uint8Array(data), width: info.width, height: info.height, channels: info.channels };
  const centre = (view: ReturnType<typeof reproject>) => Array.from(view.data.slice((Math.floor(view.height / 2) * view.width + Math.floor(view.width / 2)) * 3, (Math.floor(view.height / 2) * view.width + Math.floor(view.width / 2)) * 3 + 3));
  const red = centre(reproject(src, 90, 0, 80, 64, 36)), blue = centre(reproject(src, 270, 0, 80, 64, 36));
  assert.ok(red[0] > red[2], 'heading 90° (u ≈ 0.25) sees the red half');
  assert.ok(blue[2] > blue[0], 'heading 270° (u ≈ 0.75) sees the blue half');
  const relative = await fakeDepth();
  const metres = metricDepth(relative);
  const bottom = metres.data[(OUT_H - 1) * OUT_W + Math.floor(OUT_W * 0.3)];
  assert.ok(bottom > 3 && bottom < 4.5, `road just below a 2 m camera at -4° pitch should be ~3.7 m away, got ${bottom}`);
  assert.ok(metres.data[Math.floor(OUT_W * 0.5)] >= metres.data[(OUT_H - 1) * OUT_W + Math.floor(OUT_W * 0.5)], 'top of frame is farther than the road');
});

test('/api/rue renders, caches and attributes the nearest panorama, and reports when none is in range', async () => {
  const cache = `${await mkdtemp(join(tmpdir(), 'zouave-street-'))}/`;
  const { fetcher, images } = mockFetch([feature('near', 2.38300, 48.84595)]);
  await withApp({ fetcher, photosPath: '/nonexistent/manifest.json', street: { estimateDepth: fakeDepth, cache, radius_m: 80 } }, async url => {
    const first = await fetch(`${url}/api/rue?lat=${address.lat}&lon=${address.lon}`);
    assert.equal(first.status, 200);
    const scene = await first.json();
    assert.equal(scene.live, true);
    assert.match(scene.url_clean, /^\/cache\/street\/near\/photo_\d+\.jpg$/);
    assert.match(scene.url_depth, /^\/cache\/street\/near\/depth_\d+\.png$/);
    assert.equal(scene.credit, 'Photo : contributeur Panoramax / Panoramax, CC-BY-SA-4.0');
    assert.equal(scene.license_url, 'https://creativecommons.org/licenses/by-sa/4.0/');
    assert.equal(scene.source_url, 'https://api.panoramax.xyz/#focus=pic&pic=near');
    assert.deepEqual(scene.view, { fov: 80, pitch: -4, camera_height_m: 2 });
    const depth = await sharp(await readFile(`${cache}near/depth_${scene.yaw}.png`)).metadata();
    assert.deepEqual([depth.width, depth.height], [OUT_W / 2, OUT_H / 2]);
    assert.ok(!JSON.stringify(scene).includes('@'), 'no email in the response');
    const second = await (await fetch(`${url}/api/rue?lat=${address.lat}&lon=${address.lon}`)).json();
    assert.equal(second.url_depth, scene.url_depth);
    assert.equal(images(), 1, 'the panorama is downloaded once');
    assert.equal((await fetch(`${url}/api/rue?lat=48.80&lon=2.30`)).status, 404);
    assert.equal((await fetch(`${url}/api/rue?lat=abc`)).status, 400);
  });
});

test('/api/rue prefers the curated demo photo within 30 m and can be switched off', async () => {
  const { fetcher } = mockFetch([feature('near', 2.3697, 48.8450)]);
  await withApp({ fetcher, street: { estimateDepth: fakeDepth } }, async url => {
    const scene = await (await fetch(`${url}/api/rue?lat=48.844929&lon=2.369632`)).json();
    assert.equal(scene.live, false);
    assert.equal(scene.url_depth, '/photos/4-rue-traversiere/depth.png');
  });
  await withApp({ fetcher, street: { enabled: false, estimateDepth: fakeDepth } }, async url => {
    assert.equal((await fetch(`${url}/api/rue?lat=${address.lat}&lon=${address.lon}`)).status, 404);
  });
});
