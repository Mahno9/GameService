import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import {
  createEntry,
  deleteEntry,
  getMergedLeaderboard,
  listEntries,
  updateEntry,
} from './leaderboard.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

/** Insert a user row directly via SQL (bypasses session route logic). */
function insertUser(
  db: Database.Database,
  opts: {
    id: string;
    name: string;
    avatarEmoji: string;
    totalScore?: number;
    isDebug?: boolean;
    completedAll?: boolean;
  },
) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, name, avatar_emoji, is_debug, total_score, completed_all, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.name,
    opts.avatarEmoji,
    opts.isDebug ? 1 : 0,
    opts.totalScore ?? 0,
    opts.completedAll ? 1 : 0,
    now,
    now,
  );
}

// ---------------------------------------------------------------------------
// Fictional entry CRUD
// ---------------------------------------------------------------------------

describe('leaderboard entries CRUD', () => {
  it('creates and lists fictional entries', () => {
    const db = freshDb();
    const entry = createEntry(db, { name: 'Alice', avatarEmoji: '🦊', score: 500 });
    expect(entry.id).toBeTruthy();
    expect(entry.name).toBe('Alice');
    expect(entry.score).toBe(500);
    expect(entry.sortHint).toBe(0);

    const list = listEntries(db);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(entry.id);
  });

  it('updates a fictional entry partially', () => {
    const db = freshDb();
    const entry = createEntry(db, { name: 'Bob', avatarEmoji: '🐶', score: 200 });
    const updated = updateEntry(db, entry.id, { score: 350, name: 'Bobby' });
    expect(updated).not.toBeNull();
    expect(updated!.score).toBe(350);
    expect(updated!.name).toBe('Bobby');
    expect(updated!.avatarEmoji).toBe('🐶'); // unchanged
  });

  it('returns null when updating unknown entry', () => {
    const db = freshDb();
    expect(updateEntry(db, 'nonexistent', { score: 100 })).toBeNull();
  });

  it('deletes a fictional entry', () => {
    const db = freshDb();
    const entry = createEntry(db, { name: 'Charlie', avatarEmoji: '🐱', score: 100 });
    expect(deleteEntry(db, entry.id)).toBe(true);
    expect(listEntries(db)).toHaveLength(0);
  });

  it('returns false when deleting unknown entry', () => {
    const db = freshDb();
    expect(deleteEntry(db, 'ghost')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Merged leaderboard
// ---------------------------------------------------------------------------

describe('getMergedLeaderboard', () => {
  it('returns empty list when nothing exists', () => {
    const db = freshDb();
    expect(getMergedLeaderboard(db)).toEqual([]);
  });

  it('interleaves fictional and real by score desc', () => {
    const db = freshDb();
    createEntry(db, { name: 'F-300', avatarEmoji: '🦁', score: 300 });
    createEntry(db, { name: 'F-100', avatarEmoji: '🐯', score: 100 });
    insertUser(db, { id: 'u1', name: 'Real-200', avatarEmoji: '😀', totalScore: 200 });

    const board = getMergedLeaderboard(db);
    expect(board.map((r) => r.score)).toEqual([300, 200, 100]);
    expect(board[0]?.isReal).toBe(false);
    expect(board[1]?.isReal).toBe(true);
    expect(board[2]?.isReal).toBe(false);
  });

  it('places fictional before real on score tie', () => {
    const db = freshDb();
    createEntry(db, { name: 'FicTied', avatarEmoji: '🦊', score: 200 });
    insertUser(db, { id: 'u1', name: 'RealTied', avatarEmoji: '😎', totalScore: 200 });

    const board = getMergedLeaderboard(db);
    expect(board).toHaveLength(2);
    expect(board[0]?.isReal).toBe(false); // fictional first on tie
    expect(board[1]?.isReal).toBe(true);
  });

  it('excludes debug users from public leaderboard', () => {
    const db = freshDb();
    insertUser(db, { id: 'debug1', name: 'Debugger', avatarEmoji: '🔧', totalScore: 999, isDebug: true });
    insertUser(db, { id: 'real1', name: 'Normal', avatarEmoji: '😀', totalScore: 50 });

    const board = getMergedLeaderboard(db);
    const names = board.map((r) => r.name);
    expect(names).not.toContain('Debugger');
    expect(names).toContain('Normal');
  });

  it('includes debug user when they are the requesting user', () => {
    const db = freshDb();
    insertUser(db, { id: 'debug1', name: 'Debugger', avatarEmoji: '🔧', totalScore: 999, isDebug: true });

    const board = getMergedLeaderboard(db, 'debug1');
    const found = board.find((r) => r.name === 'Debugger');
    expect(found).toBeDefined();
    expect(found!.isPlayer).toBe(true);
  });

  it('marks requesting user row as isPlayer=true', () => {
    const db = freshDb();
    insertUser(db, { id: 'u1', name: 'Player', avatarEmoji: '🎮', totalScore: 150 });
    createEntry(db, { name: 'Fic', avatarEmoji: '🦁', score: 200 });

    const board = getMergedLeaderboard(db, 'u1');
    const playerRow = board.find((r) => r.isPlayer);
    expect(playerRow).toBeDefined();
    expect(playerRow!.name).toBe('Player');
    // Non-player rows must not be isPlayer
    const others = board.filter((r) => !r.isPlayer);
    expect(others.every((r) => !r.isPlayer)).toBe(true);
  });

  it('includes requesting user even with 0 score', () => {
    const db = freshDb();
    insertUser(db, { id: 'u1', name: 'NewPlayer', avatarEmoji: '🌱', totalScore: 0 });
    createEntry(db, { name: 'Fic', avatarEmoji: '🎯', score: 100 });

    const board = getMergedLeaderboard(db, 'u1');
    const playerRow = board.find((r) => r.isPlayer);
    expect(playerRow).toBeDefined();
    expect(playerRow!.score).toBe(0);
  });

  it('excludes real users with 0 score who are not the requesting user', () => {
    const db = freshDb();
    insertUser(db, { id: 'u1', name: 'ZeroScore', avatarEmoji: '😶', totalScore: 0 });

    // No userId provided (or different userId)
    const board = getMergedLeaderboard(db);
    expect(board.find((r) => r.name === 'ZeroScore')).toBeUndefined();
  });

  it('does not duplicate the requesting user when they have total_score > 0', () => {
    const db = freshDb();
    insertUser(db, { id: 'u1', name: 'Player', avatarEmoji: '🎮', totalScore: 100 });

    const board = getMergedLeaderboard(db, 'u1');
    const playerRows = board.filter((r) => r.name === 'Player');
    expect(playerRows).toHaveLength(1);
  });
});
