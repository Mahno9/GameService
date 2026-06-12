import type { Database } from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Client state payload types
// ---------------------------------------------------------------------------

export interface PoiResult {
  bestScore: number;
  won: boolean;
  attempts: number;
  firstCompletedAt: number;
  rewardGranted: boolean;
}

export interface ClientStatePayload {
  version: number;
  updatedAt: number;
  profile: {
    userId: string;
    name: string;
    avatarEmoji: string;
  };
  poiResults: Record<string, PoiResult>;
  prefs: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// resolveSync — pure function, no DB side-effects
// ---------------------------------------------------------------------------

export type SyncOutcome = 'accepted' | 'server-newer' | 'merged';

export interface ServerRow {
  payload: ClientStatePayload;
  clientUpdatedAt: number;
}

export interface ResolveResult {
  outcome: SyncOutcome;
  merged: ClientStatePayload;
}

/**
 * Merge poiResults from `other` into `base` using LWW max-merge rules:
 *   - bestScore = max
 *   - attempts = max
 *   - rewardGranted = OR
 *   - won = kept from whichever has the higher bestScore (base wins ties)
 *   - firstCompletedAt = min (earliest)
 *
 * Returns { merged, changed } where `changed` is true if anything in base was
 * actually altered by the merge.
 */
function mergePoiResults(
  base: Record<string, PoiResult>,
  other: Record<string, PoiResult>,
): { merged: Record<string, PoiResult>; changed: boolean } {
  let changed = false;
  const merged: Record<string, PoiResult> = { ...base };

  for (const [poiId, otherResult] of Object.entries(other)) {
    const baseResult = merged[poiId];
    if (!baseResult) {
      // New entry in other that base doesn't have
      merged[poiId] = { ...otherResult };
      changed = true;
      continue;
    }

    const newBestScore = Math.max(baseResult.bestScore, otherResult.bestScore);
    const newAttempts = Math.max(baseResult.attempts, otherResult.attempts);
    const newRewardGranted = baseResult.rewardGranted || otherResult.rewardGranted;
    const newWon =
      otherResult.bestScore > baseResult.bestScore ? otherResult.won : baseResult.won;
    const newFirstCompletedAt = Math.min(
      baseResult.firstCompletedAt,
      otherResult.firstCompletedAt,
    );

    if (
      newBestScore !== baseResult.bestScore ||
      newAttempts !== baseResult.attempts ||
      newRewardGranted !== baseResult.rewardGranted ||
      newWon !== baseResult.won ||
      newFirstCompletedAt !== baseResult.firstCompletedAt
    ) {
      changed = true;
    }

    merged[poiId] = {
      bestScore: newBestScore,
      won: newWon,
      attempts: newAttempts,
      firstCompletedAt: newFirstCompletedAt,
      rewardGranted: newRewardGranted,
    };
  }

  return { merged, changed };
}

export function resolveSync(
  serverRow: ServerRow | null,
  incoming: { state: ClientStatePayload; updatedAt: number },
): ResolveResult {
  // No server row → accept incoming as-is
  if (serverRow === null) {
    return { outcome: 'accepted', merged: incoming.state };
  }

  if (incoming.updatedAt > serverRow.clientUpdatedAt) {
    // Incoming is newer — start from incoming, but max-merge server's poiResults in
    const { merged: mergedPoiResults, changed } = mergePoiResults(
      incoming.state.poiResults,
      serverRow.payload.poiResults,
    );
    const mergedPayload: ClientStatePayload = {
      ...incoming.state,
      poiResults: mergedPoiResults,
    };
    return {
      outcome: changed ? 'merged' : 'accepted',
      merged: mergedPayload,
    };
  } else {
    // Server is newer or equal — start from server payload, but max-merge incoming's poiResults in
    const { merged: mergedPoiResults, changed } = mergePoiResults(
      serverRow.payload.poiResults,
      incoming.state.poiResults,
    );
    const mergedPayload: ClientStatePayload = {
      ...serverRow.payload,
      poiResults: mergedPoiResults,
    };
    return {
      outcome: 'server-newer',
      merged: mergedPayload,
    };
  }
}

// ---------------------------------------------------------------------------
// DB helpers for session & sync
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  name: string;
  avatar_emoji: string;
  is_debug: number;
  total_score: number;
  completed_all: number;
  created_at: number;
  updated_at: number;
}

export interface GameStateRow {
  user_id: string;
  payload: string;
  client_updated_at: number;
  synced_at: number;
}

export function findUserByName(db: Database, name: string): UserRow | null {
  return (
    (db
      .prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE')
      .get(name) as UserRow | undefined) ?? null
  );
}

export function findUserById(db: Database, id: string): UserRow | null {
  return (
    (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null
  );
}

export function getGameState(db: Database, userId: string): GameStateRow | null {
  return (
    (db
      .prepare('SELECT * FROM game_states WHERE user_id = ?')
      .get(userId) as GameStateRow | undefined) ?? null
  );
}

export function upsertGameState(
  db: Database,
  userId: string,
  payload: ClientStatePayload,
  clientUpdatedAt: number,
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO game_states (user_id, payload, client_updated_at, synced_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       payload = excluded.payload,
       client_updated_at = excluded.client_updated_at,
       synced_at = excluded.synced_at`,
  ).run(userId, JSON.stringify(payload), clientUpdatedAt, now);
}

/**
 * Delete a debug user row (and all game_states via FK cascade).
 * Returns true when deleted, false when the user was not found or is not debug.
 */
export function deleteDebugUser(db: Database, userId: string): 'deleted' | 'not_found' | 'not_debug' {
  const user = findUserById(db, userId);
  if (!user) return 'not_found';
  if (user.is_debug === 0) return 'not_debug';
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return 'deleted';
}

export function updateUserStats(db: Database, userId: string, payload: ClientStatePayload): void {
  const now = Date.now();

  // Compute total_score = sum of bestScore across all poiResults
  const totalScore = Object.values(payload.poiResults).reduce(
    (sum, r) => sum + r.bestScore,
    0,
  );

  // Compute completed_all: every poi id in the pois table must appear in poiResults
  const allPoiIds = (
    db.prepare('SELECT id FROM pois').all() as { id: string }[]
  ).map((r) => r.id);

  const completedAll =
    allPoiIds.length > 0 && allPoiIds.every((id) => id in payload.poiResults) ? 1 : 0;

  db.prepare(
    `UPDATE users SET total_score = ?, completed_all = ?, updated_at = ? WHERE id = ?`,
  ).run(totalScore, completedAll, now, userId);
}
