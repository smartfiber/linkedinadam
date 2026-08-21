PRAGMA foreign_keys = ON;

CREATE TABLE development_copilot_state (
  development_request_id TEXT PRIMARY KEY,
  work_state TEXT NOT NULL DEFAULT 'NEEDS_PROMPT'
    CHECK (work_state IN ('NEEDS_PROMPT','PROMPT_READY','IN_PROGRESS','RESPONSE_REVIEW','NEEDS_FOLLOWUP','READY_FOR_REVIEW','QA','READY_FOR_PROMOTION','BLOCKED','COMPLETED','ARCHIVED')),
  layman_summary TEXT,
  technical_interpretation TEXT,
  current_state_summary TEXT,
  suggested_next_step TEXT,
  visual_observations_json TEXT,
  generated_provider TEXT,
  generated_model TEXT,
  generated_at TEXT,
  archived_at TEXT,
  archived_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (development_request_id) REFERENCES development_requests(id) ON DELETE CASCADE
);

CREATE TABLE development_prompts (
  id TEXT PRIMARY KEY,
  development_request_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  prompt_type TEXT NOT NULL,
  target_tool TEXT NOT NULL DEFAULT 'Codex',
  target_model TEXT,
  generated_text TEXT NOT NULL,
  edited_text TEXT,
  source_snapshot_json TEXT,
  evidence_snapshot_json TEXT,
  generated_by TEXT NOT NULL,
  generated_provider TEXT,
  generated_model TEXT,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  sent_by TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  UNIQUE(development_request_id, version),
  FOREIGN KEY (development_request_id) REFERENCES development_requests(id) ON DELETE CASCADE
);

CREATE TABLE development_thread_entries (
  id TEXT PRIMARY KEY,
  development_request_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('HUMAN','DEVOS','CODEX','CLAUDE','CHATGPT','GEMINI','SYSTEM')),
  actor_identity TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  content TEXT NOT NULL,
  related_prompt_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (development_request_id) REFERENCES development_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (related_prompt_id) REFERENCES development_prompts(id) ON DELETE SET NULL
);

CREATE TABLE development_attachments (
  id TEXT PRIMARY KEY,
  development_request_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  safe_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  size_bytes INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  caption TEXT,
  category TEXT NOT NULL DEFAULT 'Other' CHECK (category IN ('Current Behavior','Desired Behavior','Error','QA Failure','Reference','Other')),
  display_order INTEGER NOT NULL DEFAULT 0,
  related_thread_entry_id TEXT,
  related_qa_attempt_id INTEGER,
  FOREIGN KEY (development_request_id) REFERENCES development_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (related_thread_entry_id) REFERENCES development_thread_entries(id) ON DELETE SET NULL,
  FOREIGN KEY (related_qa_attempt_id) REFERENCES environment_qa_attempts(id) ON DELETE SET NULL
);

CREATE TABLE development_response_analyses (
  id TEXT PRIMARY KEY,
  development_request_id TEXT NOT NULL,
  thread_entry_id TEXT NOT NULL UNIQUE,
  result TEXT NOT NULL CHECK (result IN ('Success','Partial','Failure','Needs Clarification','Ready for Review')),
  plain_english_result TEXT NOT NULL,
  important_facts_json TEXT,
  provenance_json TEXT,
  recommended_next_step TEXT,
  provider TEXT,
  model TEXT,
  analyzed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (development_request_id) REFERENCES development_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_entry_id) REFERENCES development_thread_entries(id) ON DELETE CASCADE
);

CREATE TABLE development_batch_prompts (
  id TEXT PRIMARY KEY,
  target_tool TEXT NOT NULL DEFAULT 'Codex',
  target_model TEXT,
  prompt_text TEXT NOT NULL,
  request_ids_json TEXT NOT NULL,
  evidence_snapshot_json TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_development_copilot_state_work ON development_copilot_state(work_state, updated_at DESC);
CREATE INDEX idx_development_prompts_request ON development_prompts(development_request_id, version DESC);
CREATE INDEX idx_development_thread_request ON development_thread_entries(development_request_id, created_at, id);
CREATE INDEX idx_development_attachments_request ON development_attachments(development_request_id, display_order, uploaded_at);
CREATE INDEX idx_development_response_request ON development_response_analyses(development_request_id, analyzed_at DESC);
