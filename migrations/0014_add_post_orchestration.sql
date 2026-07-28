CREATE TABLE orchestration_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'strategy_pending'
    CHECK (status IN (
      'strategy_pending','strategy_review','planner_pending','planner_review',
      'drafting_pending','drafting_review','complete','failed','superseded'
    )),
  playbook_snapshot TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE(employee_id, week_start, version)
);

CREATE TABLE orchestration_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orchestration_run_id INTEGER NOT NULL,
  stage_type TEXT NOT NULL CHECK (stage_type IN ('strategy','planner','drafting')),
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','needs_review','approved','rejected','failed','invalidated')),
  model TEXT,
  input_json TEXT NOT NULL,
  output_json TEXT,
  safe_error TEXT,
  reviewed_by TEXT,
  review_note TEXT,
  reviewed_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
  UNIQUE(orchestration_run_id, stage_type, version)
);

CREATE TABLE orchestration_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orchestration_run_id INTEGER NOT NULL,
  from_stage_id INTEGER NOT NULL,
  to_stage_type TEXT NOT NULL CHECK (to_stage_type IN ('planner','drafting')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (from_stage_id) REFERENCES orchestration_stages(id) ON DELETE CASCADE
);

CREATE TABLE orchestration_draft_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orchestration_run_id INTEGER NOT NULL,
  drafting_stage_id INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  content_draft_id INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (drafting_stage_id) REFERENCES orchestration_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (content_draft_id) REFERENCES content_drafts(id) ON DELETE CASCADE,
  UNIQUE(orchestration_run_id, sequence)
);

CREATE TABLE orchestration_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orchestration_run_id INTEGER NOT NULL,
  orchestration_stage_id INTEGER,
  event_type TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (orchestration_run_id) REFERENCES orchestration_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (orchestration_stage_id) REFERENCES orchestration_stages(id) ON DELETE CASCADE
);

CREATE INDEX idx_orchestration_runs_employee_week
ON orchestration_runs(employee_id, week_start, version DESC);
CREATE INDEX idx_orchestration_runs_status
ON orchestration_runs(status, updated_at DESC);
CREATE INDEX idx_orchestration_stages_run
ON orchestration_stages(orchestration_run_id, stage_type, version DESC);
CREATE INDEX idx_orchestration_events_run
ON orchestration_events(orchestration_run_id, created_at DESC);
