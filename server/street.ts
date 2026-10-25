// Live street scene: nearest Panoramax 360° picture of an address, reprojected towards the façade,
// with a monocular depth map estimated on the CPU (Depth Anything V2 Small, Apache-2.0) and cached on disk.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { distance } from './api.ts';

export const panoramaxURL = 'https://api.panoramax.xyz/api';
export const cacheDir = fileURLToPath(new URL('../.cache/street/', import.meta.url));
export const OUT_W = 1600, OUT_H = 896, FOV = 80, PITCH = -4, CAMERA_HEIGHT = 2;
export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

export interface Picture { id: string; lat: number; lon: number; azimuth: number; hd: string; sd?: string; producer: string; license: string; license_url: string; datetime: string; distance_m: number }
export type DepthEstimator = (jpeg: Buffer) => Promise<{ data: Float32Array; width: number; height: number }>;

export function bearing(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const r = Math.PI / 180, dLon = (toLon - fromLon) * r;
  const y = Math.sin(dLon) * Math.cos(toLat * r), x = Math.cos(fromLat * r) * Math.sin(toLat * r) - Math.sin(fromLat * r) * Math.cos(toLat * r) * Math.cos(dLon);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/** Nearest equirectangular picture within `radius` metres, from the Panoramax STAC search API. */
export async function findNearestPicture(lat: number, lon: number, radius: number, fetcher: typeof fetch): Promise<Picture | null> {
  const dLat = radius / 111_320, dLon = radius / (111_320 * Math.cos(lat * Math.PI / 180));
  const url = `${panoramaxURL}/search?${new URLSearchParams({ bbox: `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`, limit: '50' })}`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/geo+json, application/json' } });
  if (!response.ok) throw new Error(`Panoramax HTTP ${response.status}`);
  const json = await response.json() as { features?: Record<string, any>[] };
  const pictures = (json.features ?? []).flatMap(feature => {
    const p = feature.properties ?? {};
    const panoramic = p['pers:interior_orientation']?.field_of_view === 360 || p.exif?.['Xmp.GPano.ProjectionType'] === 'equirectangular';
    const [plon, plat] = feature.geometry?.coordinates ?? [];
    if (!panoramic || !Number.isFinite(plat) || !Number.isFinite(plon) || !feature.assets?.hd?.href) return [];
    const d = distance(lat, lon, { lat: plat, lon: plon });
    if (d > radius) return [];
    const licenseLink = (feature.links ?? []).find((l: { rel: string }) => l.rel === 'license');
    return [{ id: String(feature.id), lat: plat, lon: plon, azimuth: Number(p['view:azimuth'] ?? 0), hd: feature.assets.hd.href, sd: feature.assets.sd?.href, producer: String(p['geovisio:producer'] ?? 'contributeur Panoramax'), license: String(p.license ?? 'CC-BY-SA-4.0'), license_url: licenseLink?.href ?? 'https://creativecommons.org/licenses/by-sa/4.0/', datetime: String(p.datetime ?? ''), distance_m: Math.round(d) } satisfies Picture];
  });
  return pictures.sort((a, b) => a.distance_m - b.distance_m)[0] ?? null;
}

/** Rectilinear view of an equirectangular picture. Panoramax panoramas start (u = 0) at the camera azimuth. */
export function reproject(src: { data: Uint8Array; width: number; height: number; channels: number }, yawDeg: number, pitchDeg = PITCH, fovDeg = FOV, w = OUT_W, h = OUT_H) {
  const out = new Uint8Array(w * h * 3);
  const f = (w / 2) / Math.tan(fovDeg * Math.PI / 360);
  const yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const { data, width: sw, height: sh, channels } = src;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = i - w / 2 + 0.5, y = -(j - h / 2 + 0.5), z = f;
    // pitch about X (negative = looking down, as hero.ts and metricDepth assume), then yaw about Y
    const y1 = y * cp + z * sp, z1 = -y * sp + z * cp;
    const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
    const lon = Math.atan2(x2, z2), lat = Math.atan2(y1, Math.hypot(x2, z2));
    const u = ((lon / (2 * Math.PI)) % 1 + 1) % 1 * sw - 0.5, v = (0.5 - lat / Math.PI) * sh - 0.5;
    const u0 = Math.floor(u), v0 = Math.min(Math.max(Math.floor(v), 0), sh - 2);
    const fu = u - u0, fv = Math.min(Math.max(v - v0, 0), 1);
    const ua = ((u0 % sw) + sw) % sw, ub = (ua + 1) % sw;
    const o = (j * w + i) * 3;
    for (let c = 0; c < 3; c++) {
      const a = data[(v0 * sw + ua) * channels + c], b = data[(v0 * sw + ub) * channels + c];
      const cc = data[((v0 + 1) * sw + ua) * channels + c], d = data[((v0 + 1) * sw + ub) * channels + c];
      out[o + c] = a * (1 - fu) * (1 - fv) + b * fu * (1 - fv) + cc * (1 - fu) * fv + d * fu * fv;
    }
  }
  return { data: out, width: w, height: h, channels: 3 as const };
}

/**
 * Relative monocular depth is affine-invariant inverse depth. Anchor it with two points: the road just below the
 * camera (bottom rows, left half), whose distance follows from the camera height and the ray geometry, and the
 * farthest content (1st percentile), pinned to the far clamp. Returns metres clamped to [1, 120].
 */
export function metricDepth(relative: { data: Float32Array; width: number; height: number }, cameraHeight = CAMERA_HEIGHT, pitchDeg = PITCH, fovDeg = FOV) {
  const { data, width, height } = relative;
  const tanY = Math.tan(fovDeg * Math.PI / 360) * height / width, p = pitchDeg * Math.PI / 180;
  const road: number[] = [], expected: number[] = [];
  for (let j = Math.floor(height * 0.97); j < height; j++) {
    const t = (j + 0.5) / height, slope = (1 - 2 * t) * tanY * Math.cos(p) + Math.sin(p);
    if (slope >= -1e-3) continue;
    for (let i = Math.floor(width * 0.15); i < width * 0.45; i += 4) { road.push(data[j * width + i]); expected.push(-cameraHeight / slope); }
  }
  const median = (values: number[]) => { const sorted = [...values].sort((x, y) => x - y); return sorted[sorted.length >> 1]; };
  const sample = Array.from({ length: 4096 }, (_, k) => data[Math.floor(k * data.length / 4096)]).sort((x, y) => x - y);
  const far = sample[Math.floor(sample.length * 0.01)], near = median(road), nearMetres = median(expected);
  const FAR = 120;
  const a = (1 / nearMetres - 1 / FAR) / Math.max(near - far, 1e-6), b = 1 / FAR - a * far;
  const metres = new Float32Array(data.length);
  for (let k = 0; k < data.length; k++) { const inv = a * data[k] + b; metres[k] = inv > 1 / FAR ? Math.max(1, 1 / inv) : FAR; }
  return { data: metres, width, height, scale: a, shift: b };
}

/** 16-bit centimetres packed as R = high byte, G = low byte, as written by scripts/photo/depth.py. */
export function encodeDepth(depth: { data: Float32Array; width: number; height: number }, scale = 0.5) {
  const w = Math.round(depth.width * scale), h = Math.round(depth.height * scale);
  const rgb = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const sx = Math.min(depth.width - 1, Math.round((i + 0.5) / scale - 0.5)), sy = Math.min(depth.height - 1, Math.round((j + 0.5) / scale - 0.5));
    const cm = Math.min(65535, Math.max(0, Math.round(depth.data[sy * depth.width + sx] * 100)));
    const o = (j * w + i) * 3; rgb[o] = cm >> 8; rgb[o + 1] = cm & 255;
  }
  return { data: rgb, width: w, height: h };
}

let estimatorPromise: Promise<DepthEstimator> | undefined;
type Transformers = Pick<typeof import('@huggingface/transformers'), 'pipeline' | 'RawImage'>;
/** Lazily loads the model once; a failed initialisation (e.g. first download offline) is forgotten so the next request retries. */
export function defaultDepthEstimator(load: () => Promise<Transformers> = () => import('@huggingface/transformers')): DepthEstimator {
  return async jpeg => {
    estimatorPromise ??= load().then(async ({ pipeline, RawImage }) => {
      const estimator = await pipeline('depth-estimation', DEPTH_MODEL, { dtype: 'fp32' });
      return async (buffer: Buffer) => {
        const sharp = (await import('sharp')).default;
        const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const image = new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);
        const out = await estimator(image) as { predicted_depth: { data: Float32Array; dims: number[] } };
        return { data: Float32Array.from(out.predicted_depth.data), width: out.predicted_depth.dims[1], height: out.predicted_depth.dims[0] };
      };
    }).catch(error => { estimatorPromise = undefined; throw error; });
    return (await estimatorPromise)(jpeg);
  };
}

export interface StreetScene { id: string; url_clean: string; url_depth: string; view: { fov: number; pitch: number; camera_height_m: number }; credit: string; license: string; license_url: string; source_url: string; author: string; datetime: string; distance_m: number; yaw: number }

const anonymize = (value: string) => value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'contributeur Panoramax');
const inflight = new Map<string, Promise<StreetScene>>();

/** Download, reproject towards the address and estimate depth; results are cached under `.cache/street/<picture id>/`. */
export function renderStreet(picture: Picture, lat: number, lon: number, options: { fetcher: typeof fetch; estimateDepth: DepthEstimator; cache?: string }): Promise<StreetScene> {
  const dir = `${options.cache ?? cacheDir}${picture.id}/`;
  const yaw = Math.round(bearing(picture.lat, picture.lon, lat, lon));
  const key = `${picture.id}:${yaw}`;
  const credit = `Photo : ${anonymize(picture.producer)} / Panoramax, ${picture.license}`;
  const scene = (): StreetScene => ({ id: picture.id, url_clean: `/cache/street/${picture.id}/photo_${yaw}.jpg`, url_depth: `/cache/street/${picture.id}/depth_${yaw}.png`, view: { fov: FOV, pitch: PITCH, camera_height_m: CAMERA_HEIGHT }, credit, license: picture.license, license_url: picture.license_url, source_url: `https://api.panoramax.xyz/#focus=pic&pic=${picture.id}`, author: anonymize(picture.producer), datetime: picture.datetime, distance_m: picture.distance_m, yaw });
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = (async () => {
    try { await access(`${dir}depth_${yaw}.png`); return scene(); } catch { /* not cached yet */ }
    const sharp = (await import('sharp')).default;
    const response = await options.fetcher(picture.hd, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`Panoramax image HTTP ${response.status}`);
    const source = Buffer.from(await response.arrayBuffer());
    const { data, info } = await sharp(source).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const view = reproject({ data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height, channels: info.channels }, yaw - picture.azimuth);
    const jpeg = await sharp(Buffer.from(view.data.buffer), { raw: { width: view.width, height: view.height, channels: 3 } }).jpeg({ quality: 86 }).toBuffer();
    const relative = await options.estimateDepth(jpeg);
    const depth = encodeDepth(metricDepth(relative));
    const png = await sharp(Buffer.from(depth.data.buffer), { raw: { width: depth.width, height: depth.height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}photo_${yaw}.jpg`, jpeg);
    await writeFile(`${dir}meta_${yaw}.json`, JSON.stringify({ ...scene(), model: DEPTH_MODEL }, null, 2));
    await writeFile(`${dir}depth_${yaw}.png`, png);
    return scene();
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

export async function readCachedScene(id: string, yaw: number, cache = cacheDir) {
  try { return JSON.parse(await readFile(`${cache}${id}/meta_${yaw}.json`, 'utf8')) as StreetScene; } catch { return null; }
}
