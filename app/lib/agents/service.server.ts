import type { AuthenticatedUser } from "../auth.server";
import type { AgentApproval, AgentRun } from "./types";
import { classifyAgentAction } from "./permissions";
import { getRegisteredAgent } from "./registry.server";
import { assertAgentControlPlaneAvailable, getAgentControlPlaneStatus } from "./readiness.server";

type AgentEnvironment = { linkedinadam_db: D1Database; DEVOS_AGENT_RUNTIME?: DurableObjectNamespace };

async function event(db: D1Database, runId: string, eventType: string, actor: string, detail: unknown) {
  await db.prepare(`INSERT INTO devos_agent_run_events (agent_run_id,event_type,actor_identity,detail_json) VALUES (?,?,?,?)`).bind(runId,eventType,actor,JSON.stringify(detail)).run();
}

async function deterministicResult(db: D1Database, slug: string) {
  if (slug === "issue-hunter") {
    const row = await db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN overall_status='blocked' THEN 1 ELSE 0 END) blocked FROM development_requests WHERE overall_status NOT IN ('verified','closed')`).first<{total:number;blocked:number}>();
    return { summary: `${row?.total || 0} open Development records reviewed; ${row?.blocked || 0} blocked.`, recommendation: "Review unmatched manual records while GitHub remains disconnected.", draftOnly: true };
  }
  if (slug === "release-readiness") {
    const row = await db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN EXISTS (SELECT 1 FROM qa_handoffs q WHERE q.development_request_id=development_requests.id AND q.stage='MAIN_VERIFICATION' AND q.status='passed') THEN 1 ELSE 0 END) verified, SUM(CASE WHEN overall_status='blocked' THEN 1 ELSE 0 END) blocked FROM development_requests`).first<{total:number;verified:number;blocked:number}>();
    return { summary: `${row?.verified || 0} of ${row?.total || 0} records have explicit Main verification; ${row?.blocked || 0} blocked.`, technicalStateDoesNotImplyQa: true };
  }
  if (slug === "qa-agent") {
    const row = await db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN test_url IS NULL OR test_url='' THEN 1 ELSE 0 END) missing_urls FROM qa_handoffs`).first<{total:number;missing_urls:number}>();
    return { summary: `${row?.total || 0} QA handoffs reviewed.`, guidance: `${row?.missing_urls || 0} have no test URL; those fields remain blank until a human supplies them.`, inventedUrls: false, draftOnly: true };
  }
  if (slug === "chief-of-staff") {
    const [development, drafts, approvals] = await Promise.all([
      db.prepare(`SELECT COUNT(*) count FROM development_requests WHERE overall_status NOT IN ('verified','closed')`).first<{count:number}>(),
      db.prepare(`SELECT COUNT(*) count FROM content_drafts WHERE status IN ('draft','review','approved')`).first<{count:number}>(),
      db.prepare(`SELECT COUNT(*) count FROM devos_agent_approvals WHERE status='pending'`).first<{count:number}>(),
    ]);
    return { summary: `${development?.count || 0} open Development records, ${drafts?.count || 0} active content drafts, and ${approvals?.count || 0} pending agent approvals.`, readOnly: true };
  }
  throw new Error("This agent is exposed as existing automation and must be run from its existing workflow.");
}

export async function runSafeAgent(env: AgentEnvironment, user: AuthenticatedUser, slug: string, input: unknown = {}) {
  assertAgentControlPlaneAvailable(await getAgentControlPlaneStatus(env.linkedinadam_db));
  const agent = await getRegisteredAgent(env.linkedinadam_db, slug);
  if (!agent) throw new Error("Agent not found.");
  if (agent.status !== "active" || agent.implementation === "existing") throw new Error(agent.status === "waiting" ? "This agent is waiting for a required connection." : "Use the existing workflow for this automation.");
  const id = crypto.randomUUID();
  await env.linkedinadam_db.prepare(`INSERT INTO devos_agent_runs (id,agent_slug,initiator_email,trigger_type,input_json,status,provider,model,started_at,attempt_count) VALUES (?,?,?,?,?,'running',?,?,CURRENT_TIMESTAMP,1)`).bind(id,slug,user.email,"manual",JSON.stringify(input),agent.provider,agent.model).run();
  await event(env.linkedinadam_db,id,"run_started",user.email,{ trigger:"manual" });
  try {
    const result = await deterministicResult(env.linkedinadam_db,slug);
    if (env.DEVOS_AGENT_RUNTIME) {
      const stub = env.DEVOS_AGENT_RUNTIME.get(env.DEVOS_AGENT_RUNTIME.idFromName(slug));
      await stub.fetch("https://agent-runtime.internal/state", { method:"POST", body:JSON.stringify({ runId:id,status:"completed",updatedAt:new Date().toISOString() }) });
    }
    await env.linkedinadam_db.prepare(`UPDATE devos_agent_runs SET status='completed',result_json=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(result),id).run();
    await event(env.linkedinadam_db,id,"run_completed",user.email,{ result });
    return id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent run failed.";
    await env.linkedinadam_db.prepare(`UPDATE devos_agent_runs SET status='failed',safe_error=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(message,id).run();
    await event(env.linkedinadam_db,id,"run_failed",user.email,{ error:message });
    throw error;
  }
}

export async function listAgentRuns(db: D1Database, slug?: string) {
  const query = slug ? db.prepare(`SELECT * FROM devos_agent_runs WHERE agent_slug=? ORDER BY created_at DESC LIMIT 30`).bind(slug) : db.prepare(`SELECT * FROM devos_agent_runs ORDER BY created_at DESC LIMIT 30`);
  return (await query.all<AgentRun>()).results;
}

export async function listApprovals(db: D1Database, slug?: string) {
  const query = slug ? db.prepare(`SELECT * FROM devos_agent_approvals WHERE agent_slug=? ORDER BY created_at DESC LIMIT 30`).bind(slug) : db.prepare(`SELECT * FROM devos_agent_approvals ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 50`);
  return (await query.all<AgentApproval>()).results;
}

export async function decideApproval(db: D1Database, user: AuthenticatedUser, input: { id:string; decision:string; reason:string }) {
  if (!["approved","rejected","changes_requested"].includes(input.decision)) throw new Error("Invalid approval decision.");
  const result = await db.prepare(`UPDATE devos_agent_approvals SET status=?,decided_by=?,decision_reason=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`).bind(input.decision,user.email,input.reason || null,input.id).run();
  if (!result.meta.changes) throw new Error("Approval is no longer pending.");
}

export async function requestAgentApproval(db:D1Database,user:AuthenticatedUser,input:{agentSlug:string;runId?:string;action:string;relatedItem?:string;reason:string;risk?:string}) {
  const capability=classifyAgentAction(input.action);
  if(capability === "PROHIBITED") throw new Error("This action is prohibited by DEVOS policy.");
  if(capability !== "APPROVAL_REQUIRED") throw new Error("This action does not require an approval request.");
  const id=crypto.randomUUID();
  await db.prepare(`INSERT INTO devos_agent_approvals (id,agent_run_id,agent_slug,requested_action,related_item,risk,reason,status,requested_by) VALUES (?,?,?,?,?,?,?,'pending',?)`).bind(id,input.runId || null,input.agentSlug,input.action,input.relatedItem || null,input.risk || "high",input.reason,user.email).run();
  if(input.runId) {
    await db.prepare(`UPDATE devos_agent_runs SET status='needs_approval',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(input.runId).run();
    await event(db,input.runId,"approval_requested",user.email,{approvalId:id,action:input.action});
  }
  return id;
}

export async function agentControlSummary(db: D1Database) {
  const row = await db.prepare(`SELECT COUNT(*) runs_today, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed FROM devos_agent_runs WHERE date(created_at)=date('now')`).first<{runs_today:number;failed:number}>();
  const pending = await db.prepare(`SELECT COUNT(*) count FROM devos_agent_approvals WHERE status='pending'`).first<{count:number}>();
  const latest = await db.prepare(`SELECT agent_slug,result_json,created_at FROM devos_agent_runs WHERE status='completed' ORDER BY created_at DESC LIMIT 1`).first<{agent_slug:string;result_json:string;created_at:string}>();
  const active = await db.prepare(`SELECT COUNT(*) count FROM devos_agents WHERE status='active'`).first<{count:number}>();
  return { activeAgents:active?.count || 0, runsToday:row?.runs_today || 0, failedRuns:row?.failed || 0, pendingApprovals:pending?.count || 0, latest };
}
