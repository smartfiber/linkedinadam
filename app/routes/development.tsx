import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/development";
import { QaHandoffCard } from "../components/QaHandoffCard";
import { type AccessEnvironment, requireAuthenticatedUser } from "../lib/auth.server";
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
} from "../lib/development/service.server";
import {
  DEVELOPMENT_PRIORITIES,
  DEVELOPMENT_STATUSES,
  DEVELOPMENT_TYPES,
  type DevelopmentFilters,
} from "../lib/development/types";
import { statusLabel, statusTone } from "../lib/development/status";

type DevelopmentEnvironment = AccessEnvironment & GitHubEnvironment & { linkedinadam_db: D1Database };

function environment(context: Route.LoaderArgs["context"] | Route.ActionArgs["context"]) {
  return context.cloudflare.env as unknown as DevelopmentEnvironment;
}

function filtersFromUrl(url: URL): DevelopmentFilters {
  const priority = url.searchParams.get("priority") || "";
  const status = url.searchParams.get("status") || "";
  return {
    search: url.searchParams.get("search") || "",
    priority: DEVELOPMENT_PRIORITIES.includes(priority as never) ? priority as DevelopmentFilters["priority"] : "",
    owner: url.searchParams.get("owner") || "",
    status: DEVELOPMENT_STATUSES.includes(status as never) ? status as DevelopmentFilters["status"] : "",
    attention: url.searchParams.get("attention") === "ci_failing" || url.searchParams.get("attention") === "unknown_sync" ? url.searchParams.get("attention") as DevelopmentFilters["attention"] : "",
    view: (url.searchParams.get("view") || "") as DevelopmentFilters["view"],
    sort: (url.searchParams.get("sort") || "priority") as DevelopmentFilters["sort"],
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = environment(context);
  const user = await requireAuthenticatedUser(request, env);
  const url = new URL(request.url);
  const requestId = url.searchParams.get("request");
  const filters = filtersFromUrl(url);
  const [summary, requests, attention, activity, detail, github] = await Promise.all([
    getDevelopmentSummary(env.linkedinadam_db),
    listDevelopmentRequests(env.linkedinadam_db, filters),
    listNeedsAttention(env.linkedinadam_db, user.email),
    listActivity(env.linkedinadam_db),
    requestId ? getDevelopmentRequest(env.linkedinadam_db, requestId) : null,
    getGitHubSyncStatus(env.linkedinadam_db),
  ]);

  return {
    summary,
    requests: requests.results || [],
    attention: attention.results || [],
    activity: activity.results || [],
    detail,
    filters,
    user,
    github,
    githubConnection: {
      connected: Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY),
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
    if (result.status === "rejected" || result.status === "skipped" || result.status === "failed") return { error: result.error };
    return { ok: true, message: `GitHub readiness sync completed: ${result.issues} issues and ${result.pullRequests} pull requests read.` };
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
      requestedBy: String(formData.get("requested_by") || ""), issueUrl: String(formData.get("issue_url") || ""), prUrl: String(formData.get("pr_url") || ""), branch: String(formData.get("branch") || ""),
    });
    return { ok: true, requestId: id };
  }

  if (intent === "qa_action") {
    try {
      await recordQaAction(env.linkedinadam_db, user, { requestId: String(formData.get("request_id") || ""), stage: String(formData.get("stage") || ""), outcome: String(formData.get("outcome") || "") as "ready" | "passed" | "failed" | "approved", notes: String(formData.get("qa_notes") || "") });
      return { ok: true, message: "QA action recorded." };
    } catch (error) { return { error: error instanceof Error ? error.message : "Unable to record QA action." }; }
  }

  if (intent === "save_handoff") {
    try {
      await saveQaHandoff(env.linkedinadam_db, user, { requestId: String(formData.get("request_id") || ""), stage: String(formData.get("stage") || ""), testUser: String(formData.get("test_user") || ""), tenant: String(formData.get("tenant") || ""), loginUrl: String(formData.get("login_url") || ""), testUrl: String(formData.get("test_url") || ""), navigation: String(formData.get("navigation") || ""), prerequisites: String(formData.get("prerequisites") || ""), testSteps: String(formData.get("test_steps") || ""), expectedResult: String(formData.get("expected_result") || ""), automatedCoverage: String(formData.get("automated_coverage") || ""), notes: String(formData.get("handoff_notes") || ""), status: String(formData.get("handoff_status") || "pending") });
      return { ok: true, message: "QA handoff saved." };
    } catch (error) { return { error: error instanceof Error ? error.message : "Unable to save QA handoff." }; }
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

function SummaryCard({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return <article className={`development-summary-card ${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}
function SummaryLink({ label, value, to, tone = "" }: { label: string; value: number; to: string; tone?: string }) {
  return <Link to={to} className="summary-link"><SummaryCard label={label} value={value} tone={tone} /></Link>;
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`development-status ${statusTone(value)}`}>{statusLabel(value)}</span>;
}

export default function Development({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { summary, requests, attention, activity, detail, filters, user, github, githubConnection } = loaderData;

  return (
    <main className="development-page">
      <header className="development-header">
        <div>
          <p className="eyebrow">NET-X BACK OFFICE / DEVELOPMENT</p>
          <h1>Development Control Center</h1>
          <p>Track what is moving through Adam, Joe, Dev, and Main without treating a merge as production verification.</p>
        </div>
        <div className="development-header-actions"><span className="identity-chip">{user.displayName} · {user.role}</span><Link className="secondary-link" to="/">Command Center</Link></div>
      </header>

      <section className="development-summary-grid" aria-label="Development summary">
        <SummaryCard label="P0 Open" value={summary.p0Open} tone="critical" />
        <SummaryCard label="P1 Open" value={summary.p1Open} tone="critical" />
        <SummaryLink label="Awaiting Adam" value={summary.awaitingAdam} to="/development?status=awaiting_adam" />
        <SummaryLink label="Awaiting Joe" value={summary.awaitingJoe} to="/development?status=awaiting_joe" />
        <SummaryCard label="Awaiting Mutual Approval" value={summary.awaitingMutualApproval} />
        <SummaryLink label="Ready for Dev" value={summary.readyForDev} to="/development?status=ready_for_dev" />
        <SummaryLink label="On Dev" value={summary.onDev} to="/development?status=on_dev" />
        <SummaryLink label="Ready for Main" value={summary.readyForMain} to="/development?status=ready_for_main" />
        <SummaryLink label="On Main / Needs Verification" value={summary.onMainNeedsVerification} to="/development?status=on_main_needs_verification" />
        <SummaryLink label="CI Failing" value={summary.ciFailing} to="/development?attention=ci_failing" tone="critical" />
        <SummaryLink label="Blocked" value={summary.blocked} to="/development?status=blocked" tone="critical" />
        <SummaryLink label="Unknown Sync" value={summary.unknownSync} to="/development?attention=unknown_sync" />
        <SummaryCard label="Verified" value={summary.verified} tone="complete" />
      </section>

      <nav className="saved-views panel" aria-label="Development saved views">
        {[['needs_adam','Needs Adam'],['needs_joe','Needs Joe'],['urgent','P0 / P1'],['awaiting_approval','Awaiting Approval'],['ready_dev','Ready for Dev'],['on_dev','On Dev'],['ready_main','Ready for Main'],['main_verify','Main Needs Verification'],['blocked','Blocked'],['sync_unknown','GitHub Sync Unknown']].map(([view,label]) => <Link key={view} className={filters.view === view ? "active" : ""} to={`/development?view=${view}`}>{label}</Link>)}
      </nav>

      <section className="development-attention panel">
        <div className="panel-heading"><div><p className="eyebrow">PERSONAL QUEUE</p><h2>Needs Your Attention</h2></div><span>{attention.length}</span></div>
        {attention.length ? <ul className="attention-list">{attention.map((item) => <li key={item.id}><Link to={`/development?request=${item.id}`}>{item.priority} · {item.title}</Link><span>{item.next_action || statusLabel(item.overall_status)}</span></li>)}</ul> : <p className="empty-state">Nothing currently requires action for {user.displayName}.</p>}
      </section>

      <section className="development-attention panel">
        <div className="panel-heading"><div><p className="eyebrow">READ-ONLY INTEGRATION</p><h2>GitHub Sync</h2></div><span>{githubConnection.connected ? "GitHub App connected" : "GitHub connection required"}</span></div>
        <dl className="detail-overview"><div><dt>Repository</dt><dd>{githubConnection.repository}</dd></div><div><dt>Scheduled Sync</dt><dd>{githubConnection.scheduled ? "On" : "Off"}</dd></div></dl>
        {(user.role === "OWNER" || user.role === "ADMIN") ? <Form method="post" onSubmit={(event) => { if (!confirm(`Run one read-only GitHub synchronization against ${githubConnection.repository}?\n\nThis reads GitHub and updates DEVOS Development records. It does not modify GitHub.`)) event.preventDefault(); }}><input type="hidden" name="intent" value="github_readiness_sync" /><button disabled={busy || github.lastRun?.status === "running"}>{github.lastRun?.status === "running" ? "GitHub sync already in progress" : "Run GitHub Readiness Sync"}</button></Form> : null}
        {actionData?.error ? <p className="form-message error" role="alert">{actionData.error}</p> : actionData?.message ? <p className="form-message success" role="status">{actionData.message}</p> : null}
        {github.lastRun ? <section><h3>Latest Run</h3><dl className="detail-overview"><div><dt>Status</dt><dd>{github.lastRun.status}</dd></div><div><dt>Trigger</dt><dd>{github.lastRun.trigger || "Unknown"}</dd></div><div><dt>Initiator</dt><dd>{github.lastRun.initiator || "System"}</dd></div><div><dt>Started</dt><dd>{github.lastRun.started_at}</dd></div><div><dt>Completed</dt><dd>{github.lastRun.finished_at || "In progress"}</dd></div><div><dt>Duration</dt><dd>{github.lastRun.duration_seconds === null ? "In progress" : `${github.lastRun.duration_seconds}s`}</dd></div><div><dt>Issues</dt><dd>{github.lastRun.issues_seen}</dd></div><div><dt>PRs</dt><dd>{github.lastRun.pull_requests_seen}</dd></div><div><dt>Branches</dt><dd>{github.lastRun.branches_seen}</dd></div><div><dt>Matched</dt><dd>{github.lastRun.matched_count}</dd></div><div><dt>Created</dt><dd>{github.lastRun.created_count}</dd></div><div><dt>Ambiguous</dt><dd>{github.lastRun.ambiguous_count}</dd></div><div><dt>Skipped</dt><dd>{github.lastRun.skipped_count}</dd></div><div><dt>Conflicts</dt><dd>{github.lastRun.conflict_count}</dd></div></dl>{github.lastRun.error_message ? <p className="form-message error" role="alert">{github.lastRun.error_message}</p> : null}</section> : <p>{githubConnection.connected ? "Run one manual readiness sync to initialize GitHub-derived Development data." : "GitHub sync not connected. Current Development records and the manual QA workflow remain fully usable."}</p>}
        <div className="branch-list">{github.branches.length ? github.branches.map(branch => <span key={branch.role}><strong>{branch.role}</strong> {branch.branch_name || branch.status}{branch.sha ? ` · ${branch.sha.slice(0, 8)}` : ""}</span>) : <span>Branch mapping will appear after the first sync.</span>}</div>
      </section>

      <section className="development-toolbar panel">
        <Form method="get" className="development-filters">
          <input name="search" placeholder="Search requests" defaultValue={filters.search} />
          <select name="priority" defaultValue={filters.priority}><option value="">All priorities</option>{DEVELOPMENT_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select>
          <select name="status" defaultValue={filters.status}><option value="">All statuses</option>{DEVELOPMENT_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
          <input name="owner" placeholder="Owner email" defaultValue={filters.owner} />
          <select name="sort" defaultValue={filters.sort}><option value="priority">Priority</option><option value="updated">Recently updated</option><option value="next_action">Next action</option></select>
          <button type="submit">Filter</button>
          <Link className="secondary-link" to="/development">Clear</Link>
        </Form>
      </section>

      <section className="development-table-panel panel">
        <div className="panel-heading"><div><p className="eyebrow">SYSTEM OF RECORD</p><h2>Development requests</h2></div><span>{requests.length} shown</span></div>
        <div className="table-scroll"><table className="development-table"><thead><tr>{["Request", "Owner", "QA Partner", "Issue", "PR", "CI", "Branch", "Adam", "Joe", "Dev", "Main", "Next Action", "Updated"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{requests.length ? requests.map((item) => <tr key={item.id}><td><Link to={`/development?request=${item.id}`}><strong>{item.external_key || item.id.slice(0, 8)}</strong><span>{item.title}</span></Link><StatusBadge value={item.overall_status} /></td><td>{item.owner_email || "Unassigned"}</td><td>{item.qa_partner_email || "Unassigned"}</td><td>{item.issue_url ? <a href={item.issue_url}>{item.issue_number ? `#${item.issue_number}` : "Issue"}</a> : "Unavailable"}</td><td>{item.pr_url ? <a href={item.pr_url}>{item.pr_number ? `#${item.pr_number} · ${item.pr_state}` : "PR"}</a> : "Unavailable"}</td><td><StatusBadge value={item.ci_state || "CI Unknown"} /></td><td>{item.source_branch ? <span className="link-stack"><code>{item.source_branch}</code><span>→ {item.target_branch}</span></span> : "Unavailable"}</td><td><StatusBadge value={item.adam_state} /></td><td><StatusBadge value={item.joe_state} /></td><td><StatusBadge value={item.dev_state} /></td><td><StatusBadge value={item.main_state} /></td><td className="next-action-cell"><strong>{item.next_action}</strong></td><td>{item.updated_at}</td></tr>) : <tr><td colSpan={13} className="empty-table">No development requests yet. Create the first record below.</td></tr>}</tbody></table></div>
      </section>

      <div className="development-lower-grid">
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">CONTROLLED WRITE</p><h2>New request</h2></div></div><Form method="post" className="development-form"><input type="hidden" name="intent" value="create_request" /><label>Title<input required name="title" placeholder="Short request title" /></label><div className="form-grid"><label>Priority<select name="priority" defaultValue="P2">{DEVELOPMENT_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></label><label>Type<select name="type" defaultValue="Other">{DEVELOPMENT_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label></div><label>Requested by<input name="requested_by" defaultValue={user.displayName} /></label><div className="form-grid"><label>Owner email<input type="email" name="owner_email" /></label><label>QA partner email<input type="email" name="qa_partner_email" /></label></div><label>Product area<input name="product_area" /></label><label>Problem<textarea name="problem" rows={3} /></label><label>Why / Decision<textarea name="why_decision" rows={3} /></label><div className="form-grid"><label>Issue URL<input type="url" name="issue_url" /></label><label>PR URL<input type="url" name="pr_url" /></label></div><label>Working branch<input name="branch" placeholder="Optional; never inferred" /></label><label>Notes<textarea name="notes" rows={2} /></label><button disabled={busy}>{busy ? "Saving…" : "Create request"}</button></Form></section>
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">APPEND-ONLY HISTORY</p><h2>Recent activity</h2></div></div>{activity.length ? <ul className="activity-list">{activity.map((event) => <li key={event.id}><strong>{event.summary}</strong><span>{event.actor_identity} · {event.occurred_at}</span></li>)}</ul> : <p className="empty-state">Development events will appear here.</p>}</section>
      </div>

      {detail ? <section className="development-detail panel"><div className="panel-heading"><div><p className="eyebrow">REQUEST DETAIL</p><h2>{detail.request.title}</h2><StatusBadge value={detail.request.overall_status} /></div><Link className="secondary-link" to="/development">Close</Link></div>{actionData?.error ? <p className="form-message error" role="alert">{actionData.error}</p> : actionData?.message ? <p className="form-message success" role="status">{actionData.message}</p> : null}<section className="detail-overview"><h3>Overview</h3><dl>{[["Priority",detail.request.priority],["Type",detail.request.type],["Requested by",detail.request.requested_by_name],["Owner",detail.request.owner_email || "Unassigned"],["QA partner",detail.request.qa_partner_email || "Unassigned"],["Product area",detail.request.product_area || "Unspecified"],["Status",statusLabel(detail.request.overall_status)]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><div className="detail-copy"><section><h3>Problem</h3><p>{detail.request.problem || "Not recorded."}</p><h3>Why / Decision</h3><p>{detail.request.why_decision || "Not recorded."}</p></section><section><h3>GitHub</h3>{detail.links.length ? <ul>{detail.links.map((link: any) => <li key={link.id}><a href={link.url || "#"}>{link.type.replaceAll('_',' ')}</a> <small>{link.provider === 'manual' ? 'Manual link' : 'GitHub sync'}</small></li>)}</ul> : <p>Pending GitHub connection.</p>}<h3>Branch state</h3><ul className="branch-list">{detail.branches.length ? detail.branches.map((branch: any) => <li key={branch.id}><strong>{branch.branch}</strong><StatusBadge value={branch.state} />{branch.commit_sha ? <code>{branch.commit_sha.slice(0,8)}</code> : null}</li>) : <li>Unavailable until GitHub is connected.</li>}</ul></section></div><section><h3>QA workflow</h3><div className="qa-actions">{[["ADAM_QA","Mark Adam QA Ready","ready"],["ADAM_QA","Adam Pass","passed"],["ADAM_QA","Adam Fail","failed"],["JOE_QA","Mark Joe QA Ready","ready"],["JOE_QA","Joe Pass","passed"],["JOE_QA","Joe Fail","failed"],["MUTUAL_APPROVAL","Mutual Approval","approved"],["DEV_QA","Dev QA Pass","passed"],["DEV_QA","Dev QA Fail","failed"],["MAIN_VERIFICATION","Main Verification Pass","passed"],["MAIN_VERIFICATION","Main Verification Fail","failed"]].map(([stage,label,outcome]) => <Form method="post" key={label} className="qa-action"><input type="hidden" name="intent" value="qa_action"/><input type="hidden" name="request_id" value={detail.request.id}/><input type="hidden" name="stage" value={stage}/><input type="hidden" name="outcome" value={outcome}/><input name="qa_notes" aria-label={`${label} note`} placeholder={outcome === 'failed' ? 'Failure note required' : 'Optional note'}/><button className={outcome === 'failed' ? 'danger-button' : ''}>{label}</button></Form>)}</div></section><section><h3>Test handoff</h3><div className="qa-grid">{["ADAM_QA","JOE_QA","DEV_QA","MAIN_VERIFICATION"].map(stage => { const saved = detail.qa.find(handoff => handoff.stage === stage); const handoff = saved || { id: 0, stage, test_user:null,tenant:null,login_url:null,test_url:null,navigation:null,prerequisites:null,test_steps:null,expected_result:null,automated_coverage:null,notes:null,status:'pending',verified_by:null,verified_at:null }; return <QaHandoffCard key={stage} handoff={handoff as any} requestId={detail.request.id}/>; })}</div></section><section><h3>Approval history</h3>{detail.approvals.length ? <ul className="activity-list">{detail.approvals.map((approval) => <li key={approval.id}><strong>{approval.stage} · {approval.decision}</strong><span>{approval.actor_name} · {approval.created_at}{approval.notes ? ` · ${approval.notes}` : ""}</span></li>)}</ul> : <p>No approvals recorded.</p>}</section><section><h3>Activity</h3>{detail.activity.length ? <ul className="activity-list">{detail.activity.map((event) => <li key={event.id}><strong>{event.summary}</strong><span>{event.actor_identity} · {event.occurred_at}</span></li>)}</ul> : <p>No activity recorded.</p>}</section><section><h3>Notes</h3><p>{detail.request.notes || "No internal notes."}</p></section></section> : null}
    </main>
  );
}
