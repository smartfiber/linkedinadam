CREATE TABLE content_schedule_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_draft_id INTEGER NOT NULL,
  previous_scheduled_for TEXT,
  scheduled_for TEXT,
  changed_by TEXT NOT NULL,
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (content_draft_id)
    REFERENCES content_drafts(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_content_drafts_schedule_status
ON content_drafts(scheduled_for, status);

CREATE INDEX idx_content_schedule_history_draft
ON content_schedule_history(content_draft_id, created_at);
