import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/development-branch-sync";
import {
  requireAuthenticatedUser,
  requireRole,
  type AccessEnvironment,
} from "../lib/auth.server";
import {
  getBranchMappings,
  listBranchSyncRows,
  summarizeBranchSync,
} from "../lib/development/branch-sync.server";
import {
  branchStateIcon,
  branchSyncGuidance,
  displayBranchState,
  rowMatchesBranchView,
  syncConfidence,
  type BranchSyncState,
} from "../lib/development/branch-sync";
import { statusLabel, statusTone } from "../lib/development/status";
import { getGitHubSyncStatus } from "../lib/development/repository.server";
import { phaseTimestamp, syncStatusMessage } from "../lib/development/sync-state";
import { getDevelopmentRequest } from "../lib/development/repository.server";
import { generateBatchPrompt, generateImplementationPrompt, type CopilotEnvironment } from "../lib/development/copilot.server";
import type { BranchEvidence } from "../lib/development/copilot";

type Env = AccessEnvironment & CopilotEnvironment;

function evidence(row: Awaited<ReturnType<typeof listBranchSyncRows>>[number], github: Awaited<ReturnType<typeof getGitHubSyncStatus>>): BranchEvidence {
  const confidence=[row.adam,row.joe,row.dev,row.main].map(syncConfidence).includes("UNKNOWN") ? "UNKNOWN" : [row.adam,row.joe,row.dev,row.main].map(syncConfidence).includes("PROBABLE") ? "PROBABLE" : "EXACT";
  const branch=(value:typeof row.adam)=>({sha:value.sha,state:value.comparison === "PATCH_EQUIVALENT" ? "patch_equivalent":value.comparison === "CONFLICT" ? "conflict":value.state,checkedAt:value.checkedAt});
  return {requestId:row.id,title:row.title,issue:row.issueNumber ? `#${row.issueNumber}`:null,pr:row.prNumber ? `#${row.prNumber}`:null,adam:branch(row.adam),joe:branch(row.joe),dev:branch(row.dev),main:branch(row.main),confidence,ci:row.ci,adamQa:row.adamQa,joeQa:row.joeQa,syncOutcome:github.lastRun?.freshness,deferred:github.lastRun?.result?.comparisons.deferred,generatedAt:new Date().toISOString()};
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as Env;
  const user = await requireAuthenticatedUser(request, env);
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "all";
  const [rows, mappings, github] = await Promise.all([
    listBranchSyncRows(env.linkedinadam_db),
    getBranchMappings(env.linkedinadam_db),
    getGitHubSyncStatus(env.linkedinadam_db),
  ]);
  const joe = mappings.find((mapping) => mapping.role === "joe");
  const joeMapped = joe?.status === "MAPPED" && Boolean(joe.branchName);
  return {
    rows: rows.filter((row) => rowMatchesBranchView(row, view, joeMapped)),
    summary: summarizeBranchSync(rows, joeMapped),
    mappings,
    github,
    view,
    user,
  };
}

export async function action({request,context}:Route.ActionArgs){
  const env=context.cloudflare.env as unknown as Env; const user=await requireAuthenticatedUser(request,env); requireRole(user,["OWNER","ADMIN","DEVELOPER"]); const form=await request.formData(); const intent=String(form.get("intent")||"");
  const [rows,github]=await Promise.all([listBranchSyncRows(env.linkedinadam_db),getGitHubSyncStatus(env.linkedinadam_db)]); const all=rows;
  try {
    if(intent==="generate_sync_prompt"){const id=String(form.get("request_id")||"");const row=all.find(item=>item.id===id);if(!row)throw new Error("Branch Sync row not found.");const record=await getDevelopmentRequest(env.linkedinadam_db,id);if(!record)throw new Error("Development Request not found.");await generateImplementationPrompt(env,user,record,String(form.get("target_tool")||"Codex"),"branch_sync",evidence(row,github));return {ok:true,message:"Request-specific Sync Prompt generated and added to the Development Conversation.",requestId:id};}
    if(intent==="generate_reconciliation_prompt"){let ids=form.getAll("selected_request").map(String);if(String(form.get("scope"))==="visible"&&!ids.length)ids=all.filter(row=>branchSyncGuidance(row,true).promotion!=="Monitor").map(row=>row.id);const result=await generateBatchPrompt(env.linkedinadam_db,user,all.filter(row=>ids.includes(row.id)).map(row=>evidence(row,github)),String(form.get("target_tool")||"Codex"));return {ok:true,message:`Batch reconciliation prompt generated for ${ids.length} requests.`,prompt:result.prompt};}
  }catch(error){return {error:error instanceof Error?error.message:"Unable to generate remediation prompt."};}
  return {error:"Unsupported Branch Sync action."};
}

function olderThan(value: string | null, reference: string | null) {
  if (!value || !reference) return false;
  const parse = (timestamp: string) => Date.parse(timestamp.includes("T") ? timestamp : `${timestamp.replace(" ", "T")}Z`);
  return parse(value) < parse(reference);
}

function BranchState({ value, referenceAt }: { value: BranchSyncState; referenceAt: string | null }) {
  const label = displayBranchState(value);
  const tone =
    label === "Exact" || label === "Present" || label === "Patch Equivalent"
      ? "complete"
      : label === "Conflict"
        ? "blocked"
        : label === "Not Present"
          ? ""
          : "attention";
  return (
    <span className={`development-status ${tone}`}>
      <span aria-hidden="true">{branchStateIcon(value)}</span>
      {label}
      {syncConfidence(value) !== "UNKNOWN" ? (
        <small>{syncConfidence(value).replaceAll("_", " ")}</small>
      ) : null}
      {!value.checkedAt ? <small>Data missing</small> : olderThan(value.checkedAt, referenceAt) ? <small>Last-known · stale</small> : <small>Refreshed</small>}
    </span>
  );
}

const summaryLinks = [
  ["Adam Only", "adamOnly", "adam-only"],
  ["Joe Only", "joeOnly", "joe-only"],
  ["Personal → Dev", "personalDev", "personal-dev"],
  ["Dev → Main", "devMain", "dev-main"],
  ["Main Needs Verification", "mainVerify", "main-verify"],
  ["CI Blocking", "ciBlocking", "ci-blocking"],
  ["Mapping Required", "mappingRequired", "mapping-required"],
  ["Unknown", "unknown", "unknown"],
] as const;

export default function DevelopmentBranchSync({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation=useNavigation();
  const pendingIntent=String(navigation.formData?.get("intent")||"");
  const pendingRequestId=String(navigation.formData?.get("request_id")||"");
  const syncPromptPending=(requestId:string)=>navigation.state!=="idle"&&pendingIntent==="generate_sync_prompt"&&pendingRequestId===requestId;
  const reconciliationPending=navigation.state!=="idle"&&pendingIntent==="generate_reconciliation_prompt";
  const joe = loaderData.mappings.find((mapping) => mapping.role === "joe");
  const joeMapped = joe?.status === "MAPPED" && Boolean(joe.branchName);
  const result = loaderData.github.lastRun?.result;
  const coreAt = phaseTimestamp(result || null, ["coreSync"]) || loaderData.github.lastRun?.finished_at || null;
  return (
    <main className="development-page branch-sync-page">
      <header className="development-header">
        <div>
          <p className="eyebrow">DEVELOPMENT / GIT STATE</p>
          <h1>Branch Sync</h1>
          <p>
            Compare Adam, Joe, dev, and main without treating branch presence as
            human QA.
          </p>
        </div>
        <div className="branch-mapping-summary" aria-label="Branch mappings">
          {loaderData.mappings.map((mapping) => (
            <span key={mapping.role}>
              <strong>{mapping.role}</strong>
              {mapping.branchName || mapping.status.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      </header>

      <nav className="development-subnav" aria-label="Development navigation">
        <Link to="/development">Requests</Link>
        <Link aria-current="page" to="/development/branch-sync">
          Branch Sync
        </Link>
        <Link to="/development/environments">Environments &amp; QA</Link>
        <Link to="/development/console">Development Console</Link>
      </nav>

      <section
        className={`branch-sync-health ${loaderData.github.lastRun?.freshness === "FAILED" ? "failed" : ""}`}
        role="status"
      >
        <strong>
          {loaderData.github.lastRun ? syncStatusMessage(loaderData.github.lastRun.status, result || null) : "No GitHub sync run recorded"}
        </strong>
        <span>
          {loaderData.github.lastRun?.finished_at ||
            loaderData.github.lastRun?.started_at ||
            "Branch timestamps remain visible per row"}
        </span>
      </section>

      {loaderData.github.lastRun ? (
        <section className="panel" aria-label="GitHub freshness by phase">
          <div className="panel-heading"><div><p className="eyebrow">SYNC FRESHNESS</p><h2>{loaderData.github.lastRun.freshness.replaceAll("_", " ")}</h2></div></div>
          <dl className="detail-overview">
            <div><dt>Core GitHub</dt><dd>{result ? `${result.coreSync.status} · ${result.coreSync.completed_at || "not completed"}` : "Legacy run · granular data unavailable"}</dd></div>
            <div><dt>PR details / reviews / CI</dt><dd>{result ? `${result.prDetails.status} / ${result.reviews.status} / ${result.ci.status} · ${result.ci.completed_at || "not completed"}` : "Granular data unavailable"}</dd></div>
            <div><dt>Branch observations</dt><dd>{result ? `${result.branches.status} · ${result.branches.completed_at || "not completed"}` : "Last-known timestamps remain visible"}</dd></div>
            <div><dt>Comparisons / patch equivalence</dt><dd>{result ? `${result.comparisons.status} · ${result.comparisons.processed} processed · ${result.comparisons.deferred} deferred` : "Granular data unavailable"}</dd></div>
          </dl>
          <p><small>Missing data has never been observed. Last-known data remains visible but is marked stale when it predates the current core refresh.</small></p>
        </section>
      ) : null}

      {!joeMapped ? (
        <section className="panel branch-mapping-warning" role="status">
          <strong>Joe branch mapping required</strong>
          <p>
            DEVOS found {joe?.candidates.length || 0} plausible candidates. An
            OWNER or ADMIN must confirm the mapping before personal-branch
            guidance is authoritative.
          </p>
        </section>
      ) : null}

      <section className="branch-summary" aria-label="Branch Sync summary">
        {summaryLinks.map(([label, key, view]) => (
          <Link
            className={loaderData.view === view ? "active" : ""}
            key={key}
            to={`/development/branch-sync?view=${view}`}
          >
            <span>{label}</span>
            <strong>{loaderData.summary[key]}</strong>
          </Link>
        ))}
      </section>

      <div className="branch-sync-toolbar">
        <nav aria-label="Branch comparison views">
          <Link
            className={loaderData.view === "all" ? "active" : ""}
            to="/development/branch-sync"
          >
            All GitHub work
          </Link>
          <Link
            className={loaderData.view === "adam-joe" ? "active" : ""}
            to="/development/branch-sync?view=adam-joe"
          >
            Adam ↔ Joe
          </Link>
          <Link
            className={loaderData.view === "dev-main" ? "active" : ""}
            to="/development/branch-sync?view=dev-main"
          >
            dev ↔ main
          </Link>
        </nav>
        <span>{loaderData.rows.length} records</span>
      </div>

      {actionData?.error?<p className="form-message error" role="alert">{actionData.error}</p>:actionData?.message?<p className="form-message success" role="status">{actionData.message}</p>:null}
      {actionData?.prompt?<details className="panel current-prompt" open><summary>Generated batch reconciliation prompt</summary><textarea readOnly rows={18} value={actionData.prompt}/><button type="button" onClick={()=>navigator.clipboard.writeText(actionData.prompt)}>Copy Prompt</button></details>:null}

      <Form method="post" aria-busy={reconciliationPending}><input type="hidden" name="intent" value="generate_reconciliation_prompt"/><input type="hidden" name="scope" value="selected"/><div className="branch-batch-actions"><button disabled={reconciliationPending}>{reconciliationPending?"Generating reconciliation prompt…":"Generate Reconciliation Prompt for selected"}</button><button name="scope" value="visible" disabled={reconciliationPending}>{reconciliationPending?"Working…":"Generate for visible actionable rows"}</button>{reconciliationPending?<span className="async-status" role="status"><span className="loading-spinner" aria-hidden="true"/>Analyzing selected branch evidence request by request…</span>:null}</div><section
        className="branch-matrix-wrap"
        aria-label="Branch comparison matrix"
      >
        <table className="branch-matrix">
          <thead>
            <tr>
              <th><span className="sr-only">Select</span></th><th>Request</th>
              <th>Issue / PR</th>
              <th>Adam</th>
              <th>Joe</th>
              <th>dev</th>
              <th>main</th>
              <th>CI</th>
              <th>QA</th>
              <th>Next Promotion</th>
              <th>Sync Confidence</th>
              <th>Next Action</th>
            </tr>
          </thead>
          <tbody>
            {loaderData.rows.map((row) => {
              const guidance = branchSyncGuidance(row, joeMapped);
              const confidenceStates = [
                row.adam,
                row.joe,
                row.dev,
                row.main,
              ].map(syncConfidence);
              const confidence = confidenceStates.includes("UNKNOWN")
                ? "UNKNOWN"
                : confidenceStates.includes("PROBABLE")
                  ? "PROBABLE"
                  : confidenceStates.includes("PATCH_EQUIVALENT")
                    ? "PATCH_EQUIVALENT"
                    : "EXACT";
              return (
                <tr key={row.id}>
                  <td><input type="checkbox" name="selected_request" value={row.id} aria-label={`Select ${row.title}`}/></td>
                  <td className="branch-request-cell">
                    <Link to={`/development?request=${row.id}`}>
                      {row.title}
                    </Link>
                    <small>{row.externalKey || row.id.slice(0, 8)}</small>
                    <details>
                      <summary>Why DEVOS thinks these differ</summary>
                      <div className="branch-difference-detail">
                        {(["adam", "joe", "dev", "main"] as const).map(
                          (branch) => (
                            <p key={branch}>
                              <strong>{branch}</strong>:{" "}
                              {row[branch].sha?.slice(0, 12) || "No SHA"} ·{" "}
                              {row[branch].comparison} ·{" "}
                              {syncConfidence(row[branch])} · checked{" "}
                              {row[branch].checkedAt || "never"}
                            </p>
                          ),
                        )}
                        <p>
                          PR:{" "}
                          {row.prNumber
                            ? `#${row.prNumber} · ${row.sourceBranch} → ${row.targetBranch}`
                            : "No PR linked"}
                        </p>
                        <p>
                          Files:{" "}
                          {row.changedFiles.length
                            ? row.changedFiles
                                .slice(0, 6)
                                .map((file) => file.filename)
                                .join(", ")
                            : "No changed-file summary available"}
                        </p>
                      </div>
                    </details>
                  </td>
                  <td>
                    {row.issueNumber && row.issueUrl ? (
                      <a href={row.issueUrl} target="_blank" rel="noreferrer">
                        Issue #{row.issueNumber}
                      </a>
                    ) : (
                      "—"
                    )}
                    {row.prNumber && row.prUrl ? (
                      <a href={row.prUrl} target="_blank" rel="noreferrer">
                        PR #{row.prNumber}
                      </a>
                    ) : null}
                  </td>
                  <td>
                    <BranchState value={row.adam} referenceAt={coreAt} />
                  </td>
                  <td>
                    <BranchState value={row.joe} referenceAt={coreAt} />
                  </td>
                  <td>
                    <BranchState value={row.dev} referenceAt={coreAt} />
                  </td>
                  <td>
                    <BranchState value={row.main} referenceAt={coreAt} />
                  </td>
                  <td>
                    <span
                      className={`development-status ${row.ci === "Failing" ? "blocked" : row.ci === "Passing" ? "complete" : "attention"}`}
                    >
                      {row.ci}
                    </span>
                  </td>
                  <td className="branch-qa-state">
                    <span>Adam: {statusLabel(row.adamQa)}</span>
                    <span>Joe: {statusLabel(row.joeQa)}</span>
                    <span
                      className={`development-status ${statusTone(row.overallStatus)}`}
                    >
                      {statusLabel(row.overallStatus)}
                    </span>
                  </td>
                  <td>{guidance.promotion}</td>
                  <td>
                    <span className="branch-confidence">
                      {confidence.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="branch-next-action">
                    <strong>{guidance.action}</strong>
                    <button form={`sync-prompt-${row.id}`} type="submit" disabled={syncPromptPending(row.id)}>{syncPromptPending(row.id)?"Generating sync remediation prompt…":"Generate Sync Prompt"}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loaderData.rows.length ? (
          <p className="empty-state">No records match this Branch Sync view.</p>
        ) : null}
      </section>
      </Form>
      {loaderData.rows.map(row=><Form method="post" id={`sync-prompt-${row.id}`} key={`prompt-${row.id}`} aria-busy={syncPromptPending(row.id)}><input type="hidden" name="intent" value="generate_sync_prompt"/><input type="hidden" name="request_id" value={row.id}/><input type="hidden" name="target_tool" value="Codex"/>{syncPromptPending(row.id)?<span className="sr-only" role="status">Generating sync remediation prompt for {row.title}…</span>:null}</Form>)}
    </main>
  );
}
