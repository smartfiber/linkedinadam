import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../app/lib/auth.server";
import { runManualGitHubReadinessSync } from "../app/lib/development/github-readiness.server";
import type { GitHubReadAdapter } from "../app/lib/integrations/github.server";

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
  return {
    get runRows() { return runRows; },
    get sql() { return sql; },
    prepare(statement: string) {
      sql.push(statement);
      let values: unknown[] = [];
      const prepared = {
        bind(...bound: unknown[]) { values = bound; return prepared; },
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
  } as unknown as D1Database & { readonly runRows: number; readonly sql: string[] };
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
