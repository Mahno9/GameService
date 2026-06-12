CREATE TABLE tile_jobs (
  id                   TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL CHECK (kind IN ('vector', 'raster')),
  bbox_json            TEXT NOT NULL,
  min_zoom             INTEGER NOT NULL,
  max_zoom             INTEGER NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'done', 'failed')),
  completed_zooms_json TEXT NOT NULL DEFAULT '[]',
  tiles_done           INTEGER NOT NULL DEFAULT 0,
  tiles_total          INTEGER NOT NULL DEFAULT 0,
  osm_cache_key        TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
