-- sharecli schema. Every statement is idempotent: `share setup` runs this file on each deploy.

CREATE TABLE IF NOT EXISTS shares (
  slug TEXT PRIMARY KEY,
  -- Version served right now. 0 until the first upload is committed.
  version INTEGER NOT NULL DEFAULT 0,
  next_version INTEGER NOT NULL DEFAULT 1,
  private INTEGER NOT NULL DEFAULT 0,
  -- Stored in plain text on purpose so `share info` can show it again.
  -- Passcodes keep casual visitors out; they are not meant to protect secrets.
  passcode TEXT,
  -- NULL means permanent.
  ttl_seconds INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  last_viewed_at INTEGER
);

CREATE INDEX IF NOT EXISTS shares_expires_at ON shares (expires_at);

CREATE TABLE IF NOT EXISTS versions (
  slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  entry TEXT NOT NULL,
  title TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  files INTEGER NOT NULL DEFAULT 0,
  committed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (slug, version)
);

CREATE TABLE IF NOT EXISTS views_daily (
  slug TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
);

CREATE TABLE IF NOT EXISTS unlock_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
