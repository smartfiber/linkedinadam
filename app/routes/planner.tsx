import {
  Form,
  Link,
  redirect,
  useNavigation,
} from "react-router";
import type { Route } from "./+types/planner";
import { getSafeOpenAIErrorMessage } from "../lib/aiErrors.server";
import {
  addDays,
  getMonday,
  PLANNER_MODEL,
  validateGeneratedPlan,
} from "../lib/contentPlanner";
import { refreshContentPlanStatus } from "../lib/contentPlanner.server";
import { findScheduleConflict } from "../lib/contentWorkflow.server";
import { generateWeeklyContentPlan } from "../lib/generateWeeklyContentPlan.server";
import {
  buildContentInsights,
  type MeasuredPost,
} from "../lib/postAnalytics";

type AppEnvironment = {
  linkedinadam_db: D1Database;
  OPENAI_API_KEY?: string;
};

type PlannerEmployee = {
  id: number;
  name: string;
  role_name: string;
  primary_audience: string | null;
  primary_expertise: string | null;
  positioning_statement: string | null;
  recurring_series: string | null;
  weekly_original_posts: number;
  weekly_short_posts: number;
  soft_cta: string | null;
  guardrail: string | null;
};

type ContentPlan = {
  id: number;
  employee_id: number;
  employee_name: string;
  week_start: string;
  version: number;
  status: string;
  planning_instructions: string | null;
  model: string;
  generated_by: string;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
};

type ContentPlanItem = {
  id: number;
  content_plan_id: number;
  sequence: number;
  post_format: string;
  topic: string;
  angle: string;
  rationale: string;
  suggested_scheduled_for: string;
  status: string;
  reviewed_by: string | null;
  review_note: string | null;
  content_draft_id: number | null;
};

type ItemHistory = {
  id: number;
  content_plan_item_id: number;
  from_status: string | null;
  to_status: string;
  actor_name: string;
  note: string | null;
  created_at: string;
};

function plannerRedirect(
  employeeId: number,
  weekStart: string,
) {
  return `/planner?employee=${employeeId}&week=${weekStart}`;
}

export async function loader({
  request,
  context,
}: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const url = new URL(request.url);
  const weekStart = getMonday(url.searchParams.get("week"));
  const employeesQuery = await env.linkedinadam_db
    .prepare(`
      SELECT
        e.id,
        e.name,
        e.role_name,
        p.primary_audience,
        p.primary_expertise,
        p.positioning_statement,
        p.recurring_series,
        COALESCE(p.weekly_original_posts, 0)
          AS weekly_original_posts,
        COALESCE(p.weekly_short_posts, 0)
          AS weekly_short_posts,
        p.soft_cta,
        p.guardrail
      FROM employees e
      LEFT JOIN employee_playbooks ep
        ON ep.employee_id = e.id
      LEFT JOIN playbooks p
        ON p.id = ep.playbook_id
      WHERE e.status = 'active'
      ORDER BY e.name
    `)
    .all<PlannerEmployee>();
  const employees = employeesQuery.results ?? [];
  const requestedEmployeeId = Number(
    url.searchParams.get("employee"),
  );
  const employeeId = employees.some(
    (employee) => employee.id === requestedEmployeeId,
  )
    ? requestedEmployeeId
    : employees[0]?.id ?? null;

  if (!employeeId) {
    return {
      employees,
      employeeId: null,
      weekStart,
      plans: [] as ContentPlan[],
      items: [] as ContentPlanItem[],
      history: [] as ItemHistory[],
    };
  }

  const plansQuery = await env.linkedinadam_db
    .prepare(`
      SELECT
        p.id,
        p.employee_id,
        e.name AS employee_name,
        p.week_start,
        p.version,
        p.status,
        p.planning_instructions,
        p.model,
        p.generated_by,
        p.reviewed_by,
        p.review_note,
        p.created_at
      FROM content_plans p
      JOIN employees e ON e.id = p.employee_id
      WHERE p.employee_id = ?
        AND p.week_start = ?
      ORDER BY p.version DESC
    `)
    .bind(employeeId, weekStart)
    .all<ContentPlan>();
  const plans = plansQuery.results ?? [];
  const planIds = plans.map((plan) => plan.id);
  let items: ContentPlanItem[] = [];
  let history: ItemHistory[] = [];

  if (planIds.length) {
    const placeholders = planIds.map(() => "?").join(", ");
    const [itemsQuery, historyQuery] = await Promise.all([
      env.linkedinadam_db
        .prepare(`
          SELECT
            id,
            content_plan_id,
            sequence,
            post_format,
            topic,
            angle,
            rationale,
            suggested_scheduled_for,
            status,
            reviewed_by,
            review_note,
            content_draft_id
          FROM content_plan_items
          WHERE content_plan_id IN (${placeholders})
          ORDER BY content_plan_id DESC, sequence
        `)
        .bind(...planIds)
        .all<ContentPlanItem>(),
      env.linkedinadam_db
        .prepare(`
          SELECT
            h.id,
            h.content_plan_item_id,
            h.from_status,
            h.to_status,
            h.actor_name,
            h.note,
            h.created_at
          FROM content_plan_item_history h
          JOIN content_plan_items i
            ON i.id = h.content_plan_item_id
          WHERE i.content_plan_id IN (${placeholders})
          ORDER BY h.created_at DESC, h.id DESC
        `)
        .bind(...planIds)
        .all<ItemHistory>(),
    ]);
    items = itemsQuery.results ?? [];
    history = historyQuery.results ?? [];
  }

  return {
    employees,
    employeeId,
    weekStart,
    plans,
    items,
    history,
  };
}

export async function action({
  request,
  context,
}: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const employeeId = Number(formData.get("employee_id"));
  const weekStart = getMonday(
    String(formData.get("week_start") ?? ""),
  );
  const returnTo = plannerRedirect(employeeId, weekStart);

  if (intent === "generate_plan") {
    const generatedBy = String(
      formData.get("generated_by") ?? "",
    ).trim();
    const planningInstructions = String(
      formData.get("planning_instructions") ?? "",
    ).trim();

    if (!Number.isInteger(employeeId)) {
      return { error: "Select a valid employee." };
    }

    if (!generatedBy) {
      return { error: "Your name is required for the audit trail." };
    }

    if (!env.OPENAI_API_KEY) {
      return { error: "The OpenAI API key is not configured." };
    }

    const employee = await env.linkedinadam_db
      .prepare(`
        SELECT
          e.id,
          e.name,
          e.role_name,
          p.primary_audience,
          p.primary_expertise,
          p.positioning_statement,
          p.recurring_series,
          COALESCE(p.weekly_original_posts, 0)
            AS weekly_original_posts,
          COALESCE(p.weekly_short_posts, 0)
            AS weekly_short_posts,
          p.soft_cta,
          p.guardrail
        FROM employees e
        JOIN employee_playbooks ep ON ep.employee_id = e.id
        JOIN playbooks p ON p.id = ep.playbook_id
        WHERE e.id = ? AND e.status = 'active'
      `)
      .bind(employeeId)
      .first<PlannerEmployee>();

    if (!employee) {
      return { error: "The employee or playbook could not be found." };
    }

    const totalTarget =
      employee.weekly_original_posts +
      employee.weekly_short_posts;

    if (!totalTarget || totalTarget > 10) {
      return {
        error:
          "The playbook must request between one and ten weekly posts.",
      };
    }

    const recentCutoff = addDays(weekStart, -84);
    const weekEnd = addDays(weekStart, 7);
    const [recentQuery, occupiedQuery, metricsQuery, versionRow] =
      await Promise.all([
        env.linkedinadam_db
          .prepare(`
            SELECT topic
            FROM content_drafts
            WHERE employee_id = ?
              AND topic IS NOT NULL
              AND created_at >= ?
            ORDER BY created_at DESC
            LIMIT 50
          `)
          .bind(employeeId, `${recentCutoff}T00:00`)
          .all<{ topic: string }>(),
        env.linkedinadam_db
          .prepare(`
            SELECT scheduled_for
            FROM content_drafts
            WHERE employee_id = ?
              AND scheduled_for >= ?
              AND scheduled_for < ?
              AND status != 'published'
            ORDER BY scheduled_for
          `)
          .bind(
            employeeId,
            `${weekStart}T00:00`,
            `${weekEnd}T00:00`,
          )
          .all<{ scheduled_for: string }>(),
        env.linkedinadam_db
          .prepare(`
            WITH ranked AS (
              SELECT
                s.*,
                ROW_NUMBER() OVER (
                  PARTITION BY s.content_draft_id
                  ORDER BY s.captured_at DESC, s.id DESC
                ) AS rank
              FROM post_metric_snapshots s
            )
            SELECT
              c.id,
              e.name AS employee_name,
              c.post_format,
              c.topic,
              c.image_key,
              s.impressions,
              s.reactions,
              s.comments,
              s.reposts,
              s.clicks,
              s.qualified_conversations,
              s.leads
            FROM content_drafts c
            JOIN employees e ON e.id = c.employee_id
            JOIN ranked s
              ON s.content_draft_id = c.id AND s.rank = 1
            WHERE c.employee_id = ?
              AND c.status = 'published'
            ORDER BY c.published_at DESC
            LIMIT 100
          `)
          .bind(employeeId)
          .all<MeasuredPost>(),
        env.linkedinadam_db
          .prepare(`
            SELECT COALESCE(MAX(version), 0) AS version
            FROM content_plans
            WHERE employee_id = ? AND week_start = ?
          `)
          .bind(employeeId, weekStart)
          .first<{ version: number }>(),
      ]);
    const recentTopics = (recentQuery.results ?? []).map(
      (row) => row.topic,
    );
    const occupiedTimes = (occupiedQuery.results ?? []).map(
      (row) => row.scheduled_for,
    );

    let generated;

    try {
      generated = await generateWeeklyContentPlan({
        apiKey: env.OPENAI_API_KEY,
        employeeName: employee.name,
        roleName: employee.role_name,
        weekStart,
        originalPostTarget: employee.weekly_original_posts,
        shortPostTarget: employee.weekly_short_posts,
        primaryAudience: employee.primary_audience,
        primaryExpertise: employee.primary_expertise,
        positioningStatement: employee.positioning_statement,
        recurringSeries: employee.recurring_series,
        softCta: employee.soft_cta,
        guardrail: employee.guardrail,
        recentTopics,
        occupiedTimes,
        analyticsInsights: buildContentInsights(
          metricsQuery.results ?? [],
        ),
        planningInstructions: planningInstructions || null,
      });
      validateGeneratedPlan(generated.items, {
        weekStart,
        originalPostTarget: employee.weekly_original_posts,
        shortPostTarget: employee.weekly_short_posts,
        recentTopics,
        occupiedTimes,
      });
    } catch (error) {
      console.error("Weekly content plan generation failed.", error);

      if (
        error instanceof SyntaxError ||
        (
          error instanceof Error &&
          error.message.startsWith("The generated plan")
        )
      ) {
        return {
          error:
            "OpenAI returned a plan that did not pass workflow validation. Generate a new version.",
        };
      }

      return {
        error: getSafeOpenAIErrorMessage(error, "plan"),
      };
    }

    try {
      const version = (versionRow?.version ?? 0) + 1;
      const planInsert = await env.linkedinadam_db
        .prepare(`
          INSERT INTO content_plans (
            employee_id,
            week_start,
            version,
            status,
            planning_instructions,
            model,
            generated_by
          )
          VALUES (?, ?, ?, 'proposed', ?, ?, ?)
          RETURNING id
        `)
        .bind(
          employeeId,
          weekStart,
          version,
          planningInstructions || null,
          generated.model,
          generatedBy,
        )
        .first<{ id: number }>();

      if (!planInsert) {
        throw new Error("The plan insert did not return an ID.");
      }

      for (const [index, item] of generated.items.entries()) {
        const itemInsert = await env.linkedinadam_db
          .prepare(`
            INSERT INTO content_plan_items (
              content_plan_id,
              sequence,
              post_format,
              topic,
              angle,
              rationale,
              suggested_scheduled_for
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id
          `)
          .bind(
            planInsert.id,
            index + 1,
            item.post_format,
            item.topic,
            item.angle,
            item.rationale,
            item.suggested_scheduled_for,
          )
          .first<{ id: number }>();

        if (!itemInsert) {
          throw new Error("The plan item insert did not return an ID.");
        }

        await env.linkedinadam_db
          .prepare(`
            INSERT INTO content_plan_item_history (
              content_plan_item_id,
              from_status,
              to_status,
              actor_name,
              note
            )
            VALUES (?, NULL, 'proposed', ?, 'Generated by AI')
          `)
          .bind(itemInsert.id, generatedBy)
          .run();
      }

      await env.linkedinadam_db
        .prepare(`
          UPDATE content_plans
          SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
          WHERE employee_id = ?
            AND week_start = ?
            AND id != ?
            AND status IN ('proposed', 'approved', 'rejected')
        `)
        .bind(employeeId, weekStart, planInsert.id)
        .run();
    } catch (error) {
      console.error("Weekly content plan save failed.", error);
      return {
        error:
          "The plan was generated but could not be saved to the database.",
      };
    }

    return redirect(returnTo);
  }

  const itemId = Number(formData.get("item_id"));
  const actorName = String(
    formData.get("actor_name") ?? "",
  ).trim();
  const reviewNote = String(
    formData.get("review_note") ?? "",
  ).trim();

  if (!Number.isInteger(itemId) || !actorName) {
    return {
      error: "Select a valid plan item and provide your name.",
    };
  }

  const item = await env.linkedinadam_db
    .prepare(`
      SELECT
        i.id,
        i.content_plan_id,
        i.post_format,
        i.topic,
        i.angle,
        i.suggested_scheduled_for,
        i.status,
        p.employee_id,
        p.week_start,
        p.status AS plan_status
      FROM content_plan_items i
      JOIN content_plans p ON p.id = i.content_plan_id
      WHERE i.id = ?
    `)
    .bind(itemId)
    .first<{
      id: number;
      content_plan_id: number;
      post_format: string;
      topic: string;
      angle: string;
      suggested_scheduled_for: string;
      status: string;
      employee_id: number;
      week_start: string;
      plan_status: string;
    }>();

  if (!item || item.employee_id !== employeeId) {
    return { error: "The plan item could not be found." };
  }

  if (item.plan_status === "superseded") {
    return { error: "Superseded plans cannot be changed." };
  }

  if (intent === "review_item") {
    const nextStatus = String(formData.get("next_status") ?? "");

    if (
      !["approved", "rejected"].includes(nextStatus) ||
      !["proposed", "approved", "rejected"].includes(item.status)
    ) {
      return { error: "Choose a valid review action." };
    }

    if (item.status === nextStatus) {
      return { error: `This item is already ${nextStatus}.` };
    }

    await env.linkedinadam_db.batch([
      env.linkedinadam_db
        .prepare(`
          UPDATE content_plan_items
          SET
            status = ?,
            reviewed_by = ?,
            review_note = ?,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status != 'converted'
        `)
        .bind(nextStatus, actorName, reviewNote || null, item.id),
      env.linkedinadam_db
        .prepare(`
          INSERT INTO content_plan_item_history (
            content_plan_item_id,
            from_status,
            to_status,
            actor_name,
            note
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          item.id,
          item.status,
          nextStatus,
          actorName,
          reviewNote || null,
        ),
    ]);
    await refreshContentPlanStatus(
      env.linkedinadam_db,
      item.content_plan_id,
    );

    return redirect(returnTo);
  }

  if (intent === "convert_item") {
    if (item.status !== "approved") {
      return {
        error: "Approve the plan item before creating a content draft.",
      };
    }

    const conflict = await findScheduleConflict(
      env.linkedinadam_db,
      employeeId,
      item.suggested_scheduled_for,
    );

    if (conflict) {
      return {
        error:
          `“${conflict.title || "Untitled post"}” is already scheduled within 30 minutes. Reschedule it before converting this item.`,
      };
    }

    try {
      const draft = await env.linkedinadam_db
        .prepare(`
          INSERT INTO content_drafts (
            employee_id,
            title,
            body,
            post_format,
            topic,
            status,
            scheduled_for
          )
          VALUES (?, ?, '', ?, ?, 'draft', ?)
          RETURNING id
        `)
        .bind(
          employeeId,
          item.topic,
          item.post_format,
          item.topic,
          item.suggested_scheduled_for,
        )
        .first<{ id: number }>();

      if (!draft) {
        throw new Error("The draft insert did not return an ID.");
      }

      await env.linkedinadam_db.batch([
        env.linkedinadam_db
          .prepare(`
            UPDATE content_plan_items
            SET
              status = 'converted',
              content_draft_id = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'approved'
          `)
          .bind(draft.id, item.id),
        env.linkedinadam_db
          .prepare(`
            INSERT INTO content_plan_item_history (
              content_plan_item_id,
              from_status,
              to_status,
              actor_name,
              note
            )
            VALUES (?, 'approved', 'converted', ?, ?)
          `)
          .bind(
            item.id,
            actorName,
            reviewNote || "Created content draft shell",
          ),
        env.linkedinadam_db
          .prepare(`
            INSERT INTO content_schedule_history (
              content_draft_id,
              previous_scheduled_for,
              scheduled_for,
              changed_by,
              change_note
            )
            VALUES (?, NULL, ?, ?, 'Created from approved weekly plan')
          `)
          .bind(
            draft.id,
            item.suggested_scheduled_for,
            actorName,
          ),
      ]);
      await refreshContentPlanStatus(
        env.linkedinadam_db,
        item.content_plan_id,
      );
    } catch (error) {
      console.error("Plan item conversion failed.", error);
      return {
        error: "The approved item could not be converted into a draft.",
      };
    }

    return redirect(returnTo);
  }

  return { error: "Choose a valid planner action." };
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

export default function Planner({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    employees,
    employeeId,
    weekStart,
    plans,
    items,
    history,
  } = loaderData;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const selectedEmployee = employees.find(
    (employee) => employee.id === employeeId,
  );

  return (
    <main className="planner-page">
      <header className="planner-header">
        <div>
          <Link className="back-link" to="/">
            ← Dashboard
          </Link>
          <p className="eyebrow">CONTENT STRATEGY</p>
          <h1>Weekly content planner</h1>
          <p>
            Generate topic plans, review each idea, and convert only
            approved items into draft shells. Publication always
            remains a separate human-approved step.
          </p>
        </div>
      </header>

      {actionData?.error ? (
        <p className="form-error">{actionData.error}</p>
      ) : null}

      <section className="planner-toolbar panel">
        <div className="week-navigation">
          <Link
            to={`/planner?employee=${employeeId ?? ""}&week=${addDays(weekStart, -7)}`}
          >
            ← Previous
          </Link>
          <strong>
            {weekStart} through {addDays(weekStart, 6)}
          </strong>
          <Link
            to={`/planner?employee=${employeeId ?? ""}&week=${addDays(weekStart, 7)}`}
          >
            Next →
          </Link>
        </div>

        <Form method="get" className="planner-filter">
          <input type="hidden" name="week" value={weekStart} />
          <select name="employee" defaultValue={employeeId ?? ""}>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} — {employee.role_name}
              </option>
            ))}
          </select>
          <button type="submit">View plan</button>
        </Form>
      </section>

      {selectedEmployee ? (
        <section className="planner-layout">
          <aside className="panel planner-generator">
            <h2>Generate a plan</h2>
            <p>
              Target: {selectedEmployee.weekly_original_posts} original
              and {selectedEmployee.weekly_short_posts} short posts.
            </p>
            <Form method="post">
              <input
                type="hidden"
                name="intent"
                value="generate_plan"
              />
              <input
                type="hidden"
                name="employee_id"
                value={selectedEmployee.id}
              />
              <input
                type="hidden"
                name="week_start"
                value={weekStart}
              />
              <label>
                Generated by
                <input
                  name="generated_by"
                  required
                  placeholder="Your name"
                />
              </label>
              <label>
                Optional planning direction
                <textarea
                  name="planning_instructions"
                  rows={5}
                  placeholder="Upcoming event, priority theme, or topic to include…"
                />
              </label>
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? "Working…"
                  : plans.length
                    ? "Generate new version"
                    : "Generate weekly plan"}
              </button>
            </Form>
            <small>
              Uses {PLANNER_MODEL}. A new version supersedes an
              unconverted prior proposal without deleting its audit
              history.
            </small>
          </aside>

          <div className="planner-plans">
            {plans.length ? (
              plans.map((plan) => (
                <section
                  className={`panel plan-version ${plan.status}`}
                  key={plan.id}
                >
                  <div className="plan-version-heading">
                    <div>
                      <p className="eyebrow">
                        VERSION {plan.version}
                      </p>
                      <h2>{plan.employee_name}</h2>
                      <small>
                        Generated by {plan.generated_by} ·{" "}
                        {plan.created_at}
                      </small>
                    </div>
                    <span className={`plan-status ${plan.status}`}>
                      {formatStatus(plan.status)}
                    </span>
                  </div>

                  {plan.planning_instructions ? (
                    <p className="plan-instructions">
                      Direction: {plan.planning_instructions}
                    </p>
                  ) : null}

                  <div className="plan-items">
                    {items
                      .filter(
                        (item) => item.content_plan_id === plan.id,
                      )
                      .map((item) => (
                        <article className="plan-item" key={item.id}>
                          <div className="plan-item-heading">
                            <div>
                              <span>
                                {item.post_format === "short_post"
                                  ? "Short post"
                                  : "Original post"}
                              </span>
                              <h3>{item.topic}</h3>
                            </div>
                            <span
                              className={`plan-status ${item.status}`}
                            >
                              {item.status}
                            </span>
                          </div>
                          <p><strong>Angle:</strong> {item.angle}</p>
                          <p>
                            <strong>Why this fits:</strong>{" "}
                            {item.rationale}
                          </p>
                          <p>
                            <strong>Suggested:</strong>{" "}
                            {item.suggested_scheduled_for} CT
                          </p>

                          {plan.status !== "superseded" &&
                          item.status !== "converted" ? (
                            <Form
                              method="post"
                              className="plan-review-form"
                            >
                              <input
                                type="hidden"
                                name="intent"
                                value="review_item"
                              />
                              <input
                                type="hidden"
                                name="employee_id"
                                value={selectedEmployee.id}
                              />
                              <input
                                type="hidden"
                                name="week_start"
                                value={weekStart}
                              />
                              <input
                                type="hidden"
                                name="item_id"
                                value={item.id}
                              />
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
                                name="next_status"
                                value="approved"
                                disabled={isSubmitting}
                              >
                                Approve
                              </button>
                              <button
                                className="secondary-button"
                                name="next_status"
                                value="rejected"
                                disabled={isSubmitting}
                              >
                                Reject
                              </button>
                            </Form>
                          ) : null}

                          {item.status === "approved" ? (
                            <Form
                              method="post"
                              className="plan-convert-form"
                            >
                              <input
                                type="hidden"
                                name="intent"
                                value="convert_item"
                              />
                              <input
                                type="hidden"
                                name="employee_id"
                                value={selectedEmployee.id}
                              />
                              <input
                                type="hidden"
                                name="week_start"
                                value={weekStart}
                              />
                              <input
                                type="hidden"
                                name="item_id"
                                value={item.id}
                              />
                              <input
                                name="actor_name"
                                required
                                placeholder="Your name"
                              />
                              <button type="submit" disabled={isSubmitting}>
                                Create draft shell
                              </button>
                            </Form>
                          ) : null}

                          {item.content_draft_id ? (
                            <Link
                              className="draft-link"
                              to={`/content/${item.content_draft_id}/edit`}
                            >
                              Open draft #{item.content_draft_id} →
                            </Link>
                          ) : null}

                          <details>
                            <summary>Item history</summary>
                            <div className="plan-history">
                              {history
                                .filter(
                                  (event) =>
                                    event.content_plan_item_id ===
                                    item.id,
                                )
                                .map((event) => (
                                  <p key={event.id}>
                                    {event.actor_name}:{" "}
                                    {event.from_status
                                      ? `${event.from_status} → `
                                      : ""}
                                    {event.to_status}
                                    {event.note
                                      ? ` — ${event.note}`
                                      : ""}
                                  </p>
                                ))}
                            </div>
                          </details>
                        </article>
                      ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="panel empty-state">
                No plan exists for this employee and week.
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="panel empty-state">
          Add an active employee with a playbook before generating a
          weekly plan.
        </div>
      )}
    </main>
  );
}
