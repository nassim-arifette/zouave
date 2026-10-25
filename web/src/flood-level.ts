export type FloodClass = '0-1' | '1-2' | '2+';
export type Evidence = 'Mesuré' | 'Officiel' | 'Estimé';
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
const historic = (id: string, level: number): FloodPreset => ({ id, label: id, level, evidence: 'Mesuré', source: levelSources.history, note: 'DRIEE reproduite par la Ville de Draveil ; référence rapportée à Austerlitz pour les crues anciennes.' });
export const floodPresets: FloodPreset[] = [
  historic('1658', 8.96), historic('1740', 8.05),
  { id: '1910', label: '1910', level: 8.62, evidence: 'Mesuré', source: levelSources.reference },
  historic('1955', 7.12),
  { id: '2016', label: '2016', level: 6.10, evidence: 'Mesuré', source: levelSources.recent },
  { id: '2026', label: 'Février 2026', level: 3.54, evidence: 'Mesuré', source: levelSources.february, note: 'Relevé du 17 février relayé par France 3 ; archive primaire non retrouvée. Pas un maximum annuel.' },
  { id: 'today', label: 'Direct', level: null, evidence: 'Mesuré' },
  { id: '115', label: 'Scénario 115 %', level: 9.10, evidence: 'Officiel', source: levelSources.extreme, note: 'Scénario de débit, sans date future. Ce niveau au fleuve n’est pas une hauteur locale.' },
];
export const consequences = [
  { level: 3.20, label: 'Premières fermetures des voies sur berge', source: levelSources.banks },
  { level: 4.30, label: 'Navigation interdite dans Paris', source: levelSources.navigation, note: 'Les restrictions dépendent aussi du bateau et des avis VNF ; ce repère ne vaut pas autorisation de naviguer.' },
  { level: 4.75, label: 'RER C : interruption préventive dans Paris', source: levelSources.rail },
  { level: 5.75, label: 'RER C : risque d’entrée d’eau par les vantaux', source: levelSources.rail },
];
export const formatDepth = (n: number) => Number(n.toFixed(1)).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const round = (n: number) => Math.round(n * 100) / 100;
export interface DepthBand { min: number; max: number | null; status: 'dry' | 'possible' | 'flooded'; label: string; evidence: Evidence; }
export function depthAtLevel(classe: FloodClass, level: number): DepthBand {
  if (!['0-1', '1-2', '2+'].includes(classe) || !Number.isFinite(level) || level < 0 || level > 12) throw new Error('Classe ou niveau invalide.');
  const delta = round(level - REFERENCE_LEVEL);
  const lower = classe === '0-1' ? 0 : classe === '1-2' ? 1 : 2;
  const min = round(lower + delta);
  const max = classe === '2+' ? null : round(lower + 1 + delta);
  const status = level < BANKS_ONLY_BELOW || (max !== null && max <= 0) ? 'dry' : min > 0 || level === REFERENCE_LEVEL ? 'flooded' : 'possible';
  const label = status === 'dry' ? 'Au sec (estimation)' : max === null ? min > 0 ? `plus de ${formatDepth(min)} m` : 'Au sec ou inondé — borne haute inconnue' : status === 'possible' ? `au sec ou jusqu’à ${formatDepth(max)} m` : `${formatDepth(min)} à ${formatDepth(max)} m`;
  return { min: Math.max(0, min), max: max === null ? null : Math.max(0, max), status, label, evidence: level === REFERENCE_LEVEL ? 'Officiel' : 'Estimé' };
}
export function outsidePpri(level: number, insideSdrif: boolean): DepthBand {
  if (!Number.isFinite(level) || level < 0 || level > 12) throw new Error('Niveau invalide.');
  const wet = level > REFERENCE_LEVEL && insideSdrif;
  return { min: 0, max: wet ? 0.5 : 0, status: wet ? 'possible' : 'dry', label: wet ? 'moins de 50 cm (estimation)' : 'Hors emprise cartographiée', evidence: 'Estimé' };
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
export function timelineBands(level: number) { return Object.fromEntries((['0-1', '1-2', '2+'] as const).map(classe => [classe, depthAtLevel(classe, level)])) as Record<FloodClass, DepthBand>; }
