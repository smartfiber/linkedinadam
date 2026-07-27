CREATE TABLE activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  external_action_id TEXT,
  content_url TEXT,
  description TEXT,
  metadata TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (employee_id)
    REFERENCES employees(id)
    ON DELETE CASCADE,

  CHECK (
    event_type IN (
      'original_post',
      'short_post',
      'meaningful_comment',
      'relevant_connection',
      'qualified_conversation',
      'lead_handoff'
    )
  ),

  CHECK (
    source IN (
      'manual',
      'linkedinadam',
      'linkedin',
      'import'
    )
  )
);

CREATE UNIQUE INDEX idx_activity_events_external_action
ON activity_events(source, external_action_id)
WHERE external_action_id IS NOT NULL;

CREATE INDEX idx_activity_events_employee_date
ON activity_events(employee_id, occurred_at);

CREATE INDEX idx_activity_events_type_date
ON activity_events(event_type, occurred_at);
