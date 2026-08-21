export const GITHUB_FRESHNESS_WINDOW_MS = 30 * 60_000;

export type SyncPhaseStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "NOT_REACHED";
export type GitHubSyncFreshness = "FRESH" | "PARTIALLY_FRESH" | "STALE" | "FAILED" | "SYNCING";

export type SyncPhaseResult = {
  status: SyncPhaseStatus;
  processed: number;
  deferred: number;
  error: string | null;
  completed_at: string | null;
};

export type GitHubGranularSyncResult = {
  authentication: SyncPhaseResult;
  repository: SyncPhaseResult;
  coreSync: SyncPhaseResult;
  issues: SyncPhaseResult;
  prs: SyncPhaseResult;
  reconciliation: SyncPhaseResult;
  prDetails: SyncPhaseResult;
  reviews: SyncPhaseResult;
  ci: SyncPhaseResult;
  branchDiscovery: SyncPhaseResult;
  branches: SyncPhaseResult;
  ancestry: SyncPhaseResult;
  comparisons: SyncPhaseResult;
  patchEquivalence: SyncPhaseResult;
  errorStage: string | null;
  errorCategory: string | null;
  comparisonCursor: number;
  comparisonBatchKey: string | null;
};

export const emptySyncPhase = (): SyncPhaseResult => ({
  status: "NOT_REACHED", processed: 0, deferred: 0, error: null, completed_at: null,
});

export function emptyGranularSyncResult(): GitHubGranularSyncResult {
  return {
    authentication: emptySyncPhase(), repository: emptySyncPhase(), coreSync: emptySyncPhase(),
    issues: emptySyncPhase(), prs: emptySyncPhase(), reconciliation: emptySyncPhase(),
    prDetails: emptySyncPhase(), reviews: emptySyncPhase(), ci: emptySyncPhase(),
    branchDiscovery: emptySyncPhase(), branches: emptySyncPhase(), ancestry: emptySyncPhase(),
    comparisons: emptySyncPhase(), patchEquivalence: emptySyncPhase(),
    errorStage: null, errorCategory: null, comparisonCursor: 0, comparisonBatchKey: null,
  };
}

function timestamp(value: string | null) {
  if (!value) return Number.NaN;
  return Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

export function syncFreshness(status: string, result: GitHubGranularSyncResult | null, completedAt: string | null, now = Date.now()): GitHubSyncFreshness {
  if (status === "running") return "SYNCING";
  const usefulPartial = status === "partial" || result?.coreSync.status === "SUCCESS" && result.comparisons.status === "PARTIAL";
  if (usefulPartial && completedAt && now - timestamp(completedAt) > GITHUB_FRESHNESS_WINDOW_MS) return "STALE";
  if (usefulPartial) return "PARTIALLY_FRESH";
  if (status === "succeeded" && completedAt && now - timestamp(completedAt) <= GITHUB_FRESHNESS_WINDOW_MS) return "FRESH";
  if (status === "failed" && result?.coreSync.status !== "SUCCESS") return "FAILED";
  return "STALE";
}

export function syncStatusMessage(status: string, result: GitHubGranularSyncResult | null) {
  if (status === "running") return "GitHub sync already in progress.";
  if (status === "succeeded") return "GitHub sync complete";
  if (status === "partial" && result?.errorCategory === "worker_subrequest_limit") return "GitHub sync reached its safe processing limit. Core data is current; remaining enrichment will continue on the next run.";
  if (status === "partial" && result?.errorCategory === "rate_limit") return "GitHub rate limit reached. Showing last-known branch data.";
  if (status === "partial") return `Core GitHub data refreshed. ${result?.comparisons.deferred || 0} branch comparisons will continue on the next sync.`;
  if (result?.errorCategory === "authentication") return "GitHub connection unavailable. No data was refreshed.";
  if (result?.errorCategory === "rate_limit") return "GitHub rate limit reached. No data was refreshed.";
  return "GitHub synchronization failed before useful data was refreshed.";
}

export function phaseTimestamp(result: GitHubGranularSyncResult | null, names: Array<keyof GitHubGranularSyncResult>) {
  for (const name of names) {
    const phase = result?.[name];
    if (phase && typeof phase === "object" && "completed_at" in phase && phase.completed_at) return phase.completed_at;
  }
  return null;
}
