import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { config } from './config.ts';
import { createHero } from './hero.ts';
import { mapReady, showScenario, showFloodLevel, goTo, showCaves, datasets, type Scenario } from './map.ts';
import { floodPresets, depthAtLevel, outsidePpri, photoHeight, sceneHeight, timelineBands, type Evidence, type FloodClass } from './flood-level.ts';
export const state = { scenario: 'aujourdhui' as Scenario, address: { label: config.demoAddress, ...config.demoPosition }, exposureShown: false, timeline: null as null | { id: string; label: string; level: number; evidence: Evidence; source?: string; note?: string; stale?: boolean } };
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
  state.timeline = null;
  window.dispatchEvent(new CustomEvent('zouave:timeline-clear'));
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
  if (state.timeline && scenario === state.scenario) return timelineExposure(lat, lon);
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
  showCard('exposure-card', `<div class="card-eyebrow"><i></i>CHEZ VOUS · ${scenario === '1910' ? 'SCÉNARIO 1910' : scenario === 'pire' ? 'SCÉNARIO EXTRÊME' : 'AUJOURD’HUI'}</div><h2>Votre adresse,<br>face à la crue.</h2><p class="address">${escape(state.address.label)}</p><div class="exposure-depth">${escape(shownHeight)}</div>${scenario === '1910' && classe ? `<div class="exposure-tag">Hauteur de submersion · classe ${escape(classe)}</div>` : ''}<div class="exposure-row"><span>Emprise ${scenario === 'pire' ? 'SDRIF-E' : 'PPRI 1910'}</span><strong>${(scenario === 'pire' ? extreme : classe) ? 'Dans la zone' : 'Hors zone cartographiée'}</strong></div><div class="exposure-row"><span>Caves · scénario 1910</span><strong>${cave ? 'Secteur exposé' : 'Hors secteur cartographié'}</strong></div><p class="disclaimer">${scenario === 'pire' ? 'Hauteurs locales non publiées. ' : ''}La carte ne mesure pas votre logement. L’absence de zone n’exclut pas un risque ni des coupures de réseaux.</p>${scenario === '1910' ? `<button class="photo-button" id="show-photo">${classe ? 'Voir ma rue en simulation ↗' : 'Voir ma rue (au sec, à vous de régler l’eau) ↗'}</button>` : ''}${googleStreetView ? `<button class="photo-button" id="show-streetview">Street View · eau à ${result.hauteur_visuelle_m ?? 1} m ↗</button>` : ''}`, result.sources.map(s => source(s.label, s.url)).join(''));
  $('show-streetview')?.addEventListener('click', () => { void streetView(result.hauteur_visuelle_m ?? 1); });
  $('show-photo')?.addEventListener('click', () => { void photo_inondee({ hauteur: result.hauteur_visuelle_m ?? 0 }).then(photo => { if (!photo.affichee) notify(photo.error!); }).catch(error => notify(error.message)); });
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
/**
 * One counter owns every step of opening the street scene (HTTP, textures, render install, fallback). A new request,
 * closing the dialog or animating the current scene bumps it; anything older is dropped, and a scene load still in
 * flight is invalidated so it can never install itself or open its fallback later.
 */
let heroRequest = 0;
const supersede = () => { heroRequest++; hero?.cancelPending(); liveAbort?.abort(); return heroRequest; };
let liveAbort: AbortController | undefined;
const superseded = () => ({ affichee: false, remplacee: true, error: 'Demande remplacée par une nouvelle sélection.', source: 'Catalogue local de simulations' });
/** `origin` pins the request to an address so a late answer for an older address is never shown as the current one. */
export async function photo_inondee({ hauteur }: { hauteur: number }, origin: { lat: number; lon: number } = state.address) {
  if (!Number.isFinite(hauteur) || hauteur < 0 || hauteur > 10) throw new Error('Hauteur de simulation invalide.');
  const request = supersede();
  const stale = () => request !== heroRequest;
  try {
    const live = await liveStreet(origin.lat, origin.lon, request);
    if (stale()) return superseded();
    const result = live ?? await api(`/api/photo?${new URLSearchParams({ lat: String(origin.lat), lon: String(origin.lon), h: String(hauteur) })}`);
    if (stale()) return superseded();
    const credit = `${escape(result.credit)}${result.credit.includes(result.license) ? '' : ` · ${escape(result.license)}`}${result.source_url ? ` · ${source('Photo originale · Panoramax', result.source_url)}` : ''}`;
    if (result.url_depth) {
      const shown = await showHero({ ...result, hauteur_m: hauteur }, credit, origin, request);
      if (stale()) return superseded();
      if (shown) return { affichee: true, ...result, hauteur_m: hauteur, rendu: 'relief-3d' };
    }
    // Flat photo fallback (no depth or no WebGL). A live answer has no flooded rendering: show its original view.
    const fallback = result.url ? result : { ...result, url: result.url_clean, hauteur_m: 0, address_label: result.address_label ?? state.address.label };
    const flooded = hauteur !== 0 && fallback.url !== fallback.url_clean;
    $('hero-status').hidden = true; $<HTMLDialogElement>('hero-dialog').close();
    const image = $<HTMLImageElement>('photo-image'); image.src = flooded ? fallback.url : fallback.url_clean ?? fallback.url;
    $('photo-label').textContent = flooded ? `${fallback.address_label} · Eau à ${Number(fallback.hauteur_m).toLocaleString('fr-FR')} m` : `${fallback.address_label} · Vue originale`;
    if (flooded) $('photo-label').insertAdjacentHTML('beforeend', ` ${badge('Estimé')}`);
    $('photo-credit').innerHTML = `${escape(result.credit)}${result.credit.includes(result.license) ? '' : ` · ${escape(result.license)}`}${result.source_url ? ` · ${source('Photo originale · Panoramax', result.source_url)}` : ''}`;
    image.onerror = () => { $<HTMLDialogElement>('photo-dialog').close(); notify('Image indisponible. La simulation ne peut pas être affichée.'); };
    $<HTMLDialogElement>('photo-dialog').showModal();
    return { affichee: true, ...result };
  } catch (error) { if (stale()) return superseded(); return { affichee: false, error: error instanceof Error ? error.message : 'Photo indisponible.', source: 'Catalogue local de simulations (absent ou indisponible)' }; }
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
/** Street View browser key, fetched once; `null` hides the Street View button (key-gated feature). */
let googleStreetView: string | null = null;
export async function loadGoogleStatus() { try { const status = await (await fetch('/api/google/status')).json(); googleStreetView = status.streetview ? status.browser_key : null; } catch { googleStreetView = null; } return googleStreetView; }
let streetViewHandle: { close: () => void; overlay: { setLevel: (level: number) => void } } | undefined;
let streetViewRequest = 0;
/** Official Street View panorama at the current address with our water overlay, in an opaque panel (see data/README.md, Google Maps Platform). */
export async function streetView(hauteur: number) {
  if (!googleStreetView) { notify('Street View indisponible : clé Google manquante.'); return { affichee: false }; }
  const dialog = $<HTMLDialogElement>('streetview-dialog'), slider = $<HTMLInputElement>('streetview-slider');
  const format = (level: number) => `${level.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
  const request = ++streetViewRequest;
  streetViewHandle?.close(); streetViewHandle = undefined;
  // installed before any await: closing during the load invalidates the request, and a late result is disposed
  dialog.onclose = () => { streetViewRequest++; streetViewHandle?.close(); streetViewHandle = undefined; };
  $('streetview-label').textContent = `${state.address.label} · Eau à ${format(hauteur)} (hauteur de caméra fixe, sans relief)`;
  $('streetview-credit').textContent = '';
  if (!dialog.open) dialog.showModal();
  try {
    const { openStreetView } = await import('./streetview.ts');
    const opened = await openStreetView({ panorama: $('streetview-panorama'), canvas: $<HTMLCanvasElement>('streetview-water'), status: $('streetview-status') }, { lat: state.address.lat, lng: state.address.lon }, { key: googleStreetView, level: hauteur });
    if (request !== streetViewRequest) { opened.close(); return { affichee: false, remplacee: true }; }
    streetViewHandle = opened;
    $('streetview-credit').textContent = `${opened.copyright} · Street View, Google · panorama à ${opened.distance_m} m`;
    slider.value = String(hauteur); $('streetview-level').textContent = format(hauteur);
    slider.oninput = () => { opened.overlay.setLevel(Number(slider.value)); $('streetview-level').textContent = format(Number(slider.value)); };
    return { affichee: true, source: 'Street View (Google)', hauteur_m: hauteur, distance_m: opened.distance_m };
  } catch (error) {
    if (request !== streetViewRequest) return { affichee: false, remplacee: true };
    $('streetview-status').hidden = false; $('streetview-status').textContent = error instanceof Error && /ZERO_RESULTS|not found/i.test(error.message) ? 'Aucun panorama Street View à proximité.' : 'Street View indisponible.';
    return { affichee: false, error: error instanceof Error ? error.message : String(error) };
  }
}
let hero: ReturnType<typeof createHero> | undefined;
/** The scene actually rendering (set once its textures are installed, cleared while a load is in flight or after closing). */
let heroScene: { lat: number; lon: number; url_depth: string } | undefined;
/** Nearest Panoramax panorama of the address, reprojected and depth-mapped by the server (≤ 10 s, cached). `null` → use the curated catalogue. */
async function liveStreet(lat: number, lon: number, request: number) {
  const dialog = $<HTMLDialogElement>('hero-dialog'), status = $('hero-status');
  const controller = new AbortController(); liveAbort = controller;
  status.textContent = 'Recherche d’une photo de votre rue…'; status.hidden = false;
  dialog.onclose = () => { heroRequest++; heroScene = undefined; controller.abort(); hero?.stop(); };
  if (!dialog.open) dialog.showModal();
  try {
    const response = await fetch(`/api/rue?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
    const data = await response.json();
    if (request !== heroRequest) return null;
    if (!response.ok || !data.url_depth) { status.textContent = data.error ?? 'Photo de rue indisponible.'; return null; }
    status.hidden = true;
    return data as { url?: string; url_clean: string; url_depth: string; address_label?: string; hauteur_m?: number; credit: string; license: string; source_url: string | null; view: { fov: number; pitch: number; camera_height_m: number }; live: boolean; distance_m?: number };
  } catch { if (request === heroRequest) status.textContent = 'Photo de rue indisponible (délai dépassé).'; return null; }
}
async function showHero(result: { url_clean: string; url_depth: string; address_label?: string; hauteur_m: number; view: { fov: number; pitch: number; camera_height_m: number }; live?: boolean; distance_m?: number }, credit: string, origin: { lat: number; lon: number }, request: number) {
  const dialog = $<HTMLDialogElement>('hero-dialog');
  const slider = $<HTMLInputElement>('hero-slider');
  const format = (level: number) => `${level.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
  heroScene = undefined;
  try {
    hero ??= createHero($('hero-view'));
    const shown = await hero.show({ photoUrl: result.url_clean, depthUrl: result.url_depth, fov: result.view.fov, pitch: result.view.pitch, cameraHeight: result.view.camera_height_m, target: result.hauteur_m, onLevel: level => { slider.value = String(level); $('hero-level').textContent = format(level); } });
    if (!shown || request !== heroRequest) return true; // superseded by a newer request, which owns the dialog
  } catch (error) { if (request !== heroRequest) return true; console.warn('3D street scene unavailable, falling back to the photo:', error); hero?.stop(); return false; }
  heroScene = { lat: origin.lat, lon: origin.lon, url_depth: result.url_depth };
  $('hero-status').hidden = true;
  $('hero-label').innerHTML = `${escape(result.address_label || state.address.label)}${result.live ? ` · photo à ${result.distance_m} m` : ''} · Eau à ${format(result.hauteur_m)} ${badge('Estimé')}`;
  $('hero-credit').innerHTML = credit;
  slider.oninput = () => hero?.setLevel(Number(slider.value));
  $('hero-replay').onclick = () => { hero?.setLevel(0); hero?.animateTo(result.hauteur_m); };
  dialog.onclose = () => { heroRequest++; heroScene = undefined; hero?.stop(); };
  if (!dialog.open) dialog.showModal();
  return true;
}
let toastTimer: ReturnType<typeof setTimeout>;
export function notify(message: string) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500); }
export function badge(evidence: Evidence) { return `<span class="evidence evidence-${evidence === 'Officiel' ? 'official' : evidence === 'Mesuré' ? 'measured' : 'estimated'}">${evidence}</span>`; }
export async function timelineExposure(lat: number, lon: number) {
  const selected = state.timeline;
  if (!selected) throw new Error('Choisissez un niveau dans la frise.');
  const contains = (name: string) => datasets[name].features.filter(feature => booleanPointInPolygon([lon, lat], feature));
  const hazards = contains('ppri_aleas').sort((a, b) => Number(b.properties?.h_min) - Number(a.properties?.h_min));
  const classe = (hazards[0]?.properties?.classe ?? null) as FloodClass | null;
  const band = classe ? depthAtLevel(classe, selected.level) : outsidePpri(selected.level, contains('sdrife_zone_inondable').length > 0);
  const requestedPhoto = photoHeight(band, selected.level);
  if (hero && $<HTMLDialogElement>('hero-dialog').open) {
    // Only the scene actually rendering this very address may be animated in place; otherwise (other address, or a load still in flight) reload the right photo and relief.
    if (heroScene && Math.abs(heroScene.lat - lat) < 1e-6 && Math.abs(heroScene.lon - lon) < 1e-6) { supersede(); hero.animateTo(sceneHeight(band)); $('hero-label').innerHTML = `${escape(state.address.label)} · ${escape(selected.label)} · Eau à ${sceneHeight(band).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m ${badge(band.evidence)}`; }
    else void photo_inondee({ hauteur: sceneHeight(band) }, { lat, lon }).then(photo => { if (!photo.affichee && !('remplacee' in photo)) $<HTMLDialogElement>('hero-dialog').close(); });
  }
  let photo;
  try { photo = await api(`/api/photo?${new URLSearchParams({ lat: String(lat), lon: String(lon), h: String(requestedPhoto) })}`); } catch { photo = null; }
  if (state.timeline !== selected) throw new Error('Niveau remplacé par une nouvelle sélection.');
  state.exposureShown = true;
  $('scenario-card').hidden = true;
  showCaves(selected.level === 8.62);
  $('cave-key').hidden = selected.level !== 8.62;
  const image = photo ? requestedPhoto === 0 ? photo.url_clean : photo.url : null;
  showCard('exposure-card', `<div class="card-eyebrow"><i></i>VOTRE RUE · ${escape(selected.label)}</div><h2>Le temps passe.<br>Le risque se précise.</h2><p class="address">${escape(state.address.label)}</p><div class="timeline-depth" data-status="${band.status}">${escape(band.label)} ${badge(band.evidence)}</div><p class="timeline-verdict">${band.status === 'possible' ? 'Peut-être inondé · hachures sur la carte' : band.status === 'flooded' ? 'Dans la zone inondée · aplat sur la carte' : 'Pas d’eau estimée à cette adresse. Les berges peuvent être touchées.'}</p><p class="timeline-reference">Référence PPRI : ${classe ? escape(depthAtLevel(classe, 8.62).label) : 'hors emprise'} ${badge('Officiel')}</p><p class="disclaimer">${selected.level === 8.62 ? 'Classe officielle du PPRI, pas un diagnostic du logement.' : 'Décalage des classes du PPRI : estimation pédagogique, pas une carte historique ni une prévision.'}</p>${image ? `<button class="timeline-photo-button" id="timeline-enlarge" aria-label="Agrandir la photo de la rue"><img id="timeline-photo" src="${escape(image)}" alt="${requestedPhoto === 0 ? 'Photo originale' : 'Rue inondée'}"></button><p class="timeline-image-label">${requestedPhoto === 0 ? 'Vue originale' : `Eau à ${Number(photo.hauteur_m).toLocaleString('fr-FR')} m ${badge('Estimé')}`}</p><p class="timeline-photo-credit">${escape(photo.credit)} · ${photo.source_url ? source('Photo originale', photo.source_url) : ''}</p>` : '<p>Photo indisponible ; les données restent consultables.</p>'}`, source('PPRI · DRIEAT', config.sources.ppri) + source('Emprise SDRIF-E · Officiel', config.sources.sdrif));
  $('timeline-enlarge')?.addEventListener('click', () => { void photo_inondee({ hauteur: photo?.url_depth ? sceneHeight(band) : requestedPhoto }); });
  return { ...band, classe, hauteur_texte: band.label, hauteur_visuelle_m: requestedPhoto, cave_inondee_1910: contains('caves_1910').length > 0, sdrife_en_zone: contains('sdrife_zone_inondable').length > 0, sources: [config.sources.ppri, config.sources.sdrif], photo_height_m: requestedPhoto, photo_available_height_m: photo?.hauteur_m, address: state.address };
}
export async function afficher_crue({ annee, niveau_m }: { annee?: string | null; niveau_m?: number | null }) {
  if ((annee != null) === (niveau_m != null)) throw new Error('Indiquez une année OU un niveau, pas les deux.');
  const preset = annee != null ? floodPresets.find(p => p.id === annee) : undefined;
  if (annee != null && !preset) throw new Error('Repère historique inconnu.');
  const live = preset?.id === 'today' ? await niveau_seine() : null;
  const level = live ? Number(live.hauteur_m) : preset?.level ?? niveau_m!;
  const bands = timelineBands(level);
  await syncScenario(level === 8.62 ? '1910' : level === 9.1 ? 'pire' : 'aujourdhui');
  state.timeline = { id: preset?.id ?? 'custom', label: preset?.label ?? 'Niveau choisi', level, evidence: preset?.evidence ?? 'Estimé', source: live?.source_url ?? preset?.source, note: live ? `Observation : ${live.date_obs}.` : preset?.note, stale: live?.stale };
  if (!['1910', '115', 'today'].includes(state.timeline.id)) document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => { button.classList.toggle('active', false); button.setAttribute('aria-pressed', 'false'); });
  await showFloodLevel(level);
  $('legend-depths').hidden = true; $('legend-note').hidden = false;
  $('legend-title').textContent = 'LA CARTE DU NIVEAU CHOISI';
  $('legend-note').innerHTML = `Aplat : inondé · Hachures : peut-être. ${badge(level === 8.62 ? 'Officiel' : 'Estimé')}<br>${level < 6.62 ? 'Berges/quais bas : zone rouge du PPRI utilisée comme emprise indicative.' : level > 8.62 ? 'Hors PPRI, dans SDRIF-E : moins de 50 cm (estimation).' : 'Classes du PPRI décalées selon le niveau à Austerlitz.'}`;
  window.dispatchEvent(new CustomEvent('zouave:timeline', { detail: state.timeline }));
  const exposure = await timelineExposure(state.address.lat, state.address.lon);
  return { ...state.timeline, bands, exposure, delta_m: Math.round((level - 8.62) * 100) / 100, delta_evidence: 'Estimé', reference_m: 8.62, reference_evidence: 'Officiel', future: '1 chance sur 100 par an, environ 26 % sur 30 ans', future_evidence: 'Estimé', description: `Niveau à Austerlitz : ${level.toLocaleString('fr-FR')} m (${state.timeline!.evidence}). À votre adresse : ${exposure.hauteur_texte} (${exposure.evidence}).` };
}
export const browserTools = { afficher_scenario, afficher_crue, aller_a, exposition, niveau_seine, photo_inondee, consignes };
export async function executeTool(name: string, args: unknown): Promise<unknown> {
  const tool = browserTools[name as keyof typeof browserTools];
  if (!tool) throw new Error(`Outil inconnu : ${name}`);
  return (tool as (args: unknown) => Promise<unknown>)(args);
}
