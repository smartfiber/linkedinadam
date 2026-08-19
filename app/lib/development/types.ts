import type { AuthenticatedUser } from "../auth.server";

export const DEVELOPMENT_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type DevelopmentPriority = (typeof DEVELOPMENT_PRIORITIES)[number];

export const DEVELOPMENT_TYPES = [
  "Security",
  "Bug",
  "Feature",
  "Integrity",
  "UX",
  "Performance",
  "Data",
  "Technical Debt",
  "Other",
] as const;
export type DevelopmentType = (typeof DEVELOPMENT_TYPES)[number];

export const DEVELOPMENT_STATUSES = [
  "open",
  "working",
  "awaiting_adam",
  "awaiting_joe",
  "awaiting_mutual_approval",
  "ready_for_dev",
  "on_dev",
  "ready_for_main",
  "on_main_needs_verification",
  "blocked",
  "verified",
  "closed",
] as const;
export type DevelopmentStatus = (typeof DEVELOPMENT_STATUSES)[number];

export const QA_STAGES = [
  "ADAM_QA",
  "JOE_QA",
  "DEV_QA",
  "MAIN_VERIFICATION",
] as const;
export type QaStage = (typeof QA_STAGES)[number];

export const APPROVAL_STAGES = [
  "ADAM_QA",
  "JOE_QA",
  "MUTUAL_APPROVAL",
  "DEV_QA",
  "MAIN_VERIFICATION",
] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

export type DevelopmentRequest = {
  id: string;
  external_key: string | null;
  title: string;
  problem: string | null;
  why_decision: string | null;
  priority: DevelopmentPriority;
  type: DevelopmentType;
  product_area: string | null;
  requested_by_type: string;
  requested_by_name: string;
  owner_email: string | null;
  qa_partner_email: string | null;
  overall_status: DevelopmentStatus;
  notes: string | null;
  next_action: string | null;
  created_at: string;
  updated_at: string;
  issue_url: string | null;
  pr_url: string | null;
  adam_state: string;
  joe_state: string;
  approval_state: string;
  dev_state: string;
  main_state: string;
  verification_state: string;
  issue_number: number | null;
  pr_number: number | null;
  pr_state: string | null;
  ci_state: string | null;
  source_branch: string | null;
  target_branch: string | null;
};

export type DevelopmentSummary = {
  p0Open: number;
  p1Open: number;
  awaitingAdam: number;
  awaitingJoe: number;
  awaitingMutualApproval: number;
  readyForDev: number;
  onDev: number;
  readyForMain: number;
  onMainNeedsVerification: number;
  blocked: number;
  verified: number;
  ciFailing: number;
  unknownSync: number;
};

export type DevelopmentFilters = {
  search?: string;
  priority?: DevelopmentPriority | "";
  owner?: string;
  status?: DevelopmentStatus | "";
  attention?: "ci_failing" | "unknown_sync" | "";
};

export type ActivityEvent = {
  id: number;
  actor_type: string;
  actor_identity: string;
  event_type: string;
  request_id: string | null;
  source: string;
  summary: string;
  metadata_json: string | null;
  occurred_at: string;
};

export type QaHandoff = {
  id: number;
  stage: QaStage;
  test_user: string | null;
  tenant: string | null;
  login_url: string | null;
  test_url: string | null;
  navigation: string | null;
  prerequisites: string | null;
  test_steps: string | null;
  expected_result: string | null;
  automated_coverage: string | null;
  notes: string | null;
  status: string;
  verified_by: string | null;
  verified_at: string | null;
};

export type DevelopmentApproval = {
  id: number;
  stage: ApprovalStage;
  actor_email: string;
  actor_name: string;
  decision: string;
  notes: string | null;
  created_at: string;
};

export type DevelopmentActor = Pick<AuthenticatedUser, "email" | "displayName" | "subject" | "role">;

export type GitHubSyncStatus = {
  lastRun: { status: string; finished_at: string | null; error_message: string | null } | null;
  branches: { role: string; branch_name: string | null; status: string; sha: string | null }[];
};
