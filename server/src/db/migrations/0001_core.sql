CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  avatar_emoji  TEXT NOT NULL,
  is_debug      INTEGER NOT NULL DEFAULT 0,
  total_score   INTEGER NOT NULL DEFAULT 0,
  completed_all INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE game_states (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload           TEXT NOT NULL,
  client_updated_at INTEGER NOT NULL,
  synced_at         INTEGER NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

INSERT INTO settings (key, value_json) VALUES
  ('trigger_radius_m',   '25'),
  ('sync_interval_s',    '30'),
  ('debug_mode',         'false'),
  ('gps_timeout_min',    '1'),
  ('joystick_speed_mps', '3'),
  ('zoom_threshold',     '15.5'),
  ('map_bbox',           'null');
