-- KangXi.exe D1 Migration 0002: Username + Password auth & login rate-limiting
ALTER TABLE owners ADD COLUMN username TEXT;
ALTER TABLE owners ADD COLUMN password_hash TEXT;

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);
