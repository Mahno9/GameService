import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import { getAllSettings, updateSettings } from './settings.js';

function freshDb() {
  const db = new Database(':memory:');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

describe('settings repo', () => {
  it('returns seeded defaults', () => {
    const s = getAllSettings(freshDb());
    expect(s.trigger_radius_m).toBe(25);
    expect(s.debug_mode).toBe(false);
    expect(s.map_bbox).toBeNull();
  });

  it('applies a partial update', () => {
    const db = freshDb();
    const s = updateSettings(db, { debug_mode: true, trigger_radius_m: 40 });
    expect(s.debug_mode).toBe(true);
    expect(s.trigger_radius_m).toBe(40);
    expect(s.sync_interval_s).toBe(30);
  });

  it('rejects unknown keys atomically', () => {
    const db = freshDb();
    expect(() => updateSettings(db, { debug_mode: true, nope: 1 })).toThrow(/unknown setting/);
    expect(getAllSettings(db).debug_mode).toBe(false);
  });
});
