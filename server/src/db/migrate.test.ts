import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from './migrate.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

describe('migrate', () => {
  it('applies all migrations to a fresh db', () => {
    const db = new Database(':memory:');
    const ran = migrate(db, migrationsDir);
    expect(ran).toContain('0001_core.sql');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining(['users', 'game_states', 'settings', 'schema_migrations']),
    );

    const radius = db
      .prepare("SELECT value_json FROM settings WHERE key = 'trigger_radius_m'")
      .get() as { value_json: string };
    expect(JSON.parse(radius.value_json)).toBe(25);
  });

  it('is idempotent on re-run', () => {
    const db = new Database(':memory:');
    migrate(db, migrationsDir);
    const second = migrate(db, migrationsDir);
    expect(second).toEqual([]);
  });
});
