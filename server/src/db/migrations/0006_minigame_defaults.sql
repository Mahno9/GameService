CREATE TABLE minigame_defaults (
  minigame_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
