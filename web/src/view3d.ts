// Optional "3D photoréaliste" view: Google Photorealistic 3D Tiles (Map Tiles API, OGC 3D Tiles) rendered with deck.gl,
// with our flood water drawn as a flat surface at the Seine's absolute level over the PPRI / timeline polygons.
// MapLibre stays the default (offline) mode; this view is exclusive (the MapLibre map is hidden while it is active),
// is key-gated by the server (/api/google/status, tiles proxied by /api/google/3d/*) and shows Google + data attributions.
import { config } from './config.ts';
import { seineAltitude, type FloodClass } from './flood-level.ts';
import { flattenFootprints, type WaterFeature, type WaterPolygon } from './water-footprints.ts';
interface ViewState { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }
interface Water { features: WaterFeature[]; altitude: number; label: string }

const classColour: Record<string, [number, number, number]> = { '0-1': [112, 196, 214], '1-2': [58, 141, 190], '2+': [34, 87, 158], possible: [120, 170, 200], banks: [124, 210, 223] };

export function createView3D(elements: { container: HTMLElement; toggle: HTMLButtonElement; status: HTMLElement; attribution: HTMLElement; body: HTMLElement }) {
  let active = false, deck: { setProps: (props: Record<string, unknown>) => void; finalize: () => void } | undefined;
  let viewState: ViewState = { longitude: config.initialCenter[0], latitude: config.initialCenter[1], zoom: 15.5, pitch: 60, bearing: -24 };
  let water: Water = { features: [], altitude: 0, label: '' };
  const credits = new Set<string>();
  let classes: { Tile3DLayer: any; SolidPolygonLayer: any; FlyToInterpolator: any } | undefined;

  const render = () => {
    if (!deck || !classes) return;
    const { Tile3DLayer, SolidPolygonLayer } = classes;
    deck.setProps({ viewState, layers: [
      new Tile3DLayer({ id: 'google-3d-tiles', data: '/api/google/3d/v1/3dtiles/root.json', onTileLoad: (tile: { content?: { gltf?: { asset?: { copyright?: string } } } }) => { for (const part of tile.content?.gltf?.asset?.copyright?.split(';') ?? []) if (part.trim()) credits.add(part.trim()); elements.attribution.textContent = `Données cartographiques © Google · ${[...credits].join(' · ')}`; }, onTilesetLoad: () => { elements.status.hidden = true; } }),
      new SolidPolygonLayer({ id: 'flood-water', data: flattenFootprints(water.features), extruded: true, filled: true, material: { ambient: 0.6, diffuse: 0.5, shininess: 60, specularColor: [200, 220, 230] }, getPolygon: (d: WaterPolygon) => d.polygon, getElevation: () => water.altitude, getFillColor: (d: WaterPolygon) => [...classColour[String(d.properties.classe ?? d.properties.status ?? '1-2')] ?? classColour['1-2'], 190], opacity: 0.8, updateTriggers: { getElevation: water.altitude, getFillColor: water.label } }),
    ] });
  };

  async function activate() {
    elements.status.hidden = false; elements.status.textContent = 'Chargement des tuiles 3D Google…';
    const status = await fetch('/api/google/status').then(r => r.json()).catch(() => ({ tiles3d: false }));
    if (!status.tiles3d) { elements.status.textContent = 'Clé Google manquante : définissez GOOGLE_MAPS_API_KEY sur le serveur pour activer la vue 3D photoréaliste.'; return; }
    const [{ Deck, MapView, FlyToInterpolator }, { Tile3DLayer }, { SolidPolygonLayer }] = await Promise.all([import('@deck.gl/core'), import('@deck.gl/geo-layers'), import('@deck.gl/layers')]);
    classes = { Tile3DLayer, SolidPolygonLayer, FlyToInterpolator };
    deck ??= new Deck({ parent: elements.container as HTMLDivElement, views: new MapView({ repeat: false, farZMultiplier: 3 }), controller: { touchRotate: true, inertia: true }, viewState, onViewStateChange: ({ viewState: next }: { viewState: unknown }) => { viewState = next as ViewState; render(); }, layers: [], onError: (error: Error) => { elements.status.hidden = false; elements.status.textContent = `Tuiles 3D indisponibles : ${error.message}`; } });
    render();
  }

  return {
    get active() { return active; },
    async toggle(on = !active) {
      active = on;
      elements.toggle.setAttribute('aria-pressed', String(on));
      elements.toggle.textContent = on ? 'Carte' : '3D photoréaliste';
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
      render();
    },
    isFloodClass: (value: unknown): value is FloodClass => value === '0-1' || value === '1-2' || value === '2+',
  };
}
export type View3D = ReturnType<typeof createView3D>;
