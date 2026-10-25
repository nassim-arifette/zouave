import express from 'express';
import OpenAI from 'openai';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { instructions, liveTools, realtimeTools } from './tools.ts';
import { googleStatus, proxyTile, TilePathError, type GoogleOptions } from './google.ts';
import { findNearestPicture, renderStreet, defaultDepthEstimator, cacheDir, type DepthEstimator } from './street.ts';

export const publicDir = fileURLToPath(new URL('../web/public/', import.meta.url));
export const levelURL = 'https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr?code_entite=F700000103&grandeur_hydro=H&size=1&sort=desc';
const geocodeURL = 'https://data.geopf.fr/geocodage/search';
export function normalizeAddress(q: string) { return q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[,\s]+/g, ' ').trim(); }
export function distance(lat: number, lon: number, entry: { lat: number; lon: number }) {
  const radians = Math.PI / 180;
  const a = Math.sin((entry.lat - lat) * radians / 2) ** 2 + Math.cos(lat * radians) * Math.cos(entry.lat * radians) * Math.sin((entry.lon - lon) * radians / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export interface PhotoEntry { lat: number; lon: number; label?: string; address_label?: string; address?: string; credit?: string; license?: string; license_url?: string; photo?: { author?: string; source?: string; license?: string; license_url?: string; page_url?: string; view?: { fov?: number; pitch?: number } }; files?: { original?: string; flood?: Record<string, string>; depth?: string }; depth?: { camera_height_m?: number }; url_clean?: string; clean?: string; heights: Record<string, string | { file?: string; url?: string }> | string[]; }
export function selectPhoto(manifest: Record<string, PhotoEntry> | { photos: PhotoEntry[] } | { locations: PhotoEntry[] } | PhotoEntry[], lat: number, lon: number, height: number) {
  const entries = Array.isArray(manifest) ? manifest : 'locations' in manifest && Array.isArray(manifest.locations) ? manifest.locations : 'photos' in manifest && Array.isArray(manifest.photos) ? manifest.photos : Object.values(manifest) as PhotoEntry[];
  const entry = entries.filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon) && e.heights).sort((a, b) => distance(lat, lon, a) - distance(lat, lon, b))[0];
  if (!entry) return null;
  const heights = entry.files?.flood ?? (Array.isArray(entry.heights) ? {} : entry.heights);
  const key = Object.keys(heights).filter(k => Number.isFinite(Number(k))).sort((a, b) => Math.abs(Number(a) - height) - Math.abs(Number(b) - height))[0];
  if (key === undefined) return null;
  const path = heights[key];
  const url = typeof path === 'string' ? path : path.url ?? path.file;
  if (!url) return null;
  const photoPath = (value: string | undefined) => value ? value.startsWith('/') || value.startsWith('https://') ? value : `/photos/${value.replace(/^photos\//, '')}` : null;
  // Emails become a neutral credit; the bundled manifest's French placeholder is shown in English.
  const anonymize = (value: string) => value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'Panoramax contributor').replace(/contributeur Panoramax/g, 'Panoramax contributor').replace(/^Photo : /, 'Photo: ');
  const license = entry.photo?.license ?? entry.license ?? '';
  const author = anonymize(entry.photo?.author ?? '');
  const credit = author ? `Photo: ${author}${entry.photo?.source && !author.includes(entry.photo.source) ? ` / ${entry.photo.source}` : ''}, ${license}` : anonymize(entry.credit ?? '');
  return { url: photoPath(url), url_clean: photoPath(entry.files?.original ?? entry.url_clean ?? entry.clean), hauteur_m: Number(key), address_label: entry.label ?? entry.address_label ?? entry.address ?? '', credit, license, license_url: entry.photo?.license_url ?? entry.license_url ?? null, source_url: entry.photo?.page_url ?? null, simulation: true, distance_m: Math.round(distance(lat, lon, entry)), url_depth: photoPath(entry.files?.depth), view: { fov: entry.photo?.view?.fov ?? 80, pitch: entry.photo?.view?.pitch ?? 0, camera_height_m: entry.depth?.camera_height_m ?? 2 } };
}
export const ttsURL = 'https://api.openai.com/v1/audio/speech';
export const ttsInstructions = 'You are the Zouave, the 19th-century stone statue of a French Zouave soldier standing in the Seine under the Pont de l’Alma in Paris. Speak English with a light, warm French accent. Calm, wise storyteller with gentle gravitas and a hint of humour; measured pace, never rushed. Numbers and units are read clearly.';
/** Address other devices on the same network can open (QR code at the end of the story); ZOUAVE_PUBLIC_URL wins. */
export function shareURL(port = Number(process.env.PORT ?? 3000)) {
  if (process.env.ZOUAVE_PUBLIC_URL) return process.env.ZOUAVE_PUBLIC_URL;
  const lan = Object.values(networkInterfaces()).flat().find(item => item && item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'));
  return lan ? `http://${lan.address}:${port}` : null;
}
export function createApp(options: { fetcher?: typeof fetch; photosPath?: string; apiKey?: string; mode?: string; google?: GoogleOptions; street?: { enabled?: boolean; radius_m?: number; estimateDepth?: DepthEstimator; cache?: string }; tts?: { enabled?: boolean; cache?: string; model?: string; voice?: string } } = {}) {
  const app = express();
  const fetcher = options.fetcher ?? fetch;
  const google = { tilesKey: options.google?.tilesKey ?? (process.env.GOOGLE_MAPS_API_KEY || undefined), browserKey: options.google?.browserKey ?? (process.env.GOOGLE_MAPS_BROWSER_KEY || undefined) };
  app.get('/api/google/status', (_req, res) => { res.json(googleStatus(google)); });
  // Photorealistic 3D Tiles proxy: root tileset and child tiles (session token in the query) with the server-side key.
  app.get(/^\/api\/google\/3d\/(.+)$/, async (req, res) => {
    if (!google.tilesKey) { res.status(404).json({ error: 'Google key missing: set GOOGLE_MAPS_API_KEY on the server.' }); return; }
    try {
      const tile = await proxyTile(req.params[0], new URL(req.url, 'http://localhost').searchParams, { tilesKey: google.tilesKey, fetcher });
      res.status(tile.status).type(tile.contentType);
      if (tile.cacheControl) res.setHeader('cache-control', tile.cacheControl);
      res.send(tile.body);
    } catch (error) {
      if (error instanceof TilePathError) { res.status(400).json({ error: error.message }); return; }
      res.status(502).json({ error: 'Google 3D tiles unavailable.', detail: error instanceof Error ? error.message : String(error) }); }
  });
  const street = { enabled: options.street?.enabled ?? process.env.ZOUAVE_STREET !== 'off', radius: options.street?.radius_m ?? Number(process.env.ZOUAVE_STREET_RADIUS_M ?? 80), estimateDepth: options.street?.estimateDepth ?? defaultDepthEstimator(), cache: options.street?.cache ?? cacheDir };
  const streetScenes = new Map<string, { value: unknown; expires: number }>();
  let streetJobs = 0;
  const key = options.apiKey ?? process.env.OPENAI_API_KEY;
  const mode = options.mode ?? process.env.ZOUAVE_VOICE ?? 'live';
  let levelCache: { value: Record<string, unknown>; expires: number } | undefined;
  const geocodes = new Map<string, { value: unknown; expires: number }>();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  const tts = { enabled: Boolean(key) && (options.tts?.enabled ?? process.env.ZOUAVE_TTS !== 'off'), cache: options.tts?.cache ?? fileURLToPath(new URL('../.cache/tts/', import.meta.url)), model: options.tts?.model ?? process.env.ZOUAVE_TTS_MODEL ?? 'gpt-4o-mini-tts', voice: options.tts?.voice ?? process.env.ZOUAVE_TTS_VOICE ?? 'ash' };
  app.get('/api/config', (_req, res) => { res.json({ voice: Boolean(key), mode, tts: tts.enabled, share_url: shareURL() }); });
  app.get('/api/niveau', async (_req, res) => {
    if (levelCache && levelCache.expires > Date.now()) { res.json(levelCache.value); return; }
    try {
      const upstream = await fetcher(levelURL, { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) throw new Error(`Hub'Eau HTTP ${upstream.status}`);
      const json = await upstream.json();
      const obs = json.data?.[0];
      if (!obs || !Number.isFinite(obs.resultat_obs) || !obs.date_obs || obs.code_station !== 'F700000103') throw new Error('Invalid observation');
      const value = { hauteur_m: obs.resultat_obs / 1000, date_obs: obs.date_obs, station_code: 'F700000103', station_label: 'The Seine at Paris [Austerlitz]', source: "Hub'Eau / Vigicrues", source_url: levelURL, stale: false };
      levelCache = { value, expires: Date.now() + 15 * 60_000 };
      res.json(value);
    } catch {
      const fallback = levelCache?.value ?? JSON.parse(await readFile(`${publicDir}data/niveau-fallback.json`, 'utf8'));
      res.json({ ...fallback, station_label: 'The Seine at Paris [Austerlitz]', source: "Hub'Eau / Vigicrues · offline snapshot", stale: true });
    }
  });
  app.get('/api/geocode', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 3 || q.length > 250) { res.status(400).json({ error: 'An address of 3 to 250 characters is required.' }); return; }
    const normalized = normalizeAddress(q);
    const cached = geocodes.get(normalized);
    if (cached && cached.expires > Date.now()) { res.json(cached.value); return; }
    try {
      const upstream = await fetcher(`${geocodeURL}?${new URLSearchParams({ q, limit: '1' })}`, { signal: AbortSignal.timeout(5000) });
      if (!upstream.ok) throw new Error('Geocoding unavailable');
      const json = await upstream.json();
      if (!json.features?.length) { res.status(404).json({ error: 'Address not found. Add the street number and the city.' }); return; }
      const value = { ...json, source: 'Géoplateforme IGN', source_url: geocodeURL, offline: false };
      if (geocodes.size > 500) geocodes.clear();
      geocodes.set(normalized, { value, expires: Date.now() + 24 * 60 * 60_000 });
      res.json(value);
    } catch {
      const fallbacks = JSON.parse(await readFile(`${publicDir}data/geocode-fallback.json`, 'utf8'));
      const found = fallbacks.find((entry: { aliases: string[] }) => entry.aliases.includes(normalized) || entry.aliases.includes(`${normalized} paris`));
      if (!found) { res.status(503).json({ error: 'Geocoding unavailable. Try 4 Rue Traversière, Paris (demo address).' }); return; }
      res.json({ type: 'FeatureCollection', features: [found.feature], source: 'Géoplateforme IGN', source_url: geocodeURL, offline: true });
    }
  });
  // Live street scene for any address: nearest Panoramax panorama (≤ radius), reprojected towards the façade, depth on CPU.
  app.get('/api/rue', async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { res.status(400).json({ error: 'Invalid coordinates.' }); return; }
    if (!street.enabled) { res.status(404).json({ error: 'Live street mode is disabled.' }); return; }
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    const cached = streetScenes.get(key);
    if (cached && cached.expires > Date.now()) { res.json(cached.value); return; }
    try {
      const manifest = JSON.parse(await readFile(options.photosPath ?? `${publicDir}photos/manifest.json`, 'utf8'));
      const curated = selectPhoto(manifest, lat, lon, 1.5);
      if (curated?.url_depth && curated.distance_m <= 30) { res.json({ ...curated, live: false }); return; }
    } catch { /* no curated catalogue: continue with the live path */ }
    if (streetJobs >= 2) { res.status(429).json({ error: 'Too many street scenes are being computed. Try again in a few seconds.' }); return; }
    streetJobs++;
    try {
      const picture = await findNearestPicture(lat, lon, street.radius, fetcher);
      if (!picture) { res.status(404).json({ error: `No Panoramax photo within ${street.radius} m.`, radius_m: street.radius }); return; }
      const scene = await renderStreet(picture, lat, lon, { fetcher, estimateDepth: street.estimateDepth, cache: street.cache });
      const value = { ...scene, simulation: true, live: true, source: 'Panoramax' };
      if (streetScenes.size > 200) streetScenes.clear();
      streetScenes.set(key, { value, expires: Date.now() + 6 * 3600_000 });
      res.json(value);
    } catch (error) {
      res.status(503).json({ error: 'Street photo unavailable for now.', detail: error instanceof Error ? error.message : String(error) });
    } finally { streetJobs--; }
  });
  app.get('/api/photo', async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon), h = Number(req.query.h);
    if (req.query.lat === undefined || req.query.lon === undefined || req.query.h === undefined || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(h) || h < 0 || h > 10) { res.status(400).json({ error: 'Valid lat, lon and h are required.' }); return; }
    try {
      const manifest = JSON.parse(await readFile(options.photosPath ?? `${publicDir}photos/manifest.json`, 'utf8'));
      const photo = selectPhoto(manifest, lat, lon, h);
      if (!photo) { res.status(404).json({ error: 'No simulated photo available.' }); return; }
      res.json(photo);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { res.status(404).json({ error: 'Simulated photos are not available yet.' }); return; }
      res.status(502).json({ error: 'The photo catalogue is unavailable.' });
    }
  });
  app.post('/api/session', async (req, res) => {
    const sdp = req.body?.sdp;
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || !sdp.includes('m=audio') || !sdp.includes('a=ice-ufrag:') || sdp.length > 100_000) { res.status(400).json({ error: 'A valid WebRTC audio SDP offer is required.' }); return; }
    if (!key) { res.status(503).json({ error: 'Voice is disabled: OPENAI_API_KEY is missing on the server.' }); return; }
    try {
      if (mode === 'live') {
        const client = new OpenAI({ apiKey: key, timeout: 30_000, maxRetries: 0 });
        const result = await client.live.create({ session: { model: 'gpt-live-1', instructions, delegation: { type: 'responses', responses: { model: 'gpt-6-luna', instructions, tools: liveTools, tool_choice: 'auto', parallel_tool_calls: false } } }, transport: { type: 'webrtc', sdp } });
        res.json({ sdp: result.transport.sdp, id: result.session.id, mode });
      } else if (mode === 'realtime') {
        const body = new FormData();
        body.set('sdp', sdp);
        body.set('session', JSON.stringify({ type: 'realtime', model: process.env.ZOUAVE_REALTIME_MODEL ?? 'gpt-realtime-2.1', instructions, tools: realtimeTools, tool_choice: 'auto', audio: { output: { voice: 'marin' }, input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' } } } }));
        const upstream = await fetcher('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(30_000) });
        if (!upstream.ok) {
          const message = await upstream.text();
          console.error(`Realtime HTTP ${upstream.status}: ${message}`);
          res.status(502).json({ error: `OpenAI Realtime HTTP ${upstream.status}: ${message}` }); return;
        }
        res.json({ sdp: await upstream.text(), id: upstream.headers.get('location')?.split('/').pop() ?? null, mode });
      } else res.status(500).json({ error: 'ZOUAVE_VOICE must be live or realtime.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown session failure';
      console.error(`Voice session failed: ${message}`);
      res.status(502).json({ error: `Voice session unavailable: ${message}` });
    }
  });
  // The Zouave's narrated voice (OpenAI text-to-speech), cached on disk by text so rehearsals and the demo replay offline.
  const speaking = new Map<string, Promise<Buffer>>();
  app.post('/api/tts', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > 600) { res.status(400).json({ error: 'Text of 1 to 600 characters is required.' }); return; }
    const id = createHash('sha256').update(`${tts.model}|${tts.voice}|${ttsInstructions}|${text}`).digest('hex').slice(0, 32);
    const file = `${tts.cache}${id}.mp3`;
    const send = (audio: Buffer) => { res.type('audio/mpeg').setHeader('cache-control', 'public, max-age=86400'); res.send(audio); };
    try { send(await readFile(file)); return; } catch { /* not cached yet */ }
    if (!tts.enabled) { res.status(404).json({ error: 'Narrated voice unavailable: OPENAI_API_KEY is missing on the server.' }); return; }
    let pending = speaking.get(id);
    if (!pending) {
      pending = (async () => {
        const upstream = await fetcher(ttsURL, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: tts.model, voice: tts.voice, input: text, instructions: ttsInstructions, response_format: 'mp3' }), signal: AbortSignal.timeout(20_000) });
        if (!upstream.ok) throw new Error(`OpenAI speech HTTP ${upstream.status}`);
        const audio = Buffer.from(await upstream.arrayBuffer());
        await mkdir(tts.cache, { recursive: true });
        await writeFile(file, audio);
        return audio;
      })().finally(() => speaking.delete(id));
      speaking.set(id, pending);
    }
    try { send(await pending); }
    catch (error) { res.status(502).json({ error: `Narrated voice unavailable: ${error instanceof Error ? error.message : String(error)}` }); }
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown route.' }); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : 'Invalid request.' }); });
  return app;
}
