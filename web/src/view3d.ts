// Optional "3D photoréaliste" view: Google Photorealistic 3D Tiles (Map Tiles API, OGC 3D Tiles) rendered with deck.gl,
// with our flood water drawn as a flat surface at the Seine's absolute level over the PPRI / timeline polygons.
// MapLibre stays the default (offline) mode; this view is exclusive (the MapLibre map is hidden while it is active),
// is key-gated by the server (/api/google/status, tiles proxied by /api/google/3d/*) and shows Google + data attributions.
import { config } from './config.ts';
import { seineAltitude, type FloodClass } from './flood-level.ts';
import { flattenFootprints, footprintStyle, type WaterFeature, type WaterPolygon } from './water-footprints.ts';
interface ViewState { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }
interface Water { features: WaterFeature[]; altitude: number; label: string }


export function createView3D(elements: { container: HTMLElement; toggle: HTMLButtonElement; status: HTMLElement; attribution: HTMLElement; legend: HTMLElement; body: HTMLElement }) {
  let active = false, deck: { setProps: (props: Record<string, unknown>) => void; finalize: () => void } | undefined;
  let viewState: ViewState = { longitude: config.initialCenter[0], latitude: config.initialCenter[1], zoom: 15.5, pitch: 60, bearing: -24 };
  let water: Water = { features: [], altitude: 0, label: '' };
  const credits = new Set<string>();
  let classes: { Tile3DLayer: any; SolidPolygonLayer: any; FlyToInterpolator: any } | undefined;

  const render = () => {
    if (!deck || !classes) return;
    const { Tile3DLayer, SolidPolygonLayer } = classes;
    const polygons = flattenFootprints(water.features);
    deck.setProps({ viewState, layers: [
      new Tile3DLayer({ id: 'google-3d-tiles', data: '/api/google/3d/v1/3dtiles/root.json', onTileLoad: (tile: { content?: { gltf?: { asset?: { copyright?: string } } } }) => { for (const part of tile.content?.gltf?.asset?.copyright?.split(';') ?? []) if (part.trim()) credits.add(part.trim()); elements.attribution.textContent = `Map data © Google · ${[...credits].join(' · ')}`; }, onTilesetLoad: () => { elements.status.hidden = true; } }),
      new SolidPolygonLayer({ id: 'flood-water', data: polygons.filter(d => footprintStyle(d.properties).status === 'flooded'), extruded: true, filled: true, material: { ambient: 0.6, diffuse: 0.5, shininess: 60, specularColor: [200, 220, 230] }, getPolygon: (d: WaterPolygon) => d.polygon, getElevation: () => water.altitude, getFillColor: (d: WaterPolygon) => footprintStyle(d.properties).colour, opacity: 0.8, updateTriggers: { getElevation: water.altitude, getFillColor: water.label } }),
      new SolidPolygonLayer({ id: 'flood-water-possible', data: polygons.filter(d => footprintStyle(d.properties).status === 'possible'), extruded: true, wireframe: true, filled: true, getPolygon: (d: WaterPolygon) => d.polygon, getElevation: () => water.altitude, getFillColor: (d: WaterPolygon) => footprintStyle(d.properties).colour, getLineColor: [200, 225, 240, 230], opacity: 0.8, updateTriggers: { getElevation: water.altitude, getFillColor: water.label } }),
    ] });
  };

  async function activate() {
    elements.status.hidden = false; elements.status.textContent = 'Loading Google 3D tiles…';
    const status = await fetch('/api/google/status').then(r => r.json()).catch(() => ({ tiles3d: false }));
    if (!status.tiles3d) { elements.status.textContent = 'Google key missing: set GOOGLE_MAPS_API_KEY on the server to enable the photorealistic 3D view.'; return; }
    const [{ Deck, MapView, FlyToInterpolator }, { Tile3DLayer }, { SolidPolygonLayer }] = await Promise.all([import('@deck.gl/core'), import('@deck.gl/geo-layers'), import('@deck.gl/layers')]);
    classes = { Tile3DLayer, SolidPolygonLayer, FlyToInterpolator };
    deck ??= new Deck({ parent: elements.container as HTMLDivElement, views: new MapView({ repeat: false, farZMultiplier: 3 }), controller: { touchRotate: true, inertia: true }, viewState, onViewStateChange: ({ viewState: next }: { viewState: unknown }) => { viewState = next as ViewState; render(); }, layers: [], onError: (error: Error) => { elements.status.hidden = false; elements.status.textContent = `3D tiles unavailable: ${error.message}`; } });
    render();
  }

  return {
    get active() { return active; },
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
      viewState = { ...viewState, ...next };
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
