import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/operations";
import {
  addCalendarDays,
  enqueueDailyGeneration,
  getChicagoDate,
  processAutomationBatch,
} from "../lib/autopilot.server";

type AppEnvironment = {
  linkedinadam_db: D1Database;
  OPENAI_API_KEY?: string;
};

type DailyDraft = {
  id: number;
  employee_id: number;
  employee_name: string;
  role_name: string;
  title: string | null;
  body: string;
  topic: string | null;
  post_format: string | null;
  status: string;
  scheduled_for: string;
  image_key: string | null;
  image_status: string | null;
};

type AutomationSettings = {
  enabled: number;
  generate_today: number;
  generate_tomorrow: number;
  auto_approve_posts: number;
  auto_approve_connections: number;
  connection_score_threshold: number;
  max_tasks_per_batch: number;
  weekly_connection_limit: number;
  started_by: string | null;
  started_at: string | null;
  stopped_by: string | null;
  stopped_at: string | null;
};

type AutomationRun = {
  id: number;
  trigger_type: string;
  status: string;
  requested_by: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  created_at: string;
  completed_at: string | null;
};

function parseIds(formData: FormData) {
  return Array.from(
    new Set(
      formData
        .getAll("draft_id")
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
}

async function draftsForDate(
  db: D1Database,
  date: string,
) {
  return db
    .prepare(`
      SELECT
        c.id,
        c.employee_id,
        e.name AS employee_name,
        e.role_name,
        c.title,
        c.body,
        c.topic,
        c.post_format,
        c.status,
        c.scheduled_for,
        c.image_key,
        c.image_status
      FROM content_drafts c
      JOIN employees e ON e.id = c.employee_id
      WHERE c.scheduled_for >= ?
        AND c.scheduled_for < ?
        AND e.status = 'active'
      ORDER BY e.name, c.scheduled_for, c.id
    `)
    .bind(
      `${date}T00:00`,
      `${addCalendarDays(date, 1)}T00:00`,
    )
    .all<DailyDraft>();
}

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const today = getChicagoDate();
  const tomorrow = addCalendarDays(today, 1);
  const [todayQuery, tomorrowQuery, settings, runsQuery] =
    await Promise.all([
      draftsForDate(env.linkedinadam_db, today),
      draftsForDate(env.linkedinadam_db, tomorrow),
      env.linkedinadam_db
        .prepare("SELECT * FROM automation_settings WHERE id = 1")
        .first<AutomationSettings>(),
      env.linkedinadam_db
        .prepare(`
          SELECT *
          FROM automation_runs
          ORDER BY created_at DESC, id DESC
          LIMIT 10
        `)
        .all<AutomationRun>(),
    ]);

  return {
    today,
    tomorrow,
    todayDrafts: todayQuery.results ?? [],
    tomorrowDrafts: tomorrowQuery.results ?? [],
    settings,
    runs: runsQuery.results ?? [],
  };
}

export async function action({
  request,
  context,
}: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const db = env.linkedinadam_db;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const actorName = String(
    formData.get("actor_name") ?? "",
  ).trim();

  if (!actorName) {
    return { error: "Your name is required for the audit trail." };
  }

  if (intent === "generate_all") {
    const today = getChicagoDate();

    try {
      const queued = await enqueueDailyGeneration(db, {
        requestedBy: actorName,
        triggerType: "manual",
        targetDates: [today, addCalendarDays(today, 1)],
      });

      if (queued.taskCount) {
        context.cloudflare.ctx.waitUntil(
          processAutomationBatch(env, queued.runId),
        );
      }

      return {
        success:
          queued.taskCount > 0
            ? `Queued ${queued.taskCount} missing employee posts. The first batch is running.`
            : "Every active employee already has content for today and tomorrow.",
      };
    } catch (error) {
      console.error(
        "Generate-all queue failed.",
        error instanceof Error ? error.name : "unknown",
      );
      return {
        error: "The all-employee generation run could not be queued.",
      };
    }
  }

  if (intent === "process_next_batch") {
    context.cloudflare.ctx.waitUntil(processAutomationBatch(env));
    return { success: "The next pending automation batch is running." };
  }

  if (intent === "start_yolo") {
    const threshold = Number(
      formData.get("connection_score_threshold"),
    );

    if (
      !Number.isInteger(threshold) ||
      threshold < 0 ||
      threshold > 100
    ) {
      return {
        error: "Connection threshold must be from 0 to 100.",
      };
    }

    await db
      .prepare(`
        UPDATE automation_settings
        SET
          enabled = 1,
          generate_today = 1,
          generate_tomorrow = 1,
          auto_approve_posts = 1,
          auto_approve_connections = 1,
          connection_score_threshold = ?,
          max_tasks_per_batch = 10,
          weekly_connection_limit = 25,
          started_by = ?,
          started_at = CURRENT_TIMESTAMP,
          stopped_by = NULL,
          stopped_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `)
      .bind(threshold, actorName)
      .run();
    const today = getChicagoDate();
    const queued = await enqueueDailyGeneration(db, {
      requestedBy: `YOLO Mode (${actorName})`,
      triggerType: "yolo_start",
      targetDates: [today, addCalendarDays(today, 1)],
    });

    context.cloudflare.ctx.waitUntil(
      processAutomationBatch(env, queued.runId),
    );

    return {
      success:
        "YOLO Mode started. Internal generation and qualifying approvals will continue until stopped.",
    };
  }

  if (intent === "stop_yolo") {
    await db.batch([
      db
        .prepare(`
          UPDATE automation_settings
          SET
            enabled = 0,
            stopped_by = ?,
            stopped_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = 1
        `)
        .bind(actorName),
      db
        .prepare(`
          INSERT INTO automation_events (
            event_type,
            actor_name,
            detail
          )
          VALUES ('yolo_stopped', ?, ?)
        `)
        .bind(
          actorName,
          "YOLO Mode stopped. No new scheduled batch may start.",
        ),
    ]);

    return {
      success:
        "YOLO Mode stopped. Any item already running may finish safely.",
    };
  }

  if (
    intent === "approve_selected_posts" ||
    intent === "approve_all_daily_posts" ||
    intent === "return_selected_to_draft"
  ) {
    let ids = parseIds(formData);
    const reviewNote = String(
      formData.get("review_note") ?? "",
    ).trim();
    const isApproval =
      intent === "approve_selected_posts" ||
      intent === "approve_all_daily_posts";

    if (intent === "approve_all_daily_posts") {
      const today = getChicagoDate();
      const eligible = await db
        .prepare(`
          SELECT id
          FROM content_drafts
          WHERE status = 'draft'
            AND TRIM(body) != ''
            AND scheduled_for >= ?
            AND scheduled_for < ?
          ORDER BY scheduled_for, id
          LIMIT 500
        `)
        .bind(
          `${today}T00:00`,
          `${addCalendarDays(today, 2)}T00:00`,
        )
        .all<{ id: number }>();
      ids = (eligible.results ?? []).map((row) => row.id);
    }

    if (!ids.length) {
      return {
        error:
          intent === "approve_all_daily_posts"
            ? "There are no eligible draft posts for today or tomorrow."
            : "Select at least one post.",
      };
    }

    const placeholders = ids.map(() => "?").join(", ");
    const expectedStatus =
      isApproval ? "draft" : "approved";
    const nextStatus =
      isApproval ? "approved" : "draft";

    if (nextStatus === "draft" && !reviewNote) {
      return {
        error:
          "Explain why approved posts are being returned to draft.",
      };
    }

    const drafts = await db
      .prepare(`
        SELECT id, body
        FROM content_drafts
        WHERE id IN (${placeholders}) AND status = ?
      `)
      .bind(...ids, expectedStatus)
      .all<{ id: number; body: string }>();
    const valid = (drafts.results ?? []).filter(
      (draft) => nextStatus === "draft" || draft.body.trim(),
    );

    if (!valid.length) {
      return {
        error:
          "None of the selected posts are eligible for this action.",
      };
    }

    const statements: D1PreparedStatement[] = [];

    for (const draft of valid) {
      statements.push(
        db
          .prepare(`
            UPDATE content_drafts
            SET
              status = ?,
              approved_at = CASE
                WHEN ? = 'approved' THEN CURRENT_TIMESTAMP
                ELSE NULL
              END,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = ?
          `)
          .bind(nextStatus, nextStatus, draft.id, expectedStatus),
        db
          .prepare(`
            INSERT INTO content_review_history (
              content_draft_id,
              from_status,
              to_status,
              reviewer_name,
              review_note
            )
            VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            draft.id,
            expectedStatus,
            nextStatus,
            actorName,
            reviewNote || "Bulk approval from Daily Operations",
          ),
      );
    }

    await db.batch(statements);

    return {
      success:
        `${nextStatus === "approved" ? "Approved" : "Returned"} ${valid.length} post${valid.length === 1 ? "" : "s"}.`,
    };
  }

  return { error: "Choose a valid Daily Operations action." };
}

function DailyPostGroup({
  title,
  date,
  drafts,
}: {
  title: string;
  date: string;
  drafts: DailyDraft[];
}) {
  const employees = Array.from(
    new Set(drafts.map((draft) => draft.employee_name)),
  );

  return (
    <section className="daily-column panel">
      <div className="daily-column-heading">
        <div>
          <p className="eyebrow">{date}</p>
          <h2>{title}</h2>
        </div>
        <span>{drafts.length} posts</span>
      </div>

      {employees.length ? (
        employees.map((employee) => (
          <details className="daily-employee" key={employee} open>
            <summary>
              <strong>{employee}</strong>
              <span>
                {
                  drafts.filter(
                    (draft) => draft.employee_name === employee,
                  ).length
                }{" "}
                posts
              </span>
            </summary>
            <div className="daily-post-list">
              {drafts
                .filter(
                  (draft) => draft.employee_name === employee,
                )
                .map((draft) => (
                  <details className="daily-post-card" key={draft.id}>
                    <summary>
                      <input
                        type="checkbox"
                        name="draft_id"
                        value={draft.id}
                        aria-label={`Select ${draft.title || "post"}`}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <div>
                        <strong>
                          {draft.title || draft.topic || "Untitled post"}
                        </strong>
                        <span>
                          {draft.scheduled_for.slice(11)} ·{" "}
                          {draft.status}
                        </span>
                      </div>
                      <span
                        className={`daily-status ${draft.status}`}
                      >
                        {draft.body.trim()
                          ? "Copy ready"
                          : "Missing copy"}
                      </span>
                    </summary>
                    <div className="daily-post-body">
                      <p>
                        {draft.body.trim() ||
                          "This draft does not have generated post copy yet."}
                      </p>
                      <div>
                        <span>
                          Image:{" "}
                          {draft.image_status || "not generated"}
                        </span>
                        <Link to={`/content/${draft.id}/edit`}>
                          Edit full post
                        </Link>
                      </div>
                    </div>
                  </details>
                ))}
            </div>
          </details>
        ))
      ) : (
        <div className="empty-state">
          No posts are scheduled for {title.toLowerCase()}.
        </div>
      )}
    </section>
  );
}

export default function Operations({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const {
    today,
    tomorrow,
    todayDrafts,
    tomorrowDrafts,
    settings,
    runs,
  } = loaderData;

  return (
    <main className="operations-page">
      <header className="operations-header">
        <Link className="back-link" to="/">
          ← Dashboard
        </Link>
        <span> · </span>
        <Link className="back-link" to="/orchestration">
          Post Orchestration
        </Link>
        <p className="eyebrow">DAILY OPERATIONS</p>
        <h1>Today, tomorrow, and automation</h1>
        <p>
          Review complete post copy by employee, generate missing
          content in batches, and control internal automation from one
          place.
        </p>
      </header>

      {actionData?.error ? (
        <p className="form-error">{actionData.error}</p>
      ) : null}
      {actionData?.success ? (
        <p className="form-success">{actionData.success}</p>
      ) : null}

      <section className="operations-controls panel">
        <Form method="post">
          <input type="hidden" name="intent" value="generate_all" />
          <label>
            Requested by
            <input name="actor_name" required placeholder="Adam" />
          </label>
          <button disabled={isSubmitting}>
            Generate missing posts for all employees
          </button>
        </Form>

        <div className={`yolo-control ${settings?.enabled ? "active" : ""}`}>
          <div>
            <span className="eyebrow">YOLO MODE</span>
            <strong>
              {settings?.enabled ? "Running" : "Stopped"}
            </strong>
            <p>
              Generates today and tomorrow, approves post copy, and
              approves connection recommendations scoring{" "}
              {settings?.connection_score_threshold ?? 85}+.
            </p>
          </div>
          {settings?.enabled ? (
            <Form method="post">
              <input
                type="hidden"
                name="intent"
                value="stop_yolo"
              />
              <input name="actor_name" required placeholder="Your name" />
              <button className="stop-button" disabled={isSubmitting}>
                Stop YOLO Mode
              </button>
            </Form>
          ) : (
            <Form method="post">
              <input
                type="hidden"
                name="intent"
                value="start_yolo"
              />
              <input name="actor_name" required placeholder="Your name" />
              <label>
                Connection approval score
                <input
                  type="number"
                  name="connection_score_threshold"
                  min={0}
                  max={100}
                  defaultValue={85}
                />
              </label>
              <button
                disabled={isSubmitting}
                onClick={(event) => {
                  if (
                    !window.confirm(
                      "Start YOLO Mode? It will generate and internally approve content and qualifying connection recommendations until stopped. It will not publish or send invitations.",
                    )
                  ) {
                    event.preventDefault();
                  }
                }}
              >
                Start YOLO Mode
              </button>
            </Form>
          )}
        </div>
      </section>

      <Form method="post" className="daily-bulk-form">
        <div className="daily-bulk-toolbar panel">
          <input
            name="actor_name"
            required
            placeholder="Reviewer name"
          />
          <input
            name="review_note"
            placeholder="Optional review note"
          />
          <button
            name="intent"
            value="approve_selected_posts"
            disabled={isSubmitting}
          >
            Approve selected posts
          </button>
          <button
            name="intent"
            value="approve_all_daily_posts"
            disabled={isSubmitting}
            onClick={(event) => {
              if (
                !window.confirm(
                  "Approve every eligible draft scheduled for today and tomorrow?",
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            Approve all today &amp; tomorrow
          </button>
          <button
            className="secondary-button"
            name="intent"
            value="return_selected_to_draft"
            disabled={isSubmitting}
          >
            Return selected to draft
          </button>
        </div>

        <section className="daily-grid">
          <DailyPostGroup
            title="Today"
            date={today}
            drafts={todayDrafts}
          />
          <DailyPostGroup
            title="Tomorrow"
            date={tomorrow}
            drafts={tomorrowDrafts}
          />
        </section>
      </Form>

      <details className="panel automation-history">
        <summary>
          <strong>Automation run history</strong>
          <span>{runs.length} recent runs</span>
        </summary>
        <div>
          {runs.map((run) => (
            <article key={run.id}>
              <strong>
                Run #{run.id} · {run.status.replaceAll("_", " ")}
              </strong>
              <span>
                {run.completed_tasks}/{run.total_tasks} completed ·{" "}
                {run.failed_tasks} failed · {run.requested_by}
              </span>
            </article>
          ))}
          <Form method="post">
            <input
              type="hidden"
              name="intent"
              value="process_next_batch"
            />
            <input
              name="actor_name"
              required
              placeholder="Your name"
            />
            <button disabled={isSubmitting}>
              Process next pending batch
            </button>
          </Form>
        </div>
      </details>

      <aside className="operations-boundary">
        YOLO Mode never publishes posts, sends invitations, or sends
        messages. Those external actions remain manual.
      </aside>
    </main>
  );
}
