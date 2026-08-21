PRAGMA foreign_keys = OFF;

CREATE TABLE development_links_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  development_request_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(development_request_id, provider, type, external_id),
  FOREIGN KEY (development_request_id)
    REFERENCES development_requests(id)
    ON DELETE CASCADE
);

INSERT INTO development_links_next (
  id, development_request_id, provider, type, external_id, url,
  metadata_json, created_at
)
SELECT
  id, development_request_id, provider, type, external_id, url,
  metadata_json, created_at
FROM development_links;

DROP TABLE development_links;
ALTER TABLE development_links_next RENAME TO development_links;

CREATE INDEX idx_development_links_request
  ON development_links(development_request_id, provider, type);

CREATE INDEX idx_development_links_external
  ON development_links(provider, type, external_id);

PRAGMA foreign_keys = ON;
