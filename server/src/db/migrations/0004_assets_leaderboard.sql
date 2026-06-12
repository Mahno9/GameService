CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image','audio','gif')),
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE leaderboard_entries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_emoji TEXT NOT NULL,
  score INTEGER NOT NULL,
  sort_hint INTEGER NOT NULL DEFAULT 0
);
