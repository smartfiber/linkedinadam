import type {
  ActivityEvent,
  DevelopmentApproval,
  DevelopmentFilters,
  DevelopmentRequest,
  DevelopmentSummary,
  QaHandoff,
  GitHubSyncStatus,
} from "./types";

type DevelopmentDatabase = D1Database;

function queryParts(filters: DevelopmentFilters) {
  const where: string[] = [];
  const bindings: string[] = [];

  if (filters.search) {
    where.push("(r.title LIKE ? OR r.external_key LIKE ? OR r.problem LIKE ?)");
    const search = `%${filters.search}%`;
    bindings.push(search, search, search);
  }
  if (filters.priority) {
    where.push("r.priority = ?");
    bindings.push(filters.priority);
  }
  if (filters.owner) {
    where.push("r.owner_email = ?");
    bindings.push(filters.owner);
  }
  if (filters.status) {
    where.push("r.overall_status = ?");
    bindings.push(filters.status);
  }
  if (filters.attention === "ci_failing") {
    where.push("EXISTS (SELECT 1 FROM github_sync_items g, json_each(g.payload_json, '$.checks') c WHERE g.development_request_id = r.id AND g.kind = 'pull_request' AND json_extract(c.value, '$.conclusion') IN ('failure', 'cancelled', 'timed_out', 'action_required'))");
  }
  if (filters.attention === "unknown_sync") {
    where.push("EXISTS (SELECT 1 FROM development_branch_states s WHERE s.development_request_id = r.id AND s.state = 'unknown')");
  }
  const viewClauses: Partial<Record<NonNullable<DevelopmentFilters["view"]>, string>> = {
    needs_adam: "r.overall_status = 'awaiting_adam'", needs_joe: "r.overall_status = 'awaiting_joe'",
    urgent: "r.priority IN ('P0','P1') AND r.overall_status NOT IN ('verified','closed')",
    awaiting_approval: "r.overall_status = 'awaiting_mutual_approval'", ready_dev: "r.overall_status = 'ready_for_dev'",
    on_dev: "r.overall_status = 'on_dev'", ready_main: "r.overall_status = 'ready_for_main'",
    main_verify: "r.overall_status = 'on_main_needs_verification'", blocked: "r.overall_status = 'blocked'",
    sync_unknown: "EXISTS (SELECT 1 FROM development_branch_states s WHERE s.development_request_id = r.id AND s.state = 'unknown')",
  };
  if (filters.view && viewClauses[filters.view]) where.push(viewClauses[filters.view]!);

  return {
    clause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    bindings,
  };
}

export async function listDevelopmentRequests(
  db: DevelopmentDatabase,
  filters: DevelopmentFilters = {},
) {
  const query = queryParts(filters);
  return db
    .prepare(`
      SELECT
        r.*,
        issue.url AS issue_url,
        pr.url AS pr_url,
        (SELECT number FROM github_sync_items g WHERE g.development_request_id = r.id AND g.kind = 'issue' ORDER BY number LIMIT 1) AS issue_number,
        (SELECT number FROM github_sync_items g WHERE g.development_request_id = r.id AND g.kind = 'pull_request' ORDER BY number DESC LIMIT 1) AS pr_number,
        (SELECT state FROM github_sync_items g WHERE g.development_request_id = r.id AND g.kind = 'pull_request' ORDER BY number DESC LIMIT 1) AS pr_state,
        (SELECT json_extract(payload_json, '$.sourceBranch') FROM github_sync_items g WHERE g.development_request_id = r.id AND g.kind = 'pull_request' ORDER BY number DESC LIMIT 1) AS source_branch,
        (SELECT json_extract(payload_json, '$.targetBranch') FROM github_sync_items g WHERE g.development_request_id = r.id AND g.kind = 'pull_request' ORDER BY number DESC LIMIT 1) AS target_branch,
        CASE
          WHEN EXISTS (SELECT 1 FROM github_sync_items g, json_each(g.payload_json, '$.checks') c WHERE g.development_request_id = r.id AND g.kind = 'pull_request' AND json_extract(c.value, '$.conclusion') IN ('failure','cancelled','timed_out','action_required')) THEN 'CI Failing'
          WHEN EXISTS (SELECT 1 FROM github_sync_items g, json_each(g.payload_json, '$.checks') c WHERE g.development_request_id = r.id AND g.kind = 'pull_request' AND json_extract(c.value, '$.status') <> 'completed') THEN 'CI Pending'
          WHEN EXISTS (SELECT 1 FROM github_sync_items g, json_each(g.payload_json, '$.checks') c WHERE g.development_request_id = r.id AND g.kind = 'pull_request') THEN 'CI Passed'
          ELSE 'CI Unknown'
        END AS ci_state,
        COALESCE(adam.state, 'unknown') AS adam_state,
        COALESCE(joe.state, 'unknown') AS joe_state,
        COALESCE((
          SELECT a.decision
          FROM development_approvals a
          WHERE a.development_request_id = r.id
            AND a.stage = 'MUTUAL_APPROVAL'
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT 1
        ), 'unknown') AS approval_state,
        COALESCE(dev.state, 'unknown') AS dev_state,
        COALESCE(main_branch.state, 'unknown') AS main_state,
        CASE
          WHEN r.overall_status = 'blocked' THEN 'Resolve blocker'
          WHEN r.overall_status = 'awaiting_adam' THEN 'Adam QA / approval'
          WHEN r.overall_status = 'awaiting_joe' THEN 'Joe QA / approval'
          WHEN r.overall_status = 'awaiting_mutual_approval' THEN 'Mutual approval'
          WHEN r.overall_status = 'on_main_needs_verification' THEN 'Verify on Main'
          ELSE COALESCE(r.next_action, 'Review status')
        END AS next_action
      FROM development_requests r
      LEFT JOIN development_links issue
        ON issue.development_request_id = r.id
       AND issue.provider = 'github'
       AND issue.type = 'issue'
       AND issue.id = (SELECT MIN(i2.id) FROM development_links i2 WHERE i2.development_request_id = r.id AND i2.provider = 'github' AND i2.type = 'issue')
      LEFT JOIN development_links pr
        ON pr.development_request_id = r.id
       AND pr.provider = 'github'
       AND pr.type = 'pull_request'
       AND pr.id = (SELECT MAX(p2.id) FROM development_links p2 WHERE p2.development_request_id = r.id AND p2.provider = 'github' AND p2.type = 'pull_request')
      LEFT JOIN development_branch_states adam
        ON adam.development_request_id = r.id AND adam.branch = 'adam'
      LEFT JOIN development_branch_states joe
        ON joe.development_request_id = r.id AND joe.branch = 'joe'
      LEFT JOIN development_branch_states dev
        ON dev.development_request_id = r.id AND dev.branch = 'dev'
      LEFT JOIN development_branch_states main_branch
        ON main_branch.development_request_id = r.id AND main_branch.branch = 'main'
      ${query.clause}
      ORDER BY ${filters.sort === "updated" ? "r.updated_at DESC" : filters.sort === "next_action" ? "next_action ASC, r.updated_at DESC" : "CASE r.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, r.updated_at DESC"}
    `)
    .bind(...query.bindings)
    .all<DevelopmentRequest>();
}

export async function getDevelopmentSummary(db: DevelopmentDatabase) {
  const result = await db
    .prepare(`
      SELECT
        SUM(CASE WHEN priority = 'P0' AND overall_status NOT IN ('verified', 'closed') THEN 1 ELSE 0 END) AS p0Open,
        SUM(CASE WHEN priority = 'P1' AND overall_status NOT IN ('verified', 'closed') THEN 1 ELSE 0 END) AS p1Open,
        SUM(CASE WHEN overall_status = 'awaiting_adam' THEN 1 ELSE 0 END) AS awaitingAdam,
        SUM(CASE WHEN overall_status = 'awaiting_joe' THEN 1 ELSE 0 END) AS awaitingJoe,
        SUM(CASE WHEN overall_status = 'awaiting_mutual_approval' THEN 1 ELSE 0 END) AS awaitingMutualApproval,
        SUM(CASE WHEN overall_status = 'ready_for_dev' THEN 1 ELSE 0 END) AS readyForDev,
        SUM(CASE WHEN overall_status = 'on_dev' THEN 1 ELSE 0 END) AS onDev,
        SUM(CASE WHEN overall_status = 'ready_for_main' THEN 1 ELSE 0 END) AS readyForMain,
        SUM(CASE WHEN overall_status = 'on_main_needs_verification' THEN 1 ELSE 0 END) AS onMainNeedsVerification,
        SUM(CASE WHEN overall_status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
        SUM(CASE WHEN overall_status = 'verified' THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM github_sync_items g, json_each(g.payload_json, '$.checks') c WHERE g.development_request_id = development_requests.id AND json_extract(c.value, '$.conclusion') IN ('failure','cancelled','timed_out','action_required')) THEN 1 ELSE 0 END) AS ciFailing,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM development_branch_states s WHERE s.development_request_id = development_requests.id AND s.state = 'unknown') THEN 1 ELSE 0 END) AS unknownSync
      FROM development_requests
    `)
    .first<DevelopmentSummary>();

  return {
    p0Open: result?.p0Open || 0,
    p1Open: result?.p1Open || 0,
    awaitingAdam: result?.awaitingAdam || 0,
    awaitingJoe: result?.awaitingJoe || 0,
    awaitingMutualApproval: result?.awaitingMutualApproval || 0,
    readyForDev: result?.readyForDev || 0,
    onDev: result?.onDev || 0,
    readyForMain: result?.readyForMain || 0,
    onMainNeedsVerification: result?.onMainNeedsVerification || 0,
    blocked: result?.blocked || 0,
    verified: result?.verified || 0,
    ciFailing: result?.ciFailing || 0,
    unknownSync: result?.unknownSync || 0,
  } satisfies DevelopmentSummary;
}

export async function getDevelopmentRequest(db: DevelopmentDatabase, id: string) {
  const request = await db
    .prepare("SELECT * FROM development_requests WHERE id = ?")
    .bind(id)
    .first<DevelopmentRequest>();
  if (!request) return null;

  const [links, branches, qa, approvals, activity] = await Promise.all([
    db.prepare("SELECT * FROM development_links WHERE development_request_id = ? ORDER BY created_at")
      .bind(id).all(),
    db.prepare("SELECT * FROM development_branch_states WHERE development_request_id = ? ORDER BY branch")
      .bind(id).all(),
    db.prepare("SELECT * FROM qa_handoffs WHERE development_request_id = ? ORDER BY id")
      .bind(id).all<QaHandoff>(),
    db.prepare("SELECT * FROM development_approvals WHERE development_request_id = ? ORDER BY created_at DESC")
      .bind(id).all<DevelopmentApproval>(),
    db.prepare("SELECT * FROM development_activity_events WHERE development_request_id = ? ORDER BY occurred_at DESC")
      .bind(id).all<ActivityEvent>(),
  ]);

  return {
    request,
    links: links.results || [],
    branches: branches.results || [],
    qa: qa.results || [],
    approvals: approvals.results || [],
    activity: activity.results || [],
  };
}

export async function listNeedsAttention(db: DevelopmentDatabase, email: string) {
  return db
    .prepare(`
      SELECT id, title, priority, overall_status, next_action, updated_at
      FROM development_requests
      WHERE (owner_email = ? AND overall_status = 'blocked')
         OR (qa_partner_email = ? AND overall_status IN ('awaiting_adam', 'awaiting_joe'))
         OR (owner_email = ? AND overall_status IN ('awaiting_mutual_approval', 'on_main_needs_verification'))
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, updated_at DESC
      LIMIT 25
    `)
    .bind(email, email, email)
    .all<Pick<DevelopmentRequest, "id" | "title" | "priority" | "overall_status" | "next_action" | "updated_at">>();
}

export async function listActivity(db: DevelopmentDatabase, limit = 40) {
  return db
    .prepare("SELECT * FROM development_activity_events ORDER BY occurred_at DESC LIMIT ?")
    .bind(limit)
    .all<ActivityEvent>();
}

export async function getGitHubSyncStatus(db: DevelopmentDatabase): Promise<GitHubSyncStatus> {
  const [lastRun, branches] = await Promise.all([
    db.prepare("SELECT status, finished_at, error_message FROM github_sync_runs ORDER BY id DESC LIMIT 1").first<GitHubSyncStatus["lastRun"]>(),
    db.prepare("SELECT role, branch_name, status, sha FROM github_branch_mappings ORDER BY CASE role WHEN 'adam' THEN 0 WHEN 'joe' THEN 1 WHEN 'dev' THEN 2 ELSE 3 END").all<GitHubSyncStatus["branches"][number]>(),
  ]);
  return { lastRun: lastRun || null, branches: branches.results || [] };
}

export function insertDevelopmentRequest(
  db: DevelopmentDatabase,
  input: {
    id: string;
    title: string;
    problem?: string | null;
    whyDecision?: string | null;
    priority: string;
    type: string;
    productArea?: string | null;
    requestedByType: string;
    requestedByName: string;
    ownerEmail?: string | null;
    qaPartnerEmail?: string | null;
    overallStatus?: string;
    notes?: string | null;
    nextAction?: string | null;
  },
) {
  return db.prepare(`
    INSERT INTO development_requests (
      id, title, problem, why_decision, priority, type, product_area,
      requested_by_type, requested_by_name, owner_email, qa_partner_email,
      overall_status, notes, next_action
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.id, input.title, input.problem || null, input.whyDecision || null,
    input.priority, input.type, input.productArea || null, input.requestedByType,
    input.requestedByName, input.ownerEmail || null, input.qaPartnerEmail || null,
    input.overallStatus || "open", input.notes || null, input.nextAction || null,
  );
}

export function insertActivity(
  db: DevelopmentDatabase,
  input: {
    actorType: "HUMAN" | "SYSTEM" | "AGENT";
    actorIdentity: string;
    eventType: string;
    requestId?: string | null;
    source?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
) {
  return db.prepare(`
    INSERT INTO development_activity_events (
      actor_type, actor_identity, event_type, development_request_id,
      source, summary, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.actorType, input.actorIdentity, input.eventType, input.requestId || null,
    input.source || "backoffice", input.summary,
    input.metadata ? JSON.stringify(input.metadata) : null,
  );
}
