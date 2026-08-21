import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  branchSyncGuidance,
  categoriesForRow,
  displayBranchState,
  rowMatchesBranchView,
  syncConfidence,
  type BranchSyncRow,
  type BranchSyncState,
} from "../app/lib/development/branch-sync";
import { discoverBranchMappings } from "../app/lib/development/sync.server";

const route = readFileSync(
  new URL("../app/routes/development-branch-sync.tsx", import.meta.url),
  "utf8",
);
const home = readFileSync(
  new URL("../app/routes/home.tsx", import.meta.url),
  "utf8",
);
const repository = readFileSync(
  new URL("../app/lib/development/repository.server.ts", import.meta.url),
  "utf8",
);

const state = (
  value: string,
  comparison = value === "present" ? "EXACT" : "BEHIND",
  confidence = "HIGH",
): BranchSyncState => ({
  state: value,
  sha: `${value}-sha`,
  comparison,
  confidence,
  notes: null,
  checkedAt: "2026-08-21T00:00:00Z",
});

function row(overrides: Partial<BranchSyncRow> = {}): BranchSyncRow {
  return {
    id: "request-1",
    externalKey: "github:issue:1",
    title: "Request",
    priority: "P1",
    productArea: "Development",
    ownerEmail: "dev@net-x.io",
    overallStatus: "working",
    adamQa: "approved",
    joeQa: "pending",
    updatedAt: "2026-08-21T00:00:00Z",
    issueNumber: 610,
    issueUrl: "https://github.com/example/issues/610",
    issueState: "open",
    prNumber: 611,
    prUrl: "https://github.com/example/pull/611",
    prState: "open",
    sourceBranch: "Adam",
    targetBranch: "dev",
    changedFiles: [],
    ci: "Passing",
    adam: state("present"),
    joe: state("present"),
    dev: state("not_present"),
    main: state("not_present"),
    ...overrides,
  };
}

describe("DEVOS Branch Sync", () => {
  it("maps the single exact Joe branch without inventing a name", () => {
    const mappings = discoverBranchMappings([
      { name: "Adam", sha: "a" },
      { name: "joe", sha: "j" },
      { name: "dev", sha: "d" },
      { name: "main", sha: "m" },
    ]);
    expect(mappings.find((mapping) => mapping.role === "joe")).toMatchObject({
      branchName: "joe",
      status: "MAPPED",
      candidates: ["joe"],
    });
  });

  it("classifies Adam-only and Joe-only work", () => {
    expect(
      categoriesForRow(row({ joe: state("not_present") }), true),
    ).toContain("adam_only");
    expect(
      categoriesForRow(
        row({ adam: state("not_present"), joe: state("present") }),
        true,
      ),
    ).toContain("joe_only");
  });

  it("classifies personal-to-dev and dev-to-main promotion gaps", () => {
    expect(categoriesForRow(row(), true)).toContain("personal_dev");
    expect(
      categoriesForRow(
        row({ dev: state("present"), main: state("not_present") }),
        true,
      ),
    ).toContain("dev_main");
  });

  it("preserves patch equivalence and visible confidence", () => {
    const equivalent = state("patch_equivalent", "PATCH_EQUIVALENT", "HIGH");
    expect(displayBranchState(equivalent)).toBe("Patch Equivalent");
    expect(syncConfidence(equivalent)).toBe("PATCH_EQUIVALENT");
  });

  it("does not hide unknown comparisons", () => {
    const unknown = state("unknown", "UNKNOWN", "UNKNOWN");
    expect(displayBranchState(unknown)).toBe("Unknown");
    expect(syncConfidence(unknown)).toBe("UNKNOWN");
    expect(categoriesForRow(row({ joe: unknown }), true)).toContain("unknown");
  });

  it("gives failing CI precedence over promotion guidance", () => {
    expect(branchSyncGuidance(row({ ci: "Failing" }), true)).toEqual({
      promotion: "Blocked",
      action: "Fix CI before promotion",
    });
  });

  it("keeps Main presence separate from production verification", () => {
    const main = row({
      dev: state("present"),
      main: state("present"),
      overallStatus: "on_main_needs_verification",
    });
    expect(categoriesForRow(main, true)).toContain("main_verify");
    expect(branchSyncGuidance(main, true).action).toBe("Verify production");
  });

  it("returns issue-only implementation actions instead of generic status", () => {
    const issueOnly = row({ prNumber: null, prUrl: null, ownerEmail: null });
    expect(branchSyncGuidance(issueOnly, true).action).toBe(
      "Needs implementation owner",
    );
    expect(
      branchSyncGuidance(
        row({
          prNumber: null,
          prUrl: null,
          ownerEmail: null,
          productArea: null,
        }),
        true,
      ).action,
    ).toBe("Needs triage");
    expect(repository).toContain("Needs branch / PR");
    expect(branchSyncGuidance(issueOnly, true).action).not.toBe(
      "Review GitHub status",
    );
    const notStarted = row({
      prNumber: null,
      prUrl: null,
      adam: state("not_present"),
      joe: state("not_present"),
      dev: state("not_present"),
      main: state("not_present"),
    });
    expect(branchSyncGuidance(notStarted, true).action).toBe(
      "No implementation started",
    );
    expect(
      branchSyncGuidance(
        row({
          prNumber: null,
          prUrl: null,
          adam: state("unknown", "UNKNOWN", "UNKNOWN"),
        }),
        true,
      ).action,
    ).toBe("Needs branch / PR");
  });

  it("requires mapping before personal branch guidance", () => {
    expect(branchSyncGuidance(row(), false).action).toBe("Map Joe branch");
    expect(categoriesForRow(row(), false)).toContain("mapping_required");
  });

  it("supports daily Adam/Joe and release dev/main views", () => {
    expect(
      rowMatchesBranchView(
        row({ joe: state("not_present") }),
        "adam-joe",
        true,
      ),
    ).toBe(true);
    expect(
      rowMatchesBranchView(
        row({ dev: state("present"), main: state("not_present") }),
        "dev-main",
        true,
      ),
    ).toBe(true);
    expect(route).toContain("Why DEVOS thinks these differ");
    expect(route).toContain("Last-known");
    expect(route).toContain("checkedAt");
    expect(route).toContain("Core GitHub");
    expect(route).toContain("Comparisons / patch equivalence");
    expect(route).toContain("Data missing");
  });

  it("shows QA beside branch state without mutating QA", () => {
    expect(route).toContain("<th>QA</th>");
    expect(route).toContain("row.overallStatus");
    expect(route).not.toMatch(/recordQaAction|UPDATE development_approvals/);
    expect(home).toContain("BRANCH SYNC");
  });
});
