// "Mémoire de 1910": real photographs of the January 1910 flood near the demo addresses (Wikimedia Commons, public
// domain, fetched by scripts/fetch-1910.mjs) pinned on the map, shown next to today's street and our simulation of it.
// Without web/public/memoire/manifest.json the feature stays invisible.
import * as maplibregl from 'maplibre-gl';
import { map, mapReady } from './map.ts';
import { badge, escape, source } from './tools.ts';

export interface Memory { slug: string; label: string; lat: number; lon: number; location?: string; title: string; date: string; author: string; license: string; license_url: string | null; file_page: string; image: string }
let memories: Memory[] = [];
let overlay: HTMLElement | undefined;

export async function loadMemories() {
  try {
    const response = await fetch('/memoire/manifest.json');
    if (!response.ok) return [];
    const data = await response.json() as { entries?: Memory[] };
    memories = (data.entries ?? []).filter(entry => entry.image && entry.file_page && Number.isFinite(entry.lat) && Number.isFinite(entry.lon));
  } catch { memories = []; }
  return memories;
}
/** The memory the Story shows: Bercy first (the 1910 symbol of the 12th), else the first one available. */
export const storyMemory = () => memories.find(memory => memory.slug === 'bercy') ?? memories[0] ?? null;

function build() {
  document.body.insertAdjacentHTML('beforeend', `
    <section id="memoire" class="memoire" role="dialog" aria-modal="true" aria-labelledby="memoire-title" hidden>
      <div class="memoire-panel">
        <button class="hood-close" id="memoire-close" aria-label="Close">×</button>
        <p class="hood-eyebrow"><span></span> MEMORY OF 1910</p>
        <h2 id="memoire-title"></h2>
        <div class="memoire-grid">
          <figure><img id="memoire-then" alt=""><figcaption><b>January 1910</b> <span class="evidence evidence-measured">Real photo</span><span id="memoire-then-credit" class="memoire-credit"></span></figcaption></figure>
          <figure><img id="memoire-now" alt=""><figcaption><b>Today, nearby</b><span id="memoire-now-credit" class="memoire-credit"></span></figcaption></figure>
          <figure><img id="memoire-sim" alt=""><figcaption><b>Our simulation</b> ${badge('Estimé')}<span id="memoire-sim-credit" class="memoire-credit"></span></figcaption></figure>
        </div>
        <p class="hood-foot">Real photograph, not a simulation. Location approximate; public-domain file from Wikimedia Commons.</p>
      </div>
    </section>`);
  overlay = document.getElementById('memoire')!;
  document.getElementById('memoire-close')!.addEventListener('click', () => closeMemory());
  overlay.addEventListener('click', event => { if (event.target === overlay) closeMemory(); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && overlay && !overlay.hidden && !document.body.classList.contains('tour-active')) { event.preventDefault(); closeMemory(); } });
}

export async function openMemory(memory: Memory) {
  if (!overlay) build();
  document.getElementById('memoire-title')!.textContent = `${memory.label}, January 1910`;
  const then = document.getElementById('memoire-then') as HTMLImageElement;
  then.src = memory.image; then.alt = `${memory.label} flooded in January 1910`;
  document.getElementById('memoire-then-credit')!.innerHTML = ` ${escape(memory.author)} · ${escape(memory.license)} · ${source('Wikimedia Commons', memory.file_page)}`;
  const now = document.getElementById('memoire-now') as HTMLImageElement, sim = document.getElementById('memoire-sim') as HTMLImageElement;
  now.closest('figure')!.hidden = true; sim.closest('figure')!.hidden = true;
  overlay!.hidden = false;
  try {
    const photo = await (await fetch(`/api/photo?${new URLSearchParams({ lat: String(memory.lat), lon: String(memory.lon), h: '1.5' })}`)).json();
    if (photo.url_clean) {
      now.src = photo.url_clean; now.alt = `${photo.address_label} today`; now.closest('figure')!.hidden = false;
      document.getElementById('memoire-now-credit')!.innerHTML = ` ${escape(photo.address_label)}${photo.distance_m ? ` · ${photo.distance_m} m away` : ''} · ${escape(photo.credit)}`;
    }
    if (photo.url && photo.url !== photo.url_clean) {
      sim.src = photo.url; sim.alt = `${photo.address_label} with simulated flood water`; sim.closest('figure')!.hidden = false;
      document.getElementById('memoire-sim-credit')!.textContent = ` water at ${Number(photo.hauteur_m).toLocaleString('en-GB')} m · OpenAI image edit`;
    }
  } catch { /* the 1910 photograph alone still tells the story */ }
}
export function closeMemory() { if (overlay) overlay.hidden = true; }

export async function initializeMemoire() {
  if (!(await loadMemories()).length) return;
  await mapReady;
  for (const memory of memories) {
    const element = document.createElement('button');
    element.type = 'button'; element.className = 'memoire-pin';
    element.setAttribute('aria-label', `Photo of ${memory.label} in January 1910`);
    element.title = `${memory.label}, January 1910 (real photo)`;
    element.textContent = '1910';
    element.addEventListener('click', event => { event.stopPropagation(); void openMemory(memory); });
    new maplibregl.Marker({ element, anchor: 'bottom' }).setLngLat([memory.lon, memory.lat]).addTo(map);
  }
}
