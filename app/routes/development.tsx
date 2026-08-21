import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/development";
import { QaHandoffCard } from "../components/QaHandoffCard";
import { DevelopmentAttachmentPicker } from "../components/DevelopmentAttachmentPicker";
import {
  type AccessEnvironment,
  requireAuthenticatedUser,
} from "../lib/auth.server";
import type { GitHubEnvironment } from "../lib/integrations/github.server";
import { runManualGitHubReadinessSync } from "../lib/development/github-readiness.server";
import {
  getDevelopmentRequest,
  getDevelopmentSummary,
  getGitHubSyncStatus,
  listActivity,
  listDevelopmentRequests,
  listNeedsAttention,
} from "../lib/development/repository.server";
import {
  createDevelopmentRequest,
  recordQaAction,
  recordDevelopmentApproval,
  saveQaHandoff,
  updateDevelopmentRequest,
} from "../lib/development/service.server";
import {
  DEVELOPMENT_PRIORITIES,
  DEVELOPMENT_STATUSES,
  DEVELOPMENT_TYPES,
  type DevelopmentFilters,
} from "../lib/development/types";
import { statusLabel, statusTone } from "../lib/development/status";
import { environmentQaForRequest } from "../lib/development/environments.server";
import { composeEnvironmentTestUrl } from "../lib/development/environments";
import { getEnvironmentQaReadiness } from "../lib/development/environment-readiness.server";
import { syncStatusMessage } from "../lib/development/sync-state";
import { DEVELOPMENT_WORK_STATES, COPILOT_TARGETS, mergeReadiness } from "../lib/development/copilot";
import { addAndAnalyzeResponse, editPrompt, generateImplementationPrompt, generateSummary, getCopilotContext, hardDeleteRequest, initializeCopilotRequest, listCopilotStates, markPromptSent, setWorkState, type CopilotEnvironment } from "../lib/development/copilot.server";
import { saveDevelopmentAttachments } from "../lib/development/attachments.server";

type DevelopmentEnvironment = AccessEnvironment & GitHubEnvironment & CopilotEnvironment;

function environment(
  context: Route.LoaderArgs["context"] | Route.ActionArgs["context"],
) {
  return context.cloudflare.env as unknown as DevelopmentEnvironment;
}

function filtersFromUrl(url: URL): DevelopmentFilters {
  const priority = url.searchParams.get("priority") || "";
  const type = url.searchParams.get("type") || "";
  const status = url.searchParams.get("status") || "";
  return {
    workState: url.searchParams.get("work_state") || "",
    search: url.searchParams.get("search") || "",
    priority: DEVELOPMENT_PRIORITIES.includes(priority as never)
      ? (priority as DevelopmentFilters["priority"])
      : "",
    type: DEVELOPMENT_TYPES.includes(type as never)
      ? (type as DevelopmentFilters["type"])
      : "",
    area: url.searchParams.get("area") || "",
    owner: url.searchParams.get("owner") || "",
    qaPartner: url.searchParams.get("qa_partner") || "",
    status: DEVELOPMENT_STATUSES.includes(status as never)
      ? (status as DevelopmentFilters["status"])
      : "",
    attention:
      url.searchParams.get("attention") === "ci_failing" ||
      url.searchParams.get("attention") === "unknown_sync"
        ? (url.searchParams.get("attention") as DevelopmentFilters["attention"])
        : "",
    view: (url.searchParams.get("view") || "") as DevelopmentFilters["view"],
    sort: (url.searchParams.get("sort") ||
      "priority") as DevelopmentFilters["sort"],
  };
}

function developmentUrl(
  filters: DevelopmentFilters,
  detail?: { request: string; tab?: string },
) {
  const params = new URLSearchParams();
  const values: [string, string | undefined][] = [
    ["search", filters.search],
    ["priority", filters.priority],
    ["type", filters.type],
    ["area", filters.area],
    ["owner", filters.owner],
    ["qa_partner", filters.qaPartner],
    ["status", filters.status],
    ["attention", filters.attention],
    ["view", filters.view],
    ["sort", filters.sort],
    ["work_state", filters.workState],
  ];
  for (const [key, value] of values) if (value) params.set(key, value);
  if (detail) {
    params.set("request", detail.request);
    if (detail.tab) params.set("tab", detail.tab);
  }
  const query = params.toString();
  return query ? `/development?${query}` : "/development";
}

function parseGitHubPayload(value: string | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, any>;
  } catch {
    return null;
  }
}

function ciFromPayload(payload: Record<string, any> | null) {
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];
  if (!checks.length) return "Unknown";
  if (
    checks.some((check: any) =>
      ["failure", "cancelled", "timed_out", "action_required"].includes(
        check.conclusion,
      ),
    )
  )
    return "Failing";
  if (checks.some((check: any) => check.status !== "completed"))
    return "Pending";
  return "Passing";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = environment(context);
  const user = await requireAuthenticatedUser(request, env);
  const url = new URL(request.url);
  const requestId = url.searchParams.get("request");
  const requestedTab = url.searchParams.get("tab");
  const detailTab = ["overview", "qa", "github", "activity"].includes(
    requestedTab || "",
  )
    ? requestedTab
    : "overview";
  const filters = filtersFromUrl(url);
  const environmentQaReadiness = await getEnvironmentQaReadiness(
    env.linkedinadam_db,
  );
  const workStateFilter=filters.workState||"";
  if (environmentQaReadiness.state === "ERROR")
    throw environmentQaReadiness.error;
  const [
    summary,
    requests,
    attention,
    activity,
    detail,
    github,
    environmentQa,
    copilot,
    copilotStates,
  ] = await Promise.all([
    getDevelopmentSummary(env.linkedinadam_db),
    listDevelopmentRequests(env.linkedinadam_db, filters),
    listNeedsAttention(env.linkedinadam_db, user.email),
    listActivity(env.linkedinadam_db),
    requestId ? getDevelopmentRequest(env.linkedinadam_db, requestId) : null,
    getGitHubSyncStatus(env.linkedinadam_db),
    requestId && environmentQaReadiness.state === "READY"
      ? environmentQaForRequest(env.linkedinadam_db, requestId)
      : [],
    requestId ? getCopilotContext(env.linkedinadam_db, requestId) : null,
    listCopilotStates(env.linkedinadam_db),
  ]);

  return {
    summary,
    requests: (requests.results || []).filter(item=>{const state=(copilotStates.states as any[]).find((value:any)=>value.development_request_id===item.id)?.work_state || "NEEDS_PROMPT";return workStateFilter ? state===workStateFilter : state!=="ARCHIVED";}),
    attention: attention.results || [],
    activity: activity.results || [],
    detail,
    detailTab,
    filters,
    user,
    github,
    environmentQa,
    environmentQaInitialized: environmentQaReadiness.state === "READY",
    copilot,
    workStateFilter,
    workStateCounts: DEVELOPMENT_WORK_STATES.reduce((counts,state)=>({...counts,[state]:(copilotStates.states as any[]).filter((value:any)=>value.work_state===state).length}),{} as Record<string,number>),
    githubConnection: {
      connected: Boolean(
        env.GITHUB_APP_ID &&
        env.GITHUB_APP_INSTALLATION_ID &&
        env.GITHUB_APP_PRIVATE_KEY,
      ),
      repository: `${env.GITHUB_REPOSITORY_OWNER || "colossalbreacker"}/${env.GITHUB_REPOSITORY_NAME || "net-x"}`,
      scheduled: env.GITHUB_SYNC_ENABLED === "true",
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = environment(context);
  const user = await requireAuthenticatedUser(request, env);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "github_readiness_sync") {
    const result = await runManualGitHubReadinessSync(env, user);
    if (result.status === "rejected" || result.status === "skipped" || result.status === "failed")
      return { error: result.error };
    return {
      ok: true,
      message: result.status === "partial"
        ? `Core GitHub data refreshed. ${result.result?.comparisons.deferred || 0} branch comparisons will continue on the next sync.`
        : "GitHub sync complete",
    };
  }

  if (intent === "create_request") {
    const id = await createDevelopmentRequest(env.linkedinadam_db, user, {
      title: String(formData.get("title") || ""),
      problem: String(formData.get("problem") || ""),
      whyDecision: String(formData.get("why_decision") || ""),
      priority: String(formData.get("priority") || "P2"),
      type: String(formData.get("type") || "Other"),
      productArea: String(formData.get("product_area") || ""),
      ownerEmail: String(formData.get("owner_email") || ""),
      qaPartnerEmail: String(formData.get("qa_partner_email") || ""),
      notes: String(formData.get("notes") || ""),
      requestedBy: String(formData.get("requested_by") || ""),
      issueUrl: String(formData.get("issue_url") || ""),
      prUrl: String(formData.get("pr_url") || ""),
      branch: String(formData.get("branch") || ""),
    });
    const initialized = await initializeCopilotRequest(env.linkedinadam_db, id, user);
    const files = formData.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
    if (initialized && files.length) await saveDevelopmentAttachments(env, user, id, files, { caption: String(formData.get("attachment_caption") || ""), category: String(formData.get("attachment_category") || "Other") });
    return { ok: true, requestId: id };
  }

  const requestId = String(formData.get("request_id") || "");
  if (["generate_summary","generate_prompt","generate_follow_up","add_response","report_failure","set_work_state","edit_prompt","mark_prompt_sent","add_attachments","archive_request","restore_request","hard_delete"].includes(intent)) {
    const record = await getDevelopmentRequest(env.linkedinadam_db, requestId);
    if (!record) return { error: "Development Request not found." };
    try {
      if (intent === "generate_summary") { const copilot = await getCopilotContext(env.linkedinadam_db, requestId); await generateSummary(env,user,record.request,record.githubItems,copilot.attachments); return {ok:true,message:"Summary and technical interpretation generated."}; }
      if (intent === "generate_prompt" || intent === "generate_follow_up") { await generateImplementationPrompt(env,user,record,String(formData.get("target_tool")||"Codex"),intent === "generate_follow_up" ? "follow_up" : "implementation"); return {ok:true,message:"A new prompt version was generated."}; }
      if (intent === "add_response" || intent === "report_failure") { const response=await addAndAnalyzeResponse(env,user,record,String(formData.get("entry_type")||"CODEX"),String(formData.get("content")||""),intent === "report_failure"); const files=formData.getAll("attachments").filter((value):value is File=>value instanceof File&&value.size>0); if(files.length)await saveDevelopmentAttachments(env,user,requestId,files,{category:intent === "report_failure" ? "Error":"Reference",threadEntryId:response.entryId}); return {ok:true,message:intent === "report_failure" ? "Failure analyzed; prior context was preserved." : "Response added and analyzed."}; }
      if (intent === "set_work_state") { await setWorkState(env.linkedinadam_db,user,requestId,String(formData.get("work_state")||"")); return {ok:true,message:"Work state updated."}; }
      if (intent === "archive_request" || intent === "restore_request") { await setWorkState(env.linkedinadam_db,user,requestId,intent === "archive_request" ? "ARCHIVED":"NEEDS_PROMPT"); return {ok:true,message:intent === "archive_request" ? "Request archived; history and attachments were preserved.":"Request restored."}; }
      if (intent === "edit_prompt") { await editPrompt(env.linkedinadam_db,user,String(formData.get("prompt_id")||""),String(formData.get("prompt_text")||"")); return {ok:true,message:"Prompt edit saved without replacing prior versions."}; }
      if (intent === "mark_prompt_sent") { await markPromptSent(env.linkedinadam_db,user,String(formData.get("prompt_id")||"")); return {ok:true,message:"Prompt marked sent."}; }
      if (intent === "add_attachments") { const files=formData.getAll("attachments").filter((value):value is File=>value instanceof File&&value.size>0); await saveDevelopmentAttachments(env,user,requestId,files,{caption:String(formData.get("attachment_caption")||""),category:String(formData.get("attachment_category")||"Other")}); return {ok:true,message:"Screenshots added."}; }
      if (intent === "hard_delete") { await hardDeleteRequest(env,user,requestId,String(formData.get("delete_reason")||""),String(formData.get("delete_confirmation")||"")); return {ok:true,message:"Request permanently deleted."}; }
    } catch(error) { return {error:error instanceof Error ? error.message : "Development Copilot action failed."}; }
  }

  if (intent === "update_request") {
    try {
      await updateDevelopmentRequest(env.linkedinadam_db, user, {
        requestId: String(formData.get("request_id") || ""),
        title: String(formData.get("title") || ""),
        priority: String(formData.get("priority") || "P2"),
        type: String(formData.get("type") || "Other"),
        productArea: String(formData.get("product_area") || ""),
        requestedBy: String(formData.get("requested_by") || ""),
        ownerEmail: String(formData.get("owner_email") || ""),
        qaPartnerEmail: String(formData.get("qa_partner_email") || ""),
        problem: String(formData.get("problem") || ""),
        whyDecision: String(formData.get("why_decision") || ""),
        notes: String(formData.get("notes") || ""),
      });
      return { ok: true, message: "Request updated." };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Unable to update request.",
      };
    }
  }

  if (intent === "qa_action") {
    try {
      await recordQaAction(env.linkedinadam_db, user, {
        requestId: String(formData.get("request_id") || ""),
        stage: String(formData.get("stage") || ""),
        outcome: String(formData.get("outcome") || "") as
          | "ready"
          | "passed"
          | "failed"
          | "approved",
        notes: String(formData.get("qa_notes") || ""),
      });
      return { ok: true, message: "QA action recorded." };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Unable to record QA action.",
      };
    }
  }

  if (intent === "save_handoff") {
    try {
      await saveQaHandoff(env.linkedinadam_db, user, {
        requestId: String(formData.get("request_id") || ""),
        stage: String(formData.get("stage") || ""),
        testUser: String(formData.get("test_user") || ""),
        tenant: String(formData.get("tenant") || ""),
        loginUrl: String(formData.get("login_url") || ""),
        testUrl: String(formData.get("test_url") || ""),
        navigation: String(formData.get("navigation") || ""),
        prerequisites: String(formData.get("prerequisites") || ""),
        testSteps: String(formData.get("test_steps") || ""),
        expectedResult: String(formData.get("expected_result") || ""),
        automatedCoverage: String(formData.get("automated_coverage") || ""),
        notes: String(formData.get("handoff_notes") || ""),
        status: String(formData.get("handoff_status") || "pending"),
      });
      return { ok: true, message: "QA handoff saved." };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : "Unable to save QA handoff.",
      };
    }
  }

  if (intent === "record_approval") {
    await recordDevelopmentApproval(env.linkedinadam_db, user, {
      requestId: String(formData.get("request_id") || ""),
      stage: String(formData.get("stage") || ""),
      decision: String(formData.get("decision") || ""),
      notes: String(formData.get("notes") || ""),
    });
    return { ok: true };
  }

  return { error: "Unknown development action." };
}

function SummaryCard({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <article className={`development-summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
function SummaryLink({
  label,
  value,
  to,
  tone = "",
}: {
  label: string;
  value: number;
  to: string;
  tone?: string;
}) {
  return (
    <Link to={to} className="summary-link">
      <SummaryCard label={label} value={value} tone={tone} />
    </Link>
  );
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`development-status ${statusTone(value)}`}>
      {statusLabel(value)}
    </span>
  );
}

export default function Development({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const {
    summary,
    requests,
    attention,
    activity,
    detail,
    detailTab,
    filters,
    user,
    github,
    githubConnection,
    environmentQa,
    environmentQaInitialized,
    copilot,
    workStateFilter,
    workStateCounts,
  } = loaderData;
  const developmentListUrl = developmentUrl(filters);
  const githubIssue = detail?.githubItems.find((item) => item.kind === "issue");
  const githubPullRequest = detail?.githubItems.find(
    (item) => item.kind === "pull_request",
  );
  const pullRequestPayload = parseGitHubPayload(
    githubPullRequest?.payload_json,
  );
  const issueLink = detail?.links.find((link: any) => link.type === "issue");
  const pullRequestLink = detail?.links.find(
    (link: any) => link.type === "pull_request",
  );
  const copilotState = copilot?.state as any;
  const currentPrompt = (copilot?.prompts as any[] | undefined)?.find((prompt:any)=>prompt.is_current);
  let branchPromptChanged=false;
  if(currentPrompt?.evidence_snapshot_json&&detail){try{const snapshot=JSON.parse(currentPrompt.evidence_snapshot_json);branchPromptChanged=(["adam","joe","dev","main"] as const).some(branch=>{const current=(detail.branches as any[]).find(item=>item.branch===branch);return snapshot[branch]?.sha!==(current?.commit_sha||null)||snapshot[branch]?.checkedAt!==(current?.checked_at||null);});}catch{branchPromptChanged=true;}}
  const readiness = detail ? mergeReadiness({ci:ciFromPayload(pullRequestPayload),mergeable:pullRequestPayload?.mergeable,conflict:detail.branches.some((branch:any)=>branch.state==="conflict"),stale:detail.branches.some((branch:any)=>!branch.checked_at),adamQa:(detail.qa as any[]).find((q:any)=>q.stage==="ADAM_QA")?.status,joeQa:(detail.qa as any[]).find((q:any)=>q.stage==="JOE_QA")?.status,devQa:(detail.qa as any[]).find((q:any)=>q.stage==="DEV_QA")?.status,mainVerification:(detail.qa as any[]).find((q:any)=>q.stage==="MAIN_VERIFICATION")?.status,approvals:detail.approvals.length}) : null;

  return (
    <main className="development-page">
      <header className="development-header">
        <div>
          <p className="eyebrow">DEVOS / ENGINEERING OPERATIONS</p>
          <h1>Development</h1>
          <p>Requests, QA, branch state, releases, and verification</p>
        </div>
        <div className="development-header-actions">
          <span
            className={`github-status-chip ${github.lastRun?.freshness === "FAILED" ? "error" : githubConnection.connected ? "connected" : "offline"}`}
          >
            <span aria-hidden="true">●</span>
            {github.lastRun?.freshness === "FAILED"
              ? "GitHub sync warning"
              : githubConnection.connected
                ? `GitHub ${github.lastRun?.freshness?.replaceAll("_", " ") || "connected"}`
                : "GitHub not connected"}
          </span>
          <a className="secondary-link" href="#new-request">
            New Request
          </a>
          <Link className="secondary-link" to="/development/environments">
            Environments &amp; QA
          </Link>
          <Link className="button-link" to="/development/console">
            Development Console
          </Link>
        </div>
      </header>

      <nav className="development-subnav" aria-label="Development navigation">
        <Link aria-current="page" to="/development">
          Requests
        </Link>
        <Link to="/development/branch-sync">Branch Sync</Link>
        <Link to="/development/environments">Environments &amp; QA</Link>
        <Link to="/development/console">Development Console</Link>
      </nav>

      <section
        className="development-summary-grid"
        aria-label="Development summary"
      >
        <SummaryLink
          label="P0 Open"
          value={summary.p0Open}
          to="/development?view=all_active&priority=P0"
          tone="critical"
        />
        <SummaryLink
          label="P1 Open"
          value={summary.p1Open}
          to="/development?view=all_active&priority=P1"
          tone="critical"
        />
        <SummaryLink
          label="Needs Adam"
          value={summary.awaitingAdam}
          to="/development?status=awaiting_adam"
        />
        <SummaryLink
          label="Needs Joe"
          value={summary.awaitingJoe}
          to="/development?status=awaiting_joe"
        />
        <SummaryLink
          label="Ready for Dev"
          value={summary.readyForDev}
          to="/development?status=ready_for_dev"
        />
        <SummaryLink
          label="Ready for Main"
          value={summary.readyForMain}
          to="/development?status=ready_for_main"
        />
        <SummaryLink
          label="Main Needs Verification"
          value={summary.onMainNeedsVerification}
          to="/development?status=on_main_needs_verification"
        />
        <SummaryLink
          label="Blocked"
          value={summary.blocked}
          to="/development?status=blocked"
          tone="critical"
        />
      </section>

      <section className="development-attention panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PERSONAL QUEUE</p>
            <h2>Needs Your Attention</h2>
          </div>
          <span>{attention.length}</span>
        </div>
        {attention.length ? (
          <ul className="attention-list">
            {attention.map((item) => (
              <li key={item.id}>
                <Link to={developmentUrl(filters, { request: item.id })}>
                  {item.priority} · {item.title}
                </Link>
                <span>
                  {item.next_action || statusLabel(item.overall_status)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">
            Nothing currently requires action for {user.displayName}.
          </p>
        )}
      </section>

      <details className="github-sync-details panel">
        <summary className="panel-heading">
          <div>
            <p className="eyebrow">READ-ONLY GITHUB</p>
            <h2>GitHub Sync</h2>
          </div>
          <span className="github-sync-summary">
            {githubConnection.connected
              ? "GitHub App connected"
              : "GitHub connection required"}
          </span>
        </summary>
        <dl className="detail-overview">
          <div>
            <dt>Repository</dt>
            <dd>{githubConnection.repository}</dd>
          </div>
          <div>
            <dt>Scheduled Sync</dt>
            <dd>{githubConnection.scheduled ? "On" : "Off"}</dd>
          </div>
        </dl>
        {user.role === "OWNER" || user.role === "ADMIN" ? (
          <Form
            method="post"
            onSubmit={(event) => {
              if (
                !confirm(
                  `Run one read-only GitHub synchronization against ${githubConnection.repository}?\n\nThis reads GitHub and updates DEVOS Development records. It does not modify GitHub.`,
                )
              )
                event.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="github_readiness_sync" />
            <button disabled={busy || github.lastRun?.status === "running"}>
              {github.lastRun?.status === "running"
                ? "GitHub sync already in progress"
                : "Run GitHub Readiness Sync"}
            </button>
          </Form>
        ) : null}
        {actionData?.error ? (
          <p className="form-message error" role="alert">
            {actionData.error}
          </p>
        ) : actionData?.message ? (
          <p className="form-message success" role="status">
            {actionData.message}
          </p>
        ) : null}
        {github.lastRun ? (
          <section>
            <h3>Latest Run</h3>
            <p className={github.lastRun.freshness === "FAILED" ? "form-message error" : "form-message"} role="status">
              {syncStatusMessage(github.lastRun.status, github.lastRun.result)}
            </p>
            <dl className="detail-overview">
              <div>
                <dt>Status</dt>
                <dd>{github.lastRun.freshness.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Trigger</dt>
                <dd>{github.lastRun.trigger || "Unknown"}</dd>
              </div>
              <div>
                <dt>Initiator</dt>
                <dd>{github.lastRun.initiator || "System"}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{github.lastRun.started_at}</dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{github.lastRun.finished_at || "In progress"}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>
                  {github.lastRun.duration_seconds === null
                    ? "In progress"
                    : `${github.lastRun.duration_seconds}s`}
                </dd>
              </div>
              <div>
                <dt>Core</dt>
                <dd>{github.lastRun.result ? `${github.lastRun.result.coreSync.status} · ${github.lastRun.result.coreSync.completed_at || "not completed"}` : "Legacy run · granular data unavailable"}</dd>
              </div>
              <div>
                <dt>CI / Reviews</dt>
                <dd>{github.lastRun.result ? `${github.lastRun.result.ci.status} / ${github.lastRun.result.reviews.status}` : "Granular data unavailable"}</dd>
              </div>
              <div>
                <dt>Comparisons</dt>
                <dd>{github.lastRun.result ? `${github.lastRun.result.comparisons.processed} processed · ${github.lastRun.result.comparisons.deferred} deferred` : "Granular data unavailable"}</dd>
              </div>
              <div>
                <dt>Issues</dt>
                <dd>{github.lastRun.issues_seen}</dd>
              </div>
              <div>
                <dt>PRs</dt>
                <dd>{github.lastRun.pull_requests_seen}</dd>
              </div>
              <div>
                <dt>Branches</dt>
                <dd>{github.lastRun.branches_seen}</dd>
              </div>
              <div>
                <dt>Matched</dt>
                <dd>{github.lastRun.matched_count}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{github.lastRun.created_count}</dd>
              </div>
              <div>
                <dt>Ambiguous</dt>
                <dd>{github.lastRun.ambiguous_count}</dd>
              </div>
              <div>
                <dt>Skipped</dt>
                <dd>{github.lastRun.skipped_count}</dd>
              </div>
              <div>
                <dt>Conflicts</dt>
                <dd>{github.lastRun.conflict_count}</dd>
              </div>
            </dl>
            {github.lastRun.freshness === "FAILED" && github.lastRun.error_message ? (
              <p className="form-message error" role="alert">
                {github.lastRun.error_message}
              </p>
            ) : null}
          </section>
        ) : (
          <p>
            {githubConnection.connected
              ? "Run one manual readiness sync to initialize GitHub-derived Development data."
              : "GitHub sync not connected. Current Development records and the manual QA workflow remain fully usable."}
          </p>
        )}
        <div className="branch-list">
          {github.branches.length ? (
            github.branches.map((branch) => (
              <span key={branch.role}>
                <strong>{branch.role}</strong>{" "}
                {branch.branch_name || branch.status}
                {branch.sha ? ` · ${branch.sha.slice(0, 8)}` : ""}
              </span>
            ))
          ) : (
            <span>Branch mapping will appear after the first sync.</span>
          )}
        </div>
      </details>

      <section className="development-toolbar panel">
        <Form method="get" className="development-filters">
          <label className="development-search">
            <span>Search</span>
            <input
              name="search"
              placeholder="Request, issue, PR, title, or area"
              defaultValue={filters.search}
            />
          </label>
          <label>
            <span>Saved view</span>
            <select name="view" defaultValue={filters.view}>
              <option value="">All records</option>
              <option value="all_active">All Active</option>
              <option value="needs_adam">Needs Adam</option>
              <option value="needs_joe">Needs Joe</option>
              <option value="urgent">P0 / P1</option>
              <option value="awaiting_approval">Awaiting Approval</option>
              <option value="ready_dev">Ready for Dev</option>
              <option value="on_dev">On Dev</option>
              <option value="ready_main">Ready for Main</option>
              <option value="main_verify">Main Needs Verification</option>
              <option value="blocked">Blocked</option>
              <option value="ci_failing">CI Failing</option>
              <option value="sync_unknown">Unknown Sync</option>
              <option value="verified">Verified</option>
            </select>
          </label>
          <label>
            <span>Copilot queue</span>
            <select name="work_state" defaultValue={workStateFilter}>
              <option value="">Active queues</option>
              {DEVELOPMENT_WORK_STATES.map((state) => (
                <option key={state} value={state}>
                  {state.replaceAll("_", " ")} ({workStateCounts[state] || 0})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select name="priority" defaultValue={filters.priority}>
              <option value="">All</option>
              {DEVELOPMENT_PRIORITIES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Type</span>
            <select name="type" defaultValue={filters.type}>
              <option value="">All</option>
              {DEVELOPMENT_TYPES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Product area</span>
            <input
              name="area"
              placeholder="All areas"
              defaultValue={filters.area}
            />
          </label>
          <label>
            <span>Owner</span>
            <input
              name="owner"
              placeholder="All owners"
              defaultValue={filters.owner}
            />
          </label>
          <label>
            <span>QA partner</span>
            <input
              name="qa_partner"
              placeholder="All QA"
              defaultValue={filters.qaPartner}
            />
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={filters.status}>
              <option value="">All statuses</option>
              {DEVELOPMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select name="sort" defaultValue={filters.sort}>
              <option value="priority">Priority</option>
              <option value="updated">Recently updated</option>
              <option value="next_action">Next action</option>
            </select>
          </label>
          <button type="submit">Filter</button>
          <Link className="filter-clear" to="/development">
            Clear
          </Link>
        </Form>
      </section>

      <section className="development-table-panel panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">SYSTEM OF RECORD</p>
            <h2>Development requests</h2>
          </div>
          <span>{requests.length} shown</span>
        </div>
        <div className="table-scroll">
          <table className="development-table">
            <thead>
              <tr>
                {[
                  "Request",
                  "Priority",
                  "Area",
                  "Owner",
                  "QA",
                  "Issue / PR",
                  "Adam",
                  "Joe",
                  "Dev",
                  "Main",
                  "CI",
                  "Next Action",
                  "Updated",
                ].map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.length ? (
                requests.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={developmentUrl(filters, { request: item.id })}>
                        <strong>{item.title}</strong>
                        <span>
                          {item.external_key || item.id.slice(0, 8)}
                          {item.issue_number
                            ? ` · Issue #${item.issue_number}`
                            : ""}
                        </span>
                        <StatusBadge value={item.overall_status} />
                      </Link>
                      <Link
                        className="request-test-link"
                        to={`/development/environments?request=${item.id}`}
                      >
                        Test
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`priority-badge ${item.priority.toLowerCase()}`}
                      >
                        {item.priority}
                      </span>
                    </td>
                    <td>{item.product_area || "—"}</td>
                    <td>{item.owner_email || "Unassigned"}</td>
                    <td>{item.qa_partner_email || "Unassigned"}</td>
                    <td>
                      <span className="github-link-stack">
                        {item.issue_url ? (
                          <a href={item.issue_url}>
                            Issue #{item.issue_number || "—"}
                          </a>
                        ) : (
                          <span>Issue unavailable</span>
                        )}
                        {item.pr_url ? (
                          <a href={item.pr_url}>
                            PR #{item.pr_number || "—"} ·{" "}
                            {item.pr_state || "unknown"}
                          </a>
                        ) : (
                          <span>PR unavailable</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <StatusBadge value={item.adam_state} />
                    </td>
                    <td>
                      <StatusBadge value={item.joe_state} />
                    </td>
                    <td>
                      <StatusBadge value={item.dev_state} />
                    </td>
                    <td>
                      <StatusBadge value={item.main_state} />
                    </td>
                    <td>
                      <StatusBadge value={item.ci_state || "CI Unknown"} />
                    </td>
                    <td className="next-action-cell">
                      <strong>→ {item.next_action}</strong>
                    </td>
                    <td>
                      <time dateTime={item.updated_at}>{item.updated_at}</time>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={13} className="empty-table">
                    No development requests yet. Create the first record below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="development-lower-grid">
        <details className="panel new-request-panel" id="new-request">
          <summary>
            <span>
              <strong>New development request</strong>
              <small>Manual entry remains available without GitHub</small>
            </span>
            <span aria-hidden="true">＋</span>
          </summary>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CONTROLLED WRITE</p>
              <h2>New request</h2>
            </div>
          </div>
          <Form method="post" encType="multipart/form-data" className="development-form quick-request-form">
            <input type="hidden" name="intent" value="create_request" />
            <label>
              Request / Idea
              <textarea required name="title" rows={5} placeholder="Describe the idea or bug in your own words…" />
            </label>
            <fieldset className="attachment-composer">
              <legend>Screenshots / Attachments</legend>
              <DevelopmentAttachmentPicker />
              <div className="form-grid"><label>Category<select name="attachment_category" defaultValue="Other">{["Current Behavior","Desired Behavior","Error","Reference","Other"].map(value=><option key={value}>{value}</option>)}</select></label><label>Caption<input name="attachment_caption" /></label></div>
            </fieldset>
            <div className="form-grid">
              <label>
                Priority
                <select name="priority" defaultValue="P2">
                  {DEVELOPMENT_PRIORITIES.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Type
                <select name="type" defaultValue="Other">
                  {DEVELOPMENT_TYPES.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Requested by
              <input name="requested_by" defaultValue={user.displayName} />
            </label>
            <div className="form-grid">
              <label>
                Owner email
                <input type="email" name="owner_email" />
              </label>
              <label>
                QA partner email
                <input type="email" name="qa_partner_email" />
              </label>
            </div>
            <label>
              Product area
              <input name="product_area" />
            </label>
            <label>Optional problem detail<textarea name="problem" rows={3} /></label>
            <label>
              Why / Decision
              <textarea name="why_decision" rows={3} />
            </label>
            <div className="form-grid">
              <label>
                Issue URL
                <input type="url" name="issue_url" />
              </label>
              <label>
                PR URL
                <input type="url" name="pr_url" />
              </label>
            </div>
            <label>
              Working branch
              <input name="branch" placeholder="Optional; never inferred" />
            </label>
            <label>
              Notes
              <textarea name="notes" rows={2} />
            </label>
            <p><strong>Default work state:</strong> Needs Prompt</p>
            <button disabled={busy}>
              {busy ? "Saving…" : "Create request"}
            </button>
          </Form>
        </details>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">APPEND-ONLY HISTORY</p>
              <h2>Recent activity</h2>
            </div>
          </div>
          {activity.length ? (
            <ul className="activity-list">
              {activity.map((event) => (
                <li key={event.id}>
                  <strong>{event.summary}</strong>
                  <span>
                    {event.actor_identity} · {event.occurred_at}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">Development events will appear here.</p>
          )}
        </section>
      </div>

      {detail ? (
        <aside
          className="development-detail"
          aria-label="Development request detail"
        >
          <div className="request-detail-header">
            <div>
              <p className="eyebrow">
                {detail.request.external_key || detail.request.id.slice(0, 8)}
              </p>
              <h2>{detail.request.title}</h2>
              <div className="request-detail-meta">
                <span
                  className={`priority-badge ${detail.request.priority.toLowerCase()}`}
                >
                  {detail.request.priority}
                </span>
                <span>{detail.request.product_area || "Unspecified area"}</span>
                <span>{detail.request.owner_email || "Unassigned owner"}</span>
                <span>
                  {detail.request.qa_partner_email || "Unassigned QA"}
                </span>
                <StatusBadge value={detail.request.overall_status} />
              </div>
              <strong className="request-next-action">
                →{" "}
                {detail.request.next_action ||
                  statusLabel(detail.request.overall_status)}
              </strong>
            </div>
            <div className="request-detail-actions">
              <Link
                className="secondary-link"
                to={`/development/console?request=${detail.request.id}`}
              >
                Open in Development Console
              </Link>
              <Link
                className="icon-link"
                aria-label="Close request detail"
                to={developmentListUrl}
              >
                ×
              </Link>
            </div>
          </div>
          <nav
            className="request-detail-tabs"
            aria-label="Request detail sections"
          >
            {["overview", "qa", "github", "activity"].map((tab) => (
              <Link
                key={tab}
                aria-current={detailTab === tab ? "page" : undefined}
                to={developmentUrl(filters, {
                  request: detail.request.id,
                  tab,
                })}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </Link>
            ))}
          </nav>
          {actionData?.error ? (
            <p className="form-message error" role="alert">
              {actionData.error}
            </p>
          ) : actionData?.message ? (
            <p className="form-message success" role="status">
              {actionData.message}
            </p>
          ) : null}
          <div className="request-detail-body">
            {detailTab === "overview" ? (
              <>
                {!copilot?.initialized ? <section className="copilot-uninitialized"><h3>Development Copilot not initialized</h3><p>Existing Development and GitHub workflows remain available until migration 0021 is applied.</p></section> : (
                  <section className="development-copilot" aria-label="Development Copilot">
                    <div className="panel-heading"><div><p className="eyebrow">READ + ANALYZE + DRAFT</p><h3>Development Copilot</h3></div><span className="development-status attention">{String(copilotState?.work_state || "NEEDS_PROMPT").replaceAll("_"," ")}</span></div>
                    <Form method="post" className="copilot-state-form"><input type="hidden" name="intent" value="set_work_state"/><input type="hidden" name="request_id" value={detail.request.id}/><label>Work state<select name="work_state" defaultValue={copilotState?.work_state || "NEEDS_PROMPT"}>{DEVELOPMENT_WORK_STATES.map(state=><option key={state} value={state}>{state.replaceAll("_"," ")}</option>)}</select></label><button>Update</button></Form>
                    <div className="copilot-summary-grid">
                      <article><h4>What Are We Trying to Do?</h4><p>{copilotState?.layman_summary || "Generate a summary from the human request and current evidence."}</p></article>
                      <article><h4>Technical Interpretation</h4><p>{copilotState?.technical_interpretation || "Not generated."}</p></article>
                      <article><h4>Current State</h4><p>{copilotState?.current_state_summary || "Needs Prompt"}</p></article>
                      <article><h4>Suggested Next Step</h4><p>{copilotState?.suggested_next_step || "Generate Summary & Prompt"}</p></article>
                    </div>
                    <Form method="post" className="copilot-actions"><input type="hidden" name="intent" value="generate_summary"/><input type="hidden" name="request_id" value={detail.request.id}/><button>Generate Summary &amp; Prompt Context</button></Form>
                    <Form method="post" className="copilot-actions"><input type="hidden" name="intent" value="generate_prompt"/><input type="hidden" name="request_id" value={detail.request.id}/><label>Target tool<select name="target_tool">{COPILOT_TARGETS.map(target=><option key={target}>{target}</option>)}</select></label><button>Generate Prompt</button></Form>
                    {branchPromptChanged ? <p className="form-message error">Branch state changed since this prompt was generated. Regenerate with current branch state.</p> : null}
                    {currentPrompt ? <article className="current-prompt"><h4>Current Prompt · Version {currentPrompt.version}</h4><Form method="post"><input type="hidden" name="intent" value="edit_prompt"/><input type="hidden" name="request_id" value={detail.request.id}/><input type="hidden" name="prompt_id" value={currentPrompt.id}/><textarea name="prompt_text" rows={14} defaultValue={currentPrompt.edited_text || currentPrompt.generated_text}/><div className="copilot-actions"><button>Save Edit</button><button type="button" onClick={(event)=>navigator.clipboard.writeText((event.currentTarget.closest("form")?.elements.namedItem("prompt_text") as HTMLTextAreaElement).value)}>Copy Prompt</button></div></Form><Form method="post"><input type="hidden" name="intent" value="mark_prompt_sent"/><input type="hidden" name="request_id" value={detail.request.id}/><input type="hidden" name="prompt_id" value={currentPrompt.id}/><button>Mark Sent</button></Form></article>:null}
                    <details><summary>Add Response</summary><Form method="post" encType="multipart/form-data"><input type="hidden" name="intent" value="add_response"/><input type="hidden" name="request_id" value={detail.request.id}/><label>Source<select name="entry_type">{["CODEX","CLAUDE","CHATGPT","GEMINI"].map(type=><option key={type}>{type}</option>)}</select></label><label>Response<textarea required name="content" rows={10}/></label><input type="file" name="attachments" accept="image/png,image/jpeg,image/webp" multiple/><button>Add &amp; Analyze Response</button></Form></details>
                    <details><summary>Report Failure</summary><Form method="post" encType="multipart/form-data"><input type="hidden" name="intent" value="report_failure"/><input type="hidden" name="request_id" value={detail.request.id}/><label>Source<select name="entry_type">{["CODEX","CLAUDE","CHATGPT","GEMINI"].map(type=><option key={type}>{type}</option>)}</select></label><label>Logs / failure details<textarea required name="content" rows={10}/></label><input type="file" name="attachments" accept="image/png,image/jpeg,image/webp" multiple/><button>Analyze Failure</button></Form><Form method="post"><input type="hidden" name="intent" value="generate_follow_up"/><input type="hidden" name="request_id" value={detail.request.id}/><button>Generate Follow-up Prompt</button></Form></details>
                    <section className="merge-readiness"><h4>Merge Readiness</h4><div><strong>{readiness?.level} · {readiness?.overall}/100</strong><span>Technical {readiness?.technical}/100</span><span>Workflow {readiness?.workflow}/100</span></div><p>{readiness?.explanation}</p>{readiness?.blockers.length ? <p className="form-message error">Hard blockers: {readiness.blockers.join(", ")}</p>:null}<small>Operational readiness score, not a probability.</small></section>
                    <section><h4>Screenshots</h4><div className="attachment-grid">{(copilot.attachments as any[]).map(a=><figure key={a.id}><a href={`/development/attachments/${a.id}`} target="_blank" rel="noreferrer"><img src={`/development/attachments/${a.id}`} alt={a.caption || a.original_filename}/></a><figcaption>{a.category} · {a.caption || a.original_filename}</figcaption></figure>)}</div><Form method="post" encType="multipart/form-data"><input type="hidden" name="intent" value="add_attachments"/><input type="hidden" name="request_id" value={detail.request.id}/><input required type="file" name="attachments" accept="image/png,image/jpeg,image/webp" multiple/><input name="attachment_caption" placeholder="Optional caption"/><button>Add screenshots</button></Form></section>
                    <section><h4>Development Conversation</h4><ol className="development-conversation">{(copilot.thread as any[]).map(entry=><li key={entry.id}><strong>{entry.entry_type}</strong><time>{entry.created_at}</time><p>{entry.content}</p></li>)}</ol></section>
                    <div className="archive-actions"><Form method="post"><input type="hidden" name="intent" value={copilotState?.work_state === "ARCHIVED" ? "restore_request":"archive_request"}/><input type="hidden" name="request_id" value={detail.request.id}/><button>{copilotState?.work_state === "ARCHIVED" ? "Restore":"Archive"}</button></Form>{user.role === "OWNER" ? <details><summary>Permanent delete</summary><Form method="post"><input type="hidden" name="intent" value="hard_delete"/><input type="hidden" name="request_id" value={detail.request.id}/><label>Reason<select name="delete_reason"><option>accidental entry</option><option>duplicate</option><option>test</option><option>junk</option></select></label><label>Type DELETE {detail.request.id}<input name="delete_confirmation"/></label><button className="danger">Permanently delete</button></Form></details>:null}</div>
                  </section>
                )}
                <section className="detail-overview">
                  <h3>Overview</h3>
                  <dl>
                    {[
                      ["Priority", detail.request.priority],
                      ["Type", detail.request.type],
                      ["Requested by", detail.request.requested_by_name],
                      ["Owner", detail.request.owner_email || "Unassigned"],
                      [
                        "QA partner",
                        detail.request.qa_partner_email || "Unassigned",
                      ],
                      [
                        "Product area",
                        detail.request.product_area || "Unspecified",
                      ],
                      ["Status", statusLabel(detail.request.overall_status)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <div className="detail-copy">
                  <section id="github-detail-summary">
                    <h3>Problem</h3>
                    <p>{detail.request.problem || "Not recorded."}</p>
                    <h3>Why / Decision</h3>
                    <p>{detail.request.why_decision || "Not recorded."}</p>
                  </section>
                  <section>
                    <h3>GitHub</h3>
                    {detail.links.length ? (
                      <ul>
                        {detail.links.map((link: any) => (
                          <li key={link.id}>
                            <a href={link.url || "#"}>
                              {link.type.replaceAll("_", " ")}
                            </a>{" "}
                            <small>
                              {link.provider === "manual"
                                ? "Manual link"
                                : "GitHub sync"}
                            </small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Pending GitHub connection.</p>
                    )}
                    <h3>Branch state</h3>
                    <ul className="branch-list">
                      {detail.branches.length ? (
                        detail.branches.map((branch: any) => (
                          <li key={branch.id}>
                            <strong>{branch.branch}</strong>
                            <StatusBadge value={branch.state} />
                            {branch.commit_sha ? (
                              <code>{branch.commit_sha.slice(0, 8)}</code>
                            ) : null}
                          </li>
                        ))
                      ) : (
                        <li>Unavailable until GitHub is connected.</li>
                      )}
                    </ul>
                  </section>
                </div>
                <details className="request-edit-panel">
                  <summary>Edit Request</summary>
                  <Form method="post" className="development-form">
                    <input type="hidden" name="intent" value="update_request" />
                    <input
                      type="hidden"
                      name="request_id"
                      value={detail.request.id}
                    />
                    <label>
                      Title
                      <input
                        required
                        name="title"
                        defaultValue={detail.request.title}
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        Priority
                        <select
                          name="priority"
                          defaultValue={detail.request.priority}
                        >
                          {DEVELOPMENT_PRIORITIES.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Type
                        <select name="type" defaultValue={detail.request.type}>
                          {DEVELOPMENT_TYPES.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      Product area
                      <input
                        name="product_area"
                        defaultValue={detail.request.product_area || ""}
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        Owner
                        <input
                          type="email"
                          name="owner_email"
                          defaultValue={detail.request.owner_email || ""}
                        />
                      </label>
                      <label>
                        QA partner
                        <input
                          type="email"
                          name="qa_partner_email"
                          defaultValue={detail.request.qa_partner_email || ""}
                        />
                      </label>
                    </div>
                    <label>
                      Requested by
                      <input
                        name="requested_by"
                        defaultValue={detail.request.requested_by_name}
                      />
                    </label>
                    <label>
                      Problem
                      <textarea
                        name="problem"
                        rows={3}
                        defaultValue={detail.request.problem || ""}
                      />
                    </label>
                    <label>
                      Why / Decision
                      <textarea
                        name="why_decision"
                        rows={3}
                        defaultValue={detail.request.why_decision || ""}
                      />
                    </label>
                    <label>
                      Notes
                      <textarea
                        name="notes"
                        rows={3}
                        defaultValue={detail.request.notes || ""}
                      />
                    </label>
                    <button disabled={busy}>Save request</button>
                  </Form>
                </details>
              </>
            ) : null}
            {detailTab === "qa" ? (
              <>
                <section>
                  <div className="development-detail-heading">
                    <h3>Test Environments</h3>
                    <Link
                      className="secondary-link"
                      to={`/development/environments?request=${detail.request.id}`}
                    >
                      Open QA workspace
                    </Link>
                  </div>
                  {environmentQaInitialized ? (
                    <div className="request-environment-table-wrap">
                      <table className="request-environment-table">
                        <thead>
                          <tr>
                            <th>Environment</th>
                            <th>Test URL</th>
                            <th>Status</th>
                            <th>Tester</th>
                            <th>Last Tested</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {environmentQa.map((row) => {
                            const testLink = composeEnvironmentTestUrl(
                              row.base_url,
                              row.test_path,
                            );
                            return (
                              <tr key={row.environment_id}>
                                <td>{row.environment_name}</td>
                                <td>
                                  <a
                                    href={testLink.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {testLink.specific
                                      ? testLink.url
                                      : "Environment root"}
                                  </a>
                                  {!testLink.specific ? (
                                    <small>Specific test route required</small>
                                  ) : null}
                                </td>
                                <td>
                                  <StatusBadge value={row.qa_status} />
                                </td>
                                <td>{row.tester_name || "Not tested"}</td>
                                <td>{row.tested_at || "Never"}</td>
                                <td>
                                  <a
                                    className="secondary-link"
                                    href={testLink.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open &amp; Test
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="empty-state">
                      Environment QA workspace awaiting database initialization.
                    </p>
                  )}
                </section>
                <section>
                  <h3>QA workflow</h3>
                  <div
                    className="qa-stage-flow"
                    aria-label="QA workflow stages"
                  >
                    {[
                      "ADAM_QA",
                      "JOE_QA",
                      "MUTUAL_APPROVAL",
                      "DEV_QA",
                      "MAIN_VERIFICATION",
                    ].map((stage) => {
                      const latest = detail.approvals.find(
                        (approval) => approval.stage === stage,
                      );
                      return (
                        <article className="qa-stage" key={stage}>
                          <strong>{stage.replaceAll("_", " ")}</strong>
                          <StatusBadge value={latest?.decision || "pending"} />
                          <small>
                            {latest
                              ? `${latest.actor_name} · ${latest.created_at}${latest.notes ? ` · ${latest.notes}` : ""}`
                              : "No action recorded"}
                          </small>
                        </article>
                      );
                    })}
                  </div>
                  <div className="qa-actions">
                    {[
                      ["ADAM_QA", "Mark Adam QA Ready", "ready"],
                      ["ADAM_QA", "Adam Pass", "passed"],
                      ["ADAM_QA", "Adam Fail", "failed"],
                      ["JOE_QA", "Mark Joe QA Ready", "ready"],
                      ["JOE_QA", "Joe Pass", "passed"],
                      ["JOE_QA", "Joe Fail", "failed"],
                      ["MUTUAL_APPROVAL", "Mutual Approval", "approved"],
                      ["DEV_QA", "Dev QA Pass", "passed"],
                      ["DEV_QA", "Dev QA Fail", "failed"],
                      ["MAIN_VERIFICATION", "Main Verification Pass", "passed"],
                      ["MAIN_VERIFICATION", "Main Verification Fail", "failed"],
                    ].map(([stage, label, outcome]) => (
                      <Form method="post" key={label} className="qa-action">
                        <input type="hidden" name="intent" value="qa_action" />
                        <input
                          type="hidden"
                          name="request_id"
                          value={detail.request.id}
                        />
                        <input type="hidden" name="stage" value={stage} />
                        <input type="hidden" name="outcome" value={outcome} />
                        <input
                          name="qa_notes"
                          aria-label={`${label} note`}
                          placeholder={
                            outcome === "failed"
                              ? "Failure note required"
                              : "Optional note"
                          }
                        />
                        <button
                          className={
                            outcome === "failed" ? "danger-button" : ""
                          }
                        >
                          {label}
                        </button>
                      </Form>
                    ))}
                  </div>
                </section>
                <section>
                  <h3>Test handoff</h3>
                  <div className="qa-grid">
                    {["ADAM_QA", "JOE_QA", "DEV_QA", "MAIN_VERIFICATION"].map(
                      (stage) => {
                        const saved = detail.qa.find(
                          (handoff) => handoff.stage === stage,
                        );
                        const handoff = saved || {
                          id: 0,
                          stage,
                          test_user: null,
                          tenant: null,
                          login_url: null,
                          test_url: null,
                          navigation: null,
                          prerequisites: null,
                          test_steps: null,
                          expected_result: null,
                          automated_coverage: null,
                          notes: null,
                          status: "pending",
                          verified_by: null,
                          verified_at: null,
                        };
                        return (
                          <QaHandoffCard
                            key={stage}
                            handoff={handoff as any}
                            requestId={detail.request.id}
                          />
                        );
                      },
                    )}
                  </div>
                </section>
                <section>
                  <h3>Approval history</h3>
                  {detail.approvals.length ? (
                    <ul className="activity-list">
                      {detail.approvals.map((approval) => (
                        <li key={approval.id}>
                          <strong>
                            {approval.stage} · {approval.decision}
                          </strong>
                          <span>
                            {approval.actor_name} · {approval.created_at}
                            {approval.notes ? ` · ${approval.notes}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No approvals recorded.</p>
                  )}
                </section>
              </>
            ) : null}
            {detailTab === "activity" ? (
              <section>
                <h3>Activity</h3>
                {detail.activity.length ? (
                  <ul className="activity-list">
                    {detail.activity.map((event) => (
                      <li key={event.id}>
                        <strong>{event.summary}</strong>
                        <span>
                          {event.actor_identity} · {event.occurred_at}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No activity recorded.</p>
                )}
              </section>
            ) : null}
            {detailTab === "github" ? (
              <>
                <section>
                  <h3>Issue</h3>
                  {githubIssue || issueLink ? (
                    <article className="github-record-card">
                      <div>
                        <strong>
                          {githubIssue
                            ? `#${githubIssue.number} · ${githubIssue.title}`
                            : "Manually linked issue"}
                        </strong>
                        <StatusBadge
                          value={githubIssue?.state || "Not synced"}
                        />
                      </div>
                      {issueLink?.url ? (
                        <a
                          href={issueLink.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open issue ↗
                        </a>
                      ) : null}
                    </article>
                  ) : (
                    <p className="empty-state">
                      Pending GitHub connection. Issue data is not synced.
                    </p>
                  )}
                  <h3>Pull Request</h3>
                  {githubPullRequest || pullRequestLink ? (
                    <article className="github-record-card">
                      <div>
                        <strong>
                          {githubPullRequest
                            ? `#${githubPullRequest.number} · ${githubPullRequest.title}`
                            : "Manually linked pull request"}
                        </strong>
                        <StatusBadge
                          value={githubPullRequest?.state || "Not synced"}
                        />
                      </div>
                      <dl>
                        <div>
                          <dt>CI</dt>
                          <dd>
                            <StatusBadge
                              value={ciFromPayload(pullRequestPayload)}
                            />
                          </dd>
                        </div>
                        <div>
                          <dt>Reviewers</dt>
                          <dd>
                            {pullRequestPayload?.reviewers?.length
                              ? pullRequestPayload.reviewers.join(", ")
                              : "Unavailable"}
                          </dd>
                        </div>
                        <div>
                          <dt>Approvals</dt>
                          <dd>
                            {pullRequestPayload?.approvals ?? "Unavailable"}
                          </dd>
                        </div>
                        <div>
                          <dt>Source</dt>
                          <dd>
                            {pullRequestPayload?.sourceBranch || "Unavailable"}
                          </dd>
                        </div>
                        <div>
                          <dt>Target</dt>
                          <dd>
                            {pullRequestPayload?.targetBranch || "Unavailable"}
                          </dd>
                        </div>
                        <div>
                          <dt>Head SHA</dt>
                          <dd>
                            <code>
                              {pullRequestPayload?.headSha?.slice(0, 8) ||
                                "Unavailable"}
                            </code>
                          </dd>
                        </div>
                        <div>
                          <dt>Merge SHA</dt>
                          <dd>
                            <code>
                              {pullRequestPayload?.mergeSha?.slice(0, 8) ||
                                "Not merged"}
                            </code>
                          </dd>
                        </div>
                        <div>
                          <dt>Updated</dt>
                          <dd>
                            {githubPullRequest?.github_updated_at ||
                              "Not synced"}
                          </dd>
                        </div>
                      </dl>
                      {pullRequestLink?.url ? (
                        <a
                          href={pullRequestLink.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open pull request ↗
                        </a>
                      ) : null}
                    </article>
                  ) : (
                    <p className="empty-state">
                      Pending GitHub connection. PR, CI, and reviewer data are
                      not synced.
                    </p>
                  )}
                </section>
                <section>
                  <h3>Branch State</h3>
                  <div className="branch-state-matrix">
                    {["Adam", "Joe", "dev", "main"].map((role) => {
                      const branch: any = detail.branches.find(
                        (item: any) =>
                          item.branch.toLowerCase() === role.toLowerCase(),
                      );
                      return (
                        <article key={role}>
                          <strong>{role}</strong>
                          {branch ? (
                            <>
                              <StatusBadge value={branch.state} />
                              {branch.commit_sha ? (
                                <code>{branch.commit_sha.slice(0, 8)}</code>
                              ) : null}
                              <small>
                                {branch.comparison_state || "Unknown"} ·{" "}
                                {branch.confidence || "Unknown confidence"}
                                <br />
                                Checked {branch.checked_at || "Never"}
                              </small>
                            </>
                          ) : (
                            <>
                              <StatusBadge value="Unavailable" />
                              <small>Not synced</small>
                            </>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </aside>
      ) : null}
    </main>
  );
}
