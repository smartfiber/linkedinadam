PRAGMA foreign_keys = ON;

CREATE TABLE growth_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domain TEXT,
  linkedin_url TEXT,
  website TEXT,
  headquarters TEXT,
  geography TEXT,
  employee_count INTEGER,
  advisor_count INTEGER,
  business_type TEXT,
  specialties TEXT,
  technology_focus TEXT,
  icp_score INTEGER NOT NULL DEFAULT 0 CHECK (icp_score BETWEEN 0 AND 100),
  icp_profile_id INTEGER,
  lifecycle TEXT NOT NULL DEFAULT 'PROSPECT',
  owner_email TEXT,
  source_channel TEXT NOT NULL DEFAULT 'Manual',
  source_detail TEXT,
  first_touch_campaign_id INTEGER,
  last_touch_campaign_id INTEGER,
  enrichment_status TEXT NOT NULL DEFAULT 'NOT_ENRICHED',
  data_confidence INTEGER NOT NULL DEFAULT 0 CHECK (data_confidence BETWEEN 0 AND 100),
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_growth_companies_domain_unique
  ON growth_companies(lower(domain)) WHERE domain IS NOT NULL AND domain <> '';
CREATE INDEX idx_growth_companies_lifecycle_score
  ON growth_companies(lifecycle, icp_score DESC);

CREATE TABLE growth_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  title TEXT,
  company_id INTEGER,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  profile_urls TEXT NOT NULL DEFAULT '[]',
  geography TEXT,
  owner_email TEXT,
  team TEXT,
  assigned_to TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'PROSPECT',
  icp_score INTEGER NOT NULL DEFAULT 0 CHECK (icp_score BETWEEN 0 AND 100),
  icp_profile_id INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  source_channel TEXT NOT NULL DEFAULT 'Manual',
  source_type TEXT,
  source_detail TEXT,
  source_asset_type TEXT,
  source_asset_id TEXT,
  first_touch_campaign_id INTEGER,
  last_touch_campaign_id INTEGER,
  last_interaction_at TEXT,
  last_outbound_at TEXT,
  last_inbound_at TEXT,
  next_action TEXT,
  next_action_at TEXT,
  engagement_score INTEGER NOT NULL DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
  enrichment_status TEXT NOT NULL DEFAULT 'NOT_ENRICHED',
  data_confidence INTEGER NOT NULL DEFAULT 0 CHECK (data_confidence BETWEEN 0 AND 100),
  last_enriched_at TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'SUBSCRIBED',
  suppression_reason TEXT,
  human_notes TEXT,
  ai_summary TEXT,
  relationship_context TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES growth_companies(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_growth_people_email_unique
  ON growth_people(lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE UNIQUE INDEX idx_growth_people_linkedin_unique
  ON growth_people(lower(linkedin_url)) WHERE linkedin_url IS NOT NULL AND linkedin_url <> '';
CREATE INDEX idx_growth_people_lifecycle_score
  ON growth_people(lifecycle, icp_score DESC);
CREATE INDEX idx_growth_people_company ON growth_people(company_id);

CREATE TABLE growth_company_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  title TEXT,
  started_at TEXT,
  ended_at TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  provenance TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES growth_companies(id) ON DELETE CASCADE
);

CREATE TABLE growth_icp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  min_employees INTEGER,
  max_employees INTEGER,
  titles TEXT NOT NULL DEFAULT '[]',
  industries TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  geography TEXT NOT NULL DEFAULT '[]',
  technology_focus TEXT NOT NULL DEFAULT '[]',
  business_models TEXT NOT NULL DEFAULT '[]',
  positive_signals TEXT NOT NULL DEFAULT '[]',
  negative_signals TEXT NOT NULL DEFAULT '[]',
  disqualifiers TEXT NOT NULL DEFAULT '[]',
  weights TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE growth_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'DYNAMIC' CHECK (kind IN ('STATIC','DYNAMIC')),
  rules_json TEXT NOT NULL DEFAULT '[]',
  owner_email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE growth_segment_memberships (
  segment_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (segment_id, person_id),
  FOREIGN KEY (segment_id) REFERENCES growth_segments(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE CASCADE
);

CREATE TABLE growth_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  segment_id INTEGER,
  offer TEXT,
  problem TEXT,
  promise TEXT,
  cta TEXT,
  starts_at TEXT,
  ends_at TEXT,
  owner_email TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  budget_cents INTEGER,
  channel_plan TEXT NOT NULL DEFAULT '[]',
  strategy TEXT,
  approval_status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (segment_id) REFERENCES growth_segments(id) ON DELETE SET NULL
);

CREATE TABLE growth_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT,
  audience TEXT,
  objective TEXT,
  cta TEXT,
  body TEXT,
  url TEXT,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES growth_campaigns(id) ON DELETE SET NULL
);

CREATE TABLE growth_attribution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER,
  company_id INTEGER,
  event_type TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  source_type TEXT,
  source_asset_type TEXT,
  source_asset_id TEXT,
  campaign_id INTEGER,
  touch_kind TEXT NOT NULL DEFAULT 'ASSISTED' CHECK (touch_kind IN ('FIRST','LAST','ASSISTED','CONVERSION')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  provenance TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES growth_companies(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES growth_campaigns(id) ON DELETE SET NULL
);
CREATE INDEX idx_growth_attribution_person_time ON growth_attribution_events(person_id, occurred_at DESC);
CREATE INDEX idx_growth_attribution_company_time ON growth_attribution_events(company_id, occurred_at DESC);

CREATE TABLE growth_timeline_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER,
  company_id INTEGER,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_email TEXT,
  campaign_id INTEGER,
  related_type TEXT,
  related_id TEXT,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  provenance TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES growth_companies(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES growth_campaigns(id) ON DELETE SET NULL
);

CREATE TABLE growth_watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE growth_watchlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  label TEXT NOT NULL,
  external_url TEXT,
  person_id INTEGER,
  company_id INTEGER,
  polling_policy TEXT NOT NULL DEFAULT 'MANUAL',
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (watchlist_id) REFERENCES growth_watchlists(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE SET NULL,
  FOREIGN KEY (company_id) REFERENCES growth_companies(id) ON DELETE SET NULL
);

CREATE TABLE growth_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER,
  company_id INTEGER,
  source TEXT NOT NULL,
  source_external_id TEXT,
  external_url TEXT,
  signal_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  confidence INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  raw_metadata_ref TEXT,
  ai_interpretation TEXT,
  recommended_action TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE SET NULL,
  FOREIGN KEY (company_id) REFERENCES growth_companies(id) ON DELETE SET NULL,
  UNIQUE(source, source_external_id)
);

CREATE TABLE growth_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER,
  company_id INTEGER,
  channel TEXT NOT NULL,
  external_thread_id TEXT,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  unread INTEGER NOT NULL DEFAULT 0,
  reply_needed INTEGER NOT NULL DEFAULT 0,
  owner_email TEXT,
  ai_summary TEXT,
  suggested_reply TEXT,
  recommended_action TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE SET NULL,
  FOREIGN KEY (company_id) REFERENCES growth_companies(id) ON DELETE SET NULL,
  UNIQUE(channel, external_thread_id)
);

CREATE TABLE growth_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND','INTERNAL')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  external_message_id TEXT,
  approved_by TEXT,
  approved_at TEXT,
  sent_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES growth_conversations(id) ON DELETE CASCADE,
  UNIQUE(conversation_id, external_message_id)
);

CREATE TABLE growth_outreach_sequences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  campaign_id INTEGER,
  segment_id INTEGER,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  approval_mode TEXT NOT NULL DEFAULT 'EACH_MESSAGE',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES growth_campaigns(id) ON DELETE SET NULL,
  FOREIGN KEY (segment_id) REFERENCES growth_segments(id) ON DELETE SET NULL
);

CREATE TABLE growth_outreach_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_id INTEGER NOT NULL,
  step_order INTEGER NOT NULL,
  delay_days INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL,
  template_body TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (sequence_id) REFERENCES growth_outreach_sequences(id) ON DELETE CASCADE,
  UNIQUE(sequence_id, step_order)
);

CREATE TABLE growth_outreach_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL,
  campaign_id INTEGER,
  sequence_id INTEGER,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  approval_status TEXT NOT NULL DEFAULT 'DRAFT',
  provider_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES growth_campaigns(id) ON DELETE SET NULL,
  FOREIGN KEY (sequence_id) REFERENCES growth_outreach_sequences(id) ON DELETE SET NULL
);

CREATE TABLE growth_newsletters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  campaign_id INTEGER,
  segment_id INTEGER,
  subject TEXT NOT NULL,
  preview_text TEXT,
  content TEXT NOT NULL,
  sections_json TEXT NOT NULL DEFAULT '[]',
  cta TEXT,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  approval_status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES growth_campaigns(id) ON DELETE SET NULL,
  FOREIGN KEY (segment_id) REFERENCES growth_segments(id) ON DELETE SET NULL
);

CREATE TABLE growth_lead_captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER,
  company_id INTEGER,
  source_channel TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_asset_id TEXT,
  campaign_id INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'NEW',
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provenance TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE SET NULL,
  FOREIGN KEY (company_id) REFERENCES growth_companies(id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES growth_campaigns(id) ON DELETE SET NULL
);

CREATE TABLE growth_demo_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER,
  company_id INTEGER,
  campaign_id INTEGER,
  event_type TEXT NOT NULL,
  scheduled_at TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  external_event_id TEXT,
  notes TEXT,
  provenance TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES growth_people(id) ON DELETE SET NULL,
  FOREIGN KEY (company_id) REFERENCES growth_companies(id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES growth_campaigns(id) ON DELETE SET NULL
);

CREATE TABLE growth_integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_key TEXT NOT NULL UNIQUE,
  provider_name TEXT NOT NULL,
  capability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
  config_json TEXT NOT NULL DEFAULT '{}',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  last_sync_at TEXT,
  last_error TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE content_drafts ADD COLUMN growth_campaign_id INTEGER REFERENCES growth_campaigns(id) ON DELETE SET NULL;
ALTER TABLE content_drafts ADD COLUMN growth_segment_id INTEGER REFERENCES growth_segments(id) ON DELETE SET NULL;
ALTER TABLE content_drafts ADD COLUMN growth_objective TEXT;
ALTER TABLE content_drafts ADD COLUMN growth_cta TEXT;
ALTER TABLE content_drafts ADD COLUMN growth_channel TEXT NOT NULL DEFAULT 'LINKEDIN_PERSONAL';

INSERT INTO growth_icp_profiles
  (name, description, min_employees, max_employees, titles, industries, keywords, positive_signals, negative_signals, disqualifiers, weights)
VALUES
  ('Solo Technology Advisor', 'Independent advisor or two-person advisory business.', 1, 2, '["Founder","Owner","Technology Advisor"]', '["Technology Advisory","Telecommunications"]', '["connectivity","cloud","cybersecurity","UCaaS"]', '["active on LinkedIn","new agency","operational hiring"]', '["inactive business"]', '["carrier-only enterprise"]', '{"businessType":30,"size":25,"title":20,"technology":15,"signals":10}'),
  ('Small Technology Advisory Firm', 'Technology advisory firm with 3–10 employees.', 3, 10, '["Founder","President","Managing Partner","Technology Advisor"]', '["Technology Advisory","Telecommunications","Technology Broker"]', '["connectivity","cloud","security","mobility"]', '["hiring","new office","new vendor partnership"]', '["no advisory services"]', '["consumer-only"]', '{"businessType":30,"size":25,"title":15,"technology":20,"signals":10}'),
  ('Scaling Advisor', 'Growing advisory organization with 10–25 employees.', 10, 25, '["CEO","COO","VP Sales","Managing Partner"]', '["Technology Advisory","Telecommunications"]', '["operations","automation","multi-location"]', '["operations hiring","geographic expansion"]', '["recent layoffs"]', '["not an advisory business"]', '{"businessType":25,"size":25,"title":15,"technology":15,"signals":20}'),
  ('Large Technology Advisory Firm', 'Established advisory firm with more than 25 employees.', 26, NULL, '["CEO","COO","CRO","VP Operations"]', '["Technology Advisory","Telecommunications"]', '["automation","scale","channel"]', '["acquisition","expansion"]', '[]', '["carrier"]', '{"businessType":30,"size":15,"title":20,"technology":15,"signals":20}'),
  ('MSP with Telecom Practice', 'Managed services provider with a meaningful telecom advisory practice.', 3, NULL, '["Founder","CEO","Director of Telecom"]', '["Managed Services","IT Services"]', '["telecom","connectivity","UCaaS","managed network"]', '["telecom practice launch","channel partnership"]', '["no telecom services"]', '[]', '{"businessType":25,"size":15,"title":15,"technology":30,"signals":15}'),
  ('Former Carrier Rep / New Agency Founder', 'New advisory founder with prior carrier or channel experience.', 1, 5, '["Founder","Owner","Principal"]', '["Technology Advisory","Telecommunications"]', '["former carrier","new agency","technology advisor"]', '["new company launch","left carrier role"]', '[]', '["still carrier employee"]', '{"businessType":20,"size":15,"title":20,"technology":15,"signals":30}');

INSERT INTO growth_segments (name, description, kind, rules_json) VALUES
  ('Technology Advisors · 1–5 Employees', 'Small advisory businesses in the primary Net-X audience.', 'DYNAMIC', '[{"field":"company.employee_count","operator":"between","value":[1,5]},{"field":"company.business_type","operator":"contains","value":"Technology Advisor"}]'),
  ('ICP >80', 'High-fit prospects scoring above 80.', 'DYNAMIC', '[{"field":"person.icp_score","operator":"gt","value":80}]'),
  ('LinkedIn Engaged · Last 30 Days', 'Recent LinkedIn engagement.', 'DYNAMIC', '[{"field":"engagement.channel","operator":"eq","value":"LinkedIn"},{"field":"engagement.days","operator":"lte","value":30}]'),
  ('No Outreach Yet', 'Prospects with no outbound history.', 'DYNAMIC', '[{"field":"person.last_outbound_at","operator":"is_null"}]'),
  ('Demo Interest', 'Prospects showing demo intent.', 'DYNAMIC', '[{"field":"person.lifecycle","operator":"eq","value":"DEMO_INTEREST"}]'),
  ('Newsletter Subscribers', 'Marketable subscribed contacts.', 'DYNAMIC', '[{"field":"person.subscription_status","operator":"eq","value":"SUBSCRIBED"}]'),
  ('High-Fit / No Conversation', 'High ICP score without an active conversation.', 'DYNAMIC', '[{"field":"person.icp_score","operator":"gt","value":80},{"field":"conversation.id","operator":"is_null"}]'),
  ('Hiring Operations Staff', 'Companies with an operations hiring signal.', 'DYNAMIC', '[{"field":"signal.type","operator":"eq","value":"HIRING"},{"field":"signal.text","operator":"contains","value":"operations"}]'),
  ('Connectivity-Focused', 'Prospects focused on connectivity services.', 'DYNAMIC', '[{"field":"company.technology_focus","operator":"contains","value":"connectivity"}]');

INSERT INTO growth_campaigns
  (name, objective, segment_id, offer, problem, promise, cta, owner_email, status, channel_plan, strategy, approval_status, created_by)
SELECT '2-to-25', 'Generate qualified Technology Advisor demos', id,
  'Net-X operational platform demo',
  'Operational and administrative load constrains small advisory-firm growth.',
  'Net-X gives a 2-person technology advisory business the operational capability of a 25-person organization.',
  'Book a Net-X Demo', 'adam@net-x.io', 'DRAFT',
  '["LINKEDIN_PERSONAL","LINKEDIN_COMPANY","NEWSLETTER","EMAIL","DIRECT_OUTREACH"]',
  'Lead with the operational capacity gap, support it with practical advisor workflows, and move engaged high-fit prospects toward a human-approved demo invitation.',
  'DRAFT', 'system:configuration'
FROM growth_segments WHERE name = 'Technology Advisors · 1–5 Employees';

INSERT INTO growth_integrations (integration_key, provider_name, capability, status, permissions_json) VALUES
  ('unipile', 'Unipile', 'LinkedIn conversations and outreach', 'NOT_CONNECTED', '["accounts:read","messages:read","messages:write"]'),
  ('linkedin_personal', 'LinkedIn Personal', 'Personal profile publishing and analytics', 'PARTIAL', '["openid","profile","w_member_social"]'),
  ('linkedin_company', 'LinkedIn Company Pages', 'Organization publishing and analytics', 'NOT_CONNECTED', '["organization:read","organization:write"]'),
  ('postmark', 'Postmark', 'Newsletter and email delivery', 'NOT_CONNECTED', '["server:send","webhooks:receive"]'),
  ('enrichment', 'Provider TBD', 'Person and company enrichment', 'NOT_CONNECTED', '["records:read","enrichment:write"]'),
  ('signal_collector', 'Collector TBD', 'Compliant social and public-web signals', 'NOT_CONNECTED', '["watchlists:read","signals:write"]'),
  ('scheduling', 'Calendly / Google Calendar', 'Demo scheduling', 'NOT_CONNECTED', '["events:read","webhooks:receive"]'),
  ('linkedin_ads', 'LinkedIn Ads', 'Paid campaign delivery and metrics', 'NOT_CONNECTED', '["campaigns:read","analytics:read"]'),
  ('google_ads', 'Google Ads', 'Paid search delivery and metrics', 'NOT_CONNECTED', '["campaigns:read","analytics:read"]');

INSERT INTO devos_agents (id,slug,name,category,role,purpose,human_owner,status,autonomy_level,default_model_provider,default_model,implementation) VALUES
  ('agent-growth-prospect','prospect-analyst','Prospect Analyst','Growth','Prospect analysis','Analyzes prospect records and evidence without modifying or contacting prospects.','Growth','active','Read/analyze','OpenAI','Existing configured model','new'),
  ('agent-growth-icp','icp-analyst','ICP Analyst','Growth','ICP analysis','Explains deterministic ICP scores without fabricating facts.','Growth','active','Read/analyze','OpenAI','Existing configured model','new'),
  ('agent-growth-signal','signal-analyst','Signal Analyst','Growth','Signal analysis','Interprets normalized Growth Signals and recommends human actions.','Growth','active','Read/analyze','OpenAI','Existing configured model','new'),
  ('agent-growth-campaign','campaign-strategist','Campaign Strategist','Growth','Campaign strategy','Drafts campaign strategy from audience, offer, problem, promise and CTA.','Growth','active','Read/analyze/draft','OpenAI','Existing configured model','new'),
  ('agent-growth-content','growth-content-writer','Content Writer','Growth','Campaign content','Drafts campaign-connected assets using the selected employee playbook.','Growth','active','Draft only','OpenAI','Existing configured model','new'),
  ('agent-growth-outreach','outreach-writer','Outreach Writer','Growth','Outreach drafting','Drafts one-to-one outreach but has no external sending tool.','Growth','active','Draft only','OpenAI','Existing configured model','new'),
  ('agent-growth-newsletter','newsletter-writer','Newsletter Writer','Growth','Newsletter drafting','Drafts campaign-connected newsletter sections for human review.','Growth','active','Draft only','OpenAI','Existing configured model','new'),
  ('agent-growth-conversation','conversation-analyst','Conversation Analyst','Growth','Conversation analysis','Summarizes conversations and recommends next actions.','Growth','active','Read/analyze','OpenAI','Existing configured model','new'),
  ('agent-growth-reply','reply-assistant','Reply Assistant','Growth','Reply drafting','Drafts suggested replies without sending them.','Growth','active','Draft only','OpenAI','Existing configured model','new'),
  ('agent-growth-advisor','growth-advisor','Growth Advisor','Growth','Daily growth priorities','Uses internal Growth evidence to recommend the highest-value human actions.','Adam','active','Read/analyze/draft','OpenAI','Existing configured model','new');

INSERT INTO devos_agent_tools (id,agent_slug,tool_name,permission,enabled,configuration_json)
SELECT 'tool-' || slug || '-growth-read', slug, 'Growth CRM', 'READ', 1, '{"externalSend":false}'
FROM devos_agents WHERE category='Growth';
INSERT INTO devos_agent_tools (id,agent_slug,tool_name,permission,enabled,configuration_json)
SELECT 'tool-' || slug || '-growth-analyze', slug, 'Growth analysis', 'ANALYZE', 1, '{"evidenceRequired":true}'
FROM devos_agents WHERE category='Growth';
INSERT INTO devos_agent_tools (id,agent_slug,tool_name,permission,enabled,configuration_json)
SELECT 'tool-' || slug || '-growth-draft', slug, 'Growth drafts', 'DRAFT', 1, '{"externalSend":false,"approvalRequired":true}'
FROM devos_agents WHERE category='Growth' AND autonomy_level IN ('Read/analyze/draft','Draft only');
