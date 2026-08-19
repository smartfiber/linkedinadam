import type { DevelopmentStatus } from "./types";

export const STATUS_LABELS: Record<DevelopmentStatus, string> = {
  open: "Open",
  working: "Working",
  awaiting_adam: "Awaiting Adam",
  awaiting_joe: "Awaiting Joe",
  awaiting_mutual_approval: "Awaiting Mutual Approval",
  ready_for_dev: "Ready for Dev",
  on_dev: "On Dev",
  ready_for_main: "Ready for Main",
  on_main_needs_verification: "On Main / Needs Verification",
  blocked: "Blocked",
  verified: "Verified",
  closed: "Closed",
};

export function statusLabel(status: string) {
  return STATUS_LABELS[status as DevelopmentStatus] || status.replaceAll("_", " ");
}

export function statusTone(status: string) {
  const normalized = status.toLowerCase().replaceAll(" ", "_");
  if (["blocked", "failed", "rejected", "ci_failing", "conflict"].includes(normalized)) return "blocked";
  if (["verified", "closed", "passed", "approved", "present", "patch_equivalent", "ci_passed"].includes(normalized)) return "complete";
  if (normalized.startsWith("awaiting") || ["pending", "unknown", "ci_unknown", "needs_review", "needs_merge"].includes(normalized)) return "attention";
  return "progress";
}
