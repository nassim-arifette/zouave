import { floodPresets, consequences } from './flood-level.ts';
import { $, badge, escape, source, afficher_crue, notify, state } from './tools.ts';

export function initializeTimeline() {
  document.querySelector('.status-label')!.insertAdjacentHTML('beforeend', badge('Mesuré'));
  document.querySelector('.reference small')!.insertAdjacentHTML('beforeend', ` ${badge('Mesuré')} ${badge('Officiel')}`);
  const panel = document.createElement('section');
  panel.id = 'flood-timeline'; panel.className = 'glass'; panel.setAttribute('aria-label', 'Curseur du temps');
  panel.innerHTML = `<div class="timeline-heading"><div><span class="timeline-eyebrow">LE CURSEUR DU TEMPS</span><h2 id="timeline-title">Choisissez une crue</h2></div><output id="timeline-level">À l’échelle d’Austerlitz</output></div><label class="sr-only" for="flood-slider">Crue historique ou scénario</label><input id="flood-slider" type="range" min="0" max="${floodPresets.length - 1}" step="1" value="${floodPresets.findIndex(p => p.id === 'today')}"><div class="timeline-ticks">${floodPresets.map((p, i) => `<button data-flood-index="${i}" title="${escape(p.label)}">${p.id === 'today' ? 'Direct' : p.id === '115' ? '115 %' : p.id}</button>`).join('')}</div><div id="timeline-thresholds" class="timeline-thresholds">${consequences.map((c, i) => `<a id="threshold-${i}" href="${escape(c.source)}" target="_blank" rel="noreferrer" title="${escape(c.note ?? c.label)}"><strong>${c.level.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} m ${badge('Officiel')}</strong><span>${escape(c.label)}</span></a>`).join('')}</div><p id="timeline-source">Déplacez le curseur : les niveaux sont mesurés au fleuve, pas à votre porte.</p><p class="timeline-future">1 chance sur 100 par an, environ 26 % sur 30 ans ${badge('Estimé')} · Pas de date future.</p>`;
  document.querySelector('main')!.append(panel);
  const slider = $<HTMLInputElement>('flood-slider');
  let pending: number | null = null;
  let running = false;
  async function select(index: number) {
    pending = index;
    if (running) return;
    running = true;
    try {
      while (pending !== null) {
        const next = pending; pending = null;
        try { const result = await afficher_crue({ annee: floodPresets[next].id }); $('caption').textContent = result.description; }
        catch (error) { notify(error instanceof Error ? error.message : 'Ce niveau est indisponible.'); }
      }
    } finally { running = false; }
  }
  slider.addEventListener('input', () => { void select(Number(slider.value)); });
  panel.querySelectorAll<HTMLButtonElement>('[data-flood-index]').forEach(button => button.addEventListener('click', () => { slider.value = button.dataset.floodIndex!; void select(Number(slider.value)); }));
  window.addEventListener('zouave:timeline-clear', () => {
    $('timeline-title').textContent = 'Scénario classique';
    $('timeline-level').textContent = 'Reprenez la frise';
    $('timeline-source').textContent = 'Déplacez le curseur pour revenir aux niveaux historiques.';
    panel.querySelectorAll('[data-flood-index]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  });
  window.addEventListener('zouave:timeline', () => {
    const selected = state.timeline!;
    const index = floodPresets.findIndex(p => p.id === selected.id);
    if (index >= 0) slider.value = String(index);
    slider.setAttribute('aria-valuetext', `${selected.label} : ${selected.level.toLocaleString('fr-FR')} mètres à Austerlitz`);
    $('timeline-title').textContent = selected.label;
    $('timeline-level').innerHTML = `${selected.level.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} m ${badge(selected.evidence)}${selected.id === '1910' ? ` ${badge('Officiel')}` : ''}`;
    $('timeline-source').innerHTML = `${selected.source ? source(selected.id === 'today' ? 'Hub’Eau · Vigicrues' : 'Source du niveau', selected.source) : '<strong>Source primaire non retrouvée · à vérifier</strong>'}${selected.note ? ` · ${escape(selected.note)}` : ''}${selected.stale ? ' · Instantané hors ligne, pas une mesure en direct.' : ''}`;
    panel.querySelectorAll<HTMLButtonElement>('[data-flood-index]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.floodIndex) === index)));
    consequences.forEach((c, i) => $(`threshold-${i}`).classList.toggle('reached', selected.level >= c.level));
  });
}
