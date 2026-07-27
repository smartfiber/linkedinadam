PRAGMA foreign_keys = ON;

CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  linkedin_profile_url TEXT,
  role_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE playbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_name TEXT NOT NULL UNIQUE,
  primary_audience TEXT,
  secondary_audience TEXT,
  primary_expertise TEXT,
  core_buyer_problem TEXT,
  positioning_statement TEXT,
  recurring_series TEXT,
  weekly_original_posts INTEGER NOT NULL DEFAULT 0,
  weekly_short_posts INTEGER NOT NULL DEFAULT 0,
  weekly_meaningful_comments INTEGER NOT NULL DEFAULT 0,
  weekly_new_connections INTEGER NOT NULL DEFAULT 0,
  lead_magnet TEXT,
  soft_cta TEXT,
  qualified_buying_signal TEXT,
  lead_handoff_action TEXT,
  guardrail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employee_playbooks (
  employee_id INTEGER PRIMARY KEY,
  playbook_id INTEGER NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (playbook_id) REFERENCES playbooks(id) ON DELETE RESTRICT
);

CREATE TABLE content_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  post_format TEXT,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_for TEXT,
  approved_at TEXT,
  published_at TEXT,
  linkedin_post_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE engagement_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  source_post_url TEXT NOT NULL,
  source_author_name TEXT,
  source_author_title TEXT,
  source_company TEXT,
  source_post_text TEXT,
  relevance_reason TEXT,
  recommended_angle TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  linkedin_person_name TEXT NOT NULL,
  linkedin_profile_url TEXT,
  company_name TEXT,
  job_title TEXT,
  stage TEXT NOT NULL DEFAULT 'public_engagement',
  last_message TEXT,
  next_action TEXT,
  next_action_due TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE buying_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  employee_id INTEGER NOT NULL,
  signal_type TEXT NOT NULL,
  signal_text TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  recommended_action TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE lead_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buying_signal_id INTEGER NOT NULL,
  assigned_to TEXT,
  handoff_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (buying_signal_id) REFERENCES buying_signals(id) ON DELETE CASCADE
);

CREATE TABLE weekly_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  week_start TEXT NOT NULL,
  original_posts_completed INTEGER NOT NULL DEFAULT 0,
  short_posts_completed INTEGER NOT NULL DEFAULT 0,
  meaningful_comments_completed INTEGER NOT NULL DEFAULT 0,
  relevant_connections_completed INTEGER NOT NULL DEFAULT 0,
  qualified_conversations INTEGER NOT NULL DEFAULT 0,
  leads_handed_off INTEGER NOT NULL DEFAULT 0,
  UNIQUE(employee_id, week_start),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE INDEX idx_content_drafts_employee_status
  ON content_drafts(employee_id, status);

CREATE INDEX idx_engagement_employee_status
  ON engagement_opportunities(employee_id, status);

CREATE INDEX idx_conversations_employee_status
  ON conversations(employee_id, status);

CREATE INDEX idx_buying_signals_employee_status
  ON buying_signals(employee_id, status);

CREATE INDEX idx_weekly_activity_employee_week
  ON weekly_activity(employee_id, week_start);
