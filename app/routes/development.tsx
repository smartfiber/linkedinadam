import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/development";
import { QaHandoffCard } from "../components/QaHandoffCard";
import { type AccessEnvironment, requireAuthenticatedUser } from "../lib/auth.server";
import {
  getDevelopmentRequest,
  getDevelopmentSummary,
  listActivity,
  listDevelopmentRequests,
  listNeedsAttention,
} from "../lib/development/repository.server";
import {
  createDevelopmentRequest,
  recordDevelopmentApproval,
} from "../lib/development/service.server";
import {
  DEVELOPMENT_PRIORITIES,
  DEVELOPMENT_STATUSES,
  DEVELOPMENT_TYPES,
  type DevelopmentFilters,
} from "../lib/development/types";
import { statusLabel, statusTone } from "../lib/development/status";

type DevelopmentEnvironment = AccessEnvironment & { linkedinadam_db: D1Database };

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
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = environment(context);
  const user = await requireAuthenticatedUser(request, env);
  const url = new URL(request.url);
  const requestId = url.searchParams.get("request");
  const filters = filtersFromUrl(url);
  const [summary, requests, attention, activity, detail] = await Promise.all([
    getDevelopmentSummary(env.linkedinadam_db),
    listDevelopmentRequests(env.linkedinadam_db, filters),
    listNeedsAttention(env.linkedinadam_db, user.email),
    listActivity(env.linkedinadam_db),
    requestId ? getDevelopmentRequest(env.linkedinadam_db, requestId) : null,
  ]);

  return {
    summary,
    requests: requests.results || [],
    attention: attention.results || [],
    activity: activity.results || [],
    detail,
    filters,
    user,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = environment(context);
  const user = await requireAuthenticatedUser(request, env);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

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
    });
    return { ok: true, requestId: id };
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

function StatusBadge({ value }: { value: string }) {
  return <span className={`development-status ${statusTone(value)}`}>{statusLabel(value)}</span>;
}

export default function Development({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { summary, requests, attention, activity, detail, filters, user } = loaderData;

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
        <SummaryCard label="Awaiting Adam" value={summary.awaitingAdam} />
        <SummaryCard label="Awaiting Joe" value={summary.awaitingJoe} />
        <SummaryCard label="Awaiting Mutual Approval" value={summary.awaitingMutualApproval} />
        <SummaryCard label="Ready for Dev" value={summary.readyForDev} />
        <SummaryCard label="On Dev" value={summary.onDev} />
        <SummaryCard label="Ready for Main" value={summary.readyForMain} />
        <SummaryCard label="On Main / Needs Verification" value={summary.onMainNeedsVerification} />
        <SummaryCard label="Blocked" value={summary.blocked} tone="critical" />
        <SummaryCard label="Verified" value={summary.verified} tone="complete" />
      </section>

      <section className="development-attention panel">
        <div className="panel-heading"><div><p className="eyebrow">PERSONAL QUEUE</p><h2>Needs Your Attention</h2></div><span>{attention.length}</span></div>
        {attention.length ? <ul className="attention-list">{attention.map((item) => <li key={item.id}><Link to={`/development?request=${item.id}`}>{item.priority} · {item.title}</Link><span>{item.next_action || statusLabel(item.overall_status)}</span></li>)}</ul> : <p className="empty-state">Nothing currently requires action for {user.displayName}.</p>}
      </section>

      <section className="development-toolbar panel">
        <Form method="get" className="development-filters">
          <input name="search" placeholder="Search requests" defaultValue={filters.search} />
          <select name="priority" defaultValue={filters.priority}><option value="">All priorities</option>{DEVELOPMENT_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select>
          <select name="status" defaultValue={filters.status}><option value="">All statuses</option>{DEVELOPMENT_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
          <input name="owner" placeholder="Owner email" defaultValue={filters.owner} />
          <button type="submit">Filter</button>
          <Link className="secondary-link" to="/development">Clear</Link>
        </Form>
      </section>

      <section className="development-table-panel panel">
        <div className="panel-heading"><div><p className="eyebrow">SYSTEM OF RECORD</p><h2>Development requests</h2></div><span>{requests.length} shown</span></div>
        <div className="table-scroll"><table className="development-table"><thead><tr>{["Request", "Priority", "Type", "Requested By", "Owner", "QA Partner", "Area", "Issue / PR", "Adam", "Joe", "Approval", "Dev", "Main", "Verification", "Next Action", "Updated"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{requests.length ? requests.map((item) => <tr key={item.id}><td><Link to={`/development?request=${item.id}`}><strong>{item.external_key || item.id.slice(0, 8)}</strong><span>{item.title}</span></Link><StatusBadge value={item.overall_status} /></td><td><span className={`priority-badge ${item.priority.toLowerCase()}`}>{item.priority}</span></td><td>{item.type}</td><td>{item.requested_by_name}</td><td>{item.owner_email || "—"}</td><td>{item.qa_partner_email || "—"}</td><td>{item.product_area || "—"}</td><td>{item.issue_url || item.pr_url ? <span className="link-stack">{item.issue_url ? <a href={item.issue_url}>Issue</a> : null}{item.pr_url ? <a href={item.pr_url}>PR</a> : null}</span> : "—"}</td><td><StatusBadge value={item.adam_state} /></td><td><StatusBadge value={item.joe_state} /></td><td><StatusBadge value={item.approval_state} /></td><td><StatusBadge value={item.dev_state} /></td><td><StatusBadge value={item.main_state} /></td><td><StatusBadge value={item.overall_status === "verified" ? "verified" : item.main_state === "present" ? "awaiting_verification" : "unknown"} /></td><td>{item.next_action}</td><td>{item.updated_at}</td></tr>) : <tr><td colSpan={16} className="empty-table">No development requests yet. Create the first record below.</td></tr>}</tbody></table></div>
      </section>

      <div className="development-lower-grid">
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">CONTROLLED WRITE</p><h2>New request</h2></div></div><Form method="post" className="development-form"><input type="hidden" name="intent" value="create_request" /><label>Title<input required name="title" placeholder="Short request title" /></label><label>Problem<textarea name="problem" rows={3} /></label><label>Why / Decision<textarea name="why_decision" rows={3} /></label><div className="form-grid"><label>Priority<select name="priority" defaultValue="P2">{DEVELOPMENT_PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select></label><label>Type<select name="type" defaultValue="Other">{DEVELOPMENT_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label></div><div className="form-grid"><label>Owner email<input type="email" name="owner_email" /></label><label>QA partner email<input type="email" name="qa_partner_email" /></label></div><label>Product area<input name="product_area" /></label><label>Notes<textarea name="notes" rows={2} /></label><button disabled={busy}>{busy ? "Saving…" : "Create request"}</button></Form></section>
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">APPEND-ONLY HISTORY</p><h2>Recent activity</h2></div></div>{activity.length ? <ul className="activity-list">{activity.map((event) => <li key={event.id}><strong>{event.summary}</strong><span>{event.actor_identity} · {event.occurred_at}</span></li>)}</ul> : <p className="empty-state">Development events will appear here.</p>}</section>
      </div>

      {detail ? <section className="development-detail panel"><div className="panel-heading"><div><p className="eyebrow">REQUEST DETAIL</p><h2>{detail.request.title}</h2><StatusBadge value={detail.request.overall_status} /></div><Link className="secondary-link" to="/development">Close</Link></div><div className="detail-copy"><section><h3>Problem</h3><p>{detail.request.problem || "Not recorded."}</p><h3>Why / Decision</h3><p>{detail.request.why_decision || "Not recorded."}</p><h3>Notes</h3><p>{detail.request.notes || "Not recorded."}</p></section><section><h3>GitHub links</h3>{detail.links.length ? <ul>{detail.links.map((link: any) => <li key={link.id}><a href={link.url || "#"}>{link.provider} {link.type} {link.external_id}</a></li>)}</ul> : <p>Not connected yet. Read-only GitHub App sync is a future step.</p>}<h3>Branch status</h3><ul className="branch-list">{detail.branches.length ? detail.branches.map((branch: any) => <li key={branch.id}><strong>{branch.branch}</strong><StatusBadge value={branch.state} />{branch.commit_sha ? <code>{branch.commit_sha}</code> : null}</li>) : <li>No branch state recorded yet.</li>}</ul></section></div><section><h3>QA handoffs</h3>{detail.qa.length ? <div className="qa-grid">{detail.qa.map((handoff) => <QaHandoffCard key={handoff.id} handoff={handoff} />)}</div> : <p>No QA handoff recorded yet. URLs will only appear when saved here.</p>}</section><section><h3>Approval history</h3>{detail.approvals.length ? <ul className="activity-list">{detail.approvals.map((approval) => <li key={approval.id}><strong>{approval.stage} · {approval.decision}</strong><span>{approval.actor_name} · {approval.created_at}{approval.notes ? ` · ${approval.notes}` : ""}</span></li>)}</ul> : <p>No approvals recorded.</p>}</section><section><h3>Activity</h3>{detail.activity.length ? <ul className="activity-list">{detail.activity.map((event) => <li key={event.id}><strong>{event.summary}</strong><span>{event.actor_identity} · {event.occurred_at}</span></li>)}</ul> : <p>No activity recorded.</p>}</section></section> : null}
    </main>
  );
}
