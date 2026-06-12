import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import { deleteDebugUser, findUserById } from './sync.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

function insertUser(
  db: Database.Database,
  opts: { id: string; name: string; isDebug: boolean },
) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, name, avatar_emoji, is_debug, total_score, completed_all, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
  ).run(opts.id, opts.name, '😀', opts.isDebug ? 1 : 0, now, now);
}

function insertGameState(db: Database.Database, userId: string) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO game_states (user_id, payload, client_updated_at, synced_at)
     VALUES (?, ?, ?, ?)`,
  ).run(userId, JSON.stringify({ version: 1, updatedAt: now }), now, now);
}

describe('deleteDebugUser', () => {
  it('returns not_found for unknown userId', () => {
    const db = freshDb();
    expect(deleteDebugUser(db, 'ghost')).toBe('not_found');
  });

  it('returns not_debug for a real (non-debug) user', () => {
    const db = freshDb();
    insertUser(db, { id: 'u1', name: 'Real', isDebug: false });
    expect(deleteDebugUser(db, 'u1')).toBe('not_debug');
    // User must still exist
    expect(findUserById(db, 'u1')).not.toBeNull();
  });

  it('deletes a debug user and returns deleted', () => {
    const db = freshDb();
    insertUser(db, { id: 'dbg1', name: 'Tester', isDebug: true });
    expect(deleteDebugUser(db, 'dbg1')).toBe('deleted');
    expect(findUserById(db, 'dbg1')).toBeNull();
  });

  it('cascades to game_states on delete', () => {
    const db = freshDb();
    insertUser(db, { id: 'dbg2', name: 'Tester2', isDebug: true });
    insertGameState(db, 'dbg2');

    // Confirm game_state exists before delete
    const before = db.prepare('SELECT * FROM game_states WHERE user_id = ?').get('dbg2');
    expect(before).toBeDefined();

    deleteDebugUser(db, 'dbg2');

    const after = db.prepare('SELECT * FROM game_states WHERE user_id = ?').get('dbg2');
    expect(after).toBeUndefined();
  });
});
