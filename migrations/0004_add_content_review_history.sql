CREATE TABLE content_review_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_draft_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reviewer_name TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (content_draft_id)
    REFERENCES content_drafts(id)
    ON DELETE CASCADE,

  CHECK (
    to_status IN (
      'draft',
      'approved',
      'published',
      'rejected'
    )
  )
);

CREATE INDEX idx_content_review_history_draft
ON content_review_history(content_draft_id, created_at);

CREATE INDEX idx_content_review_history_status
ON content_review_history(to_status, created_at);
