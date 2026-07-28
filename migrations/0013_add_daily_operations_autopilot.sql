ALTER TABLE content_plan_items ADD COLUMN generated_body TEXT;
ALTER TABLE content_plan_items ADD COLUMN generated_model TEXT;
ALTER TABLE content_plan_items ADD COLUMN generated_at TEXT;
ALTER TABLE content_plan_items ADD COLUMN generation_error TEXT;

CREATE TABLE automation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  generate_today INTEGER NOT NULL DEFAULT 1 CHECK (generate_today IN (0, 1)),
  generate_tomorrow INTEGER NOT NULL DEFAULT 1 CHECK (generate_tomorrow IN (0, 1)),
  auto_approve_posts INTEGER NOT NULL DEFAULT 1 CHECK (auto_approve_posts IN (0, 1)),
  auto_approve_connections INTEGER NOT NULL DEFAULT 1
    CHECK (auto_approve_connections IN (0, 1)),
  connection_score_threshold INTEGER NOT NULL DEFAULT 85
    CHECK (connection_score_threshold BETWEEN 0 AND 100),
  max_tasks_per_batch INTEGER NOT NULL DEFAULT 10
    CHECK (max_tasks_per_batch BETWEEN 1 AND 25),
  weekly_connection_limit INTEGER NOT NULL DEFAULT 25
    CHECK (weekly_connection_limit BETWEEN 1 AND 100),
  started_by TEXT,
  started_at TEXT,
  stopped_by TEXT,
  stopped_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO automation_settings (id) VALUES (1);

CREATE TABLE automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('manual', 'scheduled', 'yolo_start')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'stopped')),
  requested_by TEXT NOT NULL,
  total_tasks INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  failed_tasks INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE automation_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_run_id INTEGER NOT NULL,
  task_type TEXT NOT NULL
    CHECK (task_type IN ('generate_daily_post')),
  employee_id INTEGER NOT NULL,
  target_date TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  result_content_draft_id INTEGER,
  safe_error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (automation_run_id)
    REFERENCES automation_runs(id)
    ON DELETE CASCADE,
  FOREIGN KEY (employee_id)
    REFERENCES employees(id)
    ON DELETE CASCADE,
  FOREIGN KEY (result_content_draft_id)
    REFERENCES content_drafts(id)
    ON DELETE SET NULL
);

CREATE TABLE automation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_run_id INTEGER,
  automation_task_id INTEGER,
  event_type TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (automation_run_id)
    REFERENCES automation_runs(id)
    ON DELETE CASCADE,
  FOREIGN KEY (automation_task_id)
    REFERENCES automation_tasks(id)
    ON DELETE CASCADE
);

CREATE TABLE employee_deletion_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_name TEXT NOT NULL,
  employee_email TEXT,
  role_name TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  record_counts TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_automation_tasks_pending
ON automation_tasks(status, created_at, id);

CREATE INDEX idx_automation_tasks_run
ON automation_tasks(automation_run_id, status);

CREATE INDEX idx_automation_tasks_employee_date
ON automation_tasks(employee_id, target_date, status);

CREATE INDEX idx_automation_runs_status
ON automation_runs(status, created_at DESC);

CREATE INDEX idx_automation_events_run
ON automation_events(automation_run_id, created_at DESC);

CREATE INDEX idx_content_plan_items_generation
ON content_plan_items(content_plan_id, status, generated_at);
