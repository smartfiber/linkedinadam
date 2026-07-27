INSERT OR IGNORE INTO playbooks (
  role_name,
  primary_audience,
  secondary_audience,
  primary_expertise,
  core_buyer_problem,
  positioning_statement,
  recurring_series,
  weekly_original_posts,
  weekly_short_posts,
  weekly_meaningful_comments,
  weekly_new_connections,
  lead_magnet,
  soft_cta,
  qualified_buying_signal,
  lead_handoff_action,
  guardrail
) VALUES (
  'Founder / Managing Partner',
  'CEOs, CIOs, CFOs and IT executives',
  'MSP owners and strategic partners',
  'Telecom procurement strategy, industry direction and customer advocacy',
  'Enterprise telecom buying is fragmented, opaque and difficult to manage',
  'Helping enterprises make better carrier, connectivity and telecom-contract decisions',
  'What Telecom Buyers Are Not Being Told',
  2,
  1,
  20,
  25,
  'Executive Telecom Procurement Scorecard',
  'Happy to share the scorecard we use.',
  'CIO mentions renewal, cost pressure, service instability, acquisition or multi-location complexity',
  'Route to senior sales owner and note executive context',
  'Avoid unsupported market claims and avoid turning every post into a company pitch'
);

INSERT OR IGNORE INTO playbooks (
  role_name,
  primary_audience,
  secondary_audience,
  primary_expertise,
  core_buyer_problem,
  positioning_statement,
  recurring_series,
  weekly_original_posts,
  weekly_short_posts,
  weekly_meaningful_comments,
  weekly_new_connections,
  lead_magnet,
  soft_cta,
  qualified_buying_signal,
  lead_handoff_action,
  guardrail
) VALUES (
  'Implementation and Project Management Advisor',
  'IT program managers, store development and infrastructure leaders',
  'Construction teams, carriers and vendors',
  'Telecom provisioning, milestones, dependencies, escalations and multi-site rollout governance',
  'Orders fail because responsibilities, dependencies, construction and acceptance steps are not actively managed',
  'Helping organizations turn signed telecom orders into working services without losing control of the timeline',
  'From Order to Turn-Up',
  2,
  2,
  20,
  20,
  'Circuit Implementation Milestone Tracker',
  'I can share the milestone tracker.',
  'Buyer mentions delayed installs, openings, migrations or lack of carrier status',
  'Route to implementation sales owner with affected orders and critical dates',
  'Never expose live customer order details or blame named individuals'
);

INSERT OR REPLACE INTO employee_playbooks (
  employee_id,
  playbook_id,
  assigned_at
)
SELECT
  employees.id,
  playbooks.id,
  CURRENT_TIMESTAMP
FROM employees
JOIN playbooks
  ON playbooks.role_name = 'Founder / Managing Partner'
WHERE employees.id = 1;
