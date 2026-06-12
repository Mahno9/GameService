/**
 * Lightweight UI click-sound module for meta controls.
 * Call initUiSound(url) once after settings load.
 * Call playClick() on any interactive meta element.
 * Call setUiMuted(bool) to sync with global mute state.
 */

let audio: HTMLAudioElement | null = null;
let muted = false;

/** Initialise (or replace) the click sound from a server URL. Pass null to disable. */
export function initUiSound(url: string | null): void {
  if (!url) {
    audio = null;
    return;
  }
  audio = new Audio(url);
  audio.preload = 'auto';
}

/** Sync muted state with localState.prefs.muted. */
export function setUiMuted(value: boolean): void {
  muted = value;
}

/** Play the click sound once (no-op when muted or no URL configured). */
export function playClick(): void {
  if (muted || !audio) return;
  // Clone the node so overlapping clicks don't cancel each other.
  const clone = audio.cloneNode() as HTMLAudioElement;
  clone.play().catch(() => {
    // Autoplay policy or missing file — ignore silently.
  });
}
