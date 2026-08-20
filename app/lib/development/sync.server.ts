import {
  createGitHubReadAdapter,
  githubConfigurationError,
  type GitHubBranchSnapshot,
  type GitHubChangedFileSnapshot,
  type GitHubCompareSnapshot,
  type GitHubEnvironment,
  type GitHubIssueSnapshot,
  type GitHubPullRequestSnapshot,
  type GitHubReadAdapter,
} from "../integrations/github.server";
import { insertActivity } from "./repository.server";

type SyncDatabase = D1Database;

export type GitHubSyncOptions = {
  trigger?: "scheduled" | "manual_readiness";
  initiator?: string;
  adapter?: GitHubReadAdapter;
};

export type BranchMapping = {
  role: "adam" | "joe" | "dev" | "main";
  branchName: string | null;
  status: "MAPPED" | "NEEDS_MAPPING" | "NOT_FOUND" | "UNKNOWN";
  candidates: string[];
};

export function discoverBranchMappings(branches: GitHubBranchSnapshot[]): BranchMapping[] {
  const names = branches.map(branch => branch.name);
  const exact = (value: string) => names.find(name => name.toLowerCase() === value) || null;
  const joeCandidates = names.filter(name => /(^|[\/_-])joe($|[\/_-])/i.test(name) || /^joe/i.test(name));
  return [
    { role: "adam", branchName: exact("adam"), status: exact("adam") ? "MAPPED" : "NOT_FOUND", candidates: exact("adam") ? [exact("adam")!] : [] },
    { role: "joe", branchName: joeCandidates.length === 1 ? joeCandidates[0] : null, status: joeCandidates.length === 1 ? "MAPPED" : "NEEDS_MAPPING", candidates: joeCandidates },
    { role: "dev", branchName: exact("dev"), status: exact("dev") ? "MAPPED" : "NOT_FOUND", candidates: exact("dev") ? [exact("dev")!] : [] },
    { role: "main", branchName: exact("main"), status: exact("main") ? "MAPPED" : "NOT_FOUND", candidates: exact("main") ? [exact("main")!] : [] },
  ];
}

export function issueNumbersFromText(text: string | null) {
  if (!text) return [];
  const values = [...text.matchAll(/(?:\b(?:closes?|fixes?|resolves?)\s+)?#(\d+)\b/gi)].map(match => Number(match[1]));
  return Array.from(new Set(values));
}

export function checkState(pr: GitHubPullRequestSnapshot) {
  if (pr.checks.some(check => ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(check.conclusion || ""))) return "CI Failing";
  if (pr.checks.length > 0 && pr.checks.every(check => check.status === "completed" && ["success", "neutral", "skipped"].includes(check.conclusion || ""))) return "CI Passed";
  if (pr.checks.some(check => check.status !== "completed")) return "CI Pending";
  return "CI Unknown";
}

export function nextActionForPullRequest(pr: GitHubPullRequestSnapshot) {
  const ci = checkState(pr);
  if (ci === "CI Failing") return "PR checks failing";
  if (pr.merged && pr.targetBranch === "main") return "Merged to main — needs production verification";
  if (pr.merged && pr.targetBranch === "dev") return "On dev, needs Dev QA";
  if (pr.state === "open" && pr.approvals > 0 && ci === "CI Passed") return `Ready to merge to ${pr.targetBranch}`;
  if (pr.state === "open" && pr.reviewers.length === 0) return "Needs review assignment";
  return ci;
}

function normalizedPatch(file: GitHubChangedFileSnapshot) {
  if (!file.patch) return null;
  const patch = file.patch.split("\n").filter(line => !line.startsWith("@@")).join("\n").replace(/[ \t]+$/gm, "").trim();
  return `${file.filename}\u0000${file.status}\u0000${patch}`;
}

export function patchEquivalence(filesA: GitHubChangedFileSnapshot[], filesB: GitHubChangedFileSnapshot[]) {
  const a = filesA.map(normalizedPatch).sort(); const b = filesB.map(normalizedPatch).sort();
  if (!a.length || !b.length || a.some(value => value === null) || b.some(value => value === null)) return { state: "UNKNOWN", confidence: "UNKNOWN" } as const;
  if (a.length === b.length && a.every((value, index) => value === b[index])) return { state: "PATCH_EQUIVALENT", confidence: "HIGH" } as const;
  return { state: "UNKNOWN", confidence: "UNKNOWN" } as const;
}

export async function computeBranchState(pr: GitHubPullRequestSnapshot, branch: GitHubBranchSnapshot, compare: (base: string, head: string) => Promise<GitHubCompareSnapshot>) {
  const expectedSha = pr.merged && pr.mergeSha ? pr.mergeSha : pr.headSha;
  if (branch.sha === expectedSha) return { state: "present", relationship: "EXACT", confidence: "HIGH", checkedSha: branch.sha } as const;
  const ancestry = await compare(expectedSha, branch.name);
  if (ancestry.status === "ahead" || ancestry.status === "identical") return { state: "present", relationship: "EXACT", confidence: "HIGH", checkedSha: branch.sha } as const;
  const branchDiff = await compare(pr.targetBranch, branch.name);
  const equivalent = patchEquivalence(pr.changedFiles, branchDiff.files);
  if (equivalent.state === "PATCH_EQUIVALENT") return { state: "patch_equivalent", relationship: equivalent.state, confidence: equivalent.confidence, checkedSha: branch.sha } as const;
  const relationship = ancestry.status === "behind" ? "BEHIND" : ancestry.status === "diverged" ? "DIVERGED" : "NOT_PRESENT";
  return { state: "not_present", relationship, confidence: ancestry.status === "unknown" ? "UNKNOWN" : "HIGH", checkedSha: branch.sha } as const;
}

function priorityForIssue(issue: GitHubIssueSnapshot) {
  if (issue.labels.some(label => /p0|critical|security/i.test(label))) return "P0";
  if (issue.labels.some(label => /p1|high/i.test(label))) return "P1";
  return "P2";
}
function typeForIssue(issue: GitHubIssueSnapshot) {
  const label = issue.labels.find(value => /security|bug|feature|ux|performance|data|technical debt|integrity/i.test(value));
  if (!label) return "Other";
  if (/security/i.test(label)) return "Security"; if (/bug/i.test(label)) return "Bug"; if (/feature/i.test(label)) return "Feature";
  if (/ux/i.test(label)) return "UX"; if (/performance/i.test(label)) return "Performance"; if (/data/i.test(label)) return "Data"; if (/integrity/i.test(label)) return "Integrity"; return "Technical Debt";
}

async function upsertItem(db: SyncDatabase, input: { kind: "issue" | "pull_request"; providerId: number; number: number; requestId: string; title: string; state: string; updatedAt: string; payload: unknown; }) {
  const payloadJson = JSON.stringify(input.payload);
  const existing = await db.prepare("SELECT id, development_request_id, github_updated_at, payload_json FROM github_sync_items WHERE kind = ? AND provider_id = ?").bind(input.kind, input.providerId).first<{ id: number; development_request_id: string | null; github_updated_at: string | null; payload_json: string }>();
  await db.prepare(`INSERT INTO github_sync_items (provider_id, kind, number, development_request_id, title, state, payload_json, github_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(kind, provider_id) DO UPDATE SET number = excluded.number, development_request_id = COALESCE(github_sync_items.development_request_id, excluded.development_request_id), title = excluded.title, state = excluded.state, payload_json = excluded.payload_json, github_updated_at = excluded.github_updated_at, last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`).bind(input.providerId, input.kind, input.number, input.requestId, input.title, input.state, payloadJson, input.updatedAt).run();
  return { isNew: !existing, changed: existing?.github_updated_at !== input.updatedAt || existing?.payload_json !== payloadJson, requestId: existing?.development_request_id || input.requestId };
}

async function ensureRequest(db: SyncDatabase, input: { kind: "issue" | "pull_request"; providerId: number; number: number; title: string; body: string | null; author: string | null; priority?: string; type?: string; nextAction?: string; }) {
  const externalKey = `github:${input.kind}:${input.providerId}`;
  const existing = await db.prepare("SELECT id FROM development_requests WHERE external_key = ?").bind(externalKey).first<{ id: string }>();
  if (existing) return { id: existing.id, created: false };
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO development_requests (id, external_key, title, problem, priority, type, requested_by_type, requested_by_name, overall_status, next_action) VALUES (?, ?, ?, ?, ?, ?, 'github', ?, 'open', ?)`).bind(id, externalKey, input.title, input.body, input.priority || "P2", input.type || "Other", input.author || "GitHub", input.nextAction || "Review GitHub status").run();
  return { id, created: true };
}

async function reconcileExistingRequest(db: SyncDatabase, kind: "issue" | "pull_request", number: number, url: string) {
  const linked = await db.prepare("SELECT development_request_id FROM development_links WHERE provider = 'github' AND type = ? AND external_id = ?").bind(kind, String(number)).first<{ development_request_id: string }>();
  if (linked) return linked.development_request_id;
  const byUrl = await db.prepare("SELECT development_request_id FROM development_links WHERE url = ? LIMIT 2").bind(url).all<{ development_request_id: string }>();
  return byUrl.results?.length === 1 ? byUrl.results[0].development_request_id : null;
}

async function link(db: SyncDatabase, requestId: string, type: "issue" | "pull_request", number: number, url: string, payload: unknown) {
  await db.prepare("INSERT OR IGNORE INTO development_links (development_request_id, provider, type, external_id, url, metadata_json) VALUES (?, 'github', ?, ?, ?, ?)").bind(requestId, type, String(number), url, JSON.stringify(payload)).run();
}

function safeSyncError(error: unknown) {
  if (error instanceof Error && /^GitHub (?:API|installation token)/.test(error.message)) return error.message.slice(0, 500);
  return "GitHub read-only synchronization failed.";
}

export async function syncNetXRepository(db: SyncDatabase, env: GitHubEnvironment, options: GitHubSyncOptions = {}) {
  const configError = githubConfigurationError(env);
  if (configError) return { status: "skipped" as const, error: configError, issues: 0, pullRequests: 0, created: 0, matched: 0, ambiguous: 0 };
  const trigger = options.trigger || "scheduled";
  const initiator = options.initiator || "system";
  const run = await db.prepare("INSERT INTO github_sync_runs (status) SELECT 'running' WHERE NOT EXISTS (SELECT 1 FROM github_sync_runs WHERE status = 'running') RETURNING id").first<{ id: number }>();
  if (!run) return { status: "rejected" as const, error: "GitHub sync already in progress", issues: 0, pullRequests: 0, created: 0, matched: 0, ambiguous: 0 };
  await db.prepare("INSERT INTO development_activity_events (actor_type, actor_identity, event_type, source, summary, metadata_json) VALUES (?, ?, 'github_sync_started', 'github', ?, ?)")
    .bind(trigger === "manual_readiness" ? "HUMAN" : "SYSTEM", initiator, `GitHub ${trigger === "manual_readiness" ? "readiness " : ""}sync started.`, JSON.stringify({ syncRunId: run.id, trigger })).run();
  try {
    const adapter = options.adapter || createGitHubReadAdapter(env); const [issues, pullRequests, branches] = await Promise.all([adapter.listIssues(), adapter.listPullRequests(), adapter.listBranches()]);
    let created = 0; let matched = 0; let ambiguous = 0;
    for (const issue of issues) {
      const reconciledId = await reconcileExistingRequest(db, "issue", issue.number, issue.htmlUrl);
      const request = reconciledId ? { id: reconciledId, created: false } : await ensureRequest(db, { kind: "issue", providerId: issue.id, number: issue.number, title: issue.title, body: issue.body, author: issue.author, priority: priorityForIssue(issue), type: typeForIssue(issue) });
      const item = await upsertItem(db, { kind: "issue", providerId: issue.id, number: issue.number, requestId: request.id, title: issue.title, state: issue.state, updatedAt: issue.updatedAt, payload: issue });
      await link(db, request.id, "issue", issue.number, issue.htmlUrl, issue); request.created ? created += 1 : matched += 1;
      if (item.changed || item.isNew) await db.batch([insertActivity(db, { actorType: "SYSTEM", actorIdentity: "github-sync", eventType: item.isNew ? "github_issue_discovered" : "github_issue_updated", requestId: request.id, source: "github", summary: `GitHub issue #${issue.number} ${item.isNew ? "discovered" : "updated"}.`, metadata: { number: issue.number, url: issue.htmlUrl } })]);
    }
    for (const pr of pullRequests) {
      const references = issueNumbersFromText(`${pr.title}\n${pr.body || ""}`); const referencedIssue = references.length === 1 ? await db.prepare("SELECT development_request_id FROM github_sync_items WHERE kind = 'issue' AND number = ?").bind(references[0]).first<{ development_request_id: string | null }>() : null;
      if (references.length > 1 && !referencedIssue) ambiguous += 1;
      const reconciledId = await reconcileExistingRequest(db, "pull_request", pr.number, pr.htmlUrl);
      const request = referencedIssue?.development_request_id ? { id: referencedIssue.development_request_id, created: false } : reconciledId ? { id: reconciledId, created: false } : await ensureRequest(db, { kind: "pull_request", providerId: pr.id, number: pr.number, title: pr.title, body: pr.body, author: pr.author, nextAction: nextActionForPullRequest(pr) });
      const item = await upsertItem(db, { kind: "pull_request", providerId: pr.id, number: pr.number, requestId: request.id, title: pr.title, state: pr.merged ? "merged" : pr.state, updatedAt: pr.updatedAt, payload: pr });
      await link(db, request.id, "pull_request", pr.number, pr.htmlUrl, pr); if (request.created) created += 1; else matched += 1;
      await db.prepare("UPDATE development_requests SET next_action = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND requested_by_type = 'github'").bind(nextActionForPullRequest(pr), request.id).run();
      if (item.changed || item.isNew) await db.batch([insertActivity(db, { actorType: "SYSTEM", actorIdentity: "github-sync", eventType: item.isNew ? "github_pr_discovered" : "github_pr_updated", requestId: request.id, source: "github", summary: `GitHub PR #${pr.number} ${pr.merged ? "merged" : "updated"}.`, metadata: { number: pr.number, url: pr.htmlUrl, targetBranch: pr.targetBranch, headSha: pr.headSha, nextAction: nextActionForPullRequest(pr) } })]);
    }
    const mappings = discoverBranchMappings(branches);
    for (const mapping of mappings) {
      const branch = mapping.branchName ? branches.find(value => value.name === mapping.branchName) : null;
      await db.prepare("INSERT INTO github_branch_mappings (role, branch_name, status, candidates_json, sha, checked_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(role) DO UPDATE SET branch_name = excluded.branch_name, status = excluded.status, candidates_json = excluded.candidates_json, sha = excluded.sha, checked_at = CURRENT_TIMESTAMP").bind(mapping.role, mapping.branchName, mapping.status, JSON.stringify(mapping.candidates), branch?.sha || null).run();
    }
    for (const pr of pullRequests) {
      const item = await db.prepare("SELECT development_request_id FROM github_sync_items WHERE kind = 'pull_request' AND provider_id = ?").bind(pr.id).first<{ development_request_id: string | null }>();
      if (!item?.development_request_id) continue;
      for (const mapping of mappings) {
        const branch = mapping.branchName ? branches.find(value => value.name === mapping.branchName) : null;
        const result = branch ? await computeBranchState(pr, branch, adapter.compare) : { state: "unknown" as const, relationship: "UNKNOWN", confidence: "UNKNOWN", checkedSha: null };
        await db.prepare("INSERT INTO development_branch_states (development_request_id, branch, state, commit_sha, comparison_state, confidence, equivalence_notes, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(development_request_id, branch) DO UPDATE SET state = excluded.state, commit_sha = excluded.commit_sha, comparison_state = excluded.comparison_state, confidence = excluded.confidence, equivalence_notes = excluded.equivalence_notes, checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP").bind(item.development_request_id, mapping.role, result.state, result.checkedSha, result.relationship, result.confidence, result.relationship === "PATCH_EQUIVALENT" ? "Normalized patches match exactly." : "Computed from GitHub commit ancestry and conservative patch comparison.").run();
      }
    }
    await db.prepare("UPDATE github_sync_runs SET status = 'succeeded', issues_seen = ?, pull_requests_seen = ?, created_count = ?, matched_count = ?, ambiguous_count = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?").bind(issues.length, pullRequests.length, created, matched, ambiguous, run?.id || 0).run();
    await db.prepare("INSERT INTO development_activity_events (actor_type, actor_identity, event_type, source, summary, metadata_json) VALUES (?, ?, 'github_sync_completed', 'github', ?, ?)")
      .bind(trigger === "manual_readiness" ? "HUMAN" : "SYSTEM", initiator, `GitHub ${trigger === "manual_readiness" ? "readiness " : ""}sync completed.`, JSON.stringify({ syncRunId: run.id, trigger })).run();
    return { status: "succeeded" as const, runId: run.id, issues: issues.length, pullRequests: pullRequests.length, branches: branches.length, created, matched, ambiguous, skipped: 0, conflicts: 0 };
  } catch (error) {
    const message = safeSyncError(error);
    await db.prepare("UPDATE github_sync_runs SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?").bind(message, run?.id || 0).run();
    await db.prepare("INSERT INTO development_activity_events (actor_type, actor_identity, event_type, source, summary, metadata_json) VALUES (?, ?, 'github_sync_failed', 'github', ?, ?)")
      .bind(trigger === "manual_readiness" ? "HUMAN" : "SYSTEM", initiator, `GitHub ${trigger === "manual_readiness" ? "readiness " : ""}sync failed.`, JSON.stringify({ syncRunId: run.id, trigger })).run();
    return { status: "failed" as const, runId: run.id, error: message, issues: 0, pullRequests: 0, branches: 0, created: 0, matched: 0, ambiguous: 0, skipped: 0, conflicts: 0 };
  }
}
