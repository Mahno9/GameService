import { api, type ServerState } from '../api';
import { localState, type ClientState } from './localState';

/** True if a server payload is a usable ClientState we should adopt. */
function isAdoptableState(value: unknown): value is ClientState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.updatedAt === 'number';
}

/**
 * Pushes the current local state to the server once. On a 'server-newer' or
 * 'merged' outcome the server's payload wins — adopt and persist it locally.
 * Network/server errors are swallowed for offline tolerance.
 */
export async function syncNow(): Promise<void> {
  const state = localState.getSnapshot();
  if (!state.profile.userId) return;
  try {
    const res = await api.postSync({ userId: state.profile.userId, state });
    if (res.outcome === 'server-newer' || res.outcome === 'merged') {
      const incoming: ServerState = res.state;
      if (isAdoptableState(incoming)) {
        localState.replace(incoming);
      }
    }
  } catch {
    // Offline / server down — try again on the next interval.
  }
}

/**
 * Starts periodic background sync. Returns a stop function. Does not sync
 * immediately — callers fire syncNow() explicitly on session start.
 */
export function startSync(intervalSeconds: number): () => void {
  const ms = Math.max(1, intervalSeconds) * 1000;
  const timer = setInterval(() => {
    void syncNow();
  }, ms);
  return () => clearInterval(timer);
}
