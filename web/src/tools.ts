import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { config } from './config.ts';
import { createHero } from './hero.ts';
import { mapReady, showScenario, goTo, showCaves, datasets, type Scenario } from './map.ts';
export const state = { scenario: 'aujourdhui' as Scenario, address: { label: config.demoAddress, ...config.demoPosition }, exposureShown: false };
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export function escape(value: unknown) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
export function source(label: string, url: string) { return `<a href="${escape(url)}" target="_blank" rel="noreferrer">${escape(label)} ↗</a>`; }
export async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}
export function showCard(id: string, body: string, sources: string) {
  const card = $(id);
  card.innerHTML = `<div class="card-body"><button class="card-close" aria-label="Fermer cette fiche">×</button>${body}</div><footer class="source-footer">${sources}</footer>`;
  card.hidden = false;
  card.querySelector('button')!.addEventListener('click', () => { card.hidden = true; });
}
const scenarioSchema = new Set(['aujourdhui', '1910', 'pire']);
async function syncScenario(scenario: Scenario) {
  await showScenario(scenario);
  state.scenario = scenario;
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => { const selected = button.dataset.scenario === scenario; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
  $('legend-depths').hidden = scenario !== '1910';
  $('legend-note').hidden = scenario === '1910';
  $('legend-title').textContent = scenario === '1910' ? 'COMPRENDRE LA CRUE DE 1910' : scenario === 'pire' ? 'AU-DELÀ DU SCÉNARIO DE RÉFÉRENCE' : 'LA VILLE, AUJOURD’HUI';
  $('legend-note').textContent = scenario === 'pire' ? 'Emprise seulement — hauteurs non publiées.' : 'Explorez les scénarios, sans prévision de crue.';
  $('cave-key').hidden = true;
}
export async function afficher_scenario({ scenario }: { scenario: Scenario }) {
  if (!scenarioSchema.has(scenario)) throw new Error('Scénario inconnu.');
  await syncScenario(scenario);
  const result = scenario === '1910' ? { scenario, description: 'Crue de référence de type 1910 : 8,62 m à l’échelle d’Austerlitz. Les classes locales du PPRI ne sont pas le niveau du fleuve. Simulation, pas une prévision.', source: 'PPRI de Paris / DRIEAT', source_url: config.sources.ppri, reference_m: 8.62, reference_source_url: config.sources.reference, hauteurs_disponibles: true } : scenario === 'pire' ? { scenario, description: 'Scénario extrême : emprise seulement — hauteurs non publiées. La stratégie francilienne décrit le scénario à 115 % des débits de 1910, soit 9,1 m à Austerlitz ; ce n’est pas une hauteur à votre adresse.', source: 'Institut Paris Région · SDRIF-E / DRIEAT', source_url: config.sources.sdrif, reference_m: 9.1, reference_source_url: config.sources.extremeReference, hauteurs_disponibles: false } : { scenario, description: 'Situation actuelle : aucune couche d’inondation simulée. Le niveau observé à Austerlitz n’est pas une hauteur d’eau à votre adresse.', source: "Hub'Eau / Vigicrues", source_url: 'https://hubeau.eaufrance.fr/', hauteurs_disponibles: false, observation: await niveau_seine() };
  if (scenario === 'aujourdhui') $('scenario-card').hidden = true;
  else showCard('scenario-card', `<div class="card-eyebrow"><i></i>${scenario === '1910' ? 'SCÉNARIO DE RÉFÉRENCE' : 'SCÉNARIO EXTRÊME'}</div><h2>${scenario === '1910' ? 'La Seine se souvient.' : 'Et si l’eau allait plus loin ?'}</h2><div class="scenario-depth">${scenario === '1910' ? '8,62 m' : '9,1 m'} <small>à Austerlitz</small></div><p class="scenario-description">${scenario === '1910' ? 'L’emprise et les hauteurs du PPRI, pour une crue de type 1910.' : 'Emprise seulement — hauteurs non publiées à l’adresse.'}</p><p class="disclaimer">${scenario === '1910' ? 'L’eau monte sur la carte. Ce scénario n’est pas une prévision.' : 'Scénario à 115 % des débits de 1910. Ne pas lire une profondeur dans cette surface.'}</p>`, source(result.source, result.source_url) + source('Repère à Austerlitz · DRIEAT', scenario === '1910' ? config.sources.reference : config.sources.extremeReference));
  if (state.exposureShown) await exposition({ ...state.address, scenario });
  return result;
}
export async function aller_a({ adresse }: { adresse: string }) {
  if (typeof adresse !== 'string' || adresse.length < 3) throw new Error('Indiquez une adresse complète.');
  const data = await api(`/api/geocode?${new URLSearchParams({ q: adresse })}`);
  const feature = data.features?.[0];
  if (!feature || feature.geometry?.type !== 'Point') throw new Error('Adresse introuvable.');
  const [lon, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('Coordonnées invalides.');
  state.address = { label: feature.properties.label, lat, lon };
  await goTo(lon, lat, state.address.label);
  return { ...state.address, source: 'Géoplateforme IGN', source_url: data.source_url, offline: data.offline };
}
export async function exposition({ lat, lon, scenario }: { lat: number; lon: number; scenario: Scenario }) {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !scenarioSchema.has(scenario)) throw new Error('Coordonnées ou scénario invalides.');
  await mapReady;
  if (state.scenario !== scenario) await syncScenario(scenario);
  const contains = (name: string) => datasets[name].features.filter(feature => booleanPointInPolygon([lon, lat], feature));
  const hazards = contains('ppri_aleas').sort((a, b) => Number(b.properties?.h_min) - Number(a.properties?.h_min));
  const classe = (hazards[0]?.properties?.classe ?? null) as '0-1' | '1-2' | '2+' | null;
  const cave = contains('caves_1910').length > 0;
  const extreme = contains('sdrife_zone_inondable').length > 0;
  const height = classe === '2+' ? 'plus de 2 m' : classe === '1-2' ? '1 à 2 m' : classe === '0-1' ? '0 à 1 m' : 'hors emprise PPRI cartographiée';
  const result = { lat, lon, scenario, en_zone: scenario === '1910' ? Boolean(classe) : scenario === 'pire' ? extreme : null, classe, hauteur_texte: height, hauteur_visuelle_m: classe === '2+' ? 3 : classe === '1-2' ? 2 : classe === '0-1' ? 1 : null, cave_inondee_1910: cave, sdrife_en_zone: extreme, sources: [{ label: 'PPRI de Paris · Préfecture / DRIEAT', url: config.sources.ppri }, { label: 'Caves · Ville de Paris · ODbL', url: config.sources.caves }, { label: 'SDRIF-E · Institut Paris Région', url: config.sources.sdrif }], precision: 'Lecture de couches simplifiées, pas un diagnostic du bâtiment. PPRI : précision en plan estimée à ±25 m, altitude ±30 cm.' };
  state.exposureShown = true;
  $('scenario-card').hidden = true;
  showCaves(scenario === '1910');
  $('cave-key').hidden = scenario !== '1910';
  const shownHeight = scenario === '1910' ? height : scenario === 'pire' ? 'Emprise seulement' : 'Aucune simulation';
  showCard('exposure-card', `<div class="card-eyebrow"><i></i>CHEZ VOUS · ${scenario === '1910' ? 'SCÉNARIO 1910' : scenario === 'pire' ? 'SCÉNARIO EXTRÊME' : 'AUJOURD’HUI'}</div><h2>Votre adresse,<br>face à la crue.</h2><p class="address">${escape(state.address.label)}</p><div class="exposure-depth">${escape(shownHeight)}</div>${scenario === '1910' && classe ? `<div class="exposure-tag">Hauteur de submersion · classe ${escape(classe)}</div>` : ''}<div class="exposure-row"><span>Emprise ${scenario === 'pire' ? 'SDRIF-E' : 'PPRI 1910'}</span><strong>${(scenario === 'pire' ? extreme : classe) ? 'Dans la zone' : 'Hors zone cartographiée'}</strong></div><div class="exposure-row"><span>Caves · scénario 1910</span><strong>${cave ? 'Secteur exposé' : 'Hors secteur cartographié'}</strong></div><p class="disclaimer">${scenario === 'pire' ? 'Hauteurs locales non publiées. ' : ''}La carte ne mesure pas votre logement. L’absence de zone n’exclut pas un risque ni des coupures de réseaux.</p>${scenario === '1910' && classe ? '<button class="photo-button" id="show-photo">Voir ma rue en simulation ↗</button>' : ''}`, result.sources.map(s => source(s.label, s.url)).join(''));
  $('show-photo')?.addEventListener('click', () => { void photo_inondee({ hauteur: result.hauteur_visuelle_m! }).then(photo => { if (!photo.affichee) notify(photo.error!); }).catch(error => notify(error.message)); });
  return result;
}
export async function niveau_seine() {
  const result = await api('/api/niveau');
  $('level-value').textContent = `${Number(result.hauteur_m).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
  const date = new Date(result.date_obs);
  $('level-date').textContent = `relevé ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}`;
  const old = Date.now() - date.getTime() > 24 * 3600_000;
  $('level-status').textContent = result.stale ? 'HORS LIGNE · DERNIER RELEVÉ CONNU' : old ? 'OBSERVATION ANCIENNE · AUSTERLITZ' : 'OBSERVATION · AUSTERLITZ';
  $('level-source').setAttribute('href', result.source_url);
  return result;
}
export async function photo_inondee({ hauteur }: { hauteur: number }) {
  if (!Number.isFinite(hauteur) || hauteur < 0 || hauteur > 10) throw new Error('Hauteur de simulation invalide.');
  try {
    const result = await api(`/api/photo?${new URLSearchParams({ lat: String(state.address.lat), lon: String(state.address.lon), h: String(hauteur) })}`);
    const credit = `${escape(result.credit)}${result.credit.includes(result.license) ? '' : ` · ${escape(result.license)}`}${result.source_url ? ` · ${source('Photo originale · Panoramax', result.source_url)}` : ''}`;
    if (result.url_depth && await showHero({ ...result, hauteur_m: hauteur }, credit)) return { affichee: true, ...result, hauteur_m: hauteur, rendu: 'relief-3d' };
    const image = $<HTMLImageElement>('photo-image'); image.src = result.url;
    $('photo-label').textContent = `${result.address_label} · ${result.hauteur_m} m simulés`;
    $('photo-credit').innerHTML = credit;
    image.onerror = () => { $<HTMLDialogElement>('photo-dialog').close(); notify('Image indisponible. La simulation ne peut pas être affichée.'); };
    $<HTMLDialogElement>('photo-dialog').showModal();
    return { affichee: true, ...result };
  } catch (error) { return { affichee: false, error: error instanceof Error ? error.message : 'Photo indisponible.', source: 'Catalogue local de simulations (absent ou indisponible)' }; }
}
export async function consignes(args: { rez_de_chaussee: boolean; cave: boolean; enfants: boolean }) {
  if (!['rez_de_chaussee', 'cave', 'enfants'].every(key => typeof args[key as keyof typeof args] === 'boolean')) throw new Error('Précisez le profil du foyer.');
  const res = await fetch('/data/consignes.json');
  if (!res.ok) throw new Error('Les consignes officielles sont indisponibles.');
  const data = await res.json() as { sources: { label: string; url: string }[]; instructions: { id: string; condition: keyof typeof args | 'always'; title: string; text: string; source: number }[] };
  const selected = data.instructions.filter(item => item.condition !== 'always' && args[item.condition]).concat(data.instructions.filter(item => item.condition === 'always')).slice(0, 3).map(item => ({ title: item.title, text: item.text, source: data.sources[item.source].label, url: data.sources[item.source].url }));
  showCard('safety-card', `<div class="card-eyebrow"><i></i>LES BONS RÉFLEXES</div><h2>Se préparer,<br>sans paniquer.</h2><p>Des gestes adaptés à votre foyer.</p><ol class="checklist">${selected.map(item => `<li><strong>${escape(item.title)}</strong><p>${escape(item.text)}</p></li>`).join('')}</ol>`, [...new Map(selected.map(item => [item.url, item])).values()].map(item => source(item.source, item.url)).join(''));
  return { consignes: selected, profil: args, source: 'Consignes officielles de prévention' };
}
let hero: ReturnType<typeof createHero> | undefined;
async function showHero(result: { url_clean: string; url_depth: string; address_label: string; hauteur_m: number; view: { fov: number; pitch: number; camera_height_m: number } }, credit: string) {
  const dialog = $<HTMLDialogElement>('hero-dialog');
  const slider = $<HTMLInputElement>('hero-slider');
  const format = (level: number) => `${level.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
  try {
    hero ??= createHero($('hero-view'));
    const shown = await hero.show({ photoUrl: result.url_clean, depthUrl: result.url_depth, fov: result.view.fov, pitch: result.view.pitch, cameraHeight: result.view.camera_height_m, target: result.hauteur_m, onLevel: level => { slider.value = String(level); $('hero-level').textContent = format(level); } });
    if (!shown) return true; // superseded by a newer opening, which owns the dialog
  } catch (error) { console.warn('3D street scene unavailable, falling back to the photo:', error); hero?.stop(); return false; }
  $('hero-label').textContent = `${result.address_label} · jusqu’à ${format(result.hauteur_m)} simulés`;
  $('hero-credit').innerHTML = credit;
  slider.oninput = () => hero?.setLevel(Number(slider.value));
  $('hero-replay').onclick = () => { hero?.setLevel(0); hero?.animateTo(result.hauteur_m); };
  dialog.onclose = () => hero?.stop();
  if (!dialog.open) dialog.showModal();
  return true;
}
let toastTimer: ReturnType<typeof setTimeout>;
export function notify(message: string) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500); }
export const browserTools = { afficher_scenario, aller_a, exposition, niveau_seine, photo_inondee, consignes };
export async function executeTool(name: string, args: unknown): Promise<unknown> {
  const tool = browserTools[name as keyof typeof browserTools];
  if (!tool) throw new Error(`Outil inconnu : ${name}`);
  return (tool as (args: unknown) => Promise<unknown>)(args);
}
