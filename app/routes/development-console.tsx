import { Form, Link } from "react-router";
import type { Route } from "./+types/development-console";
import {
  requireAuthenticatedUser,
  requireRole,
  type AccessEnvironment,
} from "../lib/auth.server";
import { runSafeAgent } from "../lib/agents/service.server";
import { getAgentControlPlaneStatus } from "../lib/agents/readiness.server";
import { getDevelopmentRequest } from "../lib/development/repository.server";
import { getCopilotContext } from "../lib/development/copilot.server";

type Env = AccessEnvironment & {
  linkedinadam_db: D1Database;
  DEVOS_AGENT_RUNTIME?: DurableObjectNamespace;
};
const safeModes = [
  ["Analyze Request", "issue-hunter"],
  ["Draft Plan", "issue-hunter"],
  ["Review Development Record", "release-readiness"],
  ["Draft QA Handoff", "qa-agent"],
  ["Run Release Readiness", "release-readiness"],
] as const;

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as Env;
  await requireAuthenticatedUser(request, env);
  const selectedRequest =
    new URL(request.url).searchParams.get("request") || "";
  const status = await getAgentControlPlaneStatus(env.linkedinadam_db);
  if (status.state === "ERROR") throw status.error;
  const [record,copilot]=selectedRequest ? await Promise.all([getDevelopmentRequest(env.linkedinadam_db,selectedRequest),getCopilotContext(env.linkedinadam_db,selectedRequest)]):[null,null];
  return { safeModes, initialized: status.state === "READY", selectedRequest, record, copilot };
}
export async function action({ context, request }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as Env;
  const user = await requireAuthenticatedUser(request, env);
  requireRole(user, ["OWNER", "ADMIN", "DEVELOPER"]);
  const status = await getAgentControlPlaneStatus(env.linkedinadam_db);
  if (status.state === "ERROR") throw status.error;
  if (status.state === "NOT_INITIALIZED")
    return { error: "Agent runtime not initialized." };
  const data = await request.formData();
  const mode = String(data.get("mode") || "");
  const match = safeModes.find(([label]) => label === mode);
  if (!match) return { error: "Unsupported action." };
  const runId = await runSafeAgent(env, user, match[1], {
    workItem: String(data.get("work_item") || ""),
  });
  return { ok: true, runId };
}

export default function DevelopmentConsole({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">DEVELOPMENT / CONTROL PLANE</p>
          <h1>DEVOS Development Console</h1>
          <p>
            Safe analysis and drafting controls only. Repository, shell, file,
            PR, merge, and deployment execution remain disconnected.
          </p>
        </div>
        <Link className="secondary-link" to="/development">
          Development
        </Link>
      </header>
      <nav className="development-subnav" aria-label="Development navigation">
        <Link to="/development">Requests</Link>
        <Link to="/development/branch-sync">Branch Sync</Link>
        <Link to="/development/environments">Environments &amp; QA</Link>
        <Link aria-current="page" to="/development/console">
          Development Console
        </Link>
      </nav>
      <section className="console-shell">
        <div className="console-banner">
          <span className="development-status attention">
            CONTROL PLANE ONLY
          </span>
          <strong>Code execution is disabled</strong>
        </div>
        {loaderData.record ? <section className="console-request-context"><p className="eyebrow">PERSISTENT REQUEST THREAD</p><h2>{loaderData.record.request.title}</h2><p>{(loaderData.copilot?.state as any)?.layman_summary || loaderData.record.request.problem || "Summary not generated."}</p><dl className="detail-overview"><div><dt>GitHub</dt><dd>{loaderData.record.githubItems.length} linked synchronized objects</dd></div><div><dt>Branches</dt><dd>{loaderData.record.branches.length} observations</dd></div><div><dt>Current prompt</dt><dd>{(loaderData.copilot?.prompts as any[])?.find((p:any)=>p.is_current)?.edited_text || (loaderData.copilot?.prompts as any[])?.find((p:any)=>p.is_current)?.generated_text || "Not generated"}</dd></div></dl><div className="attachment-grid">{(loaderData.copilot?.attachments as any[]||[]).map(a=><img key={a.id} src={`/development/attachments/${a.id}`} alt={a.caption || a.original_filename}/>)}</div><ol className="development-conversation">{(loaderData.copilot?.thread as any[]||[]).map(entry=><li key={entry.id}><strong>{entry.entry_type}</strong><p>{entry.content}</p></li>)}</ol></section>:null}
        {actionData?.error ? (
          <p role="alert" className="form-message error">
            {actionData.error}
          </p>
        ) : actionData?.ok ? (
          <p role="status" className="form-message success">
            Safe run {actionData.runId} completed.
          </p>
        ) : null}
        {!loaderData.initialized ? (
          <div className="agent-initialization-state">
            <strong>Agent runtime not initialized</strong>
            <p>
              The Development Console remains available, but audited agent runs
              require migration 0017.
            </p>
          </div>
        ) : (
          <Form method="post">
            <div className="console-grid">
              <label>
                Repository
                <select disabled>
                  <option>
                    colossalbreacker/net-x · Read sync not connected
                  </option>
                </select>
              </label>
              <label>
                Work item
                <input
                  name="work_item"
                  placeholder="Optional Development Request ID"
                  defaultValue={loaderData.selectedRequest}
                />
              </label>
              <label>
                Base branch
                <select disabled>
                  <option>Not connected</option>
                </select>
              </label>
              <label>
                Provider
                <select disabled>
                  <option>Deterministic DEVOS control plane</option>
                </select>
              </label>
              <label>
                Agent / role
                <select disabled>
                  <option>Selected by safe action</option>
                </select>
              </label>
              <label>
                Safe action
                <select name="mode">
                  {loaderData.safeModes.map(([label]) => (
                    <option key={label}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Context
              <textarea
                name="context"
                rows={5}
                placeholder="Optional context; no shell commands or code changes will run"
              />
            </label>
            <button>Run safe analysis</button>
          </Form>
        )}
        <div className="console-prohibited">
          <strong>Not connected:</strong> Implement, code generation, shell,
          repository checkout, file edits, commit, push, Prepare PR, merge, and
          deployment.
        </div>
        <div className="console-output-grid">
          {[
            "Plan",
            "Records inspected",
            "Draft",
            "Checks",
            "Findings",
            "Approval",
          ].map((title) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>
                Results are stored in the selected agent's audited run history.
              </p>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
