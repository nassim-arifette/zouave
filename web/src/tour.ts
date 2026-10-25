// Story mode: a ~90 s guided tour for demos, driven by the real tools (live level, historical timeline levels, address,
// exposure, 3D street scene, official advice) and narrated by the Zouave. While the Seine rises in accelerated time,
// counters climb from a real point-in-polygon test (IGN BD TOPO building centroids × the PPRI footprint at that level),
// official thresholds pop as they are crossed, water rises on the mascot (Zouave-meter) and a procedural water
// soundscape follows the level. Space pauses, → skips a step, Escape quits; every step fails soft.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import './tour.css';
import { config } from './config.ts';
import { map, mapReady, datasets } from './map.ts';
import { afficher_crue, aller_a, exposition, photo_inondee, consignes, state } from './tools.ts';
import { floodPresets, consequences, timelineBands, sceneHeight, BANKS_ONLY_BELOW, REFERENCE_LEVEL, type DepthBand } from './flood-level.ts';
import { flattenFootprints, timelineFootprints, type WaterFeature } from './water-footprints.ts';
import { isSpeaking, pauseSpeaking, resumeSpeaking, speak, speakEnabled, stopListening, stopSpeaking } from './speech.ts';
import { isVoiceSessionActive, stopVoice } from './voice.ts';
import { closeMemory, openMemory, storyMemory } from './memoire.ts';
import { animateAnswer, setSpeaking } from './avatar.ts';

const OECD = 'https://www.oecd.org/fr/publications/mieux-prevenir-les-inondations-de-la-seine-en-ile-de-france_9789264290082-fr';
const ZOUAVE_1910 = 'https://www.pariszigzag.fr/insolite/histoire-insolite-paris/crue-centennale-paris/';
/** Height of the Zouave's shoulders in the mascot picture (fraction of the image height, from the bottom). */
const SHOULDERS = 0.47;
/** The Zouave-meter starts filling at this Austerlitz level (illustrative scale anchored only on the 1910 marker). */
const METER_FROM = 6;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const metres = (level: number, digits = 2) => level.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: digits });
const presetLevel = (id: string) => floodPresets.find(preset => preset.id === id)?.level ?? REFERENCE_LEVEL;
/** Speech wants words, the caption keeps the compact unit. */
const spoken = (text: string) => text.replace(/(\d)\s?m\b/g, '$1 metres').replace(/€\s?(\d+)\s?billion/g, '$1 billion euros');

class Aborted extends Error {}
interface Run { aborted: boolean; paused: boolean; skip: boolean }
let run: Run | null = null;

/** Waits `ms` of tour time: paused time does not count, a skip ends the wait, an abort throws. */
async function wait(ms: number) {
  const current = run!;
  let left = ms, last = performance.now();
  while (left > 0) {
    if (current.aborted) throw new Aborted();
    if (current.skip) return;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, left)));
    const now = performance.now();
    if (!current.paused) left -= now - last;
    last = now;
  }
  if (current.aborted) throw new Aborted();
}

/** Shows the line as the Zouave's caption and speaks it; resolves when the speech ends (or after an estimate). */
async function say(text: string, minMs = 0) {
  const caption = el('caption');
  if (caption) caption.textContent = text;
  const voiced = speak(spoken(text));
  if (!voiced) animateAnswer(text);
  const estimate = text.split(/\s+/).length * 400 + 600;
  let elapsed = 0;
  for (;;) {
    await wait(150);
    elapsed += 150;
    if (run!.skip) return;
    // isSpeaking() covers narrated audio still loading from the server as well as the browser voice talking;
    // the 1.5 s floor tolerates audio that has not started yet, the cap guards against a voice that never ends.
    const talking = voiced && isSpeaking();
    if (elapsed >= Math.max(minMs, voiced ? Math.max(1500, estimate * 0.5) : estimate) && !talking) return;
    if (elapsed >= Math.max(minMs, estimate * 1.8 + 1500)) return;
  }
}

// ── Real counters: building centroids and flooded area inside the footprint at a given level ──────────────────
type Ring = Position[];
let centroids: Promise<Float64Array> | undefined;
function loadCentroids() {
  centroids ??= fetch('/data/batiments.geojson').then(response => response.json()).then((data: FeatureCollection<Polygon | MultiPolygon>) => {
    const out = new Float64Array(data.features.length * 2);
    let n = 0;
    for (const feature of data.features) {
      const geometry = feature.geometry;
      const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : geometry?.type === 'MultiPolygon' ? geometry.coordinates[0]?.[0] : undefined;
      if (!ring || ring.length < 2) continue;
      let x = 0, y = 0;
      const m = ring.length - 1;
      for (let i = 0; i < m; i++) { x += ring[i][0]; y += ring[i][1]; }
      out[n++] = x / m; out[n++] = y / m;
    }
    return out.subarray(0, n);
  });
  return centroids;
}
const bbox = (ring: Ring) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return [minX, minY, maxX, maxY] as [number, number, number, number];
};
/** Planar area of a ring in m² (local equirectangular projection, fine at city scale). */
const ringArea = (ring: Ring) => {
  const kx = 111_320 * Math.cos(48.85 * Math.PI / 180), ky = 110_574;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
  return Math.abs(sum) / 2;
};
interface Count { flooded: number; possible: number; km2: number }
const counts = new Map<number, Promise<Count>>();
/** PPRI depth classes only (no indicative bank proxy, no extra SDRIF band): the same rule as the timeline map. */
function countAt(level: number) {
  let pending = counts.get(level);
  if (!pending) {
    pending = (async () => {
      await mapReady;
      const points = await loadCentroids();
      const features = timelineFootprints(level, timelineBands(level), { aleas: datasets.ppri_aleas.features as WaterFeature[], banks: [], extra: [] });
      const polygons = flattenFootprints(features).map(part => ({ status: part.properties.status === 'possible' ? 'possible' : 'flooded', area: ringArea(part.polygon[0]) - part.polygon.slice(1).reduce((sum, hole) => sum + ringArea(hole), 0), geometry: { type: 'Polygon', coordinates: part.polygon, bbox: bbox(part.polygon[0]) } as Polygon }));
      let flooded = 0, possible = 0;
      for (let i = 0; i < points.length; i += 2) {
        let hit: string | null = null;
        for (const polygon of polygons) if (booleanPointInPolygon([points[i], points[i + 1]], polygon.geometry)) { hit = polygon.status; if (hit === 'flooded') break; }
        if (hit === 'flooded') flooded++; else if (hit === 'possible') possible++;
        if (i % 6000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      const km2 = polygons.filter(polygon => polygon.status === 'flooded').reduce((sum, polygon) => sum + polygon.area, 0) / 1e6;
      return { flooded, possible, km2 };
    })();
    counts.set(level, pending);
  }
  return pending;
}

// ── Sound: brown-noise water whose body follows the level, plus a soft chime for each official threshold ─────────
let audio: { ctx: AudioContext; master: GainNode; water: GainNode; filter: BiquadFilterNode } | undefined;
function startAudio() {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context || audio) return;
  try {
    const ctx = new Context();
    const length = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let last = 0;
      for (let i = 0; i < length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
    }
    const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300; filter.Q.value = 0.8;
    const swell = ctx.createOscillator(); swell.frequency.value = 0.13;
    const swellDepth = ctx.createGain(); swellDepth.gain.value = 140;
    swell.connect(swellDepth).connect(filter.frequency);
    const water = ctx.createGain(); water.gain.value = 0;
    const master = ctx.createGain(); master.gain.value = speakEnabled() ? 1 : 0;
    source.connect(filter).connect(water).connect(master).connect(ctx.destination);
    source.start(); swell.start();
    audio = { ctx, master, water, filter };
  } catch (error) { console.warn('Story sound unavailable:', error); }
}
function waterSound(level: number) {
  if (!audio) return;
  const t = Math.max(0, Math.min(1.1, level / REFERENCE_LEVEL)), now = audio.ctx.currentTime;
  audio.master.gain.setTargetAtTime(speakEnabled() ? 1 : 0, now, 0.2);
  audio.water.gain.setTargetAtTime(0.02 + 0.2 * t * t, now, 0.5);
  audio.filter.frequency.setTargetAtTime(220 + 950 * t, now, 0.5);
}
function chime() {
  if (!audio || !speakEnabled()) return;
  const { ctx, master } = audio, now = ctx.currentTime;
  for (const [frequency, delay] of [[1046.5, 0], [1568, 0.09]] as const) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(0.09, now + delay + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.3);
    osc.connect(gain).connect(master);
    osc.start(now + delay); osc.stop(now + delay + 1.4);
  }
}
function stopAudio() {
  if (!audio) return;
  const { ctx, master } = audio;
  audio = undefined;
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  setTimeout(() => { void ctx.close().catch(() => {}); }, 1200);
}

// ── Overlay elements ─────────────────────────────────────────────────────────────────────────────────────────────
let hud: HTMLElement, hook: HTMLElement, endCard: HTMLElement, progressBar: HTMLElement, pausedBadge: HTMLElement, startButton: HTMLButtonElement;
function buildOverlay() {
  document.body.insertAdjacentHTML('beforeend', `
    <section class="tour-hook" id="tour-hook" aria-live="polite" hidden>
      <div class="tour-hook-inner">
        <p class="tour-eyebrow"><span></span> PARIS · THE SEINE</p>
        <h2>If the 1910 flood<br><em>happened today</em></h2>
        <div class="tour-stats">
          <div><strong>5 million</strong><span>people affected, at most</span></div>
          <div><strong>€30 billion</strong><span>in direct damage, at most</span></div>
        </div>
        <p class="tour-odds">A <b>1-in-100</b> chance, every year.</p>
        <a class="tour-source" href="${OECD}" target="_blank" rel="noreferrer">Source: OECD ↗</a>
      </div>
    </section>
    <aside class="tour-hud" id="tour-hud" aria-live="polite" hidden>
      <p class="tour-hud-year" id="tour-year">TODAY</p>
      <p class="tour-hud-level"><strong id="tour-level">–</strong><span>m</span></p>
      <p class="tour-hud-sub">The Seine at the Austerlitz gauge</p>
      <div class="tour-gauge" aria-hidden="true"><i id="tour-gauge-fill"></i><b style="bottom:${(REFERENCE_LEVEL / 10) * 100}%">1910</b></div>
      <div class="tour-counters">
        <p><strong id="tour-buildings">0</strong><span>buildings inside the flood footprint<em id="tour-possible"></em></span></p>
        <p><strong id="tour-area">0.0</strong><span id="tour-area-caption">km² of Paris under water (PPRI footprint)</span></p>
      </div>
      <p class="tour-scope">Buildings: IGN BD TOPO centroids in the mapped area (central Paris) · footprint: Paris PPRI hazard classes at this level</p>
      <ol class="tour-thresholds" id="tour-thresholds"></ol>
    </aside>
    <div class="tour-progress" id="tour-progress" hidden><i id="tour-progress-bar"></i><span class="tour-keys">Space pause · → next · Esc exit</span><span class="tour-touch"><button type="button" id="tour-pause">Pause</button><button type="button" id="tour-next">Next</button><button type="button" id="tour-stop">Exit</button></span><b id="tour-paused" hidden>PAUSED</b></div>
    <section class="tour-end" id="tour-end" hidden>
      <div class="tour-end-card">
        <img id="tour-end-avatar" alt="" src="/zouave/living-stone/avatar@2x.webp">
        <p class="tour-eyebrow"><span></span> ZOUAVE</p>
        <h2>See your flood<br><em>before it comes.</em></h2>
        <p class="tour-built">Built with the OpenAI Realtime voice + function calling, on official open data<br><small>PPRI (DRIEAT) · IGN BD TOPO · Hub’Eau / Vigicrues · Ville de Paris</small></p>
        <div class="tour-end-actions"><button type="button" id="tour-replay">↻ Replay the story</button><button type="button" id="tour-explore" class="primary">Explore Paris yourself</button></div>
      </div>
    </section>`);
  hud = el('tour-hud')!; hook = el('tour-hook')!; endCard = el('tour-end')!; progressBar = el('tour-progress')!; pausedBadge = el('tour-paused')!;
  // Replay also works while the last line is still being spoken: stop the current run, then start again.
  el('tour-replay')!.addEventListener('click', () => { endCard.hidden = true; if (run) { abort(); setTimeout(() => void play(), 300); } else void play(); });
  el('tour-pause')!.addEventListener('click', togglePause);
  el('tour-next')!.addEventListener('click', skip);
  el('tour-stop')!.addEventListener('click', abort);
  el('tour-explore')!.addEventListener('click', () => { endCard.hidden = true; });
  endCard.addEventListener('click', event => { if (event.target === endCard) endCard.hidden = true; });
}

let shownLevel = 0;
function showLevel(level: number) {
  shownLevel = level;
  el('tour-level')!.textContent = level.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  el('tour-gauge-fill')!.style.height = `${Math.max(0, Math.min(100, level * 10))}%`;
  meter(level);
  waterSound(level);
}
let shownCount: Count = { flooded: 0, possible: 0, km2: 0 };
function showCount(count: Count) {
  shownCount = count;
  // From the first riverside closures up to 6.62 m only banks and low quays flood (indicative footprint, not counted):
  // printing 0 buildings / 0.0 km² there would contradict the map and the narration.
  const banksOnly = shownLevel >= consequences[0].level && shownLevel < BANKS_ONLY_BELOW;
  el('tour-buildings')!.textContent = banksOnly ? '–' : Math.round(count.flooded).toLocaleString('en-GB');
  el('tour-possible')!.textContent = !banksOnly && count.possible >= 1 ? ` · +${Math.round(count.possible).toLocaleString('en-GB')} possibly` : '';
  el('tour-area')!.textContent = banksOnly ? '–' : count.km2.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  el('tour-area-caption')!.textContent = banksOnly ? 'riverbanks and low quays only (indicative footprint)' : 'km² of Paris under water (PPRI footprint)';
}
const crossed = new Set<number>();
function thresholds(level: number) {
  for (const consequence of consequences) {
    if (level < consequence.level || crossed.has(consequence.level)) continue;
    crossed.add(consequence.level);
    const item = document.createElement('li');
    item.innerHTML = `<b>${metres(consequence.level)} m</b> ${consequence.label.replace(/[<>&]/g, '')}`;
    el('tour-thresholds')!.append(item);
    chime();
  }
}

// ── Zouave-meter: water rising over the mascot, clipped to the statue's silhouette ───────────────────────────────
function meter(level: number) {
  const ring = el('avatar-ring');
  if (!ring) return;
  let water = ring.querySelector<HTMLElement>('.tour-water');
  if (!water) {
    water = document.createElement('div');
    water.className = 'tour-water';
    water.setAttribute('aria-hidden', 'true');
    const src = (ring.querySelector('#avatar') as HTMLImageElement | null)?.src;
    // Clip to the statue's alpha and to the same bottom fade as the mascot picture (sizes and composite live in tour.css).
    if (src) { const mask = `url("${src}"), linear-gradient(#000 78%, transparent)`; water.style.setProperty('mask-image', mask); water.style.setProperty('-webkit-mask-image', mask); }
    ring.append(water);
  }
  const fill = Math.max(0, Math.min(1.08, (level - METER_FROM) / (REFERENCE_LEVEL - METER_FROM))) * SHOULDERS;
  water.style.setProperty('--tour-water', `${(fill * 100).toFixed(1)}%`);
  water.classList.toggle('is-dry', fill <= 0.001);
}
function meterTag(show: boolean) {
  const ring = el('avatar-ring');
  if (!ring) return;
  let tag = ring.querySelector<HTMLElement>('.tour-meter-tag');
  if (show && !tag) {
    tag = document.createElement('p');
    tag.className = 'tour-meter-tag';
    tag.style.bottom = `${SHOULDERS * 100}%`;
    tag.innerHTML = `<strong>1910: water up to the Zouave’s shoulders</strong><small>Popular marker — the statue was moved in 1974 · <a href="${ZOUAVE_1910}" target="_blank" rel="noreferrer">source ↗</a></small>`;
    ring.append(tag);
  } else if (!show) tag?.remove();
}
function resetMeter() { const ring = el('avatar-ring'); ring?.querySelector('.tour-water')?.remove(); meterTag(false); }

/** Raises the readout from the shown level to `to`, with counters interpolated towards the count at `to`. */
async function rise(to: number, duration: number) {
  const from = shownLevel, fromCount = shownCount;
  const target = countAt(to);
  let toCount: Count | null = null;
  void target.then(count => { toCount = count; }).catch(() => {});
  const total = reducedMotion() ? 0 : duration;
  let elapsed = 0;
  while (elapsed < total) {
    await wait(50);
    if (run!.skip) break;
    elapsed += 50;
    const t = elapsed / total, eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const level = from + (to - from) * eased;
    showLevel(level); thresholds(level);
    if (toCount) { const c: Count = toCount; showCount({ flooded: fromCount.flooded + (c.flooded - fromCount.flooded) * eased, possible: fromCount.possible + (c.possible - fromCount.possible) * eased, km2: fromCount.km2 + (c.km2 - fromCount.km2) * eased }); }
  }
  showLevel(to); thresholds(to);
  try { showCount(await Promise.race([target, new Promise<Count>((_, reject) => setTimeout(() => reject(new Error('count timeout')), 6000))])); } catch { /* keep the last shown values */ }
}

/** Starts the real timeline tool for a preset without blocking the narration (the map catches up in parallel). */
function timeline(annee: string) {
  return afficher_crue({ annee }).catch(error => { console.warn(`Story: timeline ${annee} unavailable`, error); return null; });
}
const capped = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);

// ── The story ────────────────────────────────────────────────────────────────────────────────────────────────────
let exposure: (Partial<DepthBand> & { hauteur_texte?: string }) | null = null;
const steps: Array<() => Promise<void>> = [
  // 1 · Hook: the stakes, sourced, in the first seconds.
  async () => {
    hook.hidden = false;
    document.body.classList.add('tour-hooked');
    if (!reducedMotion()) map.easeTo({ center: config.initialCenter, zoom: 13.7, pitch: 56, bearing: -32, padding: { top: 40, bottom: 220, left: 0, right: 0 }, duration: 3000 });
    await say('I’m the Zouave of the Alma bridge. For generations, Parisians have read the Seine’s floods on my body. If 1910 came back today, up to five million people would be hit.', 9000);
  },
  // 2 · Today, live.
  async () => {
    hook.hidden = true;
    document.body.classList.remove('tour-hooked');
    hud.hidden = false;
    el('tour-year')!.textContent = 'TODAY';
    // Only this run's reading may be narrated: no reuse of an earlier timeline level, no invented default.
    const today = await capped(timeline('today'), 9000);
    const level = today && 'level' in today && Number.isFinite(Number(today.level)) ? Number(today.level) : null;
    if (level === null) await say('Here is the Seine in Paris today. Now, watch it rise.', 3500);
    else {
      const stale = Boolean(today && 'stale' in today && today.stale);
      el('tour-year')!.textContent = stale ? 'LAST KNOWN READING' : 'TODAY · LIVE';
      showLevel(level); thresholds(level);
      showCount(await capped(countAt(level), 6000) ?? shownCount);
      await say(stale ? `My last known reading: ${metres(level)} m at Austerlitz. Now, watch it rise.` : `This is the Seine right now: ${metres(level)} m at Austerlitz. Now, watch it rise.`, 3500);
    }
    if (!reducedMotion()) map.easeTo({ bearing: map.getBearing() + 26, duration: 34_000, easing: t => t });
  },
  // 3 · June 2016.
  async () => {
    el('tour-year')!.textContent = 'JUNE 2016';
    const level = presetLevel('2016');
    void timeline('2016');
    await Promise.all([rise(level, 4500), say(`June 2016: ${metres(level)} m. Riverside roads close, boats stop, RER C trains halt.`, 5000)]);
  },
  // 4 · 1955.
  async () => {
    el('tour-year')!.textContent = 'JANUARY 1955';
    const level = presetLevel('1955');
    void timeline('1955');
    await Promise.all([rise(level, 3500), say(`1955: ${metres(level)} m. Low-lying streets may flood.`, 4000)]);
  },
  // 5 · 1910, the reference flood: up to the Zouave's shoulders.
  async () => {
    el('tour-year')!.textContent = 'JANUARY 1910';
    const level = presetLevel('1910');
    const pending = timeline('1910');
    await Promise.all([rise(level, 4500), say(`January 1910: ${metres(level)} m. The reference flood. Up to my shoulders!`, 5500)]);
    meterTag(true);
    await capped(pending, 6000);
    await wait(2500);
  },
  // 5b · A real photograph of 1910 near here (only when scripts/fetch-1910.mjs found one): this is not a simulation.
  async () => {
    const memory = storyMemory();
    if (!memory) return;
    void openMemory(memory);
    await say(`This is not a simulation. ${memory.label}, near here, in January 1910.`, 6000);
    closeMemory();
  },
  // 6 · And your home?
  async () => {
    document.body.classList.add('tour-home');
    const street = config.demoAddress.split(',')[0];
    const flight = aller_a({ adresse: config.demoAddress }).catch(error => { console.warn('Story: address unavailable', error); return null; });
    await say(`And your home? Let’s fly to ${street}.`, 3200);
    const point = await capped(flight, 6000);
    const where = point ?? state.address;
    exposure = await capped(exposition({ lat: where.lat, lon: where.lon, scenario: state.timeline ? state.scenario : '1910' }) as unknown as Promise<typeof exposure>, 8000).catch(() => null);
    const label = exposure?.hauteur_texte ?? exposure?.label;
    if (label) await say(`Here, in a 1910-type flood: ${label} of water.`, 3500);
  },
  // 7 · Your street, with the water rising (3D street scene from a real photo and its depth map).
  async () => {
    const height = exposure && exposure.status ? sceneHeight(exposure as DepthBand) : 1.5;
    const shown = capped(photo_inondee({ hauteur: height || 1.5 }), 14_000).catch(() => null);
    await say(`Your street, with ${metres(height || 1.5, 1)} m of water. A simulation, not a forecast.`, 4000);
    await shown;
    await wait(7000);
    closeDialogs();
  },
  // 8 · What to do.
  async () => {
    document.body.classList.add('tour-home');
    const advice = await capped(consignes({ rez_de_chaussee: true, cave: true, enfants: true }), 5000).catch(() => null);
    const titles = advice?.consignes.map(item => item.title.replace(/\.$/, '')) ?? [];
    await say(titles.length ? `Three things to do now. ${titles.join('. ')}.` : 'Prepare now: know your refuge, protect your cellar, follow the authorities.', 6000);
  },
  // 9 · End card.
  async () => {
    hud.hidden = true;
    resetMeter();
    endCard.hidden = false;
    await say('Zouave. See your flood before it comes.', 2500);
  },
];

function closeDialogs() {
  for (const id of ['hero-dialog', 'photo-dialog', 'streetview-dialog']) { const dialog = el<HTMLDialogElement>(id); if (dialog?.open) dialog.close(); }
}

// Keyboard (Space, →, Esc) and touch buttons share the same three controls.
function togglePause() {
  if (!run) return;
  run.paused = !run.paused;
  pausedBadge.hidden = !run.paused;
  document.body.classList.toggle('tour-paused', run.paused);
  el('tour-pause')!.textContent = run.paused ? 'Resume' : 'Pause';
  if (run.paused) pauseSpeaking(); else resumeSpeaking();
  if (audio) void (run.paused ? audio.ctx.suspend() : audio.ctx.resume());
}
function skip() { if (run) { run.skip = true; stopSpeaking(); } }
function abort() { if (run) { run.aborted = true; stopSpeaking(); closeDialogs(); } }

function onKey(event: KeyboardEvent) {
  if (!run) return;
  if (event.key === ' ' || event.code === 'Space') {
    event.preventDefault(); event.stopPropagation();
    togglePause();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault(); event.stopPropagation();
    skip();
  } else if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation();
    if (closeHood()) return; // Escape first closes the Under the hood overlay, as everywhere else
    abort();
  } else if (/^[0-9dhu]$/i.test(event.key) && !(event.target as HTMLElement)?.matches?.('input,textarea')) {
    event.stopPropagation();
  }
}

function closeHood() {
  const hood = el('hood');
  if (!hood || hood.hidden) return false;
  el('hood-close')?.click();
  return true;
}

function begin() {
  if (document.body.classList.contains('ui-hidden')) el('immersion-exit')?.click();
  closeHood();
  // The story narrates alone: end a live OpenAI voice session and browser listening (the mic is hidden meanwhile).
  if (isVoiceSessionActive()) void stopVoice();
  stopListening();
  closeDialogs();
  endCard.hidden = true;
  document.body.classList.add('engaged', 'tour-active');
  crossed.clear();
  el('tour-thresholds')!.replaceChildren();
  shownLevel = 0; shownCount = { flooded: 0, possible: 0, km2: 0 }; showCount(shownCount);
  exposure = null;
  progressBar.hidden = false; pausedBadge.hidden = true; el('tour-pause')!.textContent = 'Pause';
  stopSpeaking(); setSpeaking(false);
  startAudio();
  startButton.setAttribute('aria-pressed', 'true');
  // Warm what later steps need: building centroids and counts, and the live street scene of the demo address.
  for (const id of ['2016', '1955', '1910']) void countAt(presetLevel(id)).catch(() => {});
  void fetch(`/api/rue?${new URLSearchParams({ lat: String(config.demoPosition.lat), lon: String(config.demoPosition.lon) })}`).catch(() => {});
  window.addEventListener('keydown', onKey, true);
}
function finish(completed: boolean) {
  window.removeEventListener('keydown', onKey, true);
  run = null;
  stopAudio();
  if (!completed) { stopSpeaking(); closeDialogs(); endCard.hidden = true; }
  closeMemory();
  hook.hidden = true; hud.hidden = true; progressBar.hidden = true;
  resetMeter();
  document.body.classList.remove('tour-active', 'tour-hooked', 'tour-home', 'tour-paused');
  startButton.setAttribute('aria-pressed', 'false');
}

export async function play() {
  if (run) return;
  const current: Run = run = { aborted: false, paused: false, skip: false };
  begin();
  let completed = true;
  try {
    for (let i = 0; i < steps.length; i++) {
      if (current.aborted) { completed = false; break; }
      current.skip = false;
      el('tour-progress-bar')!.style.width = `${((i + 1) / steps.length) * 100}%`;
      try { await steps[i](); }
      catch (error) { if (error instanceof Aborted) { completed = false; break; } console.warn(`Story step ${i + 1} failed:`, error); }
    }
  } finally { finish(completed && !current.aborted); }
}

export function initializeTour() {
  if (el('tour-start')) return;
  buildOverlay();
  startButton = document.createElement('button');
  startButton.id = 'tour-start'; startButton.type = 'button'; startButton.className = 'tour-start';
  startButton.setAttribute('aria-pressed', 'false');
  startButton.title = 'Watch the 90-second story (key D)';
  startButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg><span>Watch the story</span><kbd>D</kbd>';
  startButton.addEventListener('click', () => { if (run) abort(); else void play(); });
  const anchor = el('immersion-toggle');
  if (anchor?.parentElement) anchor.parentElement.insertBefore(startButton, anchor); else document.body.append(startButton);
  window.addEventListener('keydown', event => {
    if (!run && event.key === 'Escape' && !endCard.hidden) { endCard.hidden = true; return; }
    if (run || event.key.toLowerCase() !== 'd' || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.target as HTMLElement)?.matches?.('input,textarea,[contenteditable]') || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    void play();
  });
}
