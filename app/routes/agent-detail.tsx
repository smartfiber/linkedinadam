import { Form, Link } from "react-router";
import type { Route } from "./+types/agent-detail";
import { requireAuthenticatedUser, requireRole, type AccessEnvironment } from "../lib/auth.server";
import { listAgentRuns, listApprovals, runSafeAgent } from "../lib/agents/service.server";
import { getAgentControlPlaneStatus } from "../lib/agents/readiness.server";
import { getRegisteredAgent } from "../lib/agents/registry.server";

type Env = AccessEnvironment & { linkedinadam_db:D1Database; DEVOS_AGENT_RUNTIME?:DurableObjectNamespace };

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as Env;
  const user = await requireAuthenticatedUser(request,env);
  const status = await getAgentControlPlaneStatus(env.linkedinadam_db);
  if (status.state === "ERROR") throw status.error;
  if (status.state === "NOT_INITIALIZED") return { initialized:false,user,agent:null,runs:[],approvals:[],events:[],schedules:[] };
  const agent = await getRegisteredAgent(env.linkedinadam_db,params.agentSlug || "");
  if (!agent) throw new Response("Agent not found",{status:404});
  const [runs,approvals,events,schedules] = await Promise.all([
    listAgentRuns(env.linkedinadam_db,agent.slug), listApprovals(env.linkedinadam_db,agent.slug),
    env.linkedinadam_db.prepare(`SELECT e.* FROM devos_agent_run_events e JOIN devos_agent_runs r ON r.id=e.agent_run_id WHERE r.agent_slug=? ORDER BY e.occurred_at DESC LIMIT 50`).bind(agent.slug).all(),
    env.linkedinadam_db.prepare(`SELECT * FROM devos_agent_schedules WHERE agent_slug=? ORDER BY created_at DESC`).bind(agent.slug).all(),
  ]);
  return { initialized:true,user,agent,runs,approvals,events:events.results,schedules:schedules.results };
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as Env;
  const user = await requireAuthenticatedUser(request,env);
  requireRole(user,["OWNER","ADMIN","DEVELOPER","MARKETING","SALES"]);
  const status = await getAgentControlPlaneStatus(env.linkedinadam_db);
  if (status.state === "ERROR") throw status.error;
  if (status.state === "NOT_INITIALIZED") return { error:"Agent runtime not initialized." };
  const id = await runSafeAgent(env,user,params.agentSlug || "",{});
  return { ok:true,runId:id };
}

export default function AgentDetail({ loaderData,actionData }: Route.ComponentProps) {
  if (!loaderData.initialized || !loaderData.agent) return <main className="workspace-page agent-detail"><header className="workspace-header"><div><p className="eyebrow">NET-X DEV OS</p><h1>Agent runtime not initialized</h1><p>This agent will become available automatically after migration 0017 initializes the control-plane tables.</p></div><Link className="secondary-link" to="/agents">Agent Control Center</Link></header></main>;
  const {agent} = loaderData;
  const canRun = agent.implementation === "new" && agent.status === "active";
  return <main className="workspace-page agent-detail"><header className="workspace-header"><div><p className="eyebrow">{agent.category}</p><h1>{agent.name}</h1><p>{agent.role}</p></div><Link className="secondary-link" to="/agents">Agent Control Center</Link></header>
    {agent.status === "waiting" ? <div className="connection-banner">WAITING FOR GITHUB CONNECTION</div> : null}
    {actionData?.error ? <p className="form-message error" role="alert">{actionData.error}</p> : actionData?.ok ? <p className="form-message success" role="status">Run {actionData.runId} completed and was recorded.</p> : null}
    <section className="agent-detail-grid"><article className="workspace-card"><h2>Overview</h2><dl><div><dt>Status</dt><dd>{agent.status}</dd></div><div><dt>Human owner</dt><dd>{agent.owner}</dd></div><div><dt>Autonomy</dt><dd>{agent.autonomy}</dd></div><div><dt>Implementation</dt><dd>{agent.implementation}</dd></div></dl></article><article className="workspace-card"><h2>Purpose</h2><p>{agent.purpose}</p>{agent.route ? <Link to={agent.route}>Open existing workflow →</Link> : null}</article><article className="workspace-card"><h2>Model</h2><p>{agent.provider}</p><strong>{agent.model}</strong></article><article className="workspace-card"><h2>Tools</h2><ul>{agent.tools.map(tool=><li key={tool}>{tool}</li>)}</ul></article><article className="workspace-card"><h2>Permission levels</h2><ul>{agent.capabilities.map(capability=><li key={capability}>{capability}</li>)}</ul></article><article className="workspace-card"><h2>Circuit breakers</h2><p>No code execution, Git writes, deployments, email sending, or automatic LinkedIn publishing. Secrets and authentication controls are inaccessible.</p></article></section>
    <section className="workspace-card agent-run-panel"><h2>Manual safe run</h2>{canRun ? <Form method="post"><p>This deterministic control-plane run reads current Back Office data and records an audited result.</p><button>Run {agent.name}</button></Form> : <p>{agent.implementation === "existing" ? "Use the existing workflow link; DEVOS does not duplicate its behavior." : "This agent cannot run until its required connection is available."}</p>}</section>
    <section className="agent-history-grid"><article className="workspace-card"><h2>Recent runs</h2>{loaderData.runs.length ? loaderData.runs.map(run=><details key={run.id}><summary>{run.status} · {run.created_at}</summary><pre>{run.result_json || run.safe_error || "No result"}</pre><small>{run.provider} · {run.model} · {run.initiator_email}</small></details>) : <p>No runs yet.</p>}</article><article className="workspace-card"><h2>Approvals</h2>{loaderData.approvals.length ? loaderData.approvals.map(a=><p key={a.id}>{a.requested_action} · {a.status}</p>) : <p>No approvals.</p>}</article><article className="workspace-card"><h2>Activity</h2>{loaderData.events.length ? loaderData.events.map((e:any)=><p key={e.id}>{e.event_type} · {e.occurred_at}</p>) : <p>No run activity.</p>}</article><article className="workspace-card"><h2>Schedule</h2>{loaderData.schedules.length ? loaderData.schedules.map((s:any)=><p key={s.id}>{s.cron_expression || "Manual"} · {s.enabled ? "Enabled" : "Disabled"}</p>) : <p>No DEVOS schedule. Existing autopilot scheduling remains in Operations.</p>}</article><article className="workspace-card"><h2>Settings</h2><p>Configuration is restricted to OWNER and ADMIN. No mutable agent settings are exposed in this phase.</p></article></section>
  </main>;
}
