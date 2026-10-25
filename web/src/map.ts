import * as maplibregl from 'maplibre-gl';
import type { Map, ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { config } from './config.ts';
import { createWaterLayer } from './water.ts';
import { createView3D, type View3D } from './view3d.ts';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import difference from '@turf/difference';
import { BANKS_ONLY_BELOW, REFERENCE_LEVEL, timelineBands, type FloodClass } from './flood-level.ts';
export type Polygons = FeatureCollection<Polygon | MultiPolygon>;
export type Scenario = 'aujourdhui' | '1910' | 'pire';
export const datasets: Record<string, Polygons> = {};
const protocol = new Protocol();
maplibregl.setWorkerUrl(workerUrl);
maplibregl.addProtocol('pmtiles', protocol.tile);
const flavor = { ...namedFlavor('dark'), water: '#243f4e', earth: '#26353d', background: '#1d2d37', buildings: '#425354', park_a: '#263f3b', park_b: '#293f3b' };
const baseLayers = (layers('basemap', flavor, { lang: 'fr' }) as LayerSpecification[]).filter(layer => layer.type !== 'symbol' || /water|places|roads/.test(layer.id));
for (const layer of baseLayers) {
  if (layer.type === 'symbol' && layer.paint) { layer.paint['text-color'] = '#91a6a8'; layer.paint['text-halo-color'] = '#20343c'; layer.paint['text-opacity'] = 0.65; }
}
export const map: Map = new maplibregl.Map({ container: 'map', center: config.initialCenter, zoom: 14.25, pitch: 58, bearing: -24, maxZoom: 19, minZoom: 10, maxBounds: [[2.18, 48.77], [2.52, 48.95]], canvasContextAttributes: { antialias: true }, attributionControl: { compact: true }, style: { version: 8, glyphs: `${location.origin}/fonts/{fontstack}/{range}.pbf`, sprite: `${location.origin}/sprites/dark`, sources: { basemap: { type: 'vector', url: `pmtiles://${location.origin}/data/paris.pmtiles`, attribution: '© OpenStreetMap / Protomaps' } }, layers: baseLayers } });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
let resolveReady: () => void, rejectReady: (error: Error) => void;
let waterLayer: ReturnType<typeof createWaterLayer> | undefined;
/** Optional Google Photorealistic 3D view; mirrors the scenario / timeline water and the camera. */
export let view3d: View3D | undefined;
export function attachView3D(view: View3D) {
  view3d = view;
  map.on('moveend', () => { const c = map.getCenter(); view.setCamera({ longitude: c.lng, latitude: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }); });
}
export const mapReady = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
void mapReady.catch(() => {});
map.once('load', async () => {
  try {
    await Promise.all(['ppri_aleas', 'ppri_zonage', 'caves_1910', 'sdrife_zone_inondable'].map(async name => {
      const res = await fetch(`/data/${name}.geojson`);
      if (!res.ok) throw new Error(`Impossible de charger ${name}`);
      datasets[name] = await res.json();
    }));
    datasets.ppri_aleas.features.forEach(feature => { feature.properties = { ...feature.properties, h_vis: feature.properties?.classe === '2+' ? 3 : feature.properties?.classe === '1-2' ? 2 : 1 }; });
    const before = baseLayers.find(layer => layer.type === 'symbol')?.id;
    map.addSource('buildings', { type: 'geojson', data: '/data/batiments.geojson' });
    map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'buildings', minzoom: 13, paint: { 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-color': '#a8b4ab', 'fill-extrusion-opacity': 0.7 } }, before);
    map.addSource('flood', { type: 'geojson', data: datasets.ppri_aleas });
    map.addLayer({ id: 'flood-3d', type: 'fill-extrusion', source: 'flood', layout: { visibility: 'none' }, paint: { 'fill-extrusion-height': 0, 'fill-extrusion-color': ['match', ['get', 'classe'], '0-1', '#86d6e5', '1-2', '#3aabc9', '#2573c4'], 'fill-extrusion-opacity': 0.65, 'fill-extrusion-vertical-gradient': true } }, before);
    if (config.waterRenderer === 'three') {
      try { waterLayer = createWaterLayer(datasets.ppri_aleas); map.addLayer(waterLayer, before); }
      catch (error) { waterLayer = undefined; console.warn('Using fill-extrusion water fallback:', error); }
    }
    map.addSource('extreme', { type: 'geojson', data: datasets.sdrife_zone_inondable });
    map.addLayer({ id: 'extreme-fill', type: 'fill', source: 'extreme', layout: { visibility: 'none' }, paint: { 'fill-color': '#619ab9', 'fill-opacity': 0.38 } }, before);
    map.addLayer({ id: 'extreme-outline', type: 'line', source: 'extreme', layout: { visibility: 'none' }, paint: { 'line-color': '#a0d7e6', 'line-width': 1.5, 'line-opacity': 0.7 } }, before);
    map.addSource('caves', { type: 'geojson', data: datasets.caves_1910 });
    map.addLayer({ id: 'caves-outline', type: 'line', source: 'caves', layout: { visibility: 'none' }, paint: { 'line-color': '#d7c598', 'line-width': 1.4, 'line-dasharray': [1, 2], 'line-opacity': 0.8 } }, before);
    map.addSource('timeline-depths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const hatch = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = (y * 8 + x) * 4; hatch.set([150, 217, 228, (x + y) % 8 < 3 ? 210 : 25], i); }
    map.addImage('timeline-hatching', { width: 8, height: 8, data: hatch });
    map.addLayer({ id: 'timeline-solid', type: 'fill', source: 'timeline-depths', layout: { visibility: 'none' }, filter: ['==', ['get', 'status'], 'flooded'], paint: { 'fill-color': ['match', ['get', 'classe'], '0-1', '#86d6e5', '1-2', '#3aabc9', '#2573c4'], 'fill-opacity': 0.6 } }, before);
    map.addLayer({ id: 'timeline-possible', type: 'fill', source: 'timeline-depths', layout: { visibility: 'none' }, filter: ['==', ['get', 'status'], 'possible'], paint: { 'fill-pattern': 'timeline-hatching', 'fill-opacity': 0.9 } }, before);
    map.addSource('timeline-banks', { type: 'geojson', data: { type: 'FeatureCollection', features: datasets.ppri_zonage.features.filter(f => f.properties?.nom === 'Zone rouge') } });
    map.addLayer({ id: 'timeline-banks', type: 'fill', source: 'timeline-banks', layout: { visibility: 'none' }, paint: { 'fill-color': '#7cd2df', 'fill-opacity': 0.65 } }, before);
    const extra = difference({ type: 'FeatureCollection', features: [...datasets.sdrife_zone_inondable.features, ...datasets.ppri_aleas.features] });
    map.addSource('timeline-extra', { type: 'geojson', data: { type: 'FeatureCollection', features: extra ? [extra] : [] } });
    map.addLayer({ id: 'timeline-extra', type: 'fill', source: 'timeline-extra', layout: { visibility: 'none' }, paint: { 'fill-pattern': 'timeline-hatching', 'fill-opacity': 0.75 } }, before);
    resolveReady();
  } catch (error) { rejectReady(error instanceof Error ? error : new Error('Carte indisponible')); }
});
let animation = 0;
let waterProgress = 0;
export async function showScenario(scenario: Scenario) {
  await mapReady;
  for (const id of ['timeline-solid', 'timeline-possible', 'timeline-banks', 'timeline-extra']) map.setLayoutProperty(id, 'visibility', 'none');
  cancelAnimationFrame(animation);
  if (waterLayer) waterLayer.enabled = scenario === '1910';
  view3d?.setWater(datasets.ppri_aleas.features as Parameters<View3D['setWater']>[0], scenario === '1910' ? REFERENCE_LEVEL : null, scenario);
  map.setLayoutProperty('flood-3d', 'visibility', scenario === '1910' && !waterLayer ? 'visible' : 'none');
  for (const id of ['extreme-fill', 'extreme-outline']) map.setLayoutProperty(id, 'visibility', scenario === 'pire' ? 'visible' : 'none');
  if (scenario !== '1910') { waterProgress = 0; map.setLayoutProperty('caves-outline', 'visibility', 'none'); return; }
  const start = performance.now();
  const from = waterProgress;
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 4000;
  const tick = (now: number) => {
    const t = duration ? Math.min((now - start) / duration, 1) : 1;
    waterProgress = from + (1 - from) * (1 - Math.pow(1 - t, 3));
    waterLayer?.rise(waterProgress);
    map.setPaintProperty('flood-3d', 'fill-extrusion-height', ['*', ['get', 'h_vis'], waterProgress * config.waterExaggeration] as ExpressionSpecification);
    if (t < 1) animation = requestAnimationFrame(tick);
  };
  animation = requestAnimationFrame(tick);
}
let marker: maplibregl.Marker | undefined;
export async function goTo(lon: number, lat: number, label: string) {
  await mapReady;
  marker?.remove();
  const element = document.createElement('div'); element.className = 'home-marker';
  marker = new maplibregl.Marker({ element }).setLngLat([lon, lat]).setPopup(new maplibregl.Popup({ closeButton: false, offset: 18 }).setText(label)).addTo(map);
  view3d?.setCamera({ longitude: lon, latitude: lat, pitch: 60, zoom: 17.5, bearing: -26 }, true);
  map.flyTo({ center: [lon, lat], pitch: 60, zoom: 17.5, bearing: -26, duration: 2400, padding: { left: 200, right: 300, top: 40, bottom: 70 } });
}
export function showCaves(show: boolean) { map.setLayoutProperty('caves-outline', 'visibility', show ? 'visible' : 'none'); }
export async function showFloodLevel(level: number) {
  await showScenario('aujourdhui');
  const bands = timelineBands(level);
  (map.getSource('timeline-depths') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: datasets.ppri_aleas.features.map(feature => ({ ...feature, properties: { ...feature.properties, ...bands[feature.properties?.classe as FloodClass] } })) });
  for (const id of ['timeline-solid', 'timeline-possible']) map.setLayoutProperty(id, 'visibility', 'visible');
  view3d?.setWater(datasets.ppri_aleas.features.filter(feature => bands[feature.properties?.classe as FloodClass]?.status !== 'dry') as Parameters<View3D['setWater']>[0], level, 'timeline');
  map.setLayoutProperty('timeline-banks', 'visibility', level >= 3.2 && level < BANKS_ONLY_BELOW ? 'visible' : 'none');
  map.setLayoutProperty('timeline-extra', 'visibility', level > REFERENCE_LEVEL ? 'visible' : 'none');
}
