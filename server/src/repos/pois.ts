import type { Database } from 'better-sqlite3';
import { nanoid } from 'nanoid';

// ---------------------------------------------------------------------------
// Row types (snake_case, as stored in SQLite)
// ---------------------------------------------------------------------------

interface PoiRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  minigame_id: string;
  config_json: string;
  replayable: number;
  reward_image_asset: string | null;
  reward_name_win: string;
  reward_name_lose: string;
  reward_description: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// DTO types (camelCase, exposed to callers)
// ---------------------------------------------------------------------------

export interface PoiReward {
  imageAsset: string | null;
  nameWin: string;
  nameLose: string;
  description: string;
}

export interface PoiDto {
  id: string;
  name: string;
  lat: number;
  lon: number;
  minigameId: string;
  replayable: boolean;
  blockerIds: string[];
  reward: PoiReward;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface PoiConfigDto {
  minigameId: string;
  config: unknown;
}

export interface CreatePoiInput {
  name: string;
  lat: number;
  lon: number;
  minigameId: string;
  replayable?: boolean;
  blockerIds?: string[];
  configJson?: unknown;
  rewardImageAsset?: string;
  rewardNameWin?: string;
  rewardNameLose?: string;
  rewardDescription?: string;
  sortOrder?: number;
}

export interface UpdatePoiInput {
  name?: string;
  lat?: number;
  lon?: number;
  minigameId?: string;
  replayable?: boolean;
  blockerIds?: string[];
  configJson?: unknown;
  rewardImageAsset?: string | null;
  rewardNameWin?: string;
  rewardNameLose?: string;
  rewardDescription?: string;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToDto(row: PoiRow, blockerIds: string[]): PoiDto {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    minigameId: row.minigame_id,
    replayable: row.replayable !== 0,
    blockerIds,
    reward: {
      imageAsset: row.reward_image_asset,
      nameWin: row.reward_name_win,
      nameLose: row.reward_name_lose,
      description: row.reward_description,
    },
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fetchBlockerIds(db: Database, poiId: string): string[] {
  const rows = db
    .prepare('SELECT blocker_id FROM poi_dependencies WHERE poi_id = ? ORDER BY blocker_id')
    .all(poiId) as { blocker_id: string }[];
  return rows.map((r) => r.blocker_id);
}

// ---------------------------------------------------------------------------
// Repo functions
// ---------------------------------------------------------------------------

export function listPois(db: Database): PoiDto[] {
  const rows = db
    .prepare('SELECT * FROM pois ORDER BY sort_order, created_at')
    .all() as PoiRow[];

  if (rows.length === 0) return [];

  // Fetch all dependencies in one query and group by poi_id
  const deps = db
    .prepare('SELECT poi_id, blocker_id FROM poi_dependencies ORDER BY poi_id, blocker_id')
    .all() as { poi_id: string; blocker_id: string }[];

  const depMap = new Map<string, string[]>();
  for (const dep of deps) {
    let arr = depMap.get(dep.poi_id);
    if (!arr) {
      arr = [];
      depMap.set(dep.poi_id, arr);
    }
    arr.push(dep.blocker_id);
  }

  return rows.map((row) => rowToDto(row, depMap.get(row.id) ?? []));
}

export function getPoi(db: Database, id: string): PoiDto | null {
  const row = db.prepare('SELECT * FROM pois WHERE id = ?').get(id) as PoiRow | undefined;
  if (!row) return null;
  return rowToDto(row, fetchBlockerIds(db, id));
}

export function getPoiConfig(db: Database, id: string): PoiConfigDto | null {
  const row = db
    .prepare('SELECT minigame_id, config_json FROM pois WHERE id = ?')
    .get(id) as Pick<PoiRow, 'minigame_id' | 'config_json'> | undefined;
  if (!row) return null;
  return {
    minigameId: row.minigame_id,
    config: JSON.parse(row.config_json),
  };
}

export function createPoi(db: Database, input: CreatePoiInput): PoiDto {
  const now = Date.now();
  const id = nanoid(10);

  const blockerIds = input.blockerIds ?? [];

  // Validate no self-reference
  if (blockerIds.includes(id)) {
    throw new Error('A POI cannot block itself');
  }

  // Validate all blockers exist
  if (blockerIds.length > 0) {
    assertBlockersExist(db, id, blockerIds);
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO pois (id, name, lat, lon, minigame_id, config_json, replayable,
         reward_image_asset, reward_name_win, reward_name_lose, reward_description,
         sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.lat,
      input.lon,
      input.minigameId,
      input.configJson !== undefined ? JSON.stringify(input.configJson) : '{}',
      input.replayable ? 1 : 0,
      input.rewardImageAsset ?? null,
      input.rewardNameWin ?? '',
      input.rewardNameLose ?? '',
      input.rewardDescription ?? '',
      input.sortOrder ?? 0,
      now,
      now,
    );

    insertBlockers(db, id, blockerIds);
  })();

  return rowToDto(
    db.prepare('SELECT * FROM pois WHERE id = ?').get(id) as PoiRow,
    blockerIds,
  );
}

export function updatePoi(db: Database, id: string, input: UpdatePoiInput): PoiDto | null {
  const existing = db.prepare('SELECT * FROM pois WHERE id = ?').get(id) as PoiRow | undefined;
  if (!existing) return null;

  const now = Date.now();
  const newBlockerIds = input.blockerIds;

  if (newBlockerIds !== undefined) {
    // Validate no self-reference
    if (newBlockerIds.includes(id)) {
      throw new Error('A POI cannot block itself');
    }
    // Validate all blockers exist
    if (newBlockerIds.length > 0) {
      assertBlockersExist(db, id, newBlockerIds);
    }
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE pois SET
         name = COALESCE(?, name),
         lat = COALESCE(?, lat),
         lon = COALESCE(?, lon),
         minigame_id = COALESCE(?, minigame_id),
         config_json = COALESCE(?, config_json),
         replayable = COALESCE(?, replayable),
         reward_image_asset = CASE WHEN ? THEN ? ELSE reward_image_asset END,
         reward_name_win = COALESCE(?, reward_name_win),
         reward_name_lose = COALESCE(?, reward_name_lose),
         reward_description = COALESCE(?, reward_description),
         sort_order = COALESCE(?, sort_order),
         updated_at = ?
       WHERE id = ?`,
    ).run(
      input.name ?? null,
      input.lat ?? null,
      input.lon ?? null,
      input.minigameId ?? null,
      input.configJson !== undefined ? JSON.stringify(input.configJson) : null,
      input.replayable !== undefined ? (input.replayable ? 1 : 0) : null,
      // reward_image_asset: use a flag to distinguish "explicitly set to null" vs "not provided"
      'rewardImageAsset' in input ? 1 : 0,
      'rewardImageAsset' in input ? (input.rewardImageAsset ?? null) : null,
      input.rewardNameWin ?? null,
      input.rewardNameLose ?? null,
      input.rewardDescription ?? null,
      input.sortOrder ?? null,
      now,
      id,
    );

    if (newBlockerIds !== undefined) {
      db.prepare('DELETE FROM poi_dependencies WHERE poi_id = ?').run(id);
      insertBlockers(db, id, newBlockerIds);
    }
  })();

  const updated = db.prepare('SELECT * FROM pois WHERE id = ?').get(id) as PoiRow;
  return rowToDto(updated, fetchBlockerIds(db, id));
}

export function deletePoi(db: Database, id: string): boolean {
  const result = db.prepare('DELETE FROM pois WHERE id = ?').run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertBlockersExist(db: Database, _selfId: string, blockerIds: string[]): void {
  for (const blockerId of blockerIds) {
    const exists = db.prepare('SELECT 1 FROM pois WHERE id = ?').get(blockerId);
    if (!exists) {
      throw new Error(`Blocker POI not found: ${blockerId}`);
    }
  }
}

function insertBlockers(db: Database, poiId: string, blockerIds: string[]): void {
  const stmt = db.prepare(
    'INSERT INTO poi_dependencies (poi_id, blocker_id) VALUES (?, ?)',
  );
  for (const blockerId of blockerIds) {
    stmt.run(poiId, blockerId);
  }
}
