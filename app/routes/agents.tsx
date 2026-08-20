import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/agents";
import { requireAuthenticatedUser, requireRole, type AccessEnvironment } from "../lib/auth.server";
import { agentControlSummary, decideApproval, listAgentRuns, listApprovals } from "../lib/agents/service.server";
import { getAgentControlPlaneStatus } from "../lib/agents/readiness.server";
import { listRegisteredAgents } from "../lib/agents/registry.server";

type Env = AccessEnvironment & { linkedinadam_db: D1Database };

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as Env;
  const user = await requireAuthenticatedUser(request, env);
  const status = await getAgentControlPlaneStatus(env.linkedinadam_db);
  if (status.state === "ERROR") throw status.error;
  if (status.state === "NOT_INITIALIZED") return { initialized:false,user,agents:[],runs:[],approvals:[],summary:null };
  const [agents,runs, approvals, summary] = await Promise.all([listRegisteredAgents(env.linkedinadam_db),listAgentRuns(env.linkedinadam_db), listApprovals(env.linkedinadam_db), agentControlSummary(env.linkedinadam_db)]);
  return { initialized:true,user,agents,runs,approvals,summary };
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as Env;
  const user = await requireAuthenticatedUser(request, env);
  requireRole(user,["OWNER","ADMIN"]);
  const status = await getAgentControlPlaneStatus(env.linkedinadam_db);
  if (status.state === "ERROR") throw status.error;
  if (status.state === "NOT_INITIALIZED") return { error:"Agent runtime not initialized." };
  const data = await request.formData();
  await decideApproval(env.linkedinadam_db,user,{ id:String(data.get("approval_id") || ""), decision:String(data.get("decision") || ""), reason:String(data.get("reason") || "") });
  return { ok:true };
}

const filters = ["Development","Content & LinkedIn","Marketing","Cross-functional","Existing Automation","Active","Paused","Needs Approval","Error"];

export default function AgentControlCenter({ loaderData, actionData }: Route.ComponentProps) {
  if (!loaderData.initialized || !loaderData.summary) return <main className="workspace-page agent-control"><header className="workspace-header"><div><p className="eyebrow">NET-X DEV OS</p><h1>DEVOS Agent Control Center</h1></div><Link className="secondary-link" to="/">Command Center</Link></header><section className="workspace-card agent-initialization-state"><strong>Agent Control Center is awaiting database initialization.</strong><p>Existing Development and Content &amp; LinkedIn workflows remain available. Apply migration 0017 through the controlled release process to initialize agents.</p></section></main>;
  const [params] = useSearchParams();
  const filter = params.get("filter") || "";
  const pendingSlugs = new Set(loaderData.approvals.filter(a=>a.status === "pending").map(a=>a.agent_slug));
  const agents = loaderData.agents.filter(agent => !filter || agent.category === filter || (filter === "Active" && agent.status === "active") || (filter === "Paused" && agent.status === "paused") || (filter === "Error" && agent.status === "error") || (filter === "Needs Approval" && pendingSlugs.has(agent.slug)));
  return <main className="workspace-page agent-control">
    <header className="workspace-header"><div><p className="eyebrow">NET-X DEV OS</p><h1>DEVOS Agent Control Center</h1><p>One control plane for existing automation and safe Development agents. External actions remain human-controlled.</p></div><Link className="secondary-link" to="/">Command Center</Link></header>
    {actionData?.error ? <p className="form-message error" role="alert">{actionData.error}</p> : null}
    <section className="agent-summary">{[["Active Agents",loaderData.summary.activeAgents],["Runs Today",loaderData.summary.runsToday],["Needs Approval",loaderData.summary.pendingApprovals],["Failed Runs",loaderData.summary.failedRuns]].map(([label,value])=><article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <nav className="saved-views agent-filters" aria-label="Agent filters"><Link to="/agents" className={!filter ? "active" : ""}>All</Link>{filters.map(value=><Link key={value} className={filter === value ? "active" : ""} to={`/agents?filter=${encodeURIComponent(value)}`}>{value}</Link>)}</nav>
    <section className="agent-control-grid">{agents.map(agent => { const last = loaderData.runs.find(run=>run.agent_slug === agent.slug); return <article className="agent-control-card" key={agent.slug}><div className="agent-card-head"><span className={`development-status ${agent.status === 'active' ? 'success' : agent.status === 'error' ? 'danger' : 'attention'}`}>{agent.status}</span><small>{agent.implementation === "existing" ? "Existing automation" : agent.implementation}</small></div><h2><Link to={`/agents/${agent.slug}`}>{agent.name}</Link></h2><p>{agent.role}</p><dl><div><dt>Category</dt><dd>{agent.category}</dd></div><div><dt>Owner</dt><dd>{agent.owner}</dd></div><div><dt>Model</dt><dd>{agent.model}</dd></div><div><dt>Autonomy</dt><dd>{agent.autonomy}</dd></div><div><dt>Tools</dt><dd>{agent.tools.join(", ")}</dd></div><div><dt>Last run</dt><dd>{last?.created_at || "Never"}</dd></div></dl>{pendingSlugs.has(agent.slug) ? <strong className="approval-callout">Approval needed</strong> : null}</article>; })}</section>
    <section className="workspace-card approval-center"><div className="panel-heading"><div><p className="eyebrow">HUMAN CONTROL</p><h2>Approval Center</h2></div></div>{actionData?.ok ? <p role="status" className="form-message success">Decision recorded.</p> : null}{loaderData.approvals.length ? <div className="approval-list">{loaderData.approvals.map(approval=><article key={approval.id}><div><strong>{approval.agent_slug} · {approval.requested_action}</strong><p>{approval.reason}</p><small>{approval.risk} risk · {approval.requested_by} · {approval.created_at}</small></div>{approval.status === "pending" ? <Form method="post"><input type="hidden" name="approval_id" value={approval.id}/><label>Decision reason<input name="reason" aria-label={`Decision reason for ${approval.requested_action}`}/></label><button name="decision" value="approved">Approve</button><button name="decision" value="rejected" className="danger-button">Reject</button><button name="decision" value="changes_requested" className="secondary-button">Request changes</button></Form> : <span className="development-status">{approval.status}</span>}</article>)}</div> : <p>No agent actions need approval.</p>}</section>
  </main>;
}
