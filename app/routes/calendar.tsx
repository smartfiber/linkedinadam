import {
  Form,
  Link,
  redirect,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/calendar";
import {
  CONTENT_TIME_ZONE,
  getContentOperationalState,
  normalizeScheduledFor,
  type ContentOperationalState,
} from "../lib/contentWorkflow";
import { findScheduleConflict } from "../lib/contentWorkflow.server";

type AppEnvironment = {
  linkedinadam_db: D1Database;
};

type CalendarDraft = {
  id: number;
  employee_id: number;
  employee_name: string;
  title: string | null;
  topic: string | null;
  post_format: string | null;
  status: string;
  scheduled_for: string | null;
  image_key: string | null;
  image_status: string | null;
  updated_at: string;
};

type ScheduleHistory = {
  id: number;
  content_draft_id: number;
  previous_scheduled_for: string | null;
  scheduled_for: string | null;
  changed_by: string;
  change_note: string | null;
  created_at: string;
};

function getMonday(value?: string | null) {
  const calendarDate =
    value && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : getCurrentChicagoDateTime().slice(0, 10);
  const candidate = new Date(`${calendarDate}T12:00:00Z`);
  const day = candidate.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;

  candidate.setUTCDate(candidate.getUTCDate() - daysSinceMonday);

  return candidate.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function getCurrentChicagoDateTime() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONTENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function formatScheduledFor(value: string | null) {
  if (!value) {
    return "Unscheduled";
  }

  const date = new Date(`${value}:00Z`);

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function operationalLabel(state: ContentOperationalState) {
  return state.replaceAll("_", " ");
}

export async function loader({
  request,
  context,
}: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const url = new URL(request.url);
  const weekStart = getMonday(url.searchParams.get("week"));
  const weekEnd = addDays(weekStart, 7);

  const [scheduledQuery, unscheduledQuery, historyQuery] =
    await Promise.all([
      env.linkedinadam_db
        .prepare(`
          SELECT
            c.id,
            c.employee_id,
            e.name AS employee_name,
            c.title,
            c.topic,
            c.post_format,
            c.status,
            c.scheduled_for,
            c.image_key,
            c.image_status,
            c.updated_at
          FROM content_drafts c
          JOIN employees e
            ON e.id = c.employee_id
          WHERE c.scheduled_for >= ?
            AND c.scheduled_for < ?
          ORDER BY c.scheduled_for ASC, e.name ASC
        `)
        .bind(`${weekStart}T00:00`, `${weekEnd}T00:00`)
        .all<CalendarDraft>(),
      env.linkedinadam_db
        .prepare(`
          SELECT
            c.id,
            c.employee_id,
            e.name AS employee_name,
            c.title,
            c.topic,
            c.post_format,
            c.status,
            c.scheduled_for,
            c.image_key,
            c.image_status,
            c.updated_at
          FROM content_drafts c
          JOIN employees e
            ON e.id = c.employee_id
          WHERE c.scheduled_for IS NULL
            AND c.status != 'published'
          ORDER BY c.updated_at DESC
          LIMIT 50
        `)
        .all<CalendarDraft>(),
      env.linkedinadam_db
        .prepare(`
          SELECT
            id,
            content_draft_id,
            previous_scheduled_for,
            scheduled_for,
            changed_by,
            change_note,
            created_at
          FROM content_schedule_history
          ORDER BY created_at DESC, id DESC
          LIMIT 100
        `)
        .all<ScheduleHistory>(),
    ]);

  return {
    scheduledDrafts: scheduledQuery.results ?? [],
    unscheduledDrafts: unscheduledQuery.results ?? [],
    scheduleHistory: historyQuery.results ?? [],
    weekStart,
    weekEnd,
    currentLocalDateTime: getCurrentChicagoDateTime(),
  };
}

export async function action({
  request,
  context,
}: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const formData = await request.formData();
  const draftId = Number(formData.get("draft_id"));
  const changedBy = String(
    formData.get("changed_by") ?? "",
  ).trim();
  const changeNote = String(
    formData.get("change_note") ?? "",
  ).trim();
  const returnWeek = getMonday(
    String(formData.get("return_week") ?? ""),
  );

  if (!Number.isInteger(draftId)) {
    return { error: "Select a valid content draft." };
  }

  if (!changedBy) {
    return { error: "Your name is required for the schedule audit." };
  }

  let scheduledFor;

  try {
    scheduledFor = normalizeScheduledFor(
      String(formData.get("scheduled_for") ?? ""),
    );
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Choose a valid schedule date and time.",
    };
  }

  const draft = await env.linkedinadam_db
    .prepare(`
      SELECT id, employee_id, status, scheduled_for
      FROM content_drafts
      WHERE id = ?
    `)
    .bind(draftId)
    .first<{
      id: number;
      employee_id: number;
      status: string;
      scheduled_for: string | null;
    }>();

  if (!draft) {
    return { error: "The content draft could not be found." };
  }

  if (!["draft", "approved"].includes(draft.status)) {
    return { error: "Published content cannot be rescheduled." };
  }

  if (draft.status === "approved" && !changeNote) {
    return {
      error: "Explain the schedule change for approved content.",
    };
  }

  if (draft.scheduled_for === scheduledFor) {
    return { error: "Choose a different schedule time." };
  }

  const conflict = await findScheduleConflict(
    env.linkedinadam_db,
    draft.employee_id,
    scheduledFor,
    draft.id,
  );

  if (conflict) {
    return {
      error:
        `This employee already has “${conflict.title || "Untitled post"}” scheduled within 30 minutes of that time.`,
    };
  }

  await env.linkedinadam_db.batch([
    env.linkedinadam_db
      .prepare(`
        UPDATE content_drafts
        SET
          scheduled_for = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status IN ('draft', 'approved')
      `)
      .bind(scheduledFor, draftId),
    env.linkedinadam_db
      .prepare(`
        INSERT INTO content_schedule_history (
          content_draft_id,
          previous_scheduled_for,
          scheduled_for,
          changed_by,
          change_note
        )
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(
        draftId,
        draft.scheduled_for,
        scheduledFor,
        changedBy,
        changeNote || null,
      ),
  ]);

  return redirect(`/calendar?week=${returnWeek}`);
}

function CalendarCard({
  draft,
  state,
  weekStart,
  history,
  isSubmitting,
}: {
  draft: CalendarDraft;
  state: ContentOperationalState;
  weekStart: string;
  history: ScheduleHistory[];
  isSubmitting: boolean;
}) {
  return (
    <article className="calendar-card">
      <div className="calendar-card-heading">
        <div>
          <strong>{draft.title || "Untitled post"}</strong>
          <p>
            {draft.employee_name} ·{" "}
            {draft.post_format === "short_post"
              ? "Short post"
              : "Original post"}
          </p>
        </div>

        <span className={`calendar-state ${state}`}>
          {operationalLabel(state)}
        </span>
      </div>

      <p className="calendar-card-time">
        {formatScheduledFor(draft.scheduled_for)}
      </p>

      {draft.topic ? (
        <p className="calendar-card-topic">{draft.topic}</p>
      ) : null}

      {draft.status !== "published" ? (
        <Form method="post" className="schedule-form">
          <input type="hidden" name="draft_id" value={draft.id} />
          <input
            type="hidden"
            name="return_week"
            value={weekStart}
          />

          <label>
            Schedule ({CONTENT_TIME_ZONE})
            <input
              type="datetime-local"
              name="scheduled_for"
              defaultValue={draft.scheduled_for ?? ""}
            />
          </label>

          <label>
            Changed by
            <input
              type="text"
              name="changed_by"
              defaultValue="Adam Copenhaver"
              required
            />
          </label>

          <label>
            Reason
            <input
              type="text"
              name="change_note"
              placeholder={
                draft.status === "approved"
                  ? "Required for approved content"
                  : "Optional"
              }
              required={draft.status === "approved"}
            />
          </label>

          <div className="calendar-card-actions">
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save schedule"}
            </button>
            <Link to={`/content/${draft.id}/edit`}>
              Open draft
            </Link>
          </div>
        </Form>
      ) : null}

      {history.length > 0 ? (
        <details className="schedule-history">
          <summary>Schedule history ({history.length})</summary>
          {history.map((item) => (
            <div key={item.id}>
              <strong>{item.changed_by}</strong>
              <span>
                {formatScheduledFor(item.previous_scheduled_for)}
                {" → "}
                {formatScheduledFor(item.scheduled_for)}
              </span>
              {item.change_note ? <p>{item.change_note}</p> : null}
            </div>
          ))}
        </details>
      ) : null}
    </article>
  );
}

export default function Calendar({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    scheduledDrafts,
    unscheduledDrafts,
    scheduleHistory,
    weekStart,
    weekEnd,
    currentLocalDateTime,
  } = loaderData;
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const employeeFilter = searchParams.get("employee") ?? "all";
  const statusFilter = searchParams.get("status") ?? "all";
  const isSubmitting = navigation.state === "submitting";
  const allDrafts = [...scheduledDrafts, ...unscheduledDrafts];
  const employees = Array.from(
    new Set(allDrafts.map((draft) => draft.employee_name)),
  ).sort();
  const withState = allDrafts.map((draft) => ({
    draft,
    state: getContentOperationalState(
      draft,
      currentLocalDateTime,
    ),
  }));
  const filtered = withState.filter(({ draft, state }) => {
    const employeeMatches =
      employeeFilter === "all" ||
      draft.employee_name === employeeFilter;
    const statusMatches =
      statusFilter === "all" || state === statusFilter;

    return employeeMatches && statusMatches;
  });
  const filteredScheduled = filtered.filter(
    ({ draft }) => draft.scheduled_for,
  );
  const filteredUnscheduled = filtered.filter(
    ({ draft }) => !draft.scheduled_for,
  );
  const readyCount = withState.filter(
    ({ state }) => state === "ready",
  ).length;
  const overdueCount = withState.filter(
    ({ state }) => state === "overdue",
  ).length;

  return (
    <main className="calendar-page">
      <header className="calendar-header">
        <div>
          <Link className="back-link" to="/">
            ← Dashboard
          </Link>
          <p className="eyebrow">CONTENT OPERATIONS</p>
          <h1>Publishing calendar</h1>
          <p>
            Schedule and review content in {CONTENT_TIME_ZONE}.
            Publishing remains a manual, human-approved action.
          </p>
        </div>

        <div className="calendar-summary">
          <span><strong>{readyCount}</strong> ready</span>
          <span><strong>{overdueCount}</strong> overdue</span>
        </div>
      </header>

      {actionData?.error ? (
        <p className="form-error">{actionData.error}</p>
      ) : null}

      <section className="calendar-toolbar panel">
        <div className="week-navigation">
          <Link to={`/calendar?week=${addDays(weekStart, -7)}`}>
            ← Previous
          </Link>
          <strong>{weekStart} through {addDays(weekEnd, -1)}</strong>
          <Link to={`/calendar?week=${addDays(weekStart, 7)}`}>
            Next →
          </Link>
        </div>

        <Form method="get" className="calendar-filters">
          <input type="hidden" name="week" value={weekStart} />
          <select name="employee" defaultValue={employeeFilter}>
            <option value="all">All employees</option>
            {employees.map((employee) => (
              <option key={employee} value={employee}>
                {employee}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={statusFilter}>
            <option value="all">All workflow states</option>
            <option value="ready">Ready</option>
            <option value="overdue">Overdue</option>
            <option value="needs_post_approval">
              Needs post approval
            </option>
            <option value="needs_image_approval">
              Needs image approval
            </option>
            <option value="unscheduled">Unscheduled</option>
          </select>
          <button type="submit">Apply filters</button>
        </Form>
      </section>

      <section className="calendar-layout">
        <div>
          <div className="calendar-section-heading">
            <h2>Scheduled this week</h2>
            <span>{filteredScheduled.length}</span>
          </div>
          <div className="calendar-card-list">
            {filteredScheduled.length ? (
              filteredScheduled.map(({ draft, state }) => (
                <CalendarCard
                  key={draft.id}
                  draft={draft}
                  state={state}
                  weekStart={weekStart}
                  history={scheduleHistory.filter(
                    (item) => item.content_draft_id === draft.id,
                  )}
                  isSubmitting={isSubmitting}
                />
              ))
            ) : (
              <div className="empty-state">
                No scheduled content matches these filters.
              </div>
            )}
          </div>
        </div>

        <aside>
          <div className="calendar-section-heading">
            <h2>Unscheduled queue</h2>
            <span>{filteredUnscheduled.length}</span>
          </div>
          <div className="calendar-card-list">
            {filteredUnscheduled.length ? (
              filteredUnscheduled.map(({ draft, state }) => (
                <CalendarCard
                  key={draft.id}
                  draft={draft}
                  state={state}
                  weekStart={weekStart}
                  history={scheduleHistory.filter(
                    (item) => item.content_draft_id === draft.id,
                  )}
                  isSubmitting={isSubmitting}
                />
              ))
            ) : (
              <div className="empty-state">
                No unscheduled content matches these filters.
              </div>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
