import { api, type Minigame } from '../api';

export interface MinigameResult {
  score: number;
  won: boolean;
}

interface LaunchOptions {
  poiId: string;
  muted: boolean;
  /** Receives the result, or null when the player exited early / on error. */
  onFinished: (result: MinigameResult | null) => void;
}

interface MinigameModule {
  init: (
    container: HTMLElement,
    config: Record<string, unknown>,
    callbacks: {
      onComplete: (result: MinigameResult) => void;
      onExit: () => void;
    },
  ) => { destroy: () => void };
}

const FADE_MS = 300;

let minigamesCache: Minigame[] | null = null;

async function getMinigames(): Promise<Minigame[]> {
  if (minigamesCache) return minigamesCache;
  const list = await api.getMinigames();
  minigamesCache = list;
  return list;
}

/**
 * Loads and runs the minigame attached to a POI inside a fullscreen overlay.
 * Handles fade transitions, a once-latch over onComplete/onExit, and cleanup.
 * Always resolves onFinished exactly once (null on exit or error).
 */
export async function launchMinigame(opts: LaunchOptions): Promise<void> {
  const { poiId, muted, onFinished } = opts;

  let overlay: HTMLDivElement | null = null;
  let handle: { destroy: () => void } | null = null;
  let settled = false;

  function cleanupAndFinish(result: MinigameResult | null): void {
    if (settled) {
      console.warn('[minigameLoader] callback fired twice, ignoring');
      return;
    }
    settled = true;
    const ov = overlay;
    if (ov) {
      ov.classList.remove('minigame-overlay-visible');
    }
    window.setTimeout(() => {
      try {
        handle?.destroy();
      } catch (err) {
        console.error('[minigameLoader] destroy failed', err);
      }
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
      onFinished(result);
    }, FADE_MS);
  }

  try {
    const [poiConfig, minigames] = await Promise.all([
      api.getPoiConfig(poiId),
      getMinigames(),
    ]);
    const meta = minigames.find((m) => m.id === poiConfig.minigameId);
    if (!meta) {
      throw new Error(`Unknown minigame: ${poiConfig.minigameId}`);
    }

    overlay = document.createElement('div');
    overlay.className = 'minigame-overlay';
    document.body.appendChild(overlay);
    // Force a frame before adding the visible class so the fade-in animates.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay?.classList.add('minigame-overlay-visible');
      });
    });

    const mod = (await import(/* @vite-ignore */ meta.entryUrl)) as MinigameModule;

    const config: Record<string, unknown> = { ...poiConfig.config, muted };

    handle = mod.init(overlay, config, {
      onComplete: (result) => cleanupAndFinish(result),
      onExit: () => cleanupAndFinish(null),
    });
  } catch (err) {
    console.error('[minigameLoader] failed to launch minigame', err);
    settled = true;
    try {
      handle?.destroy();
    } catch (destroyErr) {
      console.error('[minigameLoader] destroy failed', destroyErr);
    }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    onFinished(null);
  }
}
