import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../app/lib/auth.server";
import { runManualGitHubReadinessSync } from "../app/lib/development/github-readiness.server";
import { syncNetXRepository } from "../app/lib/development/sync.server";
import type { GitHubIssueSnapshot, GitHubPullRequestCursor, GitHubPullRequestSnapshot, GitHubReadAdapter } from "../app/lib/integrations/github.server";

const owner: AuthenticatedUser = { email: "adam@net-x.io", displayName: "Adam", subject: "adam", role: "OWNER", source: "cloudflare-access" };
const admin: AuthenticatedUser = { ...owner, email: "joseph@net-x.io", displayName: "Joseph", role: "ADMIN" };
const viewer: AuthenticatedUser = { ...owner, email: "viewer@net-x.io", role: "VIEWER" };
const developer: AuthenticatedUser = { ...owner, email: "dev@net-x.io", role: "DEVELOPER" };
const privateKey = "private-key-test-sentinel";

function readOnlyAdapter(overrides: Partial<GitHubReadAdapter> = {}): GitHubReadAdapter {
  return {
    repository: { owner: "colossalbreacker", name: "net-x" },
    listIssues: async () => [],
    listPullRequests: async () => [],
    listBranches: async () => [{ name: "Adam", sha: "a" }, { name: "dev", sha: "d" }, { name: "main", sha: "m" }],
    compare: async () => ({ status: "unknown", aheadBy: 0, behindBy: 0, files: [] }),
    ...overrides,
  };
}

function fakeDatabase(initialRunning = false) {
  let running = initialRunning;
  let runRows = 0;
  const sql: string[] = [];
  const bindings: unknown[][] = [];
  return {
    get runRows() { return runRows; },
    get sql() { return sql; },
    get bindings() { return bindings; },
    prepare(statement: string) {
      sql.push(statement);
      let values: unknown[] = [];
      const prepared = {
        bind(...bound: unknown[]) { values = bound; bindings.push(bound); return prepared; },
        async first() {
          if (statement.includes("INSERT INTO github_sync_runs")) {
            if (running) return null;
            running = true; runRows += 1; return { id: runRows };
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (statement.includes("UPDATE github_sync_runs SET status = 'succeeded'") || statement.includes("UPDATE github_sync_runs SET status = 'failed'")) running = false;
          return { success: true, meta: { changes: 1 }, values };
        },
      };
      return prepared;
    },
    async batch(statements: unknown[]) { return statements; },
  } as unknown as D1Database & { readonly runRows: number; readonly sql: string[]; readonly bindings: unknown[][] };
}

function environment(db = fakeDatabase()) {
  return {
    linkedinadam_db: db,
    GITHUB_APP_ID: "4653503",
    GITHUB_APP_INSTALLATION_ID: "155240048",
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_REPOSITORY_OWNER: "colossalbreacker",
    GITHUB_REPOSITORY_NAME: "net-x",
    GITHUB_SYNC_ENABLED: "false",
  };
}

const issue = (number: number, state: "open" | "closed" = "open"): GitHubIssueSnapshot => ({ id: 10_000 + number, number, title: `Issue ${number}`, body: null, state, labels: [], author: "reporter", htmlUrl: `https://github.com/colossalbreacker/net-x/issues/${number}`, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z", closedAt: state === "closed" ? "2026-08-20T00:00:00Z" : null });
const pullRequest = (number: number, body: string | null): GitHubPullRequestSnapshot => ({ id: 20_000 + number, number, title: `PR ${number}`, body, state: "open", draft: false, sourceBranch: `feature/${number}`, targetBranch: "dev", headSha: `head-${number}`, mergeSha: null, merged: false, mergeable: true, author: "author", reviewers: [], approvals: 0, changedFiles: [], checks: [], htmlUrl: `https://github.com/colossalbreacker/net-x/pull/${number}`, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z", mergedAt: null });

function reconciliationDatabase(seed?: { issues?: number[]; pullRequests?: number[] }) {
  let running = false; let nextRun = 1; let nextItem = 1;
  const requests = new Map<string, { id: string; priority: string; why: string | null; owner: string | null; qa: string | null; notes: string | null }>();
  const items: Array<{ id: number; providerId: number; kind: string; number: number; requestId: string; payload: string; updatedAt: string }> = [];
  const links = new Map<string, { requestId: string; kind: string; number: number; url: string; payload: string }>();
  const completedCursors: GitHubPullRequestCursor[] = [];
  const nextActions = new Map<string, string>();
  function seedItem(kind: "issue" | "pull_request", number: number) {
    const requestId = `existing-${kind}-${number}`;
    requests.set(`github:${kind}:${kind === "issue" ? 10_000 + number : 20_000 + number}`, { id: requestId, priority: "P1", why: "human decision", owner: "owner@example.com", qa: "qa@example.com", notes: "human notes" });
    const snapshot = kind === "issue" ? issue(number) : pullRequest(number, number === 626 ? "Closes #603\nCloses #604" : null);
    items.push({ id: nextItem++, providerId: snapshot.id, kind, number, requestId, payload: JSON.stringify(snapshot), updatedAt: snapshot.updatedAt });
    links.set(`${requestId}:${kind}:${number}`, { requestId, kind, number, url: snapshot.htmlUrl, payload: JSON.stringify(snapshot) });
  }
  for (const number of seed?.issues || []) seedItem("issue", number);
  for (const number of seed?.pullRequests || []) seedItem("pull_request", number);
  return {
    requests, items, links, completedCursors, nextActions,
    prepare(statement: string) {
      let values: unknown[] = [];
      const prepared = {
        bind(...bound: unknown[]) { values = bound; return prepared; },
        async first() {
          if (statement.includes("INSERT INTO github_sync_runs")) { if (running) return null; running = true; return { id: nextRun++ }; }
          if (statement.includes("nextScheduledCursor")) return completedCursors.length ? { cursor_json: JSON.stringify(completedCursors.at(-1)) } : null;
          if (statement.includes("FROM development_links WHERE provider = 'github' AND type = ?")) { const found = [...links.values()].find(link => link.kind === values[0] && String(link.number) === String(values[1])); return found ? { development_request_id: found.requestId } : null; }
          if (statement.includes("FROM development_requests WHERE external_key")) return requests.get(String(values[0])) || null;
          if (statement.includes("FROM github_sync_items WHERE kind = ? AND provider_id")) { const found = items.find(item => item.kind === values[0] && item.providerId === values[1]); return found ? { id: found.id, development_request_id: found.requestId, github_updated_at: found.updatedAt, payload_json: found.payload } : null; }
          if (statement.includes("SELECT development_request_id FROM github_sync_items WHERE kind = 'pull_request' AND provider_id")) { const found = items.find(item => item.kind === "pull_request" && item.providerId === values[0]); return found ? { development_request_id: found.requestId } : null; }
          return null;
        },
        async all() {
          if (statement.includes("WHERE url = ?")) return { results: [...links.values()].filter(link => link.url === values[0]).map(link => ({ development_request_id: link.requestId })) };
          if (statement.includes("WHERE g.kind = 'issue' AND g.number")) {
            const item = items.find(value => value.kind === "issue" && value.number === values[0]);
            return { results: item ? [...links.values()].filter(link => link.kind === "issue" && link.number === values[0]).map(link => ({ development_request_id: link.requestId, html_url: link.url, payload_json: item.payload })) : [] };
          }
          if (statement.includes("SELECT DISTINCT development_request_id FROM development_links")) return { results: [...links.values()].filter(link => link.kind === "pull_request" && String(link.number) === String(values[0])).map(link => ({ development_request_id: link.requestId })) };
          if (statement.includes("SELECT DISTINCT CAST(external_id AS INTEGER) AS number")) {
            const numbers = Array.from(new Set([...links.values()].filter(link => link.kind === "pull_request").map(link => link.number))).sort((a, b) => b - a);
            return { results: numbers.slice(Number(values[1]), Number(values[1]) + Number(values[0])).map(number => ({ number })) };
          }
          return { results: [] };
        },
        async run() {
          if (statement.includes("INSERT INTO development_requests")) requests.set(String(values[1]), { id: String(values[0]), priority: String(values[4]), why: null, owner: null, qa: null, notes: null });
          if (statement.includes("INSERT INTO github_sync_items")) {
            const found = items.find(item => item.kind === values[1] && item.providerId === values[0]);
            if (found) { found.payload = String(values[6]); found.updatedAt = String(values[7]); }
            else items.push({ id: nextItem++, providerId: Number(values[0]), kind: String(values[1]), number: Number(values[2]), requestId: String(values[3]), payload: String(values[6]), updatedAt: String(values[7]) });
          }
          if (statement.includes("INSERT OR IGNORE INTO development_links")) {
            const key = `${values[0]}:${values[1]}:${values[2]}`;
            if (!links.has(key)) links.set(key, { requestId: String(values[0]), kind: String(values[1]), number: Number(values[2]), url: String(values[3]), payload: String(values[4]) });
          }
          if (statement.includes("UPDATE development_requests SET next_action")) nextActions.set(String(values[1]), String(values[0]));
          if (statement.includes("github_sync_completed")) { const metadata = JSON.parse(String(values[3])); if (metadata.nextScheduledCursor) completedCursors.push(metadata.nextScheduledCursor); }
          if (statement.includes("SET status = 'succeeded'") || statement.includes("SET status = 'failed'")) running = false;
          return { success: true, meta: { changes: 1 } };
        },
      };
      return prepared;
    },
    async batch(statements: unknown[]) { return statements; },
  } as unknown as D1Database & { requests: typeof requests; items: typeof items; links: typeof links; completedCursors: typeof completedCursors; nextActions: typeof nextActions };
}

describe("manual GitHub readiness sync", () => {
  it.each([owner, admin])("allows $role", async (user) => {
    await expect(runManualGitHubReadinessSync(environment(), user, { adapter: readOnlyAdapter() })).resolves.toMatchObject({ status: "succeeded", runId: 1 });
  });

  it.each([viewer, developer])("denies $role", async (user) => {
    await expect(runManualGitHubReadinessSync(environment(), user, { adapter: readOnlyAdapter() })).rejects.toMatchObject({ status: 403 });
  });

  it("requires authenticated identity at the route and ignores submitted identity fields", () => {
    const route = readFileSync("app/routes/development.tsx", "utf8");
    expect(route).toContain("requireAuthenticatedUser(request, env)");
    expect(route).toContain("runManualGitHubReadinessSync(env, user)");
    expect(route).not.toContain('formData.get("actor")');
    expect(route).not.toContain('formData.get("role")');
  });

  it("uses Worker credentials without returning or persisting the private key", async () => {
    const db = fakeDatabase();
    const result = await runManualGitHubReadinessSync(environment(db), owner, { adapter: readOnlyAdapter() });
    expect(JSON.stringify(result)).not.toContain(privateKey);
    expect(JSON.stringify(db.sql)).not.toContain(privateKey);
  });

  it("creates exactly one run and records successful completion", async () => {
    const db = fakeDatabase();
    const result = await runManualGitHubReadinessSync(environment(db), owner, { adapter: readOnlyAdapter() });
    expect(db.runRows).toBe(1);
    expect(result).toMatchObject({ status: "succeeded", runId: 1, branches: 3 });
    expect(db.sql.some(value => value.includes("SET status = 'succeeded'"))).toBe(true);
  });

  it("rejects a concurrent run before GitHub reads", async () => {
    let reads = 0;
    const result = await runManualGitHubReadinessSync(environment(fakeDatabase(true)), owner, { adapter: readOnlyAdapter({ listIssues: async () => { reads += 1; return []; } }) });
    expect(result).toMatchObject({ status: "rejected", error: "GitHub sync already in progress" });
    expect(reads).toBe(0);
  });

  it("records one failed run with a safe error and does not retry", async () => {
    const db = fakeDatabase(); let attempts = 0;
    const result = await runManualGitHubReadinessSync(environment(db), owner, { adapter: readOnlyAdapter({ listIssues: async () => { attempts += 1; throw new Error(`failure ${privateKey}`); } }) });
    expect(attempts).toBe(1);
    expect(db.runRows).toBe(1);
    expect(result).toMatchObject({ status: "failed", error: "GitHub read-only synchronization failed." });
    expect(JSON.stringify(result)).not.toContain(privateKey);
  });

  it("persists a safe stage diagnostic for Worker subrequest failures", async () => {
    const db = fakeDatabase();
    const result = await runManualGitHubReadinessSync(environment(db), owner, { adapter: readOnlyAdapter({ listPullRequests: async () => { throw new Error("Too many subrequests."); } }) });
    expect(result.status).toBe("failed");
    const saved = db.bindings.flat().find(value => typeof value === "string" && value.includes('"diagnostic"')) as string;
    expect(JSON.parse(saved)).toMatchObject({ diagnostic: { stage: "pull_requests", category: "worker_subrequest_limit" } });
    expect(saved).not.toContain(privateKey);
  });

  it("exposes only read operations and permits Joe NEEDS_MAPPING", async () => {
    expect(Object.keys(readOnlyAdapter()).sort()).toEqual(["compare", "listBranches", "listIssues", "listPullRequests", "repository"]);
    const result = await runManualGitHubReadinessSync(environment(), owner, { adapter: readOnlyAdapter({ listBranches: async () => [{ name: "Adam", sha: "a" }, { name: "joe-one", sha: "1" }, { name: "joe-two", sha: "2" }, { name: "dev", sha: "d" }, { name: "main", sha: "m" }] }) });
    expect(result.status).toBe("succeeded");
  });

  it("does not update human-maintained QA fields or scheduled-sync configuration", () => {
    const source = readFileSync("app/lib/development/sync.server.ts", "utf8");
    for (const field of ["why_decision", "owner_email", "qa_partner_email", "qa_handoffs", "development_approvals", "overall_status"]) {
      expect(source).not.toMatch(new RegExp(`UPDATE[^;]+${field}`, "i"));
    }
    expect(source).not.toContain("GITHUB_SYNC_ENABLED =");
    expect(environment().GITHUB_SYNC_ENABLED).toBe("false");
  });

  it("renders confirmation, safe summary fields, and no credential value", () => {
    const route = readFileSync("app/routes/development.tsx", "utf8");
    expect(route).toContain("Run GitHub Readiness Sync");
    expect(route).toContain("This reads GitHub and updates DEVOS Development records. It does not modify GitHub.");
    for (const label of ["Initiator", "Issues", "PRs", "Branches", "Matched", "Created", "Ambiguous", "Skipped", "Conflicts", "Duration"]) expect(route).toContain(`>${label}<`);
    expect(route).not.toContain("env.GITHUB_APP_PRIVATE_KEY}");
  });
});

describe("GitHub reconciliation and incremental scheduling", () => {
  it("allows one GitHub object on multiple requests while keeping each request/object pair unique", () => {
    const migration = readFileSync("migrations/0019_allow_multi_request_github_links.sql", "utf8");
    expect(migration).toContain("UNIQUE(development_request_id, provider, type, external_id)");
    expect(migration).toContain("INSERT INTO development_links_next");
    expect(migration).toContain("idx_development_links_external");
  });

  it("links one PR to one issue without duplicating its sync item", async () => {
    const db = reconciliationDatabase();
    await syncNetXRepository(db, environment(db), { trigger: "manual_readiness", adapter: readOnlyAdapter({ listIssues: async () => [issue(603)], listPullRequests: async () => [pullRequest(626, "Closes #603")] }) });
    expect(db.items.filter(item => item.kind === "pull_request" && item.number === 626)).toHaveLength(1);
    const issueRequest = db.items.find(item => item.kind === "issue" && item.number === 603)!.requestId;
    expect(db.links.has(`${issueRequest}:pull_request:626`)).toBe(true);
  });

  it("enriches every manually linked request for a referenced issue", async () => {
    const db = reconciliationDatabase({ issues: [603] });
    const issuePayload = JSON.stringify(issue(603));
    db.links.set("manual-request:issue:603", { requestId: "manual-request", kind: "issue", number: 603, url: issue(603).htmlUrl, payload: issuePayload });
    await syncNetXRepository(db, environment(db), { trigger: "manual_readiness", adapter: readOnlyAdapter({ listIssues: async () => [issue(603)], listPullRequests: async () => [pullRequest(626, "Closes #603")] }) });
    expect(db.links.has("manual-request:pull_request:626")).toBe(true);
    expect(db.items.filter(item => item.kind === "pull_request" && item.number === 626)).toHaveLength(1);
  });

  it("links one PR to two issues idempotently and preserves human-managed fields", async () => {
    const db = reconciliationDatabase({ issues: [603, 604], pullRequests: [626] });
    const adapter = readOnlyAdapter({ listIssues: async () => [issue(603), issue(604)], listPullRequests: async () => [pullRequest(626, "Fixes #603\nResolves #604")] });
    await syncNetXRepository(db, environment(db), { trigger: "manual_readiness", adapter });
    await syncNetXRepository(db, environment(db), { trigger: "manual_readiness", adapter });
    expect(db.items.filter(item => item.kind === "pull_request" && item.number === 626)).toHaveLength(1);
    for (const number of [603, 604]) {
      const requestId = db.items.find(item => item.kind === "issue" && item.number === number)!.requestId;
      expect([...db.links.values()].filter(link => link.requestId === requestId && link.kind === "pull_request" && link.number === 626)).toHaveLength(1);
      expect(db.requests.get(`github:issue:${10_000 + number}`)).toMatchObject({ why: "human decision", owner: "owner@example.com", qa: "qa@example.com", notes: "human notes" });
    }
  });

  it("continues bounded scheduled batches and eventually reaches older open PRs", async () => {
    const db = reconciliationDatabase(); const seen: GitHubPullRequestCursor[] = [];
    const batches = [[626, 624, 623], [621, 620, 615]];
    const adapter = readOnlyAdapter({ async listScheduledPullRequests(cursor) { seen.push(cursor); const numbers = batches[cursor.page - 1] || []; return { items: numbers.map(number => pullRequest(number, null)), nextCursor: { scope: "open", page: cursor.page + 1 }, cycleComplete: false }; } });
    await syncNetXRepository(db, environment(db), { trigger: "scheduled", adapter });
    await syncNetXRepository(db, environment(db), { trigger: "scheduled", adapter });
    expect(seen).toEqual([{ scope: "open", page: 1 }, { scope: "open", page: 2 }]);
    expect(db.items.some(item => item.number === 615)).toBe(true);
  });

  it("preserves cursor position after a hard batch failure", async () => {
    const db = reconciliationDatabase(); const seen: GitHubPullRequestCursor[] = []; let fail = true;
    const adapter = readOnlyAdapter({ async listScheduledPullRequests(cursor) { seen.push(cursor); if (fail) { fail = false; throw new Error("bounded batch failed"); } return { items: [], nextCursor: { scope: "open", page: 2 }, cycleComplete: false }; } });
    await syncNetXRepository(db, environment(db), { trigger: "scheduled", adapter });
    await syncNetXRepository(db, environment(db), { trigger: "scheduled", adapter });
    expect(seen).toEqual([{ scope: "open", page: 1 }, { scope: "open", page: 1 }]);
  });

  it("refreshes tracked PRs in bounded cursor pages", async () => {
    const db = reconciliationDatabase({ pullRequests: [615] }); db.completedCursors.push({ scope: "tracked", page: 1 }); let tracked: number[] = [];
    const adapter = readOnlyAdapter({ async listScheduledPullRequests(cursor, trackedNumbers) { expect(cursor).toEqual({ scope: "tracked", page: 1 }); tracked = trackedNumbers || []; return { items: tracked.map(number => pullRequest(number, null)), nextCursor: { scope: "open", page: 1 }, cycleComplete: true }; } });
    await syncNetXRepository(db, environment(db), { trigger: "scheduled", adapter });
    expect(tracked).toEqual([615]);
  });

  it("updates closed-issue technical state without completing human workflow", async () => {
    const db = reconciliationDatabase({ issues: [609] });
    await syncNetXRepository(db, environment(db), { trigger: "manual_readiness", adapter: readOnlyAdapter({ listIssues: async () => [issue(609, "closed")] }) });
    const request = db.requests.get("github:issue:10609")!;
    expect(request).toMatchObject({ why: "human decision", owner: "owner@example.com", qa: "qa@example.com", notes: "human notes" });
    expect(db.nextActions.get(request.id)).toBe("GitHub closed — production verification required");
  });

  it("exposes no GitHub mutation methods", () => {
    expect(Object.keys(readOnlyAdapter()).filter(key => /create|update|delete|merge|push/i.test(key))).toEqual([]);
  });
});
