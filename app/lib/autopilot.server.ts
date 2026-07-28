import { getSafeOpenAIErrorMessage } from "./aiErrors.server";
import { generateLinkedInPost } from "./generateLinkedInPost.server";

export type AutomationEnvironment = {
  linkedinadam_db: D1Database;
  OPENAI_API_KEY?: string;
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
};

type AutomationTask = {
  id: number;
  automation_run_id: number;
  employee_id: number;
  target_date: string;
  trigger_type: string;
  requested_by: string;
};

type EmployeeContext = {
  name: string;
  role_name: string;
  primary_audience: string | null;
  primary_expertise: string | null;
  content_sources: string | null;
  primary_post_formats: string | null;
  example_topics: string | null;
  positioning_statement: string | null;
  recurring_series: string | null;
  lead_magnet: string | null;
  soft_cta: string | null;
  guardrail: string | null;
  writing_style_prompt: string | null;
};

export function getChicagoDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function enqueueDailyGeneration(
  db: D1Database,
  options: {
    requestedBy: string;
    triggerType: "manual" | "scheduled" | "yolo_start";
    targetDates: string[];
  },
) {
  const run = await db
    .prepare(`
      INSERT INTO automation_runs (
        trigger_type,
        requested_by
      )
      VALUES (?, ?)
      RETURNING id
    `)
    .bind(options.triggerType, options.requestedBy)
    .first<{ id: number }>();

  if (!run) {
    throw new Error("The automation run could not be created.");
  }

  const employees = await db
    .prepare(`
      SELECT e.id
      FROM employees e
      JOIN employee_playbooks ep ON ep.employee_id = e.id
      WHERE e.status = 'active'
      ORDER BY e.id
    `)
    .all<{ id: number }>();
  let taskCount = 0;

  for (const employee of employees.results ?? []) {
    for (const targetDate of options.targetDates) {
      const existing = await db
        .prepare(`
          SELECT id
          FROM content_drafts
          WHERE employee_id = ?
            AND scheduled_for >= ?
            AND scheduled_for < ?
          LIMIT 1
        `)
        .bind(
          employee.id,
          `${targetDate}T00:00`,
          `${addCalendarDays(targetDate, 1)}T00:00`,
        )
        .first<{ id: number }>();

      if (existing) {
        continue;
      }

      const result = await db
        .prepare(`
          INSERT OR IGNORE INTO automation_tasks (
            automation_run_id,
            task_type,
            employee_id,
            target_date,
            idempotency_key
          )
          VALUES (?, 'generate_daily_post', ?, ?, ?)
        `)
        .bind(
          run.id,
          employee.id,
          targetDate,
          `daily-post:${employee.id}:${targetDate}`,
        )
        .run();
      taskCount += result.meta.changes ? 1 : 0;
    }
  }

  await db.batch([
    db
      .prepare(`
        UPDATE automation_runs
        SET
          total_tasks = ?,
          status = CASE WHEN ? = 0 THEN 'completed' ELSE 'queued' END,
          completed_at = CASE
            WHEN ? = 0 THEN CURRENT_TIMESTAMP
            ELSE NULL
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(taskCount, taskCount, taskCount, run.id),
    db
      .prepare(`
        INSERT INTO automation_events (
          automation_run_id,
          event_type,
          actor_name,
          detail
        )
        VALUES (?, 'run_queued', ?, ?)
      `)
      .bind(
        run.id,
        options.requestedBy,
        `${taskCount} daily post task(s) queued.`,
      ),
  ]);

  return { runId: run.id, taskCount };
}

async function getEmployeeContext(
  db: D1Database,
  employeeId: number,
) {
  return db
    .prepare(`
      SELECT
        e.name,
        e.role_name,
        p.primary_audience,
        p.primary_expertise,
        p.content_sources,
        p.primary_post_formats,
        p.example_topics,
        p.positioning_statement,
        p.recurring_series,
        p.lead_magnet,
        p.soft_cta,
        p.guardrail,
        COALESCE(
          e.writing_style_prompt_override,
          p.writing_style_prompt
        ) AS writing_style_prompt
      FROM employees e
      JOIN employee_playbooks ep ON ep.employee_id = e.id
      JOIN playbooks p ON p.id = ep.playbook_id
      WHERE e.id = ? AND e.status = 'active'
    `)
    .bind(employeeId)
    .first<EmployeeContext>();
}

async function finishRun(db: D1Database, runId: number) {
  const counts = await db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE
          WHEN status IN ('completed', 'skipped') THEN 1 ELSE 0
        END) AS completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE
          WHEN status IN ('pending', 'running') THEN 1 ELSE 0
        END) AS remaining
      FROM automation_tasks
      WHERE automation_run_id = ?
    `)
    .bind(runId)
    .first<{
      total: number;
      completed: number;
      failed: number;
      remaining: number;
    }>();

  if (!counts) {
    return;
  }

  const isFinished = counts.remaining === 0;
  const status = isFinished
    ? counts.failed > 0
      ? "completed_with_errors"
      : "completed"
    : "running";

  await db
    .prepare(`
      UPDATE automation_runs
      SET
        status = ?,
        total_tasks = ?,
        completed_tasks = ?,
        failed_tasks = ?,
        completed_at = CASE
          WHEN ? THEN CURRENT_TIMESTAMP
          ELSE completed_at
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(
      status,
      counts.total,
      counts.completed,
      counts.failed,
      isFinished ? 1 : 0,
      runId,
    )
    .run();
}

export async function processAutomationBatch(
  env: AutomationEnvironment,
  runId?: number,
) {
  const db = env.linkedinadam_db;
  const settings = await db
    .prepare("SELECT * FROM automation_settings WHERE id = 1")
    .first<AutomationSettings>();
  const limit = settings?.max_tasks_per_batch ?? 10;
  const conditions = ["t.status = 'pending'"];
  const bindings: number[] = [];

  if (runId) {
    conditions.push("t.automation_run_id = ?");
    bindings.push(runId);
  }

  const tasks = await db
    .prepare(`
      SELECT
        t.id,
        t.automation_run_id,
        t.employee_id,
        t.target_date,
        r.trigger_type,
        r.requested_by
      FROM automation_tasks t
      JOIN automation_runs r ON r.id = t.automation_run_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY t.created_at, t.id
      LIMIT ?
    `)
    .bind(...bindings, limit)
    .all<AutomationTask>();
  const touchedRuns = new Set<number>();

  for (const task of tasks.results ?? []) {
    touchedRuns.add(task.automation_run_id);

    if (task.trigger_type !== "manual") {
      const current = await db
        .prepare(
          "SELECT enabled FROM automation_settings WHERE id = 1",
        )
        .first<{ enabled: number }>();

      if (!current?.enabled) {
        await db
          .prepare(`
            UPDATE automation_tasks
            SET
              status = 'skipped',
              safe_error = 'YOLO Mode was stopped.',
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'
          `)
          .bind(task.id)
          .run();
        continue;
      }
    }

    const lock = await db
      .prepare(`
        UPDATE automation_tasks
        SET
          status = 'running',
          attempt_count = attempt_count + 1,
          started_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'
      `)
      .bind(task.id)
      .run();

    if (!lock.meta.changes) {
      continue;
    }

    try {
      if (!env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured.");
      }

      const existing = await db
        .prepare(`
          SELECT id
          FROM content_drafts
          WHERE employee_id = ?
            AND scheduled_for >= ?
            AND scheduled_for < ?
          LIMIT 1
        `)
        .bind(
          task.employee_id,
          `${task.target_date}T00:00`,
          `${addCalendarDays(task.target_date, 1)}T00:00`,
        )
        .first<{ id: number }>();

      if (existing) {
        await db
          .prepare(`
            UPDATE automation_tasks
            SET
              status = 'skipped',
              result_content_draft_id = ?,
              safe_error = 'A scheduled post already exists.',
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(existing.id, task.id)
          .run();
        continue;
      }

      const employee = await getEmployeeContext(
        db,
        task.employee_id,
      );

      if (!employee) {
        throw new Error(
          "The employee is inactive or has no assigned playbook.",
        );
      }

      const topic =
        `Choose one distinct, useful topic for ${task.target_date} from this approved territory: ` +
        `${employee.example_topics || employee.recurring_series || employee.primary_expertise || "the employee’s professional expertise"}.`;
      const body = await generateLinkedInPost({
        apiKey: env.OPENAI_API_KEY,
        employeeName: employee.name,
        roleName: employee.role_name,
        topic,
        postFormat: "original_post",
        primaryAudience: employee.primary_audience,
        primaryExpertise: employee.primary_expertise,
        contentSources: employee.content_sources,
        primaryPostFormats: employee.primary_post_formats,
        exampleTopics: employee.example_topics,
        positioningStatement: employee.positioning_statement,
        recurringSeries: employee.recurring_series,
        leadMagnet: employee.lead_magnet,
        softCta: employee.soft_cta,
        guardrail: employee.guardrail,
        writingStylePrompt: employee.writing_style_prompt,
      });
      const shouldApprove =
        task.trigger_type !== "manual" &&
        Boolean(settings?.auto_approve_posts);
      const draft = await db
        .prepare(`
          INSERT INTO content_drafts (
            employee_id,
            title,
            body,
            post_format,
            topic,
            status,
            scheduled_for,
            approved_at
          )
          VALUES (?, ?, ?, 'original_post', ?, ?, ?, ?)
          RETURNING id
        `)
        .bind(
          task.employee_id,
          `Daily post · ${task.target_date}`,
          body,
          employee.recurring_series || employee.primary_expertise,
          shouldApprove ? "approved" : "draft",
          `${task.target_date}T09:00`,
          shouldApprove ? new Date().toISOString() : null,
        )
        .first<{ id: number }>();

      if (!draft) {
        throw new Error("The generated draft could not be saved.");
      }

      const statements: D1PreparedStatement[] = [
        db
          .prepare(`
            INSERT INTO content_schedule_history (
              content_draft_id,
              previous_scheduled_for,
              scheduled_for,
              changed_by,
              change_note
            )
            VALUES (?, NULL, ?, ?, ?)
          `)
          .bind(
            draft.id,
            `${task.target_date}T09:00`,
            task.requested_by,
            "Created by daily content automation",
          ),
        db
          .prepare(`
            UPDATE automation_tasks
            SET
              status = 'completed',
              result_content_draft_id = ?,
              safe_error = NULL,
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(draft.id, task.id),
        db
          .prepare(`
            INSERT INTO automation_events (
              automation_run_id,
              automation_task_id,
              event_type,
              actor_name,
              detail
            )
            VALUES (?, ?, 'post_generated', ?, ?)
          `)
          .bind(
            task.automation_run_id,
            task.id,
            task.requested_by,
            shouldApprove
              ? `Draft ${draft.id} generated and auto-approved.`
              : `Draft ${draft.id} generated for review.`,
          ),
      ];

      if (shouldApprove) {
        statements.push(
          db
            .prepare(`
              INSERT INTO content_review_history (
                content_draft_id,
                from_status,
                to_status,
                reviewer_name,
                review_note
              )
              VALUES (?, 'draft', 'approved', ?, ?)
            `)
            .bind(
              draft.id,
              `YOLO Mode (${settings?.started_by || task.requested_by})`,
              "Automatically approved under active YOLO Mode.",
            ),
        );
      }

      await db.batch(statements);
    } catch (error) {
      const safeError =
        error instanceof Error &&
        (
          error.message.includes("inactive") ||
          error.message.includes("configured") ||
          error.message.includes("could not be saved")
        )
          ? error.message
          : getSafeOpenAIErrorMessage(error, "post");

      console.error(
        "Automation task failed.",
        error instanceof Error ? error.name : "unknown",
      );
      await db.batch([
        db
          .prepare(`
            UPDATE automation_tasks
            SET
              status = 'failed',
              safe_error = ?,
              completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(safeError, task.id),
        db
          .prepare(`
            INSERT INTO automation_events (
              automation_run_id,
              automation_task_id,
              event_type,
              actor_name,
              detail
            )
            VALUES (?, ?, 'task_failed', ?, ?)
          `)
          .bind(
            task.automation_run_id,
            task.id,
            task.requested_by,
            safeError,
          ),
      ]);
    }
  }

  for (const touchedRun of touchedRuns) {
    await finishRun(db, touchedRun);
  }
}

async function approveConnectionRecommendations(
  db: D1Database,
  settings: AutomationSettings,
) {
  if (!settings.auto_approve_connections) {
    return 0;
  }

  const employees = await db
    .prepare(`
      SELECT DISTINCT employee_id
      FROM connection_recommendations
      WHERE status = 'recommended' AND score >= ?
    `)
    .bind(settings.connection_score_threshold)
    .all<{ employee_id: number }>();
  let approved = 0;

  for (const employee of employees.results ?? []) {
    const weeklyCount = await db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM connection_recommendation_events ev
        JOIN connection_recommendations r
          ON r.id = ev.recommendation_id
        WHERE r.employee_id = ?
          AND ev.to_status = 'approved'
          AND ev.created_at >= DATETIME('now', '-7 days')
      `)
      .bind(employee.employee_id)
      .first<{ count: number }>();
    const remaining = Math.max(
      0,
      settings.weekly_connection_limit - (weeklyCount?.count ?? 0),
    );

    if (!remaining) {
      continue;
    }

    const candidates = await db
      .prepare(`
        SELECT id
        FROM connection_recommendations
        WHERE employee_id = ?
          AND status = 'recommended'
          AND score >= ?
        ORDER BY score DESC, created_at
        LIMIT ?
      `)
      .bind(
        employee.employee_id,
        settings.connection_score_threshold,
        Math.min(remaining, settings.max_tasks_per_batch),
      )
      .all<{ id: number }>();
    const actor = `YOLO Mode (${settings.started_by || "system"})`;
    const statements: D1PreparedStatement[] = [];

    for (const candidate of candidates.results ?? []) {
      statements.push(
        db
          .prepare(`
            UPDATE connection_recommendations
            SET
              status = 'approved',
              reviewed_by = ?,
              review_note = ?,
              reviewed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'recommended'
          `)
          .bind(
            actor,
            `Auto-approved at score threshold ${settings.connection_score_threshold}.`,
            candidate.id,
          ),
        db
          .prepare(`
            INSERT INTO connection_recommendation_events (
              recommendation_id,
              from_status,
              to_status,
              actor_name,
              note
            )
            VALUES (?, 'recommended', 'approved', ?, ?)
          `)
          .bind(
            candidate.id,
            actor,
            `YOLO Mode score threshold: ${settings.connection_score_threshold}.`,
          ),
      );
      approved += 1;
    }

    if (statements.length) {
      await db.batch(statements);
    }
  }

  return approved;
}

export async function runAutopilotCycle(
  env: AutomationEnvironment,
) {
  const settings = await env.linkedinadam_db
    .prepare("SELECT * FROM automation_settings WHERE id = 1")
    .first<AutomationSettings>();

  if (!settings?.enabled) {
    return;
  }

  const today = getChicagoDate();
  const dates = [
    settings.generate_today ? today : null,
    settings.generate_tomorrow ? addCalendarDays(today, 1) : null,
  ].filter((value): value is string => Boolean(value));
  if (dates.length) {
    await env.linkedinadam_db
      .prepare(`
        UPDATE automation_tasks
        SET
          status = 'pending',
          safe_error = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE status = 'failed'
          AND attempt_count < 3
          AND target_date IN (${dates.map(() => "?").join(", ")})
      `)
      .bind(...dates)
      .run();
  }
  const pending = await env.linkedinadam_db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM automation_tasks
      WHERE status = 'pending'
    `)
    .first<{ count: number }>();

  if (pending?.count) {
    await processAutomationBatch(env);
  } else {
    let missing = false;

    for (const targetDate of dates) {
      const row = await env.linkedinadam_db
        .prepare(`
          SELECT e.id
          FROM employees e
          JOIN employee_playbooks ep ON ep.employee_id = e.id
          WHERE e.status = 'active'
            AND NOT EXISTS (
              SELECT 1
              FROM content_drafts c
              WHERE c.employee_id = e.id
                AND c.scheduled_for >= ?
                AND c.scheduled_for < ?
            )
            AND NOT EXISTS (
              SELECT 1
              FROM automation_tasks t
              WHERE t.idempotency_key =
                'daily-post:' || e.id || ':' || ?
            )
          LIMIT 1
        `)
        .bind(
          `${targetDate}T00:00`,
          `${addCalendarDays(targetDate, 1)}T00:00`,
          targetDate,
        )
        .first<{ id: number }>();
      missing ||= Boolean(row);
    }

    if (missing) {
      const queued = await enqueueDailyGeneration(
        env.linkedinadam_db,
        {
          requestedBy: `YOLO Mode (${settings.started_by || "system"})`,
          triggerType: "scheduled",
          targetDates: dates,
        },
      );
      await processAutomationBatch(env, queued.runId);
    }
  }

  await approveConnectionRecommendations(
    env.linkedinadam_db,
    settings,
  );
}
