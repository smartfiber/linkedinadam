import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/orchestration";
import { getMonday } from "../lib/contentPlanner";
import {
  runDraftingStage,
  runPlannerStage,
  runStrategyStage,
  type OrchestrationEnvironment,
} from "../lib/postOrchestration.server";

type Employee = {
  id: number;
  name: string;
  role_name: string;
  playbook_id: number;
};

type Run = {
  id: number;
  employee_id: number;
  employee_name: string;
  week_start: string;
  version: number;
  status: string;
  requested_by: string;
  created_at: string;
  updated_at: string;
};

type Stage = {
  id: number;
  stage_type: "strategy" | "planner" | "drafting";
  version: number;
  status: string;
  model: string | null;
  input_json: string;
  output_json: string | null;
  safe_error: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
};

type Handoff = {
  id: number;
  from_stage_id: number;
  to_stage_type: string;
  payload_json: string;
  created_at: string;
};

type Event = {
  id: number;
  event_type: string;
  actor_name: string;
  detail: string | null;
  created_at: string;
};

type DraftItem = {
  sequence: number;
  content_draft_id: number;
  title: string | null;
  status: string;
  scheduled_for: string | null;
};

function runUrl(employeeId: number, week: string, runId?: number) {
  const query = new URLSearchParams({
    employee: String(employeeId),
    week,
  });
  if (runId) query.set("run", String(runId));
  return `/orchestration?${query}`;
}

function prettyJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as OrchestrationEnvironment;
  const db = env.linkedinadam_db;
  const url = new URL(request.url);
  const weekStart = getMonday(url.searchParams.get("week"));
  const employeeQuery = await db.prepare(`
    SELECT e.id, e.name, e.role_name, ep.playbook_id
    FROM employees e
    JOIN employee_playbooks ep ON ep.employee_id = e.id
    WHERE e.status = 'active'
    ORDER BY e.name
  `).all<Employee>();
  const employees = employeeQuery.results ?? [];
  const requestedEmployee = Number(url.searchParams.get("employee"));
  const employeeId = employees.some(({ id }) => id === requestedEmployee)
    ? requestedEmployee
    : employees[0]?.id ?? null;

  if (!employeeId) {
    return {
      employees,
      employeeId: null,
      weekStart,
      runs: [] as Run[],
      run: null as Run | null,
      stages: [] as Stage[],
      handoffs: [] as Handoff[],
      events: [] as Event[],
      drafts: [] as DraftItem[],
    };
  }

  const runsQuery = await db.prepare(`
    SELECT r.*, e.name AS employee_name
    FROM orchestration_runs r
    JOIN employees e ON e.id = r.employee_id
    WHERE r.employee_id = ? AND r.week_start = ?
    ORDER BY r.version DESC
  `).bind(employeeId, weekStart).all<Run>();
  const runs = runsQuery.results ?? [];
  const requestedRun = Number(url.searchParams.get("run"));
  const run = runs.find(({ id }) => id === requestedRun) ?? runs[0] ?? null;

  if (!run) {
    return {
      employees,
      employeeId,
      weekStart,
      runs,
      run,
      stages: [] as Stage[],
      handoffs: [] as Handoff[],
      events: [] as Event[],
      drafts: [] as DraftItem[],
    };
  }

  const [stageQuery, handoffQuery, eventQuery, draftQuery] = await Promise.all([
    db.prepare(`
      SELECT * FROM orchestration_stages
      WHERE orchestration_run_id = ?
      ORDER BY CASE stage_type
        WHEN 'strategy' THEN 1 WHEN 'planner' THEN 2 ELSE 3 END, version DESC
    `).bind(run.id).all<Stage>(),
    db.prepare(`
      SELECT * FROM orchestration_handoffs
      WHERE orchestration_run_id = ? ORDER BY created_at, id
    `).bind(run.id).all<Handoff>(),
    db.prepare(`
      SELECT id,event_type,actor_name,detail,created_at
      FROM orchestration_events
      WHERE orchestration_run_id = ? ORDER BY created_at DESC, id DESC
    `).bind(run.id).all<Event>(),
    db.prepare(`
      SELECT odi.sequence, odi.content_draft_id, c.title, c.status, c.scheduled_for
      FROM orchestration_draft_items odi
      JOIN content_drafts c ON c.id = odi.content_draft_id
      WHERE odi.orchestration_run_id = ? ORDER BY odi.sequence
    `).bind(run.id).all<DraftItem>(),
  ]);

  return {
    employees,
    employeeId,
    weekStart,
    runs,
    run,
    stages: stageQuery.results ?? [],
    handoffs: handoffQuery.results ?? [],
    events: eventQuery.results ?? [],
    drafts: draftQuery.results ?? [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as OrchestrationEnvironment;
  const db = env.linkedinadam_db;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actor = String(form.get("actor_name") ?? "").trim();
  const employeeId = Number(form.get("employee_id"));
  const weekStart = getMonday(String(form.get("week_start") ?? ""));
  const runId = Number(form.get("run_id"));
  const note = String(form.get("review_note") ?? "").trim();

  if (!actor) return { error: "Your name is required for the audit trail." };

  try {
    if (intent === "create_run") {
      if (!Number.isInteger(employeeId) || employeeId < 1) {
        return { error: "Choose an employee with an assigned playbook." };
      }
      const playbook = await db.prepare(`
        SELECT p.*
        FROM employees e
        JOIN employee_playbooks ep ON ep.employee_id = e.id
        JOIN playbooks p ON p.id = ep.playbook_id
        WHERE e.id = ? AND e.status = 'active'
      `).bind(employeeId).first<Record<string, unknown>>();
      if (!playbook) return { error: "The employee has no active playbook." };
      const versionRow = await db.prepare(`
        SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM orchestration_runs WHERE employee_id = ? AND week_start = ?
      `).bind(employeeId, weekStart).first<{ version: number }>();
      const created = await db.prepare(`
        INSERT INTO orchestration_runs (
          employee_id,week_start,version,status,playbook_snapshot,requested_by
        ) VALUES (?, ?, ?, 'strategy_pending', ?, ?) RETURNING id
      `).bind(
        employeeId,
        weekStart,
        versionRow?.version ?? 1,
        JSON.stringify(playbook),
        actor,
      ).first<{ id: number }>();
      if (!created) throw new Error("The orchestration run could not be saved.");
      await db.prepare(`
        INSERT INTO orchestration_events (
          orchestration_run_id,event_type,actor_name,detail
        ) VALUES (?,'run_created',?,'Playbook snapshot captured')
      `).bind(created.id, actor).run();
      return redirect(runUrl(employeeId, weekStart, created.id));
    }

    if (!Number.isInteger(runId) || runId < 1) {
      return { error: "Choose or create an orchestration run." };
    }
    const run = await db.prepare(`
      SELECT employee_id, week_start, status FROM orchestration_runs
      WHERE id = ? AND status != 'superseded'
    `).bind(runId).first<{
      employee_id: number;
      week_start: string;
      status: string;
    }>();
    if (!run) return { error: "The orchestration run could not be found." };
    const redirectTo = runUrl(run.employee_id, run.week_start, runId);

    if (intent === "run_strategy") {
      const retry = run.status === "failed" && await db.prepare(`
        SELECT id FROM orchestration_stages
        WHERE orchestration_run_id=? AND stage_type='strategy' AND status='failed'
        ORDER BY version DESC LIMIT 1
      `).bind(runId).first();
      if (run.status !== "strategy_pending" && !retry) {
        return { error: "Start a new run version to replace an approved strategy." };
      }
      await runStrategyStage(env, runId, actor, note || null);
      return redirect(redirectTo);
    }
    if (intent === "run_planner") {
      const retry = run.status === "failed" && await db.prepare(`
        SELECT id FROM orchestration_stages
        WHERE orchestration_run_id=? AND stage_type='planner' AND status='failed'
        ORDER BY version DESC LIMIT 1
      `).bind(runId).first();
      if (run.status !== "planner_pending" && !retry) {
        return { error: "Approve the current strategy before running the planner." };
      }
      await runPlannerStage(env, runId, actor);
      return redirect(redirectTo);
    }
    if (intent === "run_drafting") {
      const retry = run.status === "failed" && await db.prepare(`
        SELECT id FROM orchestration_stages
        WHERE orchestration_run_id=? AND stage_type='drafting' AND status='failed'
        ORDER BY version DESC LIMIT 1
      `).bind(runId).first();
      if (run.status !== "drafting_pending" && !retry) {
        return { error: "Approve the current plan before running the drafting agent." };
      }
      await runDraftingStage(env, runId, actor);
      return redirect(redirectTo);
    }

    if (intent === "review_stage") {
      const stageId = Number(form.get("stage_id"));
      const decision = String(form.get("decision") ?? "");
      if (!Number.isInteger(stageId) || !["approved", "rejected"].includes(decision)) {
        return { error: "Choose a valid stage review decision." };
      }
      const stage = await db.prepare(`
        SELECT id,stage_type,version,status FROM orchestration_stages
        WHERE id = ? AND orchestration_run_id = ?
      `).bind(stageId, runId).first<{
        id: number; stage_type: string; version: number; status: string;
      }>();
      if (!stage || stage.status !== "needs_review") {
        return { error: "Only a stage awaiting review can be approved or rejected." };
      }
      const newer = await db.prepare(`
        SELECT id FROM orchestration_stages
        WHERE orchestration_run_id=? AND stage_type=? AND version>?
        LIMIT 1
      `).bind(runId, stage.stage_type, stage.version).first();
      if (newer) return { error: "Review the newest version of this stage." };
      const nextStatus = decision === "rejected"
        ? `${stage.stage_type}_pending`
        : stage.stage_type === "strategy"
          ? "planner_pending"
          : stage.stage_type === "planner"
            ? "drafting_pending"
            : "complete";
      await db.batch([
        db.prepare(`
          UPDATE orchestration_stages SET status=?,reviewed_by=?,review_note=?,
            reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?
        `).bind(decision, actor, note || null, stageId),
        db.prepare(`
          UPDATE orchestration_runs SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
        `).bind(nextStatus, runId),
        db.prepare(`
          INSERT INTO orchestration_events (
            orchestration_run_id,orchestration_stage_id,event_type,actor_name,detail
          ) VALUES (?,?,?,?,?)
        `).bind(
          runId,
          stageId,
          `${stage.stage_type}_${decision}`,
          actor,
          note || `${stage.stage_type} version ${stage.version}`,
        ),
      ]);
      return redirect(redirectTo);
    }

    return { error: "Unknown orchestration action." };
  } catch (error) {
    console.error("Post orchestration action failed.", error);
    return {
      error: error instanceof Error
        ? error.message
        : "The orchestration action could not be completed.",
    };
  }
}

const stageNames = {
  strategy: "1. Strategy Agent",
  planner: "2. Content Planner Agent",
  drafting: "3. Post Drafting Agent",
};

export default function Orchestration({ loaderData }: Route.ComponentProps) {
  const {
    employees, employeeId, weekStart, runs, run, stages, handoffs, events, drafts,
  } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const latest = (type: Stage["stage_type"]) =>
    stages.find((stage) => stage.stage_type === type);

  return (
    <main className="orchestration-shell">
      <style>{`
        .orchestration-shell{max-width:1380px;margin:0 auto;padding:28px;color:#15231d;font-family:Inter,ui-sans-serif,system-ui;background:#f4f7f5;min-height:100vh}
        .orchestration-header,.orchestration-card{background:#fff;border:1px solid #dbe5df;border-radius:18px;box-shadow:0 8px 28px rgba(28,59,45,.06)}
        .orchestration-header{padding:24px;margin-bottom:18px}.orchestration-header h1{margin:8px 0;font-size:30px}.orchestration-header p{margin:0;color:#587064}
        .topnav{display:flex;gap:14px;flex-wrap:wrap}.topnav a{color:#176c4a;text-decoration:none;font-weight:700}
        .filters{display:grid;grid-template-columns:minmax(220px,1fr) 180px auto;gap:12px;align-items:end;margin-top:20px}
        label{display:grid;gap:6px;font-size:13px;font-weight:700}select,input,textarea{width:100%;box-sizing:border-box;border:1px solid #cbd9d1;border-radius:10px;padding:10px;background:#fff;color:#15231d}
        button,.button-link{border:0;border-radius:10px;padding:10px 14px;background:#176c4a;color:#fff;font-weight:750;cursor:pointer;text-decoration:none;display:inline-block}
        button.secondary{background:#e8f1ec;color:#155a40}button.danger{background:#fff0ed;color:#9f2e20;border:1px solid #f0c4bb}button:disabled{opacity:.55;cursor:wait}
        .error{background:#fff0ed;color:#8a261b;border:1px solid #f0c4bb;padding:12px;border-radius:10px;margin:14px 0}
        .runbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px;margin-bottom:18px}.runbar p{margin:4px 0;color:#587064}.run-tabs{display:flex;gap:8px;flex-wrap:wrap}
        .run-tabs a{padding:7px 10px;border-radius:999px;text-decoration:none;background:#edf3ef;color:#285441}.run-tabs a.active{background:#176c4a;color:white}
        .pipeline{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.orchestration-card{padding:18px;min-width:0}
        .stage-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.stage-head h2{font-size:18px;margin:0}.badge{font-size:12px;padding:5px 8px;border-radius:999px;background:#edf3ef;color:#285441;white-space:nowrap}
        .stage-meta{color:#6a7d73;font-size:13px;margin:8px 0}.stage-output{white-space:pre-wrap;overflow:auto;max-height:420px;background:#13231c;color:#d9f4e6;border-radius:12px;padding:14px;font-size:12px;line-height:1.5}
        details{margin-top:12px}summary{cursor:pointer;font-weight:750}.review-form{display:grid;gap:10px;margin-top:14px}.actions{display:flex;gap:8px;flex-wrap:wrap}
        .lower-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.timeline{list-style:none;padding:0;margin:0;display:grid;gap:10px}.timeline li{border-left:3px solid #b8d5c5;padding-left:12px}.timeline small{color:#6a7d73}
        .draft-list{display:grid;gap:8px}.draft-row{display:flex;justify-content:space-between;gap:12px;padding:10px;background:#f3f7f4;border-radius:10px}.draft-row a{color:#176c4a;font-weight:750}
        @media(max-width:950px){.pipeline,.lower-grid{grid-template-columns:1fr}.filters{grid-template-columns:1fr}.orchestration-shell{padding:14px}}
      `}</style>

      <header className="orchestration-header">
        <nav className="topnav">
          <Link to="/">Dashboard</Link>
          <Link to="/operations">Operations</Link>
          <Link to="/planner">Legacy planner</Link>
          <Link to="/calendar">Calendar</Link>
        </nav>
        <h1>Post Orchestration</h1>
        <p>Approve the strategy handoff, then the weekly plan, before any post drafts are written.</p>
        <Form method="get" className="filters">
          <label>Employee
            <select name="employee" defaultValue={employeeId ?? ""}>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} — {employee.role_name}
                </option>
              ))}
            </select>
          </label>
          <label>Week starting
            <input type="date" name="week" defaultValue={weekStart} />
          </label>
          <button type="submit">Open week</button>
        </Form>
      </header>

      {actionData?.error ? <div className="error">{actionData.error}</div> : null}

      {employeeId ? (
        <section className="orchestration-card runbar">
          <div>
            <strong>{run ? `Run v${run.version}` : "No run yet"}</strong>
            <p>{run ? `Status: ${run.status.replaceAll("_", " ")}` : "Capture the playbook and begin with strategy."}</p>
            <div className="run-tabs">
              {runs.map((item) => (
                <Link
                  key={item.id}
                  className={item.id === run?.id ? "active" : ""}
                  to={runUrl(employeeId, weekStart, item.id)}
                >v{item.version}</Link>
              ))}
            </div>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="create_run" />
            <input type="hidden" name="employee_id" value={employeeId} />
            <input type="hidden" name="week_start" value={weekStart} />
            <label>Your name<input name="actor_name" required /></label>
            <button disabled={busy} type="submit">
              {runs.length ? "Start new version" : "Create orchestration run"}
            </button>
          </Form>
        </section>
      ) : (
        <section className="orchestration-card">Assign a playbook to an active employee first.</section>
      )}

      {run ? (
        <>
          <section className="pipeline">
            {(["strategy", "planner", "drafting"] as const).map((type) => {
              const stage = latest(type);
              const canRun =
                (type === "strategy" && (
                  run.status === "strategy_pending" ||
                  (run.status === "failed" && stage?.status === "failed")
                )) ||
                (type === "planner" && run.status === "planner_pending") ||
                (type === "planner" && run.status === "failed" && stage?.status === "failed") ||
                (type === "drafting" && run.status === "drafting_pending") ||
                (type === "drafting" && run.status === "failed" && stage?.status === "failed");
              return (
                <article className="orchestration-card" key={type}>
                  <div className="stage-head">
                    <h2>{stageNames[type]}</h2>
                    <span className="badge">{stage?.status.replaceAll("_", " ") ?? "not started"}</span>
                  </div>
                  <p className="stage-meta">
                    {stage ? `Version ${stage.version} · ${stage.model ?? "model not recorded"}` : "Waiting for the prior approved handoff."}
                  </p>
                  {stage?.safe_error ? <div className="error">{stage.safe_error}</div> : null}
                  {stage?.output_json ? <pre className="stage-output">{prettyJson(stage.output_json)}</pre> : null}
                  {stage ? (
                    <details>
                      <summary>Agent input</summary>
                      <pre className="stage-output">{prettyJson(stage.input_json)}</pre>
                    </details>
                  ) : null}
                  {canRun ? (
                    <Form method="post" className="review-form">
                      <input type="hidden" name="intent" value={`run_${type}`} />
                      <input type="hidden" name="run_id" value={run.id} />
                      <label>Your name<input name="actor_name" required /></label>
                      {type === "strategy" ? (
                        <label>Strategy instructions (optional)
                          <textarea name="review_note" rows={3} placeholder="Emphasize a campaign, audience, or point of view…" />
                        </label>
                      ) : null}
                      <button disabled={busy} type="submit">Run {stageNames[type].replace(/^[0-9]. /, "")}</button>
                    </Form>
                  ) : null}
                  {stage?.status === "needs_review" ? (
                    <Form method="post" className="review-form">
                      <input type="hidden" name="intent" value="review_stage" />
                      <input type="hidden" name="run_id" value={run.id} />
                      <input type="hidden" name="stage_id" value={stage.id} />
                      <label>Your name<input name="actor_name" required /></label>
                      <label>Review note<textarea name="review_note" rows={2} /></label>
                      <div className="actions">
                        <button disabled={busy} name="decision" value="approved">Approve handoff</button>
                        <button disabled={busy} className="danger" name="decision" value="rejected">Reject and revise</button>
                      </div>
                    </Form>
                  ) : null}
                </article>
              );
            })}
          </section>

          <section className="lower-grid">
            <article className="orchestration-card">
              <h2>Generated drafts</h2>
              <div className="draft-list">
                {drafts.length ? drafts.map((draft) => (
                  <div className="draft-row" key={draft.content_draft_id}>
                    <span>#{draft.sequence} {draft.title || "Untitled"} · {draft.status}</span>
                    <Link to={`/content/${draft.content_draft_id}/edit`}>Open post</Link>
                  </div>
                )) : <p>No drafts have been written. Drafting only unlocks after both upstream approvals.</p>}
              </div>
            </article>
            <article className="orchestration-card">
              <h2>Audit timeline</h2>
              <ul className="timeline">
                {events.map((event) => (
                  <li key={event.id}>
                    <strong>{event.event_type.replaceAll("_", " ")}</strong>
                    <div>{event.detail}</div>
                    <small>{event.actor_name} · {event.created_at}</small>
                  </li>
                ))}
              </ul>
            </article>
            <article className="orchestration-card">
              <h2>Agent handoffs</h2>
              {handoffs.length ? handoffs.map((handoff) => (
                <details key={handoff.id}>
                  <summary>Stage #{handoff.from_stage_id} → {handoff.to_stage_type}</summary>
                  <pre className="stage-output">{prettyJson(handoff.payload_json)}</pre>
                </details>
              )) : <p>No handoffs yet.</p>}
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}
