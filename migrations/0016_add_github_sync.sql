PRAGMA foreign_keys = ON;

CREATE TABLE github_sync_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'pull_request')),
  number INTEGER NOT NULL,
  development_request_id TEXT,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  github_updated_at TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(kind, provider_id),
  UNIQUE(kind, number),
  FOREIGN KEY (development_request_id)
    REFERENCES development_requests(id)
    ON DELETE SET NULL
);

CREATE TABLE github_branch_mappings (
  role TEXT PRIMARY KEY CHECK (role IN ('adam', 'joe', 'dev', 'main')),
  branch_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('MAPPED', 'NEEDS_MAPPING', 'NOT_FOUND', 'UNKNOWN')),
  candidates_json TEXT,
  sha TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE github_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  issues_seen INTEGER NOT NULL DEFAULT 0,
  pull_requests_seen INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  ambiguous_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

ALTER TABLE development_branch_states ADD COLUMN confidence TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK (confidence IN ('HIGH', 'PROBABLE', 'LOW', 'UNKNOWN'));

CREATE INDEX idx_github_sync_items_request
  ON github_sync_items(development_request_id, kind);
CREATE INDEX idx_github_sync_items_updated
  ON github_sync_items(github_updated_at, last_seen_at);
CREATE INDEX idx_github_sync_runs_started
  ON github_sync_runs(started_at DESC);
