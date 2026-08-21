export type BranchSyncState = {
  state: string;
  sha: string | null;
  comparison: string;
  confidence: string;
  notes: string | null;
  checkedAt: string | null;
};

export type BranchSyncRow = {
  id: string;
  externalKey: string | null;
  title: string;
  priority: string;
  productArea: string | null;
  ownerEmail: string | null;
  overallStatus: string;
  adamQa: string;
  joeQa: string;
  updatedAt: string;
  issueNumber: number | null;
  issueUrl: string | null;
  issueState: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prState: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  changedFiles: Array<{
    filename: string;
    status?: string;
    additions?: number;
    deletions?: number;
  }>;
  ci: "Passing" | "Failing" | "Pending" | "Unknown";
  adam: BranchSyncState;
  joe: BranchSyncState;
  dev: BranchSyncState;
  main: BranchSyncState;
};

export type BranchMappingStatus = {
  role: "adam" | "joe" | "dev" | "main";
  branchName: string | null;
  status: string;
  sha: string | null;
  checkedAt: string;
  candidates: string[];
};

export type BranchSyncCategory =
  | "adam_only"
  | "joe_only"
  | "personal_dev"
  | "dev_main"
  | "main_verify"
  | "ci_blocking"
  | "mapping_required"
  | "unknown";

export function workPresent(state: BranchSyncState) {
  return state.state === "present" || state.state === "patch_equivalent";
}

function absent(state: BranchSyncState) {
  return state.state === "not_present";
}

export function categoriesForRow(
  row: BranchSyncRow,
  joeMapped: boolean,
): BranchSyncCategory[] {
  const categories: BranchSyncCategory[] = [];
  if (!joeMapped) categories.push("mapping_required");
  if (row.ci === "Failing") categories.push("ci_blocking");
  if (workPresent(row.adam) && absent(row.joe)) categories.push("adam_only");
  if (workPresent(row.joe) && absent(row.adam)) categories.push("joe_only");
  if ((workPresent(row.adam) || workPresent(row.joe)) && absent(row.dev))
    categories.push("personal_dev");
  if (workPresent(row.dev) && absent(row.main)) categories.push("dev_main");
  if (
    workPresent(row.main) &&
    row.overallStatus === "on_main_needs_verification"
  )
    categories.push("main_verify");
  if (
    [row.adam, row.joe, row.dev, row.main].some(
      (state) => state.state === "unknown" || state.confidence === "UNKNOWN",
    )
  )
    categories.push("unknown");
  return categories;
}

export function branchSyncGuidance(row: BranchSyncRow, joeMapped: boolean) {
  const categories = categoriesForRow(row, joeMapped);
  if (row.ci === "Failing")
    return { promotion: "Blocked", action: "Fix CI before promotion" };
  if (!joeMapped)
    return { promotion: "Mapping required", action: "Map Joe branch" };
  if (row.overallStatus === "blocked")
    return { promotion: "Blocked", action: "Resolve blocker" };
  if (!row.prNumber) {
    if (!row.issueNumber)
      return { promotion: "Triage", action: "Needs triage" };
    if (!row.ownerEmail)
      return {
        promotion: "Implementation",
        action: "Needs implementation owner",
      };
    if ([row.adam, row.joe, row.dev, row.main].every(absent))
      return {
        promotion: "Implementation",
        action: "No implementation started",
      };
    return { promotion: "Implementation", action: "Needs branch / PR" };
  }
  if (categories.includes("main_verify"))
    return { promotion: "Verify Main", action: "Verify production" };
  if (categories.includes("dev_main"))
    return { promotion: "Main review", action: "Ready for Main review" };
  if (workPresent(row.adam) && workPresent(row.joe) && absent(row.dev))
    return { promotion: "Dev review", action: "Ready for Dev review" };
  if (categories.includes("adam_only"))
    return { promotion: "Joe", action: "Joe review / sync needed" };
  if (categories.includes("joe_only"))
    return { promotion: "Adam", action: "Adam review / sync needed" };
  if (categories.includes("unknown"))
    return { promotion: "Review", action: "Review branch difference" };
  return { promotion: "Monitor", action: "Review promotion readiness" };
}

export function rowMatchesBranchView(
  row: BranchSyncRow,
  view: string,
  joeMapped: boolean,
) {
  const categories = categoriesForRow(row, joeMapped);
  if (!view || view === "all") return true;
  if (view === "adam-joe")
    return (
      categories.includes("adam_only") ||
      categories.includes("joe_only") ||
      row.adam.comparison === "PATCH_EQUIVALENT" ||
      row.joe.comparison === "PATCH_EQUIVALENT" ||
      [row.adam, row.joe].some(
        (state) =>
          state.state === "unknown" ||
          state.comparison === "DIVERGED" ||
          state.comparison === "CONFLICT",
      )
    );
  if (view === "dev-main")
    return (
      categories.includes("dev_main") ||
      categories.includes("main_verify") ||
      [row.dev, row.main].some(
        (state) =>
          state.comparison === "PATCH_EQUIVALENT" ||
          state.state === "unknown" ||
          state.comparison === "DIVERGED" ||
          state.comparison === "CONFLICT",
      )
    );
  return categories.includes(view.replaceAll("-", "_") as BranchSyncCategory);
}

export function displayBranchState(state: BranchSyncState) {
  if (state.comparison === "EXACT") return "Exact";
  if (state.comparison === "PATCH_EQUIVALENT") return "Patch Equivalent";
  if (state.comparison === "CONFLICT") return "Conflict";
  if (state.state === "present") return "Present";
  if (state.state === "not_present") return "Not Present";
  if (state.state === "patch_equivalent") return "Patch Equivalent";
  return "Unknown";
}

export function syncConfidence(state: BranchSyncState) {
  if (state.comparison === "PATCH_EQUIVALENT") return "PATCH_EQUIVALENT";
  if (state.confidence === "PROBABLE") return "PROBABLE";
  if (
    state.comparison === "EXACT" ||
    (state.confidence === "HIGH" && state.state !== "unknown")
  )
    return "EXACT";
  return "UNKNOWN";
}
