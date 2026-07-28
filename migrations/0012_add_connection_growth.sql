CREATE TABLE connection_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('group', 'post', 'csv', 'crm', 'manual')),
  name TEXT NOT NULL,
  source_url TEXT,
  source_text TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE connection_prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  job_title TEXT,
  company_name TEXT,
  location TEXT,
  linkedin_profile_url TEXT,
  normalized_profile_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_connection_prospects_profile
ON connection_prospects(normalized_profile_url)
WHERE normalized_profile_url IS NOT NULL;

CREATE TABLE connection_prospect_sources (
  prospect_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  source_context TEXT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (prospect_id, source_id),
  FOREIGN KEY (prospect_id)
    REFERENCES connection_prospects(id)
    ON DELETE CASCADE,
  FOREIGN KEY (source_id)
    REFERENCES connection_sources(id)
    ON DELETE CASCADE
);

CREATE TABLE connection_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL UNIQUE,
  employee_id INTEGER NOT NULL,
  playbook_id INTEGER NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  relevance_reason TEXT NOT NULL,
  suggested_note TEXT,
  status TEXT NOT NULL DEFAULT 'recommended'
    CHECK (
      status IN (
        'recommended',
        'approved',
        'rejected',
        'sent',
        'accepted',
        'declined',
        'withdrawn'
      )
    ),
  reviewed_by TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  sent_at TEXT,
  accepted_at TEXT,
  follow_up_due TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prospect_id)
    REFERENCES connection_prospects(id)
    ON DELETE CASCADE,
  FOREIGN KEY (employee_id)
    REFERENCES employees(id)
    ON DELETE CASCADE,
  FOREIGN KEY (playbook_id)
    REFERENCES playbooks(id)
    ON DELETE RESTRICT
);

CREATE TABLE connection_recommendation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recommendation_id)
    REFERENCES connection_recommendations(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_connection_sources_type
ON connection_sources(source_type, created_at DESC);

CREATE INDEX idx_connection_prospect_sources_source
ON connection_prospect_sources(source_id, prospect_id);

CREATE INDEX idx_connection_recommendations_status_score
ON connection_recommendations(status, score DESC);

CREATE INDEX idx_connection_recommendations_employee_status
ON connection_recommendations(employee_id, status, updated_at DESC);

CREATE INDEX idx_connection_recommendations_follow_up
ON connection_recommendations(follow_up_due, status);

CREATE INDEX idx_connection_events_recommendation
ON connection_recommendation_events(recommendation_id, created_at DESC);
