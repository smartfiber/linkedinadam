import { Form, Link } from "react-router";
import type { Route } from "./+types/development-console";
import { requireAuthenticatedUser, requireRole, type AccessEnvironment } from "../lib/auth.server";
import { runSafeAgent } from "../lib/agents/service.server";
import { getAgentControlPlaneStatus } from "../lib/agents/readiness.server";

type Env = AccessEnvironment & { linkedinadam_db:D1Database; DEVOS_AGENT_RUNTIME?:DurableObjectNamespace };
const safeModes = [
  ["Analyze Request","issue-hunter"], ["Draft Plan","issue-hunter"],
  ["Review Development Record","release-readiness"], ["Draft QA Handoff","qa-agent"],
  ["Run Release Readiness","release-readiness"],
] as const;

export async function loader({ context,request }:Route.LoaderArgs) {
  const env=context.cloudflare.env as unknown as Env;
  await requireAuthenticatedUser(request,env);
  const status=await getAgentControlPlaneStatus(env.linkedinadam_db);
  if(status.state === "ERROR") throw status.error;
  return { safeModes,initialized:status.state === "READY" };
}
export async function action({ context,request }:Route.ActionArgs) {
  const env=context.cloudflare.env as unknown as Env;
  const user=await requireAuthenticatedUser(request,env);
  requireRole(user,["OWNER","ADMIN","DEVELOPER"]);
  const status=await getAgentControlPlaneStatus(env.linkedinadam_db);
  if(status.state === "ERROR") throw status.error;
  if(status.state === "NOT_INITIALIZED") return { error:"Agent runtime not initialized." };
  const data=await request.formData();
  const mode=String(data.get("mode") || "");
  const match=safeModes.find(([label])=>label===mode);
  if(!match) return { error:"Unsupported action." };
  const runId=await runSafeAgent(env,user,match[1],{ workItem:String(data.get("work_item") || "") });
  return { ok:true,runId };
}

export default function DevelopmentConsole({loaderData,actionData}:Route.ComponentProps) {
  return <main className="workspace-page"><header className="workspace-header"><div><p className="eyebrow">DEVELOPMENT / CONTROL PLANE</p><h1>DEVOS Development Console</h1><p>Safe analysis and drafting controls only. Repository, shell, file, PR, merge, and deployment execution remain disconnected.</p></div><Link className="secondary-link" to="/development">Development</Link></header>
    <section className="console-shell"><div className="console-banner"><span className="development-status attention">CONTROL PLANE ONLY</span><strong>Code execution is disabled</strong></div>{actionData?.error?<p role="alert" className="form-message error">{actionData.error}</p>:actionData?.ok?<p role="status" className="form-message success">Safe run {actionData.runId} completed.</p>:null}
      {!loaderData.initialized ? <div className="agent-initialization-state"><strong>Agent runtime not initialized</strong><p>The Development Console remains available, but audited agent runs require migration 0017.</p></div> : <Form method="post"><div className="console-grid"><label>Repository<select disabled><option>colossalbreacker/net-x · Read sync not connected</option></select></label><label>Work item<input name="work_item" placeholder="Optional Development Request ID" /></label><label>Base branch<select disabled><option>Not connected</option></select></label><label>Provider<select disabled><option>Deterministic DEVOS control plane</option></select></label><label>Agent / role<select disabled><option>Selected by safe action</option></select></label><label>Safe action<select name="mode">{loaderData.safeModes.map(([label])=><option key={label}>{label}</option>)}</select></label></div><label>Context<textarea name="context" rows={5} placeholder="Optional context; no shell commands or code changes will run" /></label><button>Run safe analysis</button></Form>}
      <div className="console-prohibited"><strong>Not connected:</strong> Implement, code generation, shell, repository checkout, file edits, commit, push, Prepare PR, merge, and deployment.</div>
      <div className="console-output-grid">{["Plan","Records inspected","Draft","Checks","Findings","Approval"].map(title=><section key={title}><h2>{title}</h2><p>Results are stored in the selected agent's audited run history.</p></section>)}</div>
    </section></main>;
}
