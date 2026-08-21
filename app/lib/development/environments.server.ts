import type { DevelopmentActor } from "./types";
import { assertCanWriteDevelopment, recordQaAction } from "./service.server";
import { insertActivity } from "./repository.server";
import type { EnvironmentQaRow } from "./environments";

export type DevelopmentEnvironmentRecord = {
  id: number;
  slug: string;
  name: string;
  owner_name: string;
  environment_type: string;
  qa_stage: string;
  base_url: string;
  purpose: string | null;
  active: number;
  sort_order: number;
  current_qa_workload: number;
  last_verification: string | null;
};

export async function listDevelopmentEnvironments(db: D1Database) {
  return db
    .prepare(
      `
    SELECT e.*,
      CASE e.slug
        WHEN 'adam' THEN (SELECT COUNT(*) FROM development_requests r WHERE r.overall_status = 'awaiting_adam' OR EXISTS (SELECT 1 FROM environment_qa_attempts a WHERE a.development_request_id=r.id AND a.environment_id=e.id AND a.status='failed' AND a.id=(SELECT MAX(a2.id) FROM environment_qa_attempts a2 WHERE a2.development_request_id=r.id AND a2.environment_id=e.id)))
        WHEN 'joe' THEN (SELECT COUNT(*) FROM development_requests r WHERE r.overall_status = 'awaiting_joe' OR EXISTS (SELECT 1 FROM environment_qa_attempts a WHERE a.development_request_id=r.id AND a.environment_id=e.id AND a.status='failed' AND a.id=(SELECT MAX(a2.id) FROM environment_qa_attempts a2 WHERE a2.development_request_id=r.id AND a2.environment_id=e.id)))
        ELSE 0
      END AS current_qa_workload,
      (SELECT MAX(a.tested_at) FROM environment_qa_attempts a WHERE a.environment_id=e.id AND a.status='passed') AS last_verification
    FROM development_environments e
    WHERE e.active=1
    ORDER BY e.sort_order, e.name
  `,
    )
    .all<DevelopmentEnvironmentRecord>();
}

export async function listEnvironmentQaQueue(db: D1Database) {
  return db
    .prepare(
      `
    SELECT r.id AS request_id, r.external_key, r.title, r.priority, r.overall_status,
      e.id AS environment_id, e.slug AS environment_slug, e.name AS environment_name,
      e.owner_name, e.base_url,
      e.qa_stage AS stage,
      q.id AS handoff_id, q.test_url AS test_path, q.test_user, q.navigation, q.prerequisites,
      q.test_steps, q.expected_result, q.automated_coverage,
      COALESCE(latest.status,
        CASE
          WHEN e.slug='adam' AND r.overall_status='awaiting_adam' THEN 'ready_to_test'
          WHEN e.slug='joe' AND r.overall_status='awaiting_joe' THEN 'ready_to_test'
          ELSE 'not_ready'
        END) AS qa_status,
      latest.tester_email, latest.tester_name, latest.tested_at, latest.notes AS qa_notes
    FROM development_requests r
    CROSS JOIN development_environments e
    LEFT JOIN qa_handoffs q ON q.development_request_id=r.id
      AND q.stage=e.qa_stage
    LEFT JOIN environment_qa_attempts latest ON latest.id=(
      SELECT MAX(a.id) FROM environment_qa_attempts a
      WHERE a.development_request_id=r.id AND a.environment_id=e.id)
    WHERE e.active=1 AND (
      (e.slug='adam' AND (r.overall_status='awaiting_adam' OR latest.status='failed')) OR
      (e.slug='joe' AND (r.overall_status='awaiting_joe' OR latest.status='failed')) OR
      r.overall_status='ready_for_dev'
    )
    ORDER BY CASE r.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      r.updated_at DESC, e.sort_order
  `,
    )
    .all<EnvironmentQaRow>();
}

export async function environmentQaForRequest(
  db: D1Database,
  requestId: string,
) {
  const result = await listEnvironmentQaQueueForRequest(db, requestId);
  return result.results || [];
}

function listEnvironmentQaQueueForRequest(db: D1Database, requestId: string) {
  return db
    .prepare(
      `
    SELECT r.id AS request_id, r.external_key, r.title, r.priority, r.overall_status,
      e.id AS environment_id, e.slug AS environment_slug, e.name AS environment_name,
      e.owner_name, e.base_url,
      e.qa_stage AS stage,
      q.id AS handoff_id, q.test_url AS test_path, q.test_user, q.navigation, q.prerequisites,
      q.test_steps, q.expected_result, q.automated_coverage,
      COALESCE(latest.status,
        CASE
          WHEN e.slug='adam' AND r.overall_status='awaiting_adam' THEN 'ready_to_test'
          WHEN e.slug='joe' AND r.overall_status='awaiting_joe' THEN 'ready_to_test'
          ELSE 'not_ready'
        END) AS qa_status,
      latest.tester_email, latest.tester_name, latest.tested_at, latest.notes AS qa_notes
    FROM development_requests r
    CROSS JOIN development_environments e
    LEFT JOIN qa_handoffs q ON q.development_request_id=r.id
      AND q.stage=e.qa_stage
    LEFT JOIN environment_qa_attempts latest ON latest.id=(SELECT MAX(a.id) FROM environment_qa_attempts a WHERE a.development_request_id=r.id AND a.environment_id=e.id)
    WHERE r.id=? AND e.active=1
    ORDER BY e.sort_order
  `,
    )
    .bind(requestId)
    .all<EnvironmentQaRow>();
}

export async function getEnvironmentQaSummary(db: D1Database) {
  const result = await db
    .prepare(
      `
    SELECT
      SUM(CASE WHEN r.overall_status='awaiting_adam' THEN 1 ELSE 0 END) AS needs_adam,
      SUM(CASE WHEN r.overall_status='awaiting_joe' THEN 1 ELSE 0 END) AS needs_joe,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM environment_qa_attempts a WHERE a.development_request_id=r.id AND a.status='failed' AND a.id=(SELECT MAX(a2.id) FROM environment_qa_attempts a2 WHERE a2.development_request_id=r.id AND a2.environment_id=a.environment_id)) THEN 1 ELSE 0 END) AS failed_retest,
      SUM(CASE WHEN r.overall_status='ready_for_dev' THEN 1 ELSE 0 END) AS ready_for_dev
    FROM development_requests r
  `,
    )
    .first<{
      needs_adam: number;
      needs_joe: number;
      failed_retest: number;
      ready_for_dev: number;
    }>();
  return {
    needsAdam: result?.needs_adam || 0,
    needsJoe: result?.needs_joe || 0,
    failedRetest: result?.failed_retest || 0,
    readyForDev: result?.ready_for_dev || 0,
  };
}

export async function recordEnvironmentQaAttempt(
  db: D1Database,
  actor: DevelopmentActor,
  input: {
    requestId: string;
    environmentId: number;
    stage: string;
    status: string;
    notes?: string;
  },
) {
  assertCanWriteDevelopment(actor);
  if (!input.requestId) throw new Error("Development Request is required.");
  if (!Number.isInteger(input.environmentId) || input.environmentId < 1)
    throw new Error("Environment is required.");
  if (
    !["ADAM_QA", "JOE_QA", "DEV_QA", "MAIN_VERIFICATION"].includes(input.stage)
  )
    throw new Error("Invalid QA stage.");
  if (
    !["not_ready", "ready_to_test", "testing", "passed", "failed"].includes(
      input.status,
    )
  )
    throw new Error("Invalid environment QA status.");
  if (input.status === "failed" && !input.notes?.trim())
    throw new Error("A failure note is required.");

  const selectedEnvironment = await db
    .prepare(
      "SELECT qa_stage FROM development_environments WHERE id=? AND active=1",
    )
    .bind(input.environmentId)
    .first<{ qa_stage: string }>();
  if (!selectedEnvironment) throw new Error("Environment is unavailable.");
  if (input.stage !== selectedEnvironment.qa_stage)
    throw new Error("QA stage does not match the selected environment.");

  const handoff = await db
    .prepare(
      "SELECT id FROM qa_handoffs WHERE development_request_id=? AND stage=?",
    )
    .bind(input.requestId, input.stage)
    .first<{ id: number }>();
  await db.batch([
    db
      .prepare(
        `INSERT INTO environment_qa_attempts
      (development_request_id, environment_id, qa_handoff_id, stage, status, tester_email, tester_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.requestId,
        input.environmentId,
        handoff?.id || null,
        input.stage,
        input.status,
        actor.email,
        actor.displayName,
        input.notes?.trim() || null,
      ),
    insertActivity(db, {
      actorType: "HUMAN",
      actorIdentity: actor.email,
      eventType: "environment_qa_recorded",
      requestId: input.requestId,
      summary: `${actor.displayName} recorded ${input.stage.replaceAll("_", " ")} as ${input.status.replaceAll("_", " ")}.`,
      metadata: {
        environmentId: input.environmentId,
        stage: input.stage,
        status: input.status,
      },
    }),
  ]);
  if (input.status === "passed" || input.status === "failed") {
    await recordQaAction(db, actor, {
      requestId: input.requestId,
      stage: input.stage,
      outcome: input.status,
      notes: input.notes,
    });
  }
}
