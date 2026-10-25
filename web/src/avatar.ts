let stopTimer: ReturnType<typeof setTimeout> | undefined;

export function setSpeaking(speaking: boolean) {
  clearTimeout(stopTimer);
  document.getElementById('avatar-ring')!.classList.toggle('speaking', speaking);
  if (speaking) stopTimer = setTimeout(() => setSpeaking(false), 12_000);
}

export function animateAnswer(text: string) {
  setSpeaking(Boolean(text.trim()));
  if (text.trim()) {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => setSpeaking(false), Math.min(6000, Math.max(1800, text.length * 35)));
  }
}

/** The mascot artwork in use (?avatar=stone|bronze-flood, living-stone by default). */
export function avatarVariant() {
  const requested = new URLSearchParams(location.search).get('avatar');
  return requested === 'stone' || requested === 'bronze-flood' ? requested : 'living-stone';
}

export function initializeAvatar() {
  const variant = avatarVariant();
  const closed = document.getElementById('avatar') as HTMLImageElement;
  closed.src = `/zouave/${variant}/avatar@2x.webp`;
  const open = new Image();
  open.className = 'avatar-mouth';
  open.alt = '';
  open.setAttribute('aria-hidden', 'true');
  open.src = `/zouave/${variant}/avatar-speaking@2x.webp`;
  closed.after(open);
  window.addEventListener('pagehide', () => setSpeaking(false));
}
