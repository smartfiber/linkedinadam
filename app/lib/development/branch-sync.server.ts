import type {
  BranchMappingStatus,
  BranchSyncRow,
  BranchSyncState,
} from "./branch-sync";
import { categoriesForRow } from "./branch-sync";

type RawRow = {
  id: string;
  external_key: string | null;
  title: string;
  priority: string;
  product_area: string | null;
  owner_email: string | null;
  overall_status: string;
  adam_qa: string | null;
  joe_qa: string | null;
  updated_at: string;
  issue_number: number | null;
  issue_url: string | null;
  issue_state: string | null;
  pr_number: number | null;
  pr_url: string | null;
  pr_state: string | null;
  pr_payload: string | null;
  adam_state: string | null;
  adam_sha: string | null;
  adam_comparison: string | null;
  adam_confidence: string | null;
  adam_notes: string | null;
  adam_checked: string | null;
  joe_state: string | null;
  joe_sha: string | null;
  joe_comparison: string | null;
  joe_confidence: string | null;
  joe_notes: string | null;
  joe_checked: string | null;
  dev_state: string | null;
  dev_sha: string | null;
  dev_comparison: string | null;
  dev_confidence: string | null;
  dev_notes: string | null;
  dev_checked: string | null;
  main_state: string | null;
  main_sha: string | null;
  main_comparison: string | null;
  main_confidence: string | null;
  main_notes: string | null;
  main_checked: string | null;
};

function state(
  row: RawRow,
  prefix: "adam" | "joe" | "dev" | "main",
): BranchSyncState {
  return {
    state: row[`${prefix}_state`] || "unknown",
    sha: row[`${prefix}_sha`],
    comparison: row[`${prefix}_comparison`] || "UNKNOWN",
    confidence: row[`${prefix}_confidence`] || "UNKNOWN",
    notes: row[`${prefix}_notes`],
    checkedAt: row[`${prefix}_checked`],
  };
}

function parsePayload(value: string | null) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function normalize(row: RawRow): BranchSyncRow {
  const payload = parsePayload(row.pr_payload);
  const checks = Array.isArray(payload.checks) ? payload.checks : [];
  const ci = checks.some((check: { conclusion?: string }) =>
    [
      "failure",
      "cancelled",
      "timed_out",
      "action_required",
      "startup_failure",
    ].includes(check.conclusion || ""),
  )
    ? "Failing"
    : checks.some((check: { status?: string }) => check.status !== "completed")
      ? "Pending"
      : checks.length
        ? "Passing"
        : "Unknown";
  return {
    id: row.id,
    externalKey: row.external_key,
    title: row.title,
    priority: row.priority,
    productArea: row.product_area,
    ownerEmail: row.owner_email,
    overallStatus: row.overall_status,
    adamQa: row.adam_qa || "pending",
    joeQa: row.joe_qa || "pending",
    updatedAt: row.updated_at,
    issueNumber: row.issue_number,
    issueUrl: row.issue_url,
    issueState: row.issue_state,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    prState: row.pr_state,
    sourceBranch: payload.sourceBranch || null,
    targetBranch: payload.targetBranch || null,
    changedFiles: Array.isArray(payload.changedFiles)
      ? payload.changedFiles
      : [],
    ci,
    adam: state(row, "adam"),
    joe: state(row, "joe"),
    dev: state(row, "dev"),
    main: state(row, "main"),
  };
}

export async function listBranchSyncRows(db: D1Database) {
  const result = await db
    .prepare(
      `
    SELECT r.id, r.external_key, r.title, r.priority, r.product_area, r.owner_email,
      r.overall_status, r.updated_at,
      (SELECT a.decision FROM development_approvals a WHERE a.development_request_id=r.id AND a.stage='ADAM_QA' ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS adam_qa,
      (SELECT a.decision FROM development_approvals a WHERE a.development_request_id=r.id AND a.stage='JOE_QA' ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS joe_qa,
      issue.number AS issue_number, issue.state AS issue_state,
      json_extract(issue.payload_json, '$.htmlUrl') AS issue_url,
      pr.number AS pr_number, pr.state AS pr_state, pr.payload_json AS pr_payload,
      json_extract(pr.payload_json, '$.htmlUrl') AS pr_url,
      adam.state AS adam_state, adam.commit_sha AS adam_sha, adam.comparison_state AS adam_comparison,
      adam.confidence AS adam_confidence, adam.equivalence_notes AS adam_notes, adam.checked_at AS adam_checked,
      joe.state AS joe_state, joe.commit_sha AS joe_sha, joe.comparison_state AS joe_comparison,
      joe.confidence AS joe_confidence, joe.equivalence_notes AS joe_notes, joe.checked_at AS joe_checked,
      dev.state AS dev_state, dev.commit_sha AS dev_sha, dev.comparison_state AS dev_comparison,
      dev.confidence AS dev_confidence, dev.equivalence_notes AS dev_notes, dev.checked_at AS dev_checked,
      main.state AS main_state, main.commit_sha AS main_sha, main.comparison_state AS main_comparison,
      main.confidence AS main_confidence, main.equivalence_notes AS main_notes, main.checked_at AS main_checked
    FROM development_requests r
    LEFT JOIN development_links issue_link ON issue_link.id=(SELECT MIN(i.id) FROM development_links i WHERE i.development_request_id=r.id AND i.provider='github' AND i.type='issue')
    LEFT JOIN github_sync_items issue ON issue.kind='issue' AND issue.number=CAST(issue_link.external_id AS INTEGER)
    LEFT JOIN development_links pr_link ON pr_link.id=(SELECT MAX(p.id) FROM development_links p WHERE p.development_request_id=r.id AND p.provider='github' AND p.type='pull_request')
    LEFT JOIN github_sync_items pr ON pr.kind='pull_request' AND pr.number=CAST(pr_link.external_id AS INTEGER)
    LEFT JOIN development_branch_states adam ON adam.development_request_id=r.id AND adam.branch='adam'
    LEFT JOIN development_branch_states joe ON joe.development_request_id=r.id AND joe.branch='joe'
    LEFT JOIN development_branch_states dev ON dev.development_request_id=r.id AND dev.branch='dev'
    LEFT JOIN development_branch_states main ON main.development_request_id=r.id AND main.branch='main'
    WHERE issue.id IS NOT NULL OR pr.id IS NOT NULL
    ORDER BY CASE r.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, r.updated_at DESC
  `,
    )
    .all<RawRow>();
  return (result.results || []).map(normalize);
}

export async function getBranchMappings(db: D1Database) {
  const result = await db
    .prepare(
      "SELECT role, branch_name, status, candidates_json, sha, checked_at FROM github_branch_mappings ORDER BY CASE role WHEN 'adam' THEN 0 WHEN 'joe' THEN 1 WHEN 'dev' THEN 2 ELSE 3 END",
    )
    .all<{
      role: BranchMappingStatus["role"];
      branch_name: string | null;
      status: string;
      candidates_json: string | null;
      sha: string | null;
      checked_at: string;
    }>();
  return (result.results || []).map((mapping) => ({
    role: mapping.role,
    branchName: mapping.branch_name,
    status: mapping.status,
    sha: mapping.sha,
    checkedAt: mapping.checked_at,
    candidates: parsePayload(mapping.candidates_json) as string[],
  }));
}

export function summarizeBranchSync(rows: BranchSyncRow[], joeMapped: boolean) {
  const counts = {
    adamOnly: 0,
    joeOnly: 0,
    personalDev: 0,
    devMain: 0,
    mainVerify: 0,
    ciBlocking: 0,
    mappingRequired: 0,
    unknown: 0,
  };
  for (const row of rows) {
    const categories = categoriesForRow(row, joeMapped);
    if (categories.includes("adam_only")) counts.adamOnly += 1;
    if (categories.includes("joe_only")) counts.joeOnly += 1;
    if (categories.includes("personal_dev")) counts.personalDev += 1;
    if (categories.includes("dev_main")) counts.devMain += 1;
    if (categories.includes("main_verify")) counts.mainVerify += 1;
    if (categories.includes("ci_blocking")) counts.ciBlocking += 1;
    if (categories.includes("mapping_required")) counts.mappingRequired += 1;
    if (categories.includes("unknown")) counts.unknown += 1;
  }
  return counts;
}
