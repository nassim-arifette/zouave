// Optional "3D photoréaliste" view: Google Photorealistic 3D Tiles (Map Tiles API, OGC 3D Tiles) rendered with deck.gl,
// with our flood water drawn as a flat surface at the Seine's absolute level over the PPRI / timeline polygons.
// MapLibre stays the default (offline) mode; this view is exclusive (the MapLibre map is hidden while it is active),
// is key-gated by the server (/api/google/status, tiles proxied by /api/google/3d/*) and shows the Google Maps logo with
// the credits of the tiles on screen (index.html, bottom right, above every panel).
import { config } from './config.ts';
import { seineAltitude, type FloodClass } from './flood-level.ts';
import { flattenFootprints, footprintStyle, type WaterFeature, type WaterPolygon } from './water-footprints.ts';
interface ViewState { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }
interface Water { features: WaterFeature[]; altitude: number; label: string }
interface Tile { content?: { gltf?: { asset?: { copyright?: string } } } }

/** Credits of the displayed tiles, most frequent first: the Map Tiles policy asks to aggregate, sort and show them on one line. */
function tileCredits(tiles: Tile[]) {
  const counts = new Map<string, number>();
  for (const tile of tiles) for (const part of tile.content?.gltf?.asset?.copyright?.split(';') ?? []) if (part.trim()) counts.set(part.trim(), (counts.get(part.trim()) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([credit]) => credit).join(' · ');
}

export function createView3D(elements: { container: HTMLElement; toggle: HTMLButtonElement; status: HTMLElement; credits: HTMLElement; legend: HTMLElement; body: HTMLElement }) {
  let active = false, deck: { setProps: (props: Record<string, unknown>) => void; finalize: () => void } | undefined;
  // The tileset loads once per Deck: when the view comes back, there is no new load event to clear the status.
  let tilesetLoaded = false;
  let markReady: (() => void) | undefined;
  const tilesetReady = new Promise<void>(resolve => { markReady = resolve; });
  let viewState: ViewState = { longitude: config.initialCenter[0], latitude: config.initialCenter[1], zoom: 15.5, pitch: 60, bearing: -24 };
  let water: Water = { features: [], altitude: 0, label: '' };
  let classes: { Tile3DLayer: any; SolidPolygonLayer: any; FlyToInterpolator: any } | undefined;

  const render = () => {
    if (!deck || !classes) return;
    const { Tile3DLayer, SolidPolygonLayer } = classes;
    const polygons = flattenFootprints(water.features);
    deck.setProps({ viewState, layers: [
      new Tile3DLayer({ id: 'google-3d-tiles', data: '/api/google/3d/v1/3dtiles/root.json', onTilesetLoad: (tileset: { options: { onTraversalComplete: (tiles: Tile[]) => Tile[] } }) => {
        tilesetLoaded = true; markReady?.(); elements.status.hidden = true;
        // Each traversal hands over the tiles selected for display, so credits of tiles that left the screen go too.
        tileset.options.onTraversalComplete = tiles => { const text = tileCredits(tiles); if (elements.credits.textContent !== text) elements.credits.textContent = text; return tiles; };
      } }),
      new SolidPolygonLayer({ id: 'flood-water', data: polygons.filter(d => footprintStyle(d.properties).status === 'flooded'), extruded: true, filled: true, material: { ambient: 0.6, diffuse: 0.5, shininess: 60, specularColor: [200, 220, 230] }, getPolygon: (d: WaterPolygon) => d.polygon, getElevation: () => water.altitude, getFillColor: (d: WaterPolygon) => footprintStyle(d.properties).colour, opacity: 0.8, updateTriggers: { getElevation: water.altitude, getFillColor: water.label } }),
      new SolidPolygonLayer({ id: 'flood-water-possible', data: polygons.filter(d => footprintStyle(d.properties).status === 'possible'), extruded: true, wireframe: true, filled: true, getPolygon: (d: WaterPolygon) => d.polygon, getElevation: () => water.altitude, getFillColor: (d: WaterPolygon) => footprintStyle(d.properties).colour, getLineColor: [200, 225, 240, 230], opacity: 0.8, updateTriggers: { getElevation: water.altitude, getFillColor: water.label } }),
    ] });
  };

  async function activate() {
    // Once loaded, no banner at all: not even a flash while the status check and the imports below resolve.
    elements.status.hidden = tilesetLoaded; elements.status.textContent = tilesetLoaded ? '' : 'Loading Google 3D tiles…';
    const status = await fetch('/api/google/status').then(r => r.json()).catch(() => ({ tiles3d: false }));
    if (!status.tiles3d) { elements.status.textContent = 'Google key missing: set GOOGLE_MAPS_API_KEY on the server to enable the photorealistic 3D view.'; return; }
    const [{ Deck, MapView, FlyToInterpolator }, { Tile3DLayer }, { SolidPolygonLayer }] = await Promise.all([import('@deck.gl/core'), import('@deck.gl/geo-layers'), import('@deck.gl/layers')]);
    classes = { Tile3DLayer, SolidPolygonLayer, FlyToInterpolator };
    deck ??= new Deck({ parent: elements.container as HTMLDivElement, views: new MapView({ repeat: false, farZMultiplier: 3 }), controller: { touchRotate: true, inertia: true }, viewState, onViewStateChange: ({ viewState: next }: { viewState: unknown }) => { viewState = next as ViewState; render(); }, layers: [], onError: (error: Error) => { elements.status.hidden = false; elements.status.textContent = `3D tiles unavailable: ${error.message}`; } });
    render();
  }

  return {
    get active() { return active; },
    /** True once the Google tileset has loaded, false if it has not within `ms` (no key, network, quota). */
    ready(ms: number) { return tilesetLoaded ? Promise.resolve(true) : Promise.race([tilesetReady.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), ms))]); },
    async toggle(on = !active) {
      active = on;
      elements.toggle.setAttribute('aria-pressed', String(on));
      elements.toggle.textContent = on ? 'Map' : 'Photorealistic 3D';
      elements.container.classList.toggle('active', on);
      elements.body.classList.toggle('view-google', on);
      if (on) await activate();
    },
    /** Camera handoff from MapLibre (called when the MapLibre camera moves and when we fly to an address). */
    setCamera(next: Partial<ViewState>, animate = false) {
      const { transitionDuration: _duration, transitionInterpolator: _interpolator, ...settled } = { ...viewState, ...next } as ViewState & { transitionDuration?: number; transitionInterpolator?: unknown };
      viewState = settled;
      if (animate && classes) viewState = { ...viewState, transitionDuration: 2400, transitionInterpolator: new classes.FlyToInterpolator({ speed: 1.4 }) } as ViewState;
      render();
    },
    /** Water surface at the Seine's absolute level for `level` (Austerlitz gauge, m) over the given polygons; empty hides the water. */
    setWater(features: WaterFeature[], level: number | null, label: string) {
      water = { features: level === null ? [] : features, altitude: level === null ? 0 : seineAltitude(level), label: `${label}:${level}` };
      const statuses = new Set(water.features.map(feature => footprintStyle(feature.properties ?? {}).status));
      elements.legend.hidden = statuses.size === 0;
      elements.legend.textContent = [statuses.has('flooded') ? 'Solid: flooded' : '', statuses.has('possible') ? 'Translucent outline: possibly' : ''].filter(Boolean).join(' · ');
      render();
    },
    isFloodClass: (value: unknown): value is FloodClass => value === '0-1' || value === '1-2' || value === '2+',
  };
}
export type View3D = ReturnType<typeof createView3D>;
