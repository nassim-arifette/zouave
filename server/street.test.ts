import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from './api.ts';
import { bearing, findNearestPicture, metricDepth, reproject, defaultDepthEstimator, OUT_W, OUT_H, RENDER_VERSION } from './street.ts';
import { mkdir, writeFile } from 'node:fs/promises';

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
  // Negative pitch looks down: the centre pixel at -60° lands in the dark ground band (bottom rows of the panorama).
  const down = centre(reproject(src, 90, -60, 80, 64, 36)), up = centre(reproject(src, 90, 60, 80, 64, 36));
  assert.ok(down[0] < 60 && down[1] < 60 && down[2] < 60, `pitch -60° must see the ground band, got ${down}`);
  assert.ok(up[0] > 100, `pitch +60° must see the red upper half, got ${up}`);
  // Capture tilt compensation (Panoramax pers:pitch, positive = camera pitched up): the view requested 10° below the horizon in a
  // panorama shot 20° up samples what a level panorama shows 10° above it (yaw 0, roll 0); roll compensation leaves the central ray untouched.
  const tilted = reproject(src, 0, -10, 80, 64, 36, { pitch: 20, roll: 0 }), level = reproject(src, 0, 10, 80, 64, 36);
  const close = (a: number[], b: number[]) => a.every((v, k) => Math.abs(v - b[k]) <= 3);
  assert.ok(close(centre(tilted), centre(level)), `tilt-compensated ${centre(tilted)} vs level ${centre(level)}`);
  assert.ok(close(centre(reproject(src, 45, 0, 80, 64, 36, { pitch: 0, roll: 35 })), centre(reproject(src, 45, 0, 80, 64, 36))));
  // Horizon test on a panorama built with the reference capture rotation (camera pitched 7° up and rolled 10°): once
  // compensated, the sky/ground boundary must be horizontal across the whole view, at every yaw.
  const tp = 7 * Math.PI / 180, tr = 10 * Math.PI / 180, W = 1024, H = 512, pano = new Uint8Array(W * H * 3);
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const lon = ((u + 0.5) / W) * 2 * Math.PI, lat = Math.PI / 2 - ((v + 0.5) / H) * Math.PI;
    // camera-frame direction of this texel, then back to the level frame: undo roll (about forward), then undo pitch (about X)
    const xc = Math.cos(lat) * Math.sin(lon), yc = Math.sin(lat), zc = Math.cos(lat) * Math.cos(lon);
    const xr = xc * Math.cos(tr) - yc * Math.sin(tr), yr = xc * Math.sin(tr) + yc * Math.cos(tr);
    const yl = yr * Math.cos(tp) - zc * Math.sin(tp);
    const o = (v * W + u) * 3; if (yl > 0) { pano[o + 2] = 220; } else { pano[o] = 200; pano[o + 1] = 120; }
  }
  for (const yawDeg of [0, 90, 180, 270]) {
    const view = reproject({ data: pano, width: W, height: H, channels: 3 }, yawDeg, 0, 80, 321, 181, { pitch: 7, roll: 10 });
    const horizon = [20, 80, 160, 240, 300].map(x => { for (let row = 0; row < 181; row++) if (view.data[(row * 321 + x) * 3] > view.data[(row * 321 + x) * 3 + 2]) return row; return -1; });
    assert.ok(horizon.every(row => Math.abs(row - 90) <= 2), `yaw ${yawDeg}: horizon rows ${horizon} should all be ≈ 90`);
  }
  const relative = await fakeDepth();
  const metres = metricDepth(relative);
  const bottom = metres.data[(OUT_H - 1) * OUT_W + Math.floor(OUT_W * 0.3)];
  assert.ok(bottom > 3 && bottom < 4.5, `road just below a 2 m camera at -4° pitch should be ~3.7 m away, got ${bottom}`);
  assert.ok(metres.data[Math.floor(OUT_W * 0.5)] >= metres.data[(OUT_H - 1) * OUT_W + Math.floor(OUT_W * 0.5)], 'top of frame is farther than the road');
  // Ground-plane prior: even when the model pushes the whole bottom of the frame far away, rays below the horizon stop at the ground.
  const far = metricDepth({ data: new Float32Array(OUT_W * OUT_H).fill(0.01), width: OUT_W, height: OUT_H });
  const row = Math.floor(OUT_H * 0.9), tanY = Math.tan(80 * Math.PI / 360) * OUT_H / OUT_W, p = -4 * Math.PI / 180;
  const ground = -2 / ((1 - 2 * (row + 0.5) / OUT_H) * tanY * Math.cos(p) + Math.sin(p));
  assert.ok(far.data[row * OUT_W + Math.floor(OUT_W * 0.7)] <= ground * 1.05 + 1e-6, `bottom-right ray capped at the ground (${ground.toFixed(2)} m)`);
  assert.equal(far.data[Math.floor(OUT_W * 0.5)], 120, 'rays above the horizon are not capped');
});

test('/api/rue renders, caches and attributes the nearest panorama, and reports when none is in range', async () => {
  const cache = `${await mkdtemp(join(tmpdir(), 'zouave-street-'))}/`;
  const { fetcher, images } = mockFetch([feature('near', 2.38300, 48.84595)]);
  await withApp({ fetcher, photosPath: '/nonexistent/manifest.json', street: { estimateDepth: fakeDepth, cache, radius_m: 80 } }, async url => {
    const first = await fetch(`${url}/api/rue?lat=${address.lat}&lon=${address.lon}`);
    assert.equal(first.status, 200);
    const scene = await first.json();
    assert.equal(scene.live, true);
    assert.match(scene.url_clean, /^\/cache\/street\/near\/photo_\d+_v\d+\.jpg$/);
    assert.match(scene.url_depth, /^\/cache\/street\/near\/depth_\d+_v\d+\.png$/);
    assert.equal(scene.credit, 'Photo: Panoramax contributor / Panoramax, CC-BY-SA-4.0');
    assert.equal(scene.license_url, 'https://creativecommons.org/licenses/by-sa/4.0/');
    assert.equal(scene.source_url, 'https://api.panoramax.xyz/#focus=pic&pic=near');
    assert.deepEqual(scene.view, { fov: 80, pitch: -4, camera_height_m: 2 });
    const depth = await sharp(await readFile(`${cache}near/${scene.url_depth.split('/').pop()}`)).metadata();
    assert.deepEqual([depth.width, depth.height], [OUT_W / 2, OUT_H / 2]);
    assert.ok(!JSON.stringify(scene).includes('@'), 'no email in the response');
    const second = await (await fetch(`${url}/api/rue?lat=${address.lat}&lon=${address.lon}`)).json();
    assert.equal(second.url_depth, scene.url_depth);
    assert.equal(images(), 1, 'the panorama is downloaded once');
    assert.equal((await fetch(`${url}/api/rue?lat=48.80&lon=2.30`)).status, 404);
    assert.equal((await fetch(`${url}/api/rue?lat=abc`)).status, 400);
  });
});

test('cached renders from an older pipeline version are recomputed', async () => {
  const cache = `${await mkdtemp(join(tmpdir(), 'zouave-street-'))}/`;
  const { fetcher, images } = mockFetch([feature('near', 2.38300, 48.84595)]);
  let estimations = 0;
  const countingDepth = async () => { estimations++; return fakeDepth(); };
  await withApp({ fetcher, photosPath: '/nonexistent/manifest.json', street: { estimateDepth: countingDepth, cache, radius_m: 80 } }, async url => {
    const scene = await (await fetch(`${url}/api/rue?lat=${address.lat}&lon=${address.lon}`)).json();
    assert.equal(estimations, 1);
    // Simulate an entry written by the previous pipeline: same files, older version in the metadata.
    const metaPath = `${cache}near/meta_${scene.yaw}_v${RENDER_VERSION}.json`;
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    assert.equal(meta.render_version, RENDER_VERSION);
    await writeFile(metaPath, JSON.stringify({ ...meta, render_version: RENDER_VERSION - 1 }));
    const fresh = createApp({ fetcher, photosPath: '/nonexistent/manifest.json', street: { estimateDepth: countingDepth, cache, radius_m: 80 } }).listen(0);
    await new Promise(resolve => fresh.once('listening', resolve));
    try {
      const again = await (await fetch(`http://127.0.0.1:${(fresh.address() as { port: number }).port}/api/rue?lat=${address.lat}&lon=${address.lon}`)).json();
      assert.equal(again.url_depth, scene.url_depth);
      assert.equal(estimations, 2, 'the stale entry was recomputed');
      assert.equal(images(), 2);
      assert.equal(JSON.parse(await readFile(metaPath, 'utf8')).render_version, RENDER_VERSION);
    } finally { fresh.close(); }
  });
  await mkdir(cache, { recursive: true });
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

test('a failed model initialisation is retried on the next request while an in-flight one is shared', async () => {
  let attempts = 0;
  const fakeImage = { width: 2, height: 2 };
  const load = async () => {
    attempts++;
    if (attempts === 1) throw new Error('offline');
    return { RawImage: class { constructor() { return fakeImage; } }, pipeline: async () => async () => ({ predicted_depth: { data: new Float32Array([1, 2, 3, 4]), dims: [2, 2] } }) } as never;
  };
  const estimate = defaultDepthEstimator(load);
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#808080' } }).png().toBuffer();
  await assert.rejects(estimate(png), /offline/);
  const [a, b] = await Promise.all([estimate(png), estimate(png)]);
  assert.deepEqual([a.width, a.height, b.width], [2, 2, 2]);
  assert.equal(attempts, 2, 'the model is loaded again after the failure and only once for concurrent requests');
});
