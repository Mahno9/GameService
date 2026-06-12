import type { Database } from 'better-sqlite3';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface LeaderboardEntryRow {
  id: string;
  name: string;
  avatar_emoji: string;
  score: number;
  sort_hint: number;
}

interface UserRow {
  id: string;
  name: string;
  avatar_emoji: string;
  is_debug: number;
  total_score: number;
  completed_all: number;
}

// ---------------------------------------------------------------------------
// DTO types
// ---------------------------------------------------------------------------

export interface LeaderboardEntryDto {
  id: string;
  name: string;
  avatarEmoji: string;
  score: number;
  sortHint: number;
}

export interface LeaderboardRowDto {
  name: string;
  avatarEmoji: string;
  score: number;
  isPlayer: boolean;
  isReal: boolean;
}

export interface RealUserDto {
  id: string;
  name: string;
  avatarEmoji: string;
  totalScore: number;
  isDebug: boolean;
  completedAll: boolean;
}

export interface CreateEntryInput {
  name: string;
  avatarEmoji: string;
  score: number;
  sortHint?: number;
}

export interface UpdateEntryInput {
  name?: string;
  avatarEmoji?: string;
  score?: number;
  sortHint?: number;
}

// ---------------------------------------------------------------------------
// Fictional entries CRUD
// ---------------------------------------------------------------------------

export function listEntries(db: Database): LeaderboardEntryDto[] {
  const rows = db
    .prepare('SELECT * FROM leaderboard_entries ORDER BY score DESC, name')
    .all() as LeaderboardEntryRow[];
  return rows.map(rowToDto);
}

export function createEntry(db: Database, input: CreateEntryInput): LeaderboardEntryDto {
  const id = nanoid(10);
  db.prepare(
    `INSERT INTO leaderboard_entries (id, name, avatar_emoji, score, sort_hint)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.avatarEmoji, input.score, input.sortHint ?? 0);
  return rowToDto(
    db.prepare('SELECT * FROM leaderboard_entries WHERE id = ?').get(id) as LeaderboardEntryRow,
  );
}

export function updateEntry(
  db: Database,
  id: string,
  input: UpdateEntryInput,
): LeaderboardEntryDto | null {
  const existing = db
    .prepare('SELECT * FROM leaderboard_entries WHERE id = ?')
    .get(id) as LeaderboardEntryRow | undefined;
  if (!existing) return null;

  db.prepare(
    `UPDATE leaderboard_entries SET
       name       = COALESCE(?, name),
       avatar_emoji = COALESCE(?, avatar_emoji),
       score      = COALESCE(?, score),
       sort_hint  = COALESCE(?, sort_hint)
     WHERE id = ?`,
  ).run(
    input.name ?? null,
    input.avatarEmoji ?? null,
    input.score ?? null,
    input.sortHint ?? null,
    id,
  );

  return rowToDto(
    db
      .prepare('SELECT * FROM leaderboard_entries WHERE id = ?')
      .get(id) as LeaderboardEntryRow,
  );
}

export function deleteEntry(db: Database, id: string): boolean {
  const result = db.prepare('DELETE FROM leaderboard_entries WHERE id = ?').run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Real users
// ---------------------------------------------------------------------------

export function listRealUsers(db: Database): RealUserDto[] {
  const rows = db
    .prepare('SELECT * FROM users ORDER BY total_score DESC, name')
    .all() as UserRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    avatarEmoji: r.avatar_emoji,
    totalScore: r.total_score,
    isDebug: r.is_debug !== 0,
    completedAll: r.completed_all !== 0,
  }));
}

export function deleteRealUser(db: Database, userId: string): boolean {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Merged public leaderboard
// ---------------------------------------------------------------------------

export function getMergedLeaderboard(db: Database, userId?: string): LeaderboardRowDto[] {
  // Fictional entries (all of them, regardless of score)
  const fictionalRows = db
    .prepare('SELECT * FROM leaderboard_entries ORDER BY score DESC, name')
    .all() as LeaderboardEntryRow[];

  // Real users: total_score > 0, exclude debug users EXCEPT the requesting user
  const realRows = db
    .prepare(
      `SELECT * FROM users
       WHERE total_score > 0
         AND (is_debug = 0 OR id = ?)
       ORDER BY total_score DESC, name`,
    )
    .all(userId ?? null) as UserRow[];

  // Also always include the requesting user if they exist (even with score 0)
  // and they aren't already in realRows
  if (userId !== undefined) {
    const alreadyIncluded = realRows.some((r) => r.id === userId);
    if (!alreadyIncluded) {
      const requesting = db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(userId) as UserRow | undefined;
      if (requesting !== undefined) {
        realRows.push(requesting);
      }
    }
  }

  const rows: LeaderboardRowDto[] = [];

  // Add fictional entries
  for (const f of fictionalRows) {
    rows.push({
      name: f.name,
      avatarEmoji: f.avatar_emoji,
      score: f.score,
      isPlayer: false,
      isReal: false,
    });
  }

  // Add real users
  for (const u of realRows) {
    rows.push({
      name: u.name,
      avatarEmoji: u.avatar_emoji,
      score: u.total_score,
      isPlayer: u.id === userId,
      isReal: true,
    });
  }

  // Sort: score desc; ties: fictional first (stable — fictionals were added first),
  // then by name for determinism among same-kind same-score entries.
  // We use a stable sort preserving insertion order for equal-score entries of different kinds
  // by sorting only on score (descending). Ties are broken by isReal=false first, then name.
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie: fictional first (isReal=false < isReal=true)
    if (a.isReal !== b.isReal) return a.isReal ? 1 : -1;
    // Same kind + same score: sort by name
    return a.name.localeCompare(b.name);
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToDto(row: LeaderboardEntryRow): LeaderboardEntryDto {
  return {
    id: row.id,
    name: row.name,
    avatarEmoji: row.avatar_emoji,
    score: row.score,
    sortHint: row.sort_hint,
  };
}
