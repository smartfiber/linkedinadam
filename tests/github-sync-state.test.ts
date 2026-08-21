import { describe, expect, it } from "vitest";
import { emptyGranularSyncResult, syncFreshness, syncStatusMessage } from "../app/lib/development/sync-state";
import { getGitHubSyncStatus } from "../app/lib/development/repository.server";

describe("granular GitHub sync state", () => {
  it("distinguishes fresh, partial, failed, stale, and syncing", () => {
    const result = emptyGranularSyncResult();
    result.coreSync.status = "SUCCESS";
    expect(syncFreshness("succeeded", result, "2026-08-21 14:00:00", Date.parse("2026-08-21T14:10:00Z"))).toBe("FRESH");
    expect(syncFreshness("partial", result, "2026-08-21 14:00:00", Date.parse("2026-08-21T14:10:00Z"))).toBe("PARTIALLY_FRESH");
    expect(syncFreshness("partial", result, "2026-08-21 14:00:00", Date.parse("2026-08-21T15:00:01Z"))).toBe("STALE");
    expect(syncFreshness("failed", emptyGranularSyncResult(), "2026-08-21 14:00:00")).toBe("FAILED");
    expect(syncFreshness("succeeded", result, "2026-08-21 14:00:00", Date.parse("2026-08-21T15:00:01Z"))).toBe("STALE");
    expect(syncFreshness("running", null, null)).toBe("SYNCING");
  });

  it("provides safe messages for budget, rate limit, authentication, lock, and hard failure", () => {
    const result = emptyGranularSyncResult(); result.coreSync.status = "SUCCESS";
    result.errorCategory = "worker_subrequest_limit";
    expect(syncStatusMessage("partial", result)).toContain("safe processing limit");
    result.errorCategory = "rate_limit";
    expect(syncStatusMessage("partial", result)).toContain("last-known branch data");
    result.errorCategory = "authentication";
    expect(syncStatusMessage("failed", result)).toContain("connection unavailable");
    expect(syncStatusMessage("running", null)).toBe("GitHub sync already in progress.");
    expect(syncStatusMessage("failed", null)).toContain("before useful data");
  });

  it("renders a legacy run when migration 0020 is not installed", async () => {
    let reads = 0;
    const db = { prepare(statement: string) { return {
      async first() {
        reads += 1;
        if (statement.includes("r.outcome")) throw new Error("no such column: r.outcome");
        return { id: 10, status: "failed", outcome: null, result_json: null, trigger: "manual_readiness", initiator: "adam@net-x.io", started_at: "2026-08-21 13:45:05", finished_at: "2026-08-21 13:45:21", duration_seconds: 15, issues_seen: 0, pull_requests_seen: 0, branches_seen: 4, created_count: 0, matched_count: 0, ambiguous_count: 0, skipped_count: 0, conflict_count: 0, error_message: "GitHub read-only synchronization failed." };
      },
      async all() { return { results: [] }; },
    }; } } as unknown as D1Database;
    await expect(getGitHubSyncStatus(db)).resolves.toMatchObject({ lastRun: { status: "failed", result: null, freshness: "FAILED" } });
    expect(reads).toBe(2);
  });

  it("exposes separate phase timestamps and processed/deferred counts", () => {
    const result = emptyGranularSyncResult();
    result.coreSync = { status: "SUCCESS", processed: 23, deferred: 0, error: null, completed_at: "2026-08-21T14:00:00Z" };
    result.ci = { status: "SUCCESS", processed: 3, deferred: 0, error: null, completed_at: "2026-08-21T13:59:00Z" };
    result.branches = { status: "SUCCESS", processed: 4, deferred: 0, error: null, completed_at: "2026-08-21T14:00:02Z" };
    result.comparisons = { status: "PARTIAL", processed: 10, deferred: 2, error: "GitHub read-only synchronization failed.", completed_at: "2026-08-21T14:00:03Z" };
    expect(result.coreSync.completed_at).not.toBe(result.ci.completed_at);
    expect(result.comparisons).toMatchObject({ processed: 10, deferred: 2 });
  });
});
