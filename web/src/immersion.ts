// Immersive staging: the intro title dissolves once the visitor engages, and "Immersion" (button or H) hides every panel
// so only the city and the water remain, with a slow camera drift (stopped by any map gesture or reduced motion).
import type { Map } from 'maplibre-gl';

export function initializeImmersion(map: Map, body = document.body) {
  const toggle = document.getElementById('immersion-toggle') as HTMLButtonElement;
  const exit = document.getElementById('immersion-exit') as HTMLButtonElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let drifting = false;
  let driftTimer: ReturnType<typeof setTimeout> | undefined;

  const engage = () => body.classList.add('engaged');
  map.once('dragstart', engage);
  map.on('zoomstart', event => { if (event.originalEvent) engage(); });
  for (const name of ['zouave:timeline', 'zouave:timeline-clear']) window.addEventListener(name, engage);
  document.querySelectorAll('[data-intent],[data-scenario],#chat-form,#mic').forEach(el => el.addEventListener(el.id === 'chat-form' ? 'submit' : 'click', engage));

  // One long linear ease: any map gesture interrupts it natively, and moveend (camera sync) only fires once.
  const stopDrift = () => { if (drifting) map.stop(); drifting = false; };
  const drift = () => {
    if (reducedMotion.matches || body.classList.contains('view-google')) return;
    drifting = true;
    map.easeTo({ bearing: map.getBearing() + 360, duration: 480_000, easing: t => t });
    map.once('moveend', () => { drifting = false; });
  };

  function set(hidden: boolean) {
    body.classList.toggle('ui-hidden', hidden);
    toggle.setAttribute('aria-pressed', String(hidden));
    stopDrift();
    // Start drifting once the panels have faded, so the camera never competes with the fade for frames.
    clearTimeout(driftTimer);
    if (hidden) { engage(); driftTimer = setTimeout(drift, 700); exit.focus({ preventScroll: true }); }
    else toggle.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => set(true));
  exit.addEventListener('click', () => set(false));
  window.addEventListener('keydown', event => {
    if ((event.target as HTMLElement)?.matches('input,textarea,[contenteditable]') || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || document.getElementById('hood')?.hidden === false) return;
    const hidden = body.classList.contains('ui-hidden');
    if (event.key.toLowerCase() === 'h' || (event.key === 'Escape' && hidden)) { event.preventDefault(); set(!hidden); }
  });
}
