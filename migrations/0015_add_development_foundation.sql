PRAGMA foreign_keys = ON;

CREATE TABLE development_requests (
  id TEXT PRIMARY KEY,
  external_key TEXT UNIQUE,
  title TEXT NOT NULL,
  problem TEXT,
  why_decision TEXT,
  priority TEXT NOT NULL DEFAULT 'P2'
    CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  type TEXT NOT NULL DEFAULT 'Other'
    CHECK (type IN ('Security', 'Bug', 'Feature', 'Integrity', 'UX',
      'Performance', 'Data', 'Technical Debt', 'Other')),
  product_area TEXT,
  requested_by_type TEXT NOT NULL DEFAULT 'unknown',
  requested_by_name TEXT NOT NULL,
  owner_email TEXT,
  qa_partner_email TEXT,
  promotion_path TEXT NOT NULL DEFAULT 'standard'
    CHECK (promotion_path IN ('standard', 'hotfix_to_main')),
  hotfix_reason TEXT,
  overall_status TEXT NOT NULL DEFAULT 'open'
    CHECK (overall_status IN ('open', 'working', 'awaiting_adam',
      'awaiting_joe', 'awaiting_mutual_approval', 'ready_for_dev', 'on_dev',
      'ready_for_main', 'on_main_needs_verification', 'blocked', 'verified',
      'closed')),
  notes TEXT,
  next_action TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE development_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  development_request_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, type, external_id),
  FOREIGN KEY (development_request_id)
    REFERENCES development_requests(id)
    ON DELETE CASCADE
);

CREATE TABLE development_branch_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  development_request_id TEXT NOT NULL,
  branch TEXT NOT NULL CHECK (branch IN ('adam', 'joe', 'dev', 'main')),
  state TEXT NOT NULL DEFAULT 'unknown'
    CHECK (state IN ('not_present', 'present', 'patch_equivalent', 'ahead',
      'behind', 'needs_merge', 'needs_review', 'conflict', 'unknown')),
  commit_sha TEXT,
  comparison_state TEXT,
  equivalence_notes TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(development_request_id, branch),
  FOREIGN KEY (development_request_id)
    REFERENCES development_requests(id)
    ON DELETE CASCADE
);

CREATE TABLE qa_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  development_request_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('ADAM_QA', 'JOE_QA', 'DEV_QA', 'MAIN_VERIFICATION')),
  test_user TEXT,
  tenant TEXT,
  login_url TEXT,
  test_url TEXT,
  navigation TEXT,
  prerequisites TEXT,
  test_steps TEXT,
  expected_result TEXT,
  automated_coverage TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'passed', 'failed', 'blocked', 'not_applicable')),
  verified_by TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(development_request_id, stage),
  FOREIGN KEY (development_request_id)
    REFERENCES development_requests(id)
    ON DELETE CASCADE
);

CREATE TABLE development_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  development_request_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('ADAM_QA', 'JOE_QA', 'MUTUAL_APPROVAL', 'DEV_QA', 'MAIN_VERIFICATION')),
  actor_email TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'requested_changes', 'verified')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (development_request_id)
    REFERENCES development_requests(id)
    ON DELETE CASCADE
);

CREATE TABLE development_activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('HUMAN', 'SYSTEM', 'AGENT')),
  actor_identity TEXT NOT NULL,
  event_type TEXT NOT NULL,
  development_request_id TEXT,
  source TEXT NOT NULL DEFAULT 'backoffice',
  summary TEXT NOT NULL,
  metadata_json TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (development_request_id)
    REFERENCES development_requests(id)
    ON DELETE SET NULL
);

CREATE INDEX idx_development_requests_status_priority
  ON development_requests(overall_status, priority, updated_at DESC);
CREATE INDEX idx_development_requests_owner
  ON development_requests(owner_email, overall_status, updated_at DESC);
CREATE INDEX idx_development_links_request
  ON development_links(development_request_id, provider, type);
CREATE INDEX idx_development_branch_states_request
  ON development_branch_states(development_request_id, branch);
CREATE INDEX idx_qa_handoffs_request_stage
  ON qa_handoffs(development_request_id, stage, status);
CREATE INDEX idx_development_approvals_request_stage
  ON development_approvals(development_request_id, stage, created_at DESC);
CREATE INDEX idx_development_activity_request_date
  ON development_activity_events(development_request_id, occurred_at DESC);
CREATE INDEX idx_development_activity_date
  ON development_activity_events(occurred_at DESC);
