CREATE TABLE content_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (
      status IN (
        'proposed',
        'approved',
        'rejected',
        'partially_converted',
        'converted',
        'superseded'
      )
    ),
  planning_instructions TEXT,
  model TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  reviewed_by TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (employee_id)
    REFERENCES employees(id)
    ON DELETE CASCADE,

  UNIQUE(employee_id, week_start, version)
);

CREATE TABLE content_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_plan_id INTEGER NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  post_format TEXT NOT NULL
    CHECK (post_format IN ('original_post', 'short_post')),
  topic TEXT NOT NULL,
  angle TEXT NOT NULL,
  rationale TEXT NOT NULL,
  suggested_scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (
      status IN (
        'proposed',
        'approved',
        'rejected',
        'converted'
      )
    ),
  reviewed_by TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  content_draft_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (content_plan_id)
    REFERENCES content_plans(id)
    ON DELETE CASCADE,

  FOREIGN KEY (content_draft_id)
    REFERENCES content_drafts(id)
    ON DELETE SET NULL,

  UNIQUE(content_plan_id, sequence)
);

CREATE TABLE content_plan_item_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_plan_item_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL
    CHECK (
      to_status IN (
        'proposed',
        'approved',
        'rejected',
        'converted'
      )
    ),
  actor_name TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (content_plan_item_id)
    REFERENCES content_plan_items(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_content_plans_employee_week
ON content_plans(employee_id, week_start, version DESC);

CREATE INDEX idx_content_plans_status
ON content_plans(status, updated_at DESC);

CREATE INDEX idx_content_plan_items_plan_status
ON content_plan_items(content_plan_id, status, sequence);

CREATE INDEX idx_content_plan_items_schedule
ON content_plan_items(suggested_scheduled_for, status);

CREATE INDEX idx_content_plan_item_history_item
ON content_plan_item_history(content_plan_item_id, created_at);
