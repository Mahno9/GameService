type WeightedAudio = { url: string; weight: number };

let pool: Array<{ audio: HTMLAudioElement; weight: number }> = [];
let muted = false;

function toList(val: string | WeightedAudio[] | null): WeightedAudio[] {
  if (!val) return [];
  if (typeof val === 'string') return val ? [{ url: val, weight: 1 }] : [];
  return val;
}

/** Initialise (or replace) the click-sound pool from a server value. Pass null to disable. */
export function initUiSound(val: string | WeightedAudio[] | null): void {
  pool = toList(val).map(({ url, weight }) => {
    const audio = new Audio(url);
    audio.preload = 'auto';
    return { audio, weight };
  });
}

/** Sync muted state with localState.prefs.muted. */
export function setUiMuted(value: boolean): void {
  muted = value;
}

/** Play one randomly-weighted click sound (no-op when muted or pool is empty). */
export function playClick(): void {
  if (muted || !pool.length) return;
  const total = pool.reduce((s, v) => s + v.weight, 0);
  let r = Math.random() * total;
  const item = pool.find((v) => (r -= v.weight) <= 0) ?? pool[pool.length - 1]!;
  const clone = item.audio.cloneNode() as HTMLAudioElement;
  clone.play().catch(() => {});
}
