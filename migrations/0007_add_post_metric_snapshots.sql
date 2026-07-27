CREATE TABLE post_metric_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_draft_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  reactions INTEGER NOT NULL DEFAULT 0 CHECK (reactions >= 0),
  comments INTEGER NOT NULL DEFAULT 0 CHECK (comments >= 0),
  reposts INTEGER NOT NULL DEFAULT 0 CHECK (reposts >= 0),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  qualified_conversations INTEGER NOT NULL DEFAULT 0
    CHECK (qualified_conversations >= 0),
  leads INTEGER NOT NULL DEFAULT 0 CHECK (leads >= 0),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'linkedin', 'import')),
  recorded_by TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (content_draft_id)
    REFERENCES content_drafts(id)
    ON DELETE CASCADE,

  UNIQUE(content_draft_id, captured_at)
);

CREATE INDEX idx_post_metric_snapshots_post_date
ON post_metric_snapshots(content_draft_id, captured_at DESC);

CREATE INDEX idx_post_metric_snapshots_capture_date
ON post_metric_snapshots(captured_at DESC);
