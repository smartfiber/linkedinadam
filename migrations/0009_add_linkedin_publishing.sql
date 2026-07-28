ALTER TABLE content_drafts
ADD COLUMN linkedin_post_urn TEXT;

ALTER TABLE content_drafts
ADD COLUMN image_alt_text TEXT;

CREATE TABLE linkedin_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL UNIQUE,
  linkedin_member_id TEXT NOT NULL UNIQUE,
  linkedin_person_urn TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT,
  access_token_ciphertext TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  encryption_key_version INTEGER NOT NULL DEFAULT 1,
  scopes TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (employee_id)
    REFERENCES employees(id)
    ON DELETE CASCADE
);

CREATE TABLE linkedin_oauth_states (
  state_hash TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  return_path TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (employee_id)
    REFERENCES employees(id)
    ON DELETE CASCADE
);

CREATE TABLE linkedin_publish_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_draft_id INTEGER NOT NULL,
  linkedin_connection_id INTEGER NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'succeeded',
        'failed',
        'uncertain',
        'resolved_not_published'
      )
    ),
  linkedin_image_urn TEXT,
  linkedin_post_urn TEXT,
  safe_error_code TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (content_draft_id)
    REFERENCES content_drafts(id)
    ON DELETE CASCADE,

  FOREIGN KEY (linkedin_connection_id)
    REFERENCES linkedin_connections(id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_linkedin_attempts_active_draft
ON linkedin_publish_attempts(content_draft_id)
WHERE status IN ('pending', 'succeeded', 'uncertain');

CREATE INDEX idx_linkedin_connections_status_expiry
ON linkedin_connections(status, expires_at);

CREATE INDEX idx_linkedin_oauth_states_expiry
ON linkedin_oauth_states(expires_at);

CREATE INDEX idx_linkedin_attempts_draft_date
ON linkedin_publish_attempts(content_draft_id, created_at DESC);
