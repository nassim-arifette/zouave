// "Mémoire de 1910": fetches real photographs of the January 1910 flood near the demo addresses from Wikimedia
// Commons, keeping only files whose Commons metadata says public domain (or CC0) and that date from 1910, and writes
// web/public/memoire/manifest.json with author, licence and file page for the credits. Run once with internet access:
//   npm run fetch-1910
// Locations are approximate (street level, for map pins); the app labels them as such.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const places = [
  { slug: 'bercy', label: 'Bercy wine warehouses', lat: 48.8358, lon: 2.3840, queries: ['Bercy inondation 1910', 'Entrepôt de Bercy 1910 flood', 'Bercy crue 1910'] },
  { slug: 'rue-de-lyon', label: 'Rue de Lyon', lat: 48.8478, lon: 2.3718, queries: ['rue de Lyon inondation 1910', 'rue de Lyon crue 1910'] },
  { slug: 'gare-de-lyon', label: 'Gare de Lyon', lat: 48.8443, lon: 2.3738, queries: ['gare de Lyon inondation 1910', 'gare de Lyon crue 1910'] },
  { slug: 'ledru-rollin', label: 'Avenue Ledru-Rollin', lat: 48.8463, lon: 2.3726, queries: ['avenue Ledru-Rollin inondation 1910', 'Ledru-Rollin 1910 crue'] },
  { slug: 'rapee', label: 'Quai de la Rapée', lat: 48.8419, lon: 2.3702, queries: ['quai de la Rapée inondation 1910', 'quai de la Rapée crue 1910'] },
  { slug: 'daumesnil', label: 'Avenue Daumesnil', lat: 48.8448, lon: 2.3770, queries: ['avenue Daumesnil inondation 1910', 'Daumesnil crue 1910'] },
];

const API = 'https://commons.wikimedia.org/w/api.php';
const strip = html => String(html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const normalize = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** True only for files Commons itself marks as public domain or CC0. */
export function isPublicDomain(meta = {}) {
  const licence = `${meta.LicenseShortName?.value ?? ''} ${meta.License?.value ?? ''} ${meta.UsageTerms?.value ?? ''}`;
  return /public domain|^pd\b|\bpd-|cc0/i.test(licence.trim()) && !/cc[- ]by|gfdl/i.test(licence);
}

/** Best Commons search result for a place: a 1910 flood photograph in the public domain whose title or description names the place. */
export function pickFile(pages, place) {
  const keys = normalize(place.label).split(/[\s-]+/).filter(word => word.length > 3 && !['avenue', 'quai', 'gare', 'rue'].includes(word));
  const candidates = Object.values(pages ?? {}).map(page => {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const text = normalize(`${page.title} ${strip(meta.ImageDescription?.value)} ${strip(meta.ObjectName?.value)}`);
    const date = `${strip(meta.DateTimeOriginal?.value)} ${page.title}`;
    return { page, info, meta, text, date };
  }).filter(({ info, meta, text, date }) =>
    info?.thumburl && /^image\/(jpeg|png|tiff)/.test(info.mime ?? 'image/jpeg') &&
    isPublicDomain(meta) && /1910/.test(date) && /(inond|crue|flood)/.test(text) && keys.some(key => text.includes(key)));
  candidates.sort((a, b) => (b.info.width ?? 0) - (a.info.width ?? 0));
  return candidates[0] ?? null;
}

export function toEntry(place, found, image) {
  const meta = found.meta;
  return {
    slug: place.slug, label: place.label, lat: place.lat, lon: place.lon, location: 'approximate',
    title: found.page.title.replace(/^File:/, ''), date: strip(meta.DateTimeOriginal?.value) || 'January 1910',
    description: strip(meta.ImageDescription?.value).slice(0, 240),
    author: strip(meta.Artist?.value) || 'Unknown photographer', credit: strip(meta.Credit?.value),
    license: strip(meta.LicenseShortName?.value) || 'Public domain', license_url: strip(meta.LicenseUrl?.value) || null,
    file_page: found.info.descriptionurl, image,
  };
}

const UA = { 'User-Agent': 'ZouaveFloodDemo/1.0 (https://github.com/nassim-arifette/zouave; hackathon) scripts/fetch-1910.mjs' };
/** Wikimedia rate-limits shared addresses (HTTP 429): wait (Retry-After or exponential backoff) and retry. */
async function polite(url, fetcher, tries = 6) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, { headers: UA });
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt >= tries - 1) return response;
    const wait = Number(response.headers?.get?.('retry-after')) * 1000 || 2000 * 2 ** attempt;
    await new Promise(resolve => setTimeout(resolve, Math.min(wait, 30_000)));
  }
}
async function search(query, fetcher) {
  const params = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1600', origin: '*' });
  const response = await polite(`${API}?${params}`, fetcher);
  if (!response.ok) throw new Error(`Commons HTTP ${response.status}`);
  return (await response.json()).query?.pages ?? {};
}

export async function fetchMemories({ fetcher = fetch, out = fileURLToPath(new URL('../web/public/memoire/', import.meta.url)), log = console.log } = {}) {
  await mkdir(out, { recursive: true });
  const entries = [], used = new Set();
  for (const place of places) {
    let found = null;
    for (const query of place.queries) {
      const pages = await search(query, fetcher);
      for (const key of Object.keys(pages)) if (used.has(pages[key].title)) delete pages[key];
      found = pickFile(pages, place);
      if (found) break;
    }
    if (!found) { log(`· ${place.label}: no public-domain 1910 photo found, skipped`); continue; }
    const image = `/memoire/${place.slug}.jpg`;
    const response = await polite(found.info.thumburl, fetcher);
    if (!response.ok) { log(`· ${place.label}: download failed (${response.status}), skipped`); continue; }
    await writeFile(`${out}${place.slug}.jpg`, Buffer.from(await response.arrayBuffer()));
    used.add(found.page.title);
    const entry = toEntry(place, found, image);
    entries.push(entry);
    log(`✓ ${place.label}: ${entry.title} · ${entry.license} · ${entry.author}`);
  }
  const manifest = { description: 'Photographs of the January 1910 Seine flood from Wikimedia Commons, public domain only (per Commons metadata). Locations are approximate.', generated: new Date().toISOString(), entries };
  await writeFile(`${out}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`${entries.length} photo(s) written to web/public/memoire/. Check each file page before publishing.`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) await fetchMemories();
