import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import {
  createPoi,
  listPois,
  getPoi,
  getPoiConfig,
  updatePoi,
  deletePoi,
} from './pois.js';

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations'));
  return db;
}

describe('pois repo', () => {
  it('creates a POI and lists it', () => {
    const db = freshDb();
    const poi = createPoi(db, {
      name: 'Alpha',
      lat: 55.0,
      lon: 37.0,
      minigameId: 'puzzle',
    });
    expect(poi.id).toBeTruthy();
    expect(poi.name).toBe('Alpha');
    expect(poi.blockerIds).toEqual([]);
    expect(poi.replayable).toBe(false);

    const list = listPois(db);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(poi.id);
  });

  it('creates a POI with blockers and lists them', () => {
    const db = freshDb();
    const a = createPoi(db, { name: 'A', lat: 1, lon: 1, minigameId: 'game1' });
    const b = createPoi(db, { name: 'B', lat: 2, lon: 2, minigameId: 'game2' });
    const c = createPoi(db, {
      name: 'C',
      lat: 3,
      lon: 3,
      minigameId: 'game3',
      blockerIds: [a.id, b.id],
    });

    const list = listPois(db);
    const cDto = list.find((p) => p.id === c.id);
    expect(cDto).toBeDefined();
    expect(cDto!.blockerIds.sort()).toEqual([a.id, b.id].sort());
  });

  it('getPoi returns correct blockerIds', () => {
    const db = freshDb();
    const a = createPoi(db, { name: 'A', lat: 1, lon: 1, minigameId: 'g' });
    const b = createPoi(db, { name: 'B', lat: 2, lon: 2, minigameId: 'g', blockerIds: [a.id] });

    const dto = getPoi(db, b.id);
    expect(dto).not.toBeNull();
    expect(dto!.blockerIds).toEqual([a.id]);
  });

  it('getPoiConfig returns parsed config_json', () => {
    const db = freshDb();
    const poi = createPoi(db, {
      name: 'X',
      lat: 0,
      lon: 0,
      minigameId: 'runner',
      configJson: { speed: 10, lives: 3 },
    });

    const cfg = getPoiConfig(db, poi.id);
    expect(cfg).not.toBeNull();
    expect(cfg!.minigameId).toBe('runner');
    expect(cfg!.config).toEqual({ speed: 10, lives: 3 });
  });

  it('getPoiConfig returns null for unknown id', () => {
    const db = freshDb();
    expect(getPoiConfig(db, 'nonexistent')).toBeNull();
  });

  it('update replaces blockerIds', () => {
    const db = freshDb();
    const a = createPoi(db, { name: 'A', lat: 1, lon: 1, minigameId: 'g' });
    const b = createPoi(db, { name: 'B', lat: 2, lon: 2, minigameId: 'g' });
    const c = createPoi(db, {
      name: 'C',
      lat: 3,
      lon: 3,
      minigameId: 'g',
      blockerIds: [a.id],
    });

    const updated = updatePoi(db, c.id, { blockerIds: [b.id] });
    expect(updated).not.toBeNull();
    expect(updated!.blockerIds).toEqual([b.id]);

    // Old blocker dependency is gone
    const fetched = getPoi(db, c.id);
    expect(fetched!.blockerIds).toEqual([b.id]);
  });

  it('update with empty blockerIds removes all blockers', () => {
    const db = freshDb();
    const a = createPoi(db, { name: 'A', lat: 1, lon: 1, minigameId: 'g' });
    const b = createPoi(db, {
      name: 'B',
      lat: 2,
      lon: 2,
      minigameId: 'g',
      blockerIds: [a.id],
    });

    const updated = updatePoi(db, b.id, { blockerIds: [] });
    expect(updated!.blockerIds).toEqual([]);
  });

  it('rejects self-reference on create', () => {
    // Self-reference can't happen on create because id is nanoid-generated and unknown
    // But we test that the validation logic works for update
    const db = freshDb();
    const a = createPoi(db, { name: 'A', lat: 1, lon: 1, minigameId: 'g' });
    expect(() => updatePoi(db, a.id, { blockerIds: [a.id] })).toThrow(/cannot block itself/);
  });

  it('rejects non-existent blocker on create', () => {
    const db = freshDb();
    expect(() =>
      createPoi(db, { name: 'A', lat: 1, lon: 1, minigameId: 'g', blockerIds: ['ghost'] }),
    ).toThrow(/not found/);
  });

  it('rejects non-existent blocker on update', () => {
    const db = freshDb();
    const a = createPoi(db, { name: 'A', lat: 1, lon: 1, minigameId: 'g' });
    expect(() => updatePoi(db, a.id, { blockerIds: ['nonexistent'] })).toThrow(/not found/);
  });

  it('delete removes POI and cascades dependencies', () => {
    const db = freshDb();
    const a = createPoi(db, { name: 'A', lat: 1, lon: 1, minigameId: 'g' });
    const b = createPoi(db, {
      name: 'B',
      lat: 2,
      lon: 2,
      minigameId: 'g',
      blockerIds: [a.id],
    });

    // Verify the dependency exists
    expect(getPoi(db, b.id)!.blockerIds).toEqual([a.id]);

    // Delete the blocker (A)
    expect(deletePoi(db, a.id)).toBe(true);
    expect(getPoi(db, a.id)).toBeNull();

    // B's dependency on A should be gone (CASCADE)
    const bDto = getPoi(db, b.id);
    expect(bDto).not.toBeNull();
    expect(bDto!.blockerIds).toEqual([]);
  });

  it('delete returns false for unknown id', () => {
    const db = freshDb();
    expect(deletePoi(db, 'does-not-exist')).toBe(false);
  });

  it('update returns null for unknown id', () => {
    const db = freshDb();
    expect(updatePoi(db, 'ghost', { name: 'X' })).toBeNull();
  });
});
