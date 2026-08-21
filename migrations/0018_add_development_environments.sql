CREATE TABLE development_environments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  environment_type TEXT NOT NULL,
  qa_stage TEXT NOT NULL CHECK (qa_stage IN ('ADAM_QA', 'JOE_QA', 'DEV_QA', 'MAIN_VERIFICATION')),
  base_url TEXT NOT NULL,
  purpose TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE environment_qa_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  development_request_id TEXT NOT NULL,
  environment_id INTEGER NOT NULL,
  qa_handoff_id INTEGER,
  stage TEXT NOT NULL CHECK (stage IN ('ADAM_QA', 'JOE_QA', 'DEV_QA', 'MAIN_VERIFICATION')),
  status TEXT NOT NULL CHECK (status IN ('not_ready', 'ready_to_test', 'testing', 'passed', 'failed')),
  tester_email TEXT NOT NULL,
  tester_name TEXT NOT NULL,
  notes TEXT,
  tested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (development_request_id) REFERENCES development_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (environment_id) REFERENCES development_environments(id),
  FOREIGN KEY (qa_handoff_id) REFERENCES qa_handoffs(id)
);

CREATE INDEX idx_environment_qa_attempts_request_environment
  ON environment_qa_attempts(development_request_id, environment_id, tested_at DESC, id DESC);

CREATE INDEX idx_environment_qa_attempts_environment_status
  ON environment_qa_attempts(environment_id, status, tested_at DESC);

INSERT INTO development_environments
  (slug, name, owner_name, environment_type, qa_stage, base_url, purpose, active, sort_order)
VALUES
  ('adam', 'Adam Live View', 'Adam', 'personal_live_view', 'ADAM_QA', 'https://netx-web-adam-792780081355.us-central1.run.app', 'Adam''s independent Net-X branch/testing environment.', 1, 10),
  ('joe', 'Joe Live View', 'Joe', 'personal_live_view', 'JOE_QA', 'https://netx-web-joe-792780081355.us-central1.run.app', 'Joe''s independent Net-X branch/testing environment.', 1, 20);
