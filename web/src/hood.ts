// "Under the hood": the architecture slide, inside the product (button or key U), for the jury's questions — what the
// agent is, which tools it may call, which official data they read, and what is real, estimated or simulated.
// It also carries the QR code that lets anyone in the room open Zouave on their phone (same network).
import QRCode from 'qrcode';
import { badge } from './tools.ts';

const tools = ['niveau_seine', 'afficher_scenario', 'afficher_crue', 'aller_a', 'exposition', 'photo_inondee', 'consignes'];
const data = [
  ['Hub’Eau / Vigicrues', 'live Seine gauge at Austerlitz'],
  ['PPRI 1910 · DRIEAT', 'official flood map and depth classes'],
  ['IGN BD TOPO + Géoplateforme', 'buildings and address geocoding'],
  ['City of Paris', 'cellars flooded in 1910'],
  ['SDRIF-E · Institut Paris Région', 'extreme flood footprint'],
  ['City of Paris · Géorisques · Prefecture', 'official safety guidance'],
];

function render() {
  document.body.insertAdjacentHTML('beforeend', `
    <section id="hood" class="hood" role="dialog" aria-modal="true" aria-labelledby="hood-title" hidden>
      <div class="hood-panel">
        <button class="hood-close" id="hood-close" aria-label="Close">×</button>
        <p class="hood-eyebrow"><span></span> UNDER THE HOOD</p>
        <h2 id="hood-title">An agent that can only answer<br><em>with official data.</em></h2>
        <div class="hood-flow">
          <article><h3>You</h3><p>Talk or type, in plain English.</p><ul><li>Microphone (WebRTC)</li><li>Chat and shortcuts</li></ul></article>
          <i aria-hidden="true">→</i>
          <article class="hood-agent"><h3>The Zouave agent</h3><p><b>OpenAI Realtime</b> voice with function calling. Persona rule: no number unless a tool returned it.</p><ul><li>Narration: OpenAI text-to-speech, cached</li><li>No key? Same tools, browser voice</li></ul></article>
          <i aria-hidden="true">→</i>
          <article><h3>7 tools in your browser</h3><p class="hood-tools">${tools.map(name => `<code>${name}</code>`).join('')}</p><p>Every call is shown under the answer.</p></article>
          <i aria-hidden="true">→</i>
          <article><h3>Official open data</h3><ul>${data.map(([name, what]) => `<li><b>${name}</b> · ${what}</li>`).join('')}</ul></article>
        </div>
        <div class="hood-grid">
          <article><h3>What you see</h3><ul><li>MapLibre 3D city + Three.js water shader</li><li>Street scene: Panoramax photo + Depth Anything V2 depth map</li><li>Flooded photos: OpenAI image edits</li><li>Story mode: the same tools, scripted</li></ul></article>
          <article><h3>The hard part</h3><p>Turning one number on a river gauge into a depth at your door: the official 1910 depth classes shifted by the gauge difference, riverbanks only below 6.62 m, the extreme footprint beyond 1910 — every figure labelled.</p><p class="hood-badges">${badge('Mesuré')} ${badge('Officiel')} ${badge('Estimé')}</p></article>
          <article class="hood-share" id="hood-share" hidden><h3>Try it on your phone</h3><div class="qr" id="hood-qr"></div><p id="hood-url"></p></article>
        </div>
        <p class="hood-foot">Educational scenarios, not forecasts or building surveys. Sources and licences: see the map credits.</p>
      </div>
    </section>`);
}

export function initializeHood() {
  if (document.getElementById('hood')) return;
  render();
  const hood = document.getElementById('hood')!;
  const button = document.createElement('button');
  button.type = 'button'; button.id = 'hood-toggle'; button.className = 'hood-toggle';
  button.title = 'How Zouave works (key U)';
  button.innerHTML = '<span>Under the hood</span><kbd>U</kbd>';
  const anchor = document.getElementById('immersion-toggle');
  if (anchor?.parentElement) anchor.parentElement.insertBefore(button, anchor); else document.body.append(button);
  const open = (show: boolean) => { hood.hidden = !show; button.setAttribute('aria-pressed', String(show)); if (show) document.getElementById('hood-close')!.focus(); };
  button.addEventListener('click', () => open(hood.hidden));
  document.getElementById('hood-close')!.addEventListener('click', () => open(false));
  hood.addEventListener('click', event => { if (event.target === hood) open(false); });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !hood.hidden) { event.preventDefault(); open(false); return; }
    if (event.key.toLowerCase() !== 'u' || event.ctrlKey || event.metaKey || event.altKey) return;
    if ((event.target as HTMLElement)?.matches?.('input,textarea,[contenteditable]') || document.querySelector('dialog[open]') || document.body.classList.contains('tour-active')) return;
    event.preventDefault(); open(hood.hidden);
  });
  void share();
}

/** QR code to the address phones on the same network can open (server-provided), in the hood and on the story's end card. */
async function share() {
  try {
    const config = await (await fetch('/api/config')).json() as { share_url?: string | null };
    const url = config.share_url;
    if (!url) return;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#08131bff', light: '#e9f4efff' } });
    document.getElementById('hood-qr')!.innerHTML = svg;
    document.getElementById('hood-url')!.textContent = url.replace(/^https?:\/\//, '');
    document.getElementById('hood-share')!.hidden = false;
    const card = document.querySelector('.tour-end-card');
    if (card && !card.querySelector('.share-qr')) card.insertAdjacentHTML('beforeend', `<div class="share-qr"><div class="qr">${svg}</div><p><b>Your turn.</b> Scan to check your own address<br><small>${url.replace(/^https?:\/\//, '')}</small></p></div>`);
  } catch (error) { console.warn('Share QR unavailable:', error); }
}
