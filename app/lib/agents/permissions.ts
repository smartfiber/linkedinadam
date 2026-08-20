import type { AgentCapability } from "./types";

export const PROHIBITED_ACTIONS = new Set(["force_push","push_main","disable_authentication","destructive_migration","mass_delete","bulk_external_communication","reveal_secrets","bypass_branch_protection"]);
export const APPROVAL_ACTIONS = new Set(["send_email","publish_linkedin","commit_code","push_branch","create_pr","merge","production_action"]);

export function classifyAgentAction(action: string): AgentCapability {
  if (PROHIBITED_ACTIONS.has(action)) return "PROHIBITED";
  if (APPROVAL_ACTIONS.has(action)) return "APPROVAL_REQUIRED";
  if (["read","analyze","draft"].includes(action)) return action.toUpperCase() as AgentCapability;
  if (action === "modify_sandbox") return "MODIFY_SANDBOX";
  return "PROHIBITED";
}

export function canExecuteCapability(capability: AgentCapability) {
  return ["READ","ANALYZE","DRAFT"].includes(capability);
}
