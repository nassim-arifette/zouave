export type FloodClass = '0-1' | '1-2' | '2+';
export type Evidence = 'Mesuré' | 'Officiel' | 'Estimé';
/** Evidence values stay stable identifiers (tool results, tests); this is what the interface shows. */
export const evidenceLabel = (evidence: Evidence) => ({ Mesuré: 'Measured', Officiel: 'Official', Estimé: 'Estimated' })[evidence] ?? evidence;
export const REFERENCE_LEVEL = 8.62;
export const BANKS_ONLY_BELOW = 6.62;
export const levelSources = {
  history: 'https://www.draveil.fr/fileadmin/draveil/MEDIA/Habitat_et_environnement/Urbanisme/crues_PPRI_urbanisme.pdf',
  reference: 'https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/bilan_1910_cle7c8919.pdf',
  extreme: 'https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/strategie_inondation_idf_v231121.pdf',
  recent: 'https://www.drieat.ile-de-france.developpement-durable.gouv.fr/IMG/pdf/rex4m_spc_smyl_mai_juin_2016_vf.pdf',
  february: 'https://france3-regions.franceinfo.fr/paris-ile-de-france/paris/crue-de-la-seine-pres-d-une-vingtaine-de-voies-fermees-a-la-circulation-a-paris-ce-jeudi-jusqu-a-nouvel-ordre-3301782.html',
  banks: 'https://www.paris.fr/pages/crues-5472',
  navigation: 'https://www.paris.fr/pages/crues-5472',
  rail: 'https://monrercetlignev.transilien.com/2021/02/04/crue-de-la-seine-retrouvez-les-dernieres-infos-rer-c/',
};
export interface FloodPreset { id: string; label: string; level: number | null; evidence: Evidence; source?: string; note?: string; }
const historic = (id: string, level: number): FloodPreset => ({ id, label: id, level, evidence: 'Mesuré', source: levelSources.history, note: 'DRIEE data republished by the town of Draveil; older floods are referred to the later Austerlitz gauge.' });
export const floodPresets: FloodPreset[] = [
  historic('1658', 8.96), historic('1740', 8.05),
  { id: '1910', label: '1910', level: 8.62, evidence: 'Mesuré', source: levelSources.reference },
  historic('1955', 7.12),
  { id: '2016', label: '2016', level: 6.10, evidence: 'Mesuré', source: levelSources.recent },
  { id: '2026', label: 'February 2026', level: 3.54, evidence: 'Mesuré', source: levelSources.february, note: 'Reading of 17 February reported by France 3; primary archive not found. Not an annual maximum.' },
  { id: 'today', label: 'Live', level: null, evidence: 'Mesuré' },
  { id: '115', label: '115% scenario', level: 9.10, evidence: 'Officiel', source: levelSources.extreme, note: 'A flow scenario with no future date. This river level is not a local depth.' },
];
export const consequences = [
  { level: 3.20, label: 'First riverside roads close', source: levelSources.banks },
  { level: 4.30, label: 'River traffic banned in Paris', source: levelSources.navigation, note: 'Restrictions also depend on the vessel and VNF notices; this mark is not a permission to navigate.' },
  { level: 4.75, label: 'RER C: precautionary shutdown in Paris', source: levelSources.rail },
  { level: 5.75, label: 'RER C: risk of water entering through the station gates', source: levelSources.rail },
];
export const formatDepth = (n: number) => Number(n.toFixed(1)).toLocaleString('en-GB', { maximumFractionDigits: 1 });
const round = (n: number) => Math.round(n * 100) / 100;
export interface DepthBand { min: number; max: number | null; status: 'dry' | 'possible' | 'flooded'; label: string; evidence: Evidence; }
export function depthAtLevel(classe: FloodClass, level: number): DepthBand {
  if (!['0-1', '1-2', '2+'].includes(classe) || !Number.isFinite(level) || level < 0 || level > 12) throw new Error('Invalid class or level.');
  const delta = round(level - REFERENCE_LEVEL);
  const lower = classe === '0-1' ? 0 : classe === '1-2' ? 1 : 2;
  const min = round(lower + delta);
  const max = classe === '2+' ? null : round(lower + 1 + delta);
  const status = level < BANKS_ONLY_BELOW || (max !== null && max <= 0) ? 'dry' : min > 0 || level === REFERENCE_LEVEL ? 'flooded' : 'possible';
  const label = status === 'dry' ? 'Dry (estimate)' : max === null ? min > 0 ? `over ${formatDepth(min)} m` : 'Dry or flooded — upper bound unknown' : status === 'possible' ? `dry or up to ${formatDepth(max)} m` : `${formatDepth(min)} to ${formatDepth(max)} m`;
  return { min: Math.max(0, min), max: max === null ? null : Math.max(0, max), status, label, evidence: level === REFERENCE_LEVEL ? 'Officiel' : 'Estimé' };
}
export function outsidePpri(level: number, insideSdrif: boolean): DepthBand {
  if (!Number.isFinite(level) || level < 0 || level > 12) throw new Error('Invalid level.');
  const wet = level > REFERENCE_LEVEL && insideSdrif;
  return { min: 0, max: wet ? 0.5 : 0, status: wet ? 'possible' : 'dry', label: wet ? 'under 50 cm (estimate)' : 'Outside the mapped footprint', evidence: 'Estimé' };
}
export function photoHeight(band: DepthBand, level: number) {
  if (band.status === 'dry') return 0;
  if (band.max === null) return 2.5;
  if (band.status === 'possible') return 0.5;
  const midpoint = (band.min + band.max) / 2;
  // At the extreme preset, use the upper available illustration rather than understate the band.
  if (level > 8.96) return Math.min(2.5, Math.ceil(band.max - 0.5) + 0.5);
  return [0.5, 1.5, 2.5].sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint))[0];
}
/** Ellipsoidal altitude (m, WGS84) of a flat water surface at `level` metres on the Austerlitz gauge — what Photorealistic 3D Tiles use as height. */
export function seineAltitude(level: number, seine = { austerlitzZeroNgf: 26.0, geoidUndulationM: 44.5 }) {
  return seine.austerlitzZeroNgf + level + seine.geoidUndulationM;
}
/** Continuous water height (m) for the 3D street scene: the middle of the estimated band, capped at 2.5 m. */
export function sceneHeight(band: DepthBand) {
  if (band.status === 'dry') return 0;
  if (band.max === null) return 2.5;
  if (band.status === 'possible') return Math.min(2.5, Math.max(0.3, band.max / 2));
  return Math.min(2.5, Math.max(0.1, (band.min + band.max) / 2));
}
export function timelineBands(level: number) { return Object.fromEntries((['0-1', '1-2', '2+'] as const).map(classe => [classe, depthAtLevel(classe, level)])) as Record<FloodClass, DepthBand>; }
