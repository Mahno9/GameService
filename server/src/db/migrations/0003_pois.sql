CREATE TABLE pois (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  minigame_id TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  replayable INTEGER NOT NULL DEFAULT 0,
  reward_image_asset TEXT,
  reward_name_win TEXT NOT NULL DEFAULT '',
  reward_name_lose TEXT NOT NULL DEFAULT '',
  reward_description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE poi_dependencies (
  poi_id TEXT NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  blocker_id TEXT NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  PRIMARY KEY (poi_id, blocker_id)
);
