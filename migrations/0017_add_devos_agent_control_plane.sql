CREATE TABLE devos_agents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  role TEXT NOT NULL,
  purpose TEXT NOT NULL,
  human_owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','waiting','error')),
  autonomy_level TEXT NOT NULL,
  default_model_provider TEXT NOT NULL,
  default_model TEXT NOT NULL,
  implementation TEXT NOT NULL CHECK (implementation IN ('existing','new','scaffold')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE devos_agent_tools (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('READ','ANALYZE','DRAFT','MODIFY_SANDBOX','APPROVAL_REQUIRED','PROHIBITED')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  configuration_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(agent_slug, tool_name),
  FOREIGN KEY (agent_slug) REFERENCES devos_agents(slug) ON DELETE CASCADE
);

CREATE TABLE devos_agent_runs (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  initiator_email TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual','scheduled','existing_automation')),
  input_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','needs_approval','cancelled')),
  result_json TEXT,
  safe_error TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  usage_json TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_slug) REFERENCES devos_agents(slug)
);

CREATE TABLE devos_agent_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_identity TEXT NOT NULL,
  detail_json TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_run_id) REFERENCES devos_agent_runs(id) ON DELETE CASCADE
);

CREATE TABLE devos_agent_approvals (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT,
  agent_slug TEXT NOT NULL,
  requested_action TEXT NOT NULL,
  related_item TEXT,
  risk TEXT NOT NULL CHECK (risk IN ('low','medium','high','critical')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','changes_requested')),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  FOREIGN KEY (agent_run_id) REFERENCES devos_agent_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (agent_slug) REFERENCES devos_agents(slug)
);

CREATE TABLE devos_agent_schedules (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  cron_expression TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  next_run_at TEXT,
  last_run_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_slug) REFERENCES devos_agents(slug) ON DELETE CASCADE
);

CREATE INDEX idx_devos_agent_runs_agent_created ON devos_agent_runs(agent_slug, created_at DESC);
CREATE INDEX idx_devos_agent_runs_status ON devos_agent_runs(status, created_at DESC);
CREATE INDEX idx_devos_agent_events_run ON devos_agent_run_events(agent_run_id, occurred_at);
CREATE INDEX idx_devos_agent_approvals_status ON devos_agent_approvals(status, created_at DESC);
CREATE INDEX idx_devos_agent_schedules_next ON devos_agent_schedules(enabled, next_run_at);

INSERT INTO devos_agents (id,slug,name,category,role,purpose,human_owner,status,autonomy_level,default_model_provider,default_model,implementation) VALUES
('agent-strategy','strategy-agent','Strategy Agent','Content & LinkedIn','Content strategy','Builds employee positioning and strategy briefs for gated orchestration.','Marketing','active','Human-gated','OpenAI','Existing configured model','existing'),
('agent-planner','content-planner','Content Planner','Content & LinkedIn','Weekly planning','Builds validated weekly plans and prevents duplicate topics.','Marketing','active','Human-gated','OpenAI','Existing configured model','existing'),
('agent-drafting','post-drafting-agent','Post Drafting Agent','Content & LinkedIn','Employee-aware writer','Drafts posts in each employee approved voice without publishing.','Marketing','active','Draft only','OpenAI','Existing configured model','existing'),
('agent-image','image-generation','Image Generation','Content & LinkedIn','Content image tool','Generates images for existing drafts with human review.','Marketing','active','Draft only','OpenAI','Existing image model','existing'),
('agent-targeting','connection-targeting-agent','Connection Targeting Agent','Marketing','Network recommendations','Scores prospects and drafts connection recommendations.','Marketing','active','Human-gated','OpenAI','Existing configured model','existing'),
('agent-engagement','engagement-queue-agent','Engagement Queue Agent','Marketing','Engagement triage','Surfaces activity and conversations worth human engagement.','Marketing','active','Read/analyze','Rules + existing data','No separate model','existing'),
('agent-signals','conversation-signal-agent','Conversation Signal Agent','Marketing','Signal analysis','Identifies lead potential from recorded conversations and signals.','Sales','active','Read/analyze','Rules + existing data','No separate model','existing'),
('agent-messaging','messaging-agent','Messaging Agent','Existing Automation','Reply drafting concept','Cannot send public replies or private messages.','Marketing','waiting','Not connected','Not activated','None','scaffold'),
('agent-routing','lead-routing-agent','Lead Routing Agent','Existing Automation','Handoff routing','Represents existing lead-handoff records.','Sales','active','Human-gated','Existing workflow','None','existing'),
('agent-orchestration','post-orchestration','Post Orchestration','Existing Automation','Gated workflow','Runs strategy, planning, and drafting with approval handoffs.','Marketing','active','Human-gated','OpenAI','Stage-recorded model','existing'),
('agent-autopilot','daily-autopilot','Daily Operations Autopilot','Existing Automation','Scheduled content preparation','Runs existing configured daily generation and recommendation gates.','Operations','active','Existing configured gates','OpenAI + rules','Existing configured model','existing'),
('agent-issues','issue-hunter','Issue Hunter','Development','Work discovery','Analyzes Development records and drafts candidate requests.','Development','active','Read/analyze/draft','Deterministic control plane','No model call','new'),
('agent-release','release-readiness','Release Readiness','Development','Release analysis','Summarizes QA and promotion readiness without changing QA.','Development','active','Read/analyze','Deterministic control plane','No model call','new'),
('agent-qa','qa-agent','QA Agent','Development','QA handoff assistant','Drafts QA guidance from recorded data without inventing URLs.','Development','active','Draft only','Deterministic control plane','No model call','new'),
('agent-pr','pr-reviewer','PR Reviewer','Development','Pull request review','Waits for the read-only GitHub connection.','Development','waiting','Not connected','Not activated','None','scaffold'),
('agent-chief','chief-of-staff','Chief of Staff','Cross-functional','Operating brief','Summarizes priority work, content, approvals, and agent activity.','Adam','active','Read/analyze','Deterministic control plane','No model call','new');
