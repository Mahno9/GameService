export interface PoiResult {
  bestScore: number;
  won: boolean;
  attempts: number;
  firstCompletedAt: number;
  rewardGranted: boolean;
}

export interface ClientState {
  version: 1;
  updatedAt: number;
  profile: { userId: string; name: string; avatarEmoji: string };
  poiResults: Record<string, PoiResult>;
  prefs: { lang: string; muted: boolean };
}

const STORAGE_KEY = 'gs_state';

function createInitialState(): ClientState {
  return {
    version: 1,
    updatedAt: 0,
    profile: { userId: '', name: '', avatarEmoji: '' },
    poiResults: {},
    prefs: { lang: 'ru', muted: false },
  };
}

function isClientState(value: unknown): value is ClientState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.updatedAt === 'number' &&
    typeof v.profile === 'object' &&
    v.profile !== null &&
    typeof v.poiResults === 'object' &&
    v.poiResults !== null &&
    typeof v.prefs === 'object' &&
    v.prefs !== null
  );
}

/**
 * Client-side state store backed by localStorage. Exposes a
 * useSyncExternalStore-friendly subscribe/getSnapshot pair: the snapshot
 * reference only changes when the state actually changes, so React can bail
 * out of re-renders safely.
 */
class LocalStateStore {
  private state: ClientState;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.state = this.read();
  }

  private read(): ClientState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isClientState(parsed)) return parsed;
      }
    } catch {
      // Corrupt/unavailable storage — fall through to fresh state.
    }
    return createInitialState();
  }

  /** Persist the current snapshot to localStorage. */
  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage full or unavailable — tolerate silently.
    }
  }

  /** Re-read from localStorage (used at startup; usually unnecessary). */
  load(): void {
    this.state = this.read();
    this.emit();
  }

  // -- useSyncExternalStore contract --
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ClientState => this.state;

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Replace the entire state (e.g. after a server-newer sync). Saves + emits. */
  replace(next: ClientState): void {
    this.state = next;
    this.save();
    this.emit();
  }

  private commit(next: ClientState): void {
    this.state = next;
    this.save();
    this.emit();
  }

  // -- mutate helpers --

  /**
   * Records a game result for a POI. bestScore = max(prev, score); `won` tracks
   * the best-scoring attempt (only flips when this attempt strictly beats the
   * previous best); attempts increments; firstCompletedAt set once.
   */
  recordGameResult(poiId: string, score: number, won: boolean): void {
    const now = Date.now();
    const prev = this.state.poiResults[poiId];
    let next: PoiResult;
    if (prev) {
      const improved = score > prev.bestScore;
      next = {
        bestScore: Math.max(prev.bestScore, score),
        won: improved ? won : prev.won,
        attempts: prev.attempts + 1,
        firstCompletedAt: prev.firstCompletedAt,
        rewardGranted: prev.rewardGranted,
      };
    } else {
      next = {
        bestScore: score,
        won,
        attempts: 1,
        firstCompletedAt: now,
        rewardGranted: false,
      };
    }
    this.commit({
      ...this.state,
      updatedAt: now,
      poiResults: { ...this.state.poiResults, [poiId]: next },
    });
  }

  /** Marks a POI's reward as granted (issued exactly once). */
  markRewardGranted(poiId: string): void {
    const prev = this.state.poiResults[poiId];
    if (!prev || prev.rewardGranted) return;
    this.commit({
      ...this.state,
      updatedAt: Date.now(),
      poiResults: {
        ...this.state.poiResults,
        [poiId]: { ...prev, rewardGranted: true },
      },
    });
  }

  setProfile(profile: { userId: string; name: string; avatarEmoji: string }): void {
    this.commit({
      ...this.state,
      updatedAt: Date.now(),
      profile: { ...profile },
    });
  }

  setMuted(muted: boolean): void {
    if (this.state.prefs.muted === muted) return;
    this.commit({
      ...this.state,
      updatedAt: Date.now(),
      prefs: { ...this.state.prefs, muted },
    });
  }
}

export const localState = new LocalStateStore();
