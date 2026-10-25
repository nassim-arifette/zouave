// Flood footprints for the Google 3D view: one deck.gl polygon per component with every ring kept (outer + holes),
// and the set of footprints that applies to a Seine level, mirroring the MapLibre timeline layers (PPRI depth classes,
// low banks between 3.2 m and the first PPRI class, SDRIF extra footprint above the 1910 reference).
import type { Feature, Polygon, MultiPolygon, Position } from 'geojson';
import { BANKS_ONLY_BELOW, REFERENCE_LEVEL, type FloodClass } from './flood-level.ts';

export type WaterFeature = Feature<Polygon | MultiPolygon, Record<string, unknown>>;
export interface WaterPolygon { polygon: Position[][]; properties: Record<string, unknown> }
export type FootprintStatus = 'flooded' | 'possible';

const classColour: Record<string, [number, number, number]> = { '0-1': [112, 196, 214], '1-2': [58, 141, 190], '2+': [34, 87, 158], possible: [120, 170, 200], banks: [124, 210, 223] };

/** Rendering style of a footprint in the Google view: the status wins over the depth class, so an uncertain PPRI class
 * (e.g. classe 1-2 at 7.12 m) is drawn as a translucent outlined « peut-être » surface, like the MapLibre hatching. */
export function footprintStyle(properties: Record<string, unknown>): { status: FootprintStatus; colour: [number, number, number, number] } {
  if (properties.status === 'possible') return { status: 'possible', colour: [...classColour.possible, 95] };
  return { status: 'flooded', colour: [...(classColour[String(properties.classe ?? '1-2')] ?? classColour['1-2']), 190] };
}

export function flattenFootprints(features: WaterFeature[]): WaterPolygon[] {
  const out: WaterPolygon[] = [];
  for (const feature of features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const rings of polygons) if (rings.length > 0 && rings[0].length >= 4) out.push({ polygon: rings, properties: feature.properties ?? {} });
  }
  return out;
}

const withClass = (features: WaterFeature[], classe: string) => features.map(feature => ({ ...feature, properties: { ...feature.properties, classe, status: classe === 'possible' ? 'possible' : 'flooded' } }));

/** Footprints shown at `level` (Austerlitz gauge, m): PPRI classes that are not dry, plus the banks / SDRIF footprints. */
export function timelineFootprints(level: number, bands: Partial<Record<FloodClass, { status: string }>>, datasets: { aleas: WaterFeature[]; banks: WaterFeature[]; extra: WaterFeature[] }) {
  const aleas = datasets.aleas.filter(feature => bands[feature.properties?.classe as FloodClass]?.status !== 'dry').map(feature => ({ ...feature, properties: { ...feature.properties, status: bands[feature.properties?.classe as FloodClass]?.status } }));
  const banks = level >= 3.2 && level < BANKS_ONLY_BELOW ? withClass(datasets.banks, 'banks') : [];
  const extra = level > REFERENCE_LEVEL ? withClass(datasets.extra, 'possible') : [];
  return [...aleas, ...banks, ...extra];
}

/** Classic scenarios: 1910 = PPRI classes; « pire que 1910 » = the exact SDRIF footprint (the same features as the MapLibre
 * 'extreme' layer and the exposure card, not SDRIF ∪ PPRI) drawn as a distinct 'possible' surface without a local depth. */
export function scenarioFootprints(scenario: string, datasets: { aleas: WaterFeature[]; sdrif: WaterFeature[] }) {
  if (scenario === '1910') return { features: datasets.aleas, level: REFERENCE_LEVEL };
  if (scenario === 'pire') return { features: withClass(datasets.sdrif, 'possible'), level: REFERENCE_LEVEL };
  return { features: [] as WaterFeature[], level: null };
}
