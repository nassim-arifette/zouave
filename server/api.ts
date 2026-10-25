import express from 'express';
import { setTimeout as delay } from 'node:timers/promises';
import { allowDemo, createDemoLimiter, type DemoLimiter } from './demo-limits.ts';
import OpenAI from 'openai';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { httpsEnabled, httpsPort, lanAddresses } from './https.ts';
import { fileURLToPath } from 'node:url';
import { instructions, liveTools, realtimeTools } from './tools.ts';
import { googleStatus, proxyTile, upstreamTileURL, TilePathError, type GoogleOptions } from './google.ts';
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
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
/** ElevenLabs v3 audio tags ([excited], [whispers]…) are for the expressive voice only: never sent elsewhere, never shown. */
export const stripVoiceTags = (text: string) => text.replace(/\[[a-z][a-z '-]{0,30}\]\s*/gi, '').replace(/\s+/g, ' ').trim();
export const ttsInstructions = 'You are the Zouave, the 19th-century stone statue of a French Zouave soldier standing in the Seine under the Pont de l’Alma in Paris. Speak English with a light, warm French accent. Calm, wise storyteller with gentle gravitas and a hint of humour; measured pace, never rushed. Numbers and units are read clearly.';
/** Address other devices on the same network can open (QR code at the end of the story); ZOUAVE_PUBLIC_URL wins. */
export function shareURL(port = Number(process.env.PORT ?? 3000)) {
  if (process.env.ZOUAVE_PUBLIC_URL) return process.env.ZOUAVE_PUBLIC_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const lan = lanAddresses()[0];
  // With ZOUAVE_HTTPS=1 phones get the secure (self-signed) address, so the microphone works there too.
  return lan ? httpsEnabled() ? `https://${lan}:${httpsPort()}` : `http://${lan}:${port}` : null;
}
export function createApp(options: { demo?: DemoLimiter; background?: (task: Promise<unknown>) => void; fetcher?: typeof fetch; photosPath?: string; apiKey?: string; mode?: string; google?: GoogleOptions; street?: { enabled?: boolean; radius_m?: number; estimateDepth?: DepthEstimator; cache?: string }; tts?: { enabled?: boolean; cache?: string; model?: string; voice?: string }; eleven?: { key?: string; voice?: string; model?: string; expressiveModel?: string } } = {}) {
  const app = express();
  const demo = options.demo ?? createDemoLimiter();
  const background = options.background ?? ((task: Promise<unknown>) => { void task.catch(() => console.error('Background session close failed.')); });
  const fetcher = options.fetcher ?? fetch;
  const google = { tilesKey: options.google?.tilesKey ?? (process.env.GOOGLE_MAPS_API_KEY || undefined), browserKey: options.google?.browserKey ?? (process.env.GOOGLE_MAPS_BROWSER_KEY || undefined) };
  app.get('/api/google/status', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(googleStatus({ tilesKey: demo.available() ? google.tilesKey : undefined, browserKey: !demo.enabled ? google.browserKey : undefined })); });
  // Photorealistic 3D Tiles proxy: root tileset and child tiles (session token in the query) with the server-side key.
  app.get(/^\/api\/google\/3d\/(.+)$/, async (req, res) => {
    if (!google.tilesKey) { res.status(404).json({ error: 'Google key missing: set GOOGLE_MAPS_API_KEY on the server.' }); return; }
    let rootTile: boolean;
    try { rootTile = upstreamTileURL(req.params[0], new URL(req.url, 'http://localhost').searchParams, google.tilesKey).pathname === '/v1/3dtiles/root.json'; }
    catch { res.status(400).json({ error: 'Tile path not allowed.' }); return; }
    if (rootTile && !await allowDemo(demo, 'google_session', req, res)) return;
    if (!await allowDemo(demo, 'google', req, res)) return;
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
  const tts = { enabled: Boolean(key) && (options.tts?.enabled ?? process.env.ZOUAVE_TTS !== 'off'), cache: options.tts?.cache ?? (process.env.VERCEL ? '/tmp/zouave/tts/' : fileURLToPath(new URL('../.cache/tts/', import.meta.url))), model: options.tts?.model ?? process.env.ZOUAVE_TTS_MODEL ?? 'gpt-4o-mini-tts', voice: options.tts?.voice ?? process.env.ZOUAVE_TTS_VOICE ?? 'marin' };
  // ElevenLabs gives the Zouave his French accent in English (shared voice "Jamie - French Accent & Charismatic");
  // it is preferred when its key is set, OpenAI text-to-speech is the fallback.
  const eleven = { key: options.eleven?.key ?? process.env.ELEVENLABS_API_KEY ?? '', voice: options.eleven?.voice ?? process.env.ZOUAVE_ELEVEN_VOICE ?? 'K8nDX2f6wjv6bCh5UeZi', model: options.eleven?.model ?? process.env.ZOUAVE_ELEVEN_MODEL ?? 'eleven_multilingual_v2', expressiveModel: options.eleven?.expressiveModel ?? process.env.ZOUAVE_ELEVEN_EXPRESSIVE_MODEL ?? 'eleven_v3' };
  const elevenEnabled = Boolean(eleven.key) && (options.tts?.enabled ?? process.env.ZOUAVE_TTS !== 'off');
  app.get('/api/config', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ voice: Boolean(key) && demo.available(), mode, tts: (elevenEnabled || tts.enabled) && demo.available(), tts_provider: elevenEnabled ? 'elevenlabs' : tts.enabled ? 'openai' : null, share_url: shareURL(), demo_until: demo.enabled ? new Date(demo.until).toISOString() : null }); });
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
    if (!await allowDemo(demo, 'street', req, res)) return;
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
    if (demo.enabled && mode !== 'live') { res.status(503).json({ error: 'The demo uses bounded Live voice sessions.' }); return; }
    if (!await allowDemo(demo, 'session', req, res)) return;
    try {
      if (mode === 'live') {
        const client = new OpenAI({ apiKey: key, fetch: fetcher, timeout: 30_000, maxRetries: 0 });
        const result = await client.live.create({ session: { model: 'gpt-live-1', instructions, ...(demo.enabled ? { client: { data_channel: { allowed_client_events: ['response.item.create', 'response.create', 'session.close'] } } } : {}), delegation: { type: 'responses', responses: { model: 'gpt-6-luna', instructions, tools: liveTools, tool_choice: 'auto', parallel_tool_calls: false, ...(demo.enabled ? { max_output_tokens: 256, reasoning: { effort: 'low' as const } } : {}) } } }, transport: { type: 'webrtc', sdp } });
        const maxDurationMs = demo.enabled ? Math.max(0, Math.min(demo.sessionSeconds * 1000, demo.until - Date.now())) : undefined;
        if (maxDurationMs !== undefined) {
          const id = result.session.id;
          background((async () => {
            await delay(maxDurationMs);
            const closer = new OpenAI({ apiKey: key, fetch: fetcher, timeout: 5000, maxRetries: 1 });
            try { await closer.live.sessions.hangup(id); }
            catch { console.error('The bounded voice session could not be closed; check the OpenAI project hard limit.'); }
          })());
        }
        res.json({ sdp: result.transport.sdp, id: result.session.id, mode, max_duration_ms: maxDurationMs });
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
  // The Zouave's narrated voice (ElevenLabs, else OpenAI text-to-speech), cached on disk by provider, model, voice,
  // settings and text, so rehearsed lines replay offline. `expressive` keeps ElevenLabs v3 audio tags ([excited]…).
  const speaking = new Map<string, Promise<Buffer>>();
  app.post('/api/tts', async (req, res) => {
    const raw = typeof req.body?.text === 'string' ? req.body.text.replace(/\s+/g, ' ').trim() : '';
    if (!raw || raw.length > 600) { res.status(400).json({ error: 'Text of 1 to 600 characters is required.' }); return; }
    const expressive = req.body?.expressive === true;
    const plain = stripVoiceTags(raw);
    if (!plain) { res.status(400).json({ error: 'Text of 1 to 600 characters is required.' }); return; }
    const elevenModel = expressive ? eleven.expressiveModel : eleven.model;
    const elevenSettings = { stability: expressive ? 0.5 : 0.35, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true, speed: 1.12 };
    const elevenText = expressive ? raw : plain;
    const jobs = [
      { provider: 'elevenlabs', enabled: elevenEnabled, id: hash(`elevenlabs|${elevenModel}|${eleven.voice}|${JSON.stringify(elevenSettings)}|${elevenText}`), run: async () => {
        const upstream = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(eleven.voice)}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': eleven.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text: elevenText, model_id: elevenModel, voice_settings: elevenSettings }), signal: AbortSignal.timeout(20_000) });
        if (!upstream.ok) throw new Error(`ElevenLabs HTTP ${upstream.status}: ${(await upstream.text()).slice(0, 200)}`);
        return Buffer.from(await upstream.arrayBuffer());
      } },
      { provider: 'openai', enabled: tts.enabled, id: hash(`${tts.model}|${tts.voice}|${ttsInstructions}|${plain}`), run: async () => {
        // Official SDK call (parameters type-checked against openai's SpeechCreateParams); the fetcher stays injectable for tests.
        const client = new OpenAI({ apiKey: key, fetch: fetcher, timeout: 20_000, maxRetries: 0 });
        const upstream = await client.audio.speech.create({ model: tts.model, voice: tts.voice, input: plain, instructions: ttsInstructions, response_format: 'mp3' });
        return Buffer.from(await upstream.arrayBuffer());
      } },
    ];
    const send = (audio: Buffer, provider: string) => { res.type('audio/mpeg').setHeader('cache-control', 'public, max-age=86400'); res.setHeader('x-zouave-tts', provider); res.send(audio); };
    for (const job of jobs) { try { send(await readFile(`${tts.cache}${job.id}.mp3`), job.provider); return; } catch { /* not cached with this provider */ } }
    const available = jobs.filter(job => job.enabled);
    if (!available.length) { res.status(404).json({ error: 'Narrated voice unavailable: set ELEVENLABS_API_KEY or OPENAI_API_KEY on the server.' }); return; }
    const errors: string[] = [];
    for (const job of available) {
      let pending = speaking.get(job.id);
      if (!pending) {
        if (!await allowDemo(demo, 'tts', req, res)) return;
        if (!await allowDemo(demo, 'tts_chars', req, res, job.provider === 'elevenlabs' ? elevenText.length : plain.length)) return;
        pending = speaking.get(job.id) ?? job.run().then(async audio => { await mkdir(tts.cache, { recursive: true }); await writeFile(`${tts.cache}${job.id}.mp3`, audio); return audio; }).finally(() => speaking.delete(job.id));
        speaking.set(job.id, pending);
      }
      try { send(await pending, job.provider); return; }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    res.status(502).json({ error: `Narrated voice unavailable: ${errors.join(' · ')}` });
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Unknown route.' }); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : 'Invalid request.' }); });
  return app;
}
