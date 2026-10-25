// Google Maps Platform gateway: the Map Tiles API key never leaves the server (3D Tiles requests are proxied);
// the browser-restricted key used by Maps JavaScript (Street View) is handed out only when configured.
export const tilesOrigin = 'https://tile.googleapis.com/';

export interface GoogleOptions { tilesKey?: string; browserKey?: string; fetcher?: typeof fetch }

export function googleStatus(options: GoogleOptions) {
  return { tiles3d: Boolean(options.tilesKey), streetview: Boolean(options.browserKey), browser_key: options.browserKey ?? null };
}

export const proxyPrefix = '/api/google/3d';
/** Only the 3D Tiles tree of the Map Tiles API may be reached through the proxy. */
const allowedPath = /^\/v1\/3dtiles\/[A-Za-z0-9._\-\/]+$/;

export class TilePathError extends Error {}

/** Builds the upstream URL for a proxied 3D Tiles request: same path and query (session token…), plus the server key.
 * The destination is locked before the key is attached: only relative `v1/3dtiles/…` paths, resolved against the Google
 * tiles origin, are accepted (absolute URLs, other schemes/hosts, `..` escapes and odd characters are rejected). */
export function upstreamTileURL(path: string, query: URLSearchParams, key: string) {
  const relative = path.replace(/^\/+/, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(relative) || relative.startsWith('/') || relative.includes('\\')) throw new TilePathError('Chemin de tuile non autorisé.');
  const url = new URL(relative, tilesOrigin);
  if (url.origin !== new URL(tilesOrigin).origin || url.protocol !== 'https:' || !allowedPath.test(url.pathname) || url.username || url.password || url.hash) throw new TilePathError('Chemin de tuile non autorisé.');
  url.search = '';
  for (const [name, value] of query) if (name !== 'key') url.searchParams.append(name, value);
  url.searchParams.set('key', key);
  return url;
}

/** Rewrites the content URIs of a tileset so that child requests also go through the proxy (the Google root tileset
 * returns absolute paths such as `/v1/3dtiles/datasets/…?session=…`, which would otherwise hit our server unproxied). */
export function rewriteTileset(tileset: unknown, prefix = proxyPrefix): unknown {
  const origin = new URL(tilesOrigin).origin;
  const rewrite = (uri: unknown) => {
    if (typeof uri !== 'string') return uri;
    if (uri.startsWith(origin + '/')) return prefix + uri.slice(origin.length);
    if (uri.startsWith('/') && !uri.startsWith(prefix + '/')) return prefix + uri;
    return uri;
  };
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(node as Record<string, unknown>)) out[name] = (name === 'uri' || name === 'url') ? rewrite(value) : walk(value);
    return out;
  };
  return walk(tileset);
}

export async function proxyTile(path: string, query: URLSearchParams, options: Required<Pick<GoogleOptions, 'tilesKey' | 'fetcher'>>) {
  const upstream = await options.fetcher(upstreamTileURL(path, query, options.tilesKey), { signal: AbortSignal.timeout(20_000), redirect: 'manual' });
  if (upstream.status >= 300 && upstream.status < 400) return { status: 502, contentType: 'application/json', cacheControl: null, body: Buffer.from(JSON.stringify({ error: 'Redirection upstream refusée.' })) };
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  let body = Buffer.from(await upstream.arrayBuffer());
  if (upstream.ok && /json/i.test(contentType)) { try { body = Buffer.from(JSON.stringify(rewriteTileset(JSON.parse(body.toString('utf8'))))); } catch { /* not a tileset: pass through */ } }
  return { status: upstream.status, contentType, cacheControl: upstream.headers.get('cache-control'), body };
}
