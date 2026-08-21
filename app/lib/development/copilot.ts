export const DEVELOPMENT_WORK_STATES = [
  "NEEDS_PROMPT", "PROMPT_READY", "IN_PROGRESS", "RESPONSE_REVIEW",
  "NEEDS_FOLLOWUP", "READY_FOR_REVIEW", "QA", "READY_FOR_PROMOTION",
  "BLOCKED", "COMPLETED", "ARCHIVED",
] as const;
export type DevelopmentWorkState = (typeof DEVELOPMENT_WORK_STATES)[number];

export const COPILOT_ENTRY_TYPES = ["HUMAN", "DEVOS", "CODEX", "CLAUDE", "CHATGPT", "GEMINI", "SYSTEM"] as const;
export type CopilotEntryType = (typeof COPILOT_ENTRY_TYPES)[number];
export const COPILOT_TARGETS = ["Codex", "ChatGPT", "Claude", "Gemini", "Other"] as const;

export type BranchEvidence = {
  requestId: string; title: string; issue?: string | null; pr?: string | null;
  adam: { sha: string | null; state: string; checkedAt: string | null };
  joe: { sha: string | null; state: string; checkedAt: string | null };
  dev: { sha: string | null; state: string; checkedAt: string | null };
  main: { sha: string | null; state: string; checkedAt: string | null };
  confidence: string; ci: string; adamQa: string; joeQa: string;
  syncOutcome?: string | null; deferred?: number; generatedAt: string;
};

const safety = `Diagnose first. Fetch current remote state. Preserve uncommitted work. Do not reset --hard. Do not force-push. Do not merge branches wholesale. Do not assume unequal SHAs mean unequal behavior. Check ancestry and patch equivalence. Do not promote unrelated work. Preserve human QA state and current Main behavior. Stop before push or merge unless explicitly authorized.`;

export function buildBranchSyncPrompt(e: BranchEvidence) {
  const states = [e.adam, e.joe, e.dev, e.main];
  const patchEquivalent = states.some((state) => state.state === "patch_equivalent");
  const conflict = states.some((state) => state.state === "conflict");
  const unknown = states.some((state) => state.state === "unknown" || !state.checkedAt);
  const stale = states.some((state) => !state.checkedAt);
  const interpretation = patchEquivalent
    ? "DEVOS currently believes at least two branches are patch-equivalent. Verify that before making any synchronization change. Do not duplicate the implementation merely because the SHAs differ."
    : conflict ? "Identify the exact conflicting files and semantic behavior; recommend a resolution without applying it."
      : unknown ? "Evidence is incomplete. Diagnose and refresh authoritative branch evidence before assuming a merge is required."
        : "Identify the exact request-specific patch and recommend the narrowest safe remediation.";
  return `# DEVOS Branch Sync Remediation\n\n${safety}\n\n## Request\n- ID: ${e.requestId}\n- Title: ${e.title}\n- Issue/PR: ${e.issue || "unavailable"} / ${e.pr || "unavailable"}\n\n## Current State\n- Adam: ${e.adam.state} · ${e.adam.sha || "unknown"} · observed ${e.adam.checkedAt || "never"}\n- Joe: ${e.joe.state} · ${e.joe.sha || "unknown"} · observed ${e.joe.checkedAt || "never"}\n- dev: ${e.dev.state} · ${e.dev.sha || "unknown"} · observed ${e.dev.checkedAt || "never"}\n- main: ${e.main.state} · ${e.main.sha || "unknown"} · observed ${e.main.checkedAt || "never"}\n\n## Comparison\n- Confidence: ${e.confidence}\n- Guidance: ${interpretation}\n- Evidence warning: ${stale ? "Some evidence is missing or stale; refresh/diagnose first." : e.syncOutcome === "PARTIALLY_FRESH" ? `Sync was partially fresh; ${e.deferred || 0} comparisons were deferred.` : "Use the observations above, then verify remote state."}\n\n## QA / CI\n- Adam QA: ${e.adamQa}\n- Joe QA: ${e.joeQa}\n- CI: ${e.ci}\n\nReturn: exact difference; ancestry; patch equivalence; missing/conflicting behavior; QA/CI constraints; narrow recommended remediation; commits/patches; target branch; unrelated-work risk; tests; diff; and proposed branch state. End with exactly one of NO ACTION NEEDED, READY TO SYNC, NEEDS REVIEW, or BLOCKED. Do not perform remediation.`;
}

export function buildBatchReconciliationPrompt(items: BranchEvidence[]) {
  return `# DEVOS Branch Reconciliation Audit\n\nDo NOT attempt to make Adam, Joe, dev, and main identical. Do NOT merge one branch wholesale into another. ${safety}\n\nTreat every Development Request independently. Verify evidence freshness and patch equivalence, assess QA/CI, and recommend narrow remediation.\n\n${items.map((item, index) => `## ${index + 1}. ${item.title}\n${buildBranchSyncPrompt(item)}`).join("\n\n")}\n\nReturn this table:\n| Request | Adam | Joe | dev | main | Difference | Evidence Freshness | QA/CI | Recommended Action | Risk |\n\nThen provide an ordered remediation plan. Do not perform remediation automatically.`;
}

export function evidenceChanged(a: BranchEvidence, b: BranchEvidence) {
  return (["adam", "joe", "dev", "main"] as const).some((key) => a[key].sha !== b[key].sha || a[key].checkedAt !== b[key].checkedAt);
}

export function mergeReadiness(input: { ci: string; mergeable?: boolean | null; conflict?: boolean; stale?: boolean; adamQa?: string; joeQa?: string; devQa?: string; mainVerification?: string; approvals?: number; securityBlocker?: boolean; migrationBlocker?: boolean }) {
  let technical = 40;
  if (input.ci === "Passing" || input.ci === "CI Passed") technical += 25;
  else if (input.ci.includes("Fail")) technical -= 30;
  if (input.mergeable === true) technical += 15;
  if (input.stale) technical -= 15;
  if (input.conflict) technical -= 35;
  let workflow = 25;
  for (const state of [input.adamQa, input.joeQa, input.devQa]) workflow += state === "passed" ? 20 : state === "failed" ? -20 : 0;
  workflow += Math.min(15, (input.approvals || 0) * 5);
  if (input.mainVerification === "passed") workflow += 10;
  technical = Math.max(0, Math.min(100, technical)); workflow = Math.max(0, Math.min(100, workflow));
  const blockers = [input.securityBlocker && "Security blocker", input.migrationBlocker && "Migration blocker", input.conflict && "Merge conflict", input.ci.includes("Fail") && "Required CI failing"].filter(Boolean) as string[];
  let overall = Math.round(technical * .6 + workflow * .4);
  if (blockers.length) overall = Math.min(overall, 40);
  return { technical, workflow, overall, level: overall >= 80 ? "High" : overall >= 55 ? "Medium" : "Low", blockers, explanation: `Technical evidence contributes ${technical}/100; explicit human workflow evidence contributes ${workflow}/100.${input.stale ? " Stale branch evidence reduces technical readiness." : ""}${blockers.length ? ` Hard blockers cap the result: ${blockers.join(", ")}.` : ""}` };
}
