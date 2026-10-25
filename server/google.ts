// Google Maps Platform gateway: the Map Tiles API key never leaves the server (3D Tiles requests are proxied);
// the browser-restricted key used by Maps JavaScript (Street View) is handed out only when configured.
export const tilesOrigin = 'https://tile.googleapis.com/';

export interface GoogleOptions { tilesKey?: string; browserKey?: string; fetcher?: typeof fetch }

export function googleStatus(options: GoogleOptions) {
  return { tiles3d: Boolean(options.tilesKey), streetview: Boolean(options.browserKey), browser_key: options.browserKey ?? null };
}

/** Builds the upstream URL for a proxied 3D Tiles request: same path and query (session token…), plus the server key. */
export function upstreamTileURL(path: string, query: URLSearchParams, key: string) {
  const url = new URL(path.replace(/^\/+/, ''), tilesOrigin);
  for (const [name, value] of query) if (name !== 'key') url.searchParams.append(name, value);
  url.searchParams.set('key', key);
  return url;
}

export async function proxyTile(path: string, query: URLSearchParams, options: Required<Pick<GoogleOptions, 'tilesKey' | 'fetcher'>>) {
  const upstream = await options.fetcher(upstreamTileURL(path, query, options.tilesKey), { signal: AbortSignal.timeout(20_000) });
  const body = Buffer.from(await upstream.arrayBuffer());
  return { status: upstream.status, contentType: upstream.headers.get('content-type') ?? 'application/octet-stream', cacheControl: upstream.headers.get('cache-control'), body };
}
