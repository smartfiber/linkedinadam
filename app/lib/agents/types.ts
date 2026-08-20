export type AgentCategory = "Development" | "Content & LinkedIn" | "Marketing" | "Cross-functional" | "Existing Automation";
export type AgentCapability = "READ" | "ANALYZE" | "DRAFT" | "MODIFY_SANDBOX" | "APPROVAL_REQUIRED" | "PROHIBITED";
export type AgentStatus = "active" | "paused" | "waiting" | "error";
export type AgentDefinition = {
  slug: string; name: string; category: AgentCategory; role: string; purpose: string;
  owner: string; status: AgentStatus; autonomy: string; provider: string; model: string;
  capabilities: AgentCapability[]; tools: string[]; route?: string; implementation: "existing" | "new" | "scaffold";
};

export type AgentRun = {
  id: string; agent_slug: string; initiator_email: string; trigger_type: string; input_json: string | null;
  status: string; result_json: string | null; safe_error: string | null; provider: string; model: string;
  started_at: string | null; completed_at: string | null; created_at: string; updated_at: string;
};

export type AgentApproval = {
  id: string; agent_run_id: string | null; agent_slug: string; requested_action: string; related_item: string | null;
  risk: string; reason: string; status: string; requested_by: string; decided_by: string | null; decision_reason: string | null;
  created_at: string; decided_at: string | null;
};
