-- Debug joystick start point, set from admin, read by player.
-- Replaces the old cross-origin localStorage hack so it works in dev (admin :5174 / player :5173).
INSERT OR IGNORE INTO settings (key, value_json) VALUES ('debug_start', 'null');
