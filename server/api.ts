import express from 'express';
import OpenAI from 'openai';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { instructions, liveTools, realtimeTools } from './tools.ts';

export const publicDir = fileURLToPath(new URL('../web/public/', import.meta.url));
export const levelURL = 'https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr?code_entite=F700000103&grandeur_hydro=H&size=1&sort=desc';
const geocodeURL = 'https://data.geopf.fr/geocodage/search';
export function normalizeAddress(q: string) { return q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[,\s]+/g, ' ').trim(); }
export function distance(lat: number, lon: number, entry: { lat: number; lon: number }) {
  const radians = Math.PI / 180;
  const a = Math.sin((entry.lat - lat) * radians / 2) ** 2 + Math.cos(lat * radians) * Math.cos(entry.lat * radians) * Math.sin((entry.lon - lon) * radians / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export interface PhotoEntry { lat: number; lon: number; label?: string; address_label?: string; address?: string; credit?: string; license?: string; license_url?: string; photo?: { author?: string; source?: string; license?: string; license_url?: string; page_url?: string }; files?: { original?: string; flood?: Record<string, string> }; url_clean?: string; clean?: string; heights: Record<string, string | { file?: string; url?: string }> | string[]; }
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
  const anonymize = (value: string) => value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'contributeur Panoramax');
  const license = entry.photo?.license ?? entry.license ?? '';
  const author = anonymize(entry.photo?.author ?? '');
  const credit = author ? `Photo : ${author}${entry.photo?.source && !author.includes(entry.photo.source) ? ` / ${entry.photo.source}` : ''}, ${license}` : anonymize(entry.credit ?? '');
  return { url: photoPath(url), url_clean: photoPath(entry.files?.original ?? entry.url_clean ?? entry.clean), hauteur_m: Number(key), address_label: entry.label ?? entry.address_label ?? entry.address ?? '', credit, license, license_url: entry.photo?.license_url ?? entry.license_url ?? null, source_url: entry.photo?.page_url ?? null, simulation: true };
}
export function createApp(options: { fetcher?: typeof fetch; photosPath?: string; apiKey?: string; mode?: string } = {}) {
  const app = express();
  const fetcher = options.fetcher ?? fetch;
  const key = options.apiKey ?? process.env.OPENAI_API_KEY;
  const mode = options.mode ?? process.env.ZOUAVE_VOICE ?? 'live';
  let levelCache: { value: Record<string, unknown>; expires: number } | undefined;
  const geocodes = new Map<string, { value: unknown; expires: number }>();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  app.get('/api/config', (_req, res) => { res.json({ voice: Boolean(key), mode }); });
  app.get('/api/niveau', async (_req, res) => {
    if (levelCache && levelCache.expires > Date.now()) { res.json(levelCache.value); return; }
    try {
      const upstream = await fetcher(levelURL, { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) throw new Error(`Hub'Eau HTTP ${upstream.status}`);
      const json = await upstream.json();
      const obs = json.data?.[0];
      if (!obs || !Number.isFinite(obs.resultat_obs) || !obs.date_obs || obs.code_station !== 'F700000103') throw new Error('Invalid observation');
      const value = { hauteur_m: obs.resultat_obs / 1000, date_obs: obs.date_obs, station_code: 'F700000103', station_label: 'La Seine à Paris [Austerlitz]', source: "Hub'Eau / Vigicrues", source_url: levelURL, stale: false };
      levelCache = { value, expires: Date.now() + 15 * 60_000 };
      res.json(value);
    } catch {
      const fallback = levelCache?.value ?? JSON.parse(await readFile(`${publicDir}data/niveau-fallback.json`, 'utf8'));
      res.json({ ...fallback, stale: true });
    }
  });
  app.get('/api/geocode', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 3 || q.length > 250) { res.status(400).json({ error: 'Une adresse de 3 à 250 caractères est requise.' }); return; }
    const normalized = normalizeAddress(q);
    const cached = geocodes.get(normalized);
    if (cached && cached.expires > Date.now()) { res.json(cached.value); return; }
    try {
      const upstream = await fetcher(`${geocodeURL}?${new URLSearchParams({ q, limit: '1' })}`, { signal: AbortSignal.timeout(5000) });
      if (!upstream.ok) throw new Error('Geocoding unavailable');
      const json = await upstream.json();
      if (!json.features?.length) { res.status(404).json({ error: 'Adresse introuvable. Précisez le numéro et la ville.' }); return; }
      const value = { ...json, source: 'Géoplateforme IGN', source_url: geocodeURL, offline: false };
      if (geocodes.size > 500) geocodes.clear();
      geocodes.set(normalized, { value, expires: Date.now() + 24 * 60 * 60_000 });
      res.json(value);
    } catch {
      const fallbacks = JSON.parse(await readFile(`${publicDir}data/geocode-fallback.json`, 'utf8'));
      const found = fallbacks.find((entry: { aliases: string[] }) => entry.aliases.includes(normalized));
      if (!found) { res.status(503).json({ error: 'Géocodage indisponible. Essayez 4 Rue Traversière, Paris (adresse de démonstration).' }); return; }
      res.json({ type: 'FeatureCollection', features: [found.feature], source: 'Géoplateforme IGN', source_url: geocodeURL, offline: true });
    }
  });
  app.get('/api/photo', async (req, res) => {
    const lat = Number(req.query.lat), lon = Number(req.query.lon), h = Number(req.query.h);
    if (req.query.lat === undefined || req.query.lon === undefined || req.query.h === undefined || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(h) || h < 0 || h > 10) { res.status(400).json({ error: 'lat, lon et h valides sont requis.' }); return; }
    try {
      const manifest = JSON.parse(await readFile(options.photosPath ?? `${publicDir}photos/manifest.json`, 'utf8'));
      const photo = selectPhoto(manifest, lat, lon, h);
      if (!photo) { res.status(404).json({ error: 'Aucune photo simulée disponible.' }); return; }
      res.json(photo);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { res.status(404).json({ error: 'Les photos simulées ne sont pas encore disponibles.' }); return; }
      res.status(502).json({ error: 'Le catalogue de photos est indisponible.' });
    }
  });
  app.post('/api/session', async (req, res) => {
    const sdp = req.body?.sdp;
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || !sdp.includes('m=audio') || !sdp.includes('a=ice-ufrag:') || sdp.length > 100_000) { res.status(400).json({ error: 'Une offre SDP WebRTC audio valide est requise.' }); return; }
    if (!key) { res.status(503).json({ error: 'La voix est désactivée : OPENAI_API_KEY manque sur le serveur.' }); return; }
    try {
      if (mode === 'live') {
        const client = new OpenAI({ apiKey: key, timeout: 30_000, maxRetries: 0 });
        const result = await client.live.create({ session: { model: 'gpt-live-1', instructions, delegation: { type: 'responses', responses: { model: 'gpt-6-luna', instructions, tools: liveTools, tool_choice: 'auto', parallel_tool_calls: false } } }, transport: { type: 'webrtc', sdp } });
        res.json({ sdp: result.transport.sdp, id: result.session.id, mode });
      } else if (mode === 'realtime') {
        const body = new FormData();
        body.set('sdp', sdp);
        body.set('session', JSON.stringify({ type: 'realtime', model: process.env.ZOUAVE_REALTIME_MODEL ?? 'gpt-realtime-2.1', instructions, tools: realtimeTools, tool_choice: 'auto', audio: { output: { voice: 'marin' }, input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'fr' } } } }));
        const upstream = await fetcher('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body, signal: AbortSignal.timeout(30_000) });
        if (!upstream.ok) {
          const message = await upstream.text();
          console.error(`Realtime HTTP ${upstream.status}: ${message}`);
          res.status(502).json({ error: `OpenAI Realtime HTTP ${upstream.status}: ${message}` }); return;
        }
        res.json({ sdp: await upstream.text(), id: upstream.headers.get('location')?.split('/').pop() ?? null, mode });
      } else res.status(500).json({ error: 'ZOUAVE_VOICE doit être live ou realtime.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown session failure';
      console.error(`Voice session failed: ${message}`);
      res.status(502).json({ error: `Session vocale indisponible : ${message}` });
    }
  });
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Route inconnue.' }); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: error instanceof SyntaxError ? 'JSON invalide.' : 'Requête invalide.' }); });
  return app;
}
