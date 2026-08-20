import { isPrivilegedDevelopmentUser } from "../auth.server";
import {
  DEVELOPMENT_PRIORITIES,
  DEVELOPMENT_STATUSES,
  DEVELOPMENT_TYPES,
  QA_STAGES,
  type DevelopmentActor,
  type DevelopmentStatus,
  type QaStage,
} from "./types";
import { insertActivity, insertDevelopmentRequest } from "./repository.server";

function assertRequired(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

export function assertCanWriteDevelopment(actor: DevelopmentActor) {
  if (!isPrivilegedDevelopmentUser(actor)) {
    throw new Response("A developer, admin, or owner role is required.", {
      status: 403,
    });
  }
}

export async function createDevelopmentRequest(
  db: D1Database,
  actor: DevelopmentActor,
  input: {
    title: string;
    problem?: string;
    whyDecision?: string;
    priority: string;
    type: string;
    productArea?: string;
    ownerEmail?: string;
    qaPartnerEmail?: string;
    notes?: string;
    requestedBy?: string;
    issueUrl?: string;
    prUrl?: string;
    branch?: string;
  },
) {
  assertCanWriteDevelopment(actor);
  const title = assertRequired(input.title, "Title");
  const id = crypto.randomUUID();

  const statements = [
    insertDevelopmentRequest(db, {
      id,
      title,
      problem: input.problem,
      whyDecision: input.whyDecision,
      priority: input.priority,
      type: input.type,
      productArea: input.productArea,
      requestedByType: "human",
      requestedByName: input.requestedBy?.trim() || actor.displayName,
      ownerEmail: input.ownerEmail,
      qaPartnerEmail: input.qaPartnerEmail,
      notes: input.notes,
    }),
    insertActivity(db, {
      actorType: "HUMAN",
      actorIdentity: actor.email,
      eventType: "development_request_created",
      requestId: id,
      summary: `${actor.displayName} created “${title}”.`,
    }),
  ];
  for (const [type, value] of [
    ["issue", input.issueUrl],
    ["pull_request", input.prUrl],
  ] as const) {
    if (value?.trim())
      statements.push(
        db
          .prepare(
            "INSERT INTO development_links (development_request_id, provider, type, external_id, url, metadata_json) VALUES (?, 'manual', ?, ?, ?, ?)",
          )
          .bind(
            id,
            type,
            crypto.randomUUID(),
            value.trim(),
            JSON.stringify({ branch: input.branch?.trim() || null }),
          ) as never,
      );
  }
  await db.batch(statements);

  return id;
}

export async function updateDevelopmentRequest(
  db: D1Database,
  actor: DevelopmentActor,
  input: {
    requestId: string;
    title: string;
    priority: string;
    type: string;
    productArea?: string;
    requestedBy?: string;
    ownerEmail?: string;
    qaPartnerEmail?: string;
    problem?: string;
    whyDecision?: string;
    notes?: string;
  },
) {
  assertCanWriteDevelopment(actor);
  const requestId = assertRequired(input.requestId, "Request ID");
  const title = assertRequired(input.title, "Title");
  if (!DEVELOPMENT_PRIORITIES.includes(input.priority as never))
    throw new Error("Invalid priority.");
  if (!DEVELOPMENT_TYPES.includes(input.type as never))
    throw new Error("Invalid request type.");
  const statements = [
    db
      .prepare(
        `UPDATE development_requests SET title=?, priority=?, type=?, product_area=?, requested_by_name=?, owner_email=?, qa_partner_email=?, problem=?, why_decision=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      )
      .bind(
        title,
        input.priority,
        input.type,
        input.productArea?.trim() || null,
        input.requestedBy?.trim() || actor.displayName,
        input.ownerEmail?.trim() || null,
        input.qaPartnerEmail?.trim() || null,
        input.problem?.trim() || null,
        input.whyDecision?.trim() || null,
        input.notes?.trim() || null,
        requestId,
      ),
    insertActivity(db, {
      actorType: "HUMAN",
      actorIdentity: actor.email,
      eventType: "development_request_updated",
      requestId,
      summary: `${actor.displayName} updated the request details.`,
    }),
  ];
  await db.batch(statements);
}

const QA_TRANSITIONS: Record<string, DevelopmentStatus> = {
  ADAM_QA_ready: "awaiting_adam",
  ADAM_QA_passed: "awaiting_joe",
  ADAM_QA_failed: "blocked",
  JOE_QA_ready: "awaiting_joe",
  JOE_QA_passed: "awaiting_mutual_approval",
  JOE_QA_failed: "blocked",
  MUTUAL_APPROVAL_approved: "ready_for_dev",
  MUTUAL_APPROVAL_failed: "blocked",
  DEV_QA_passed: "ready_for_main",
  DEV_QA_failed: "blocked",
  MAIN_VERIFICATION_passed: "verified",
  MAIN_VERIFICATION_failed: "blocked",
};

export async function recordQaAction(
  db: D1Database,
  actor: DevelopmentActor,
  input: {
    requestId: string;
    stage: string;
    outcome: "ready" | "passed" | "failed" | "approved";
    notes?: string;
  },
) {
  assertCanWriteDevelopment(actor);
  const requestId = assertRequired(input.requestId, "Request ID");
  const allowedStages = [...QA_STAGES, "MUTUAL_APPROVAL"];
  if (!allowedStages.includes(input.stage as QaStage))
    throw new Error("Invalid QA stage.");
  if (!["ready", "passed", "failed", "approved"].includes(input.outcome))
    throw new Error("Invalid QA outcome.");
  if (input.outcome === "failed" && !input.notes?.trim())
    throw new Error("A failure note is required.");
  const status = QA_TRANSITIONS[`${input.stage}_${input.outcome}`];
  if (!status) throw new Error("That QA action is not valid for this stage.");
  const decision =
    input.outcome === "failed"
      ? "rejected"
      : input.outcome === "ready"
        ? null
        : "approved";
  const statements = [
    db
      .prepare(
        "UPDATE development_requests SET overall_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .bind(status, requestId),
    insertActivity(db, {
      actorType: "HUMAN",
      actorIdentity: actor.email,
      eventType: "development_qa_action",
      requestId,
      summary: `${actor.displayName} marked ${input.stage.replaceAll("_", " ")} ${input.outcome}.`,
      metadata: {
        stage: input.stage,
        outcome: input.outcome,
        note: input.notes?.trim() || null,
      },
    }),
  ];
  if (decision)
    statements.push(
      db
        .prepare(
          "INSERT INTO development_approvals (development_request_id, stage, actor_email, actor_name, decision, notes) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          requestId,
          input.stage,
          actor.email,
          actor.displayName,
          decision,
          input.notes?.trim() || null,
        ) as never,
    );
  await db.batch(statements);
}

export async function saveQaHandoff(
  db: D1Database,
  actor: DevelopmentActor,
  input: {
    requestId: string;
    stage: string;
    testUser?: string;
    tenant?: string;
    loginUrl?: string;
    testUrl?: string;
    navigation?: string;
    prerequisites?: string;
    testSteps?: string;
    expectedResult?: string;
    automatedCoverage?: string;
    notes?: string;
    status?: string;
  },
) {
  assertCanWriteDevelopment(actor);
  const requestId = assertRequired(input.requestId, "Request ID");
  if (!QA_STAGES.includes(input.stage as QaStage))
    throw new Error("Invalid QA handoff stage.");
  const status = input.status || "pending";
  if (
    ![
      "pending",
      "in_progress",
      "passed",
      "failed",
      "blocked",
      "not_applicable",
    ].includes(status)
  )
    throw new Error("Invalid handoff status.");
  const verified = status === "passed";
  await db.batch([
    db
      .prepare(
        `INSERT INTO qa_handoffs (development_request_id, stage, test_user, tenant, login_url, test_url, navigation, prerequisites, test_steps, expected_result, automated_coverage, notes, status, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(development_request_id, stage) DO UPDATE SET test_user=excluded.test_user, tenant=excluded.tenant, login_url=excluded.login_url, test_url=excluded.test_url, navigation=excluded.navigation, prerequisites=excluded.prerequisites, test_steps=excluded.test_steps, expected_result=excluded.expected_result, automated_coverage=excluded.automated_coverage, notes=excluded.notes, status=excluded.status, verified_by=excluded.verified_by, verified_at=excluded.verified_at, updated_at=CURRENT_TIMESTAMP`,
      )
      .bind(
        requestId,
        input.stage,
        input.testUser?.trim() || null,
        input.tenant?.trim() || null,
        input.loginUrl?.trim() || null,
        input.testUrl?.trim() || null,
        input.navigation?.trim() || null,
        input.prerequisites?.trim() || null,
        input.testSteps?.trim() || null,
        input.expectedResult?.trim() || null,
        input.automatedCoverage?.trim() || null,
        input.notes?.trim() || null,
        status,
        verified ? actor.email : null,
        verified ? new Date().toISOString() : null,
      ),
    insertActivity(db, {
      actorType: "HUMAN",
      actorIdentity: actor.email,
      eventType: "qa_handoff_saved",
      requestId,
      summary: `${actor.displayName} saved the ${input.stage.replaceAll("_", " ")} handoff.`,
      metadata: { stage: input.stage, status },
    }),
  ]);
}

export async function recordDevelopmentApproval(
  db: D1Database,
  actor: DevelopmentActor,
  input: {
    requestId: string;
    stage: string;
    decision: string;
    notes?: string;
  },
) {
  assertCanWriteDevelopment(actor);
  const requestId = assertRequired(input.requestId, "Request ID");
  const decision = assertRequired(input.decision, "Decision");
  const stage = assertRequired(input.stage, "Stage");

  await db.batch([
    db
      .prepare(
        `
      INSERT INTO development_approvals (
        development_request_id, stage, actor_email, actor_name, decision, notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        requestId,
        stage,
        actor.email,
        actor.displayName,
        decision,
        input.notes || null,
      ),
    insertActivity(db, {
      actorType: "HUMAN",
      actorIdentity: actor.email,
      eventType: "development_approval_recorded",
      requestId,
      summary: `${actor.displayName} recorded ${decision} for ${stage}.`,
      metadata: { stage, decision },
    }),
  ]);
}

export async function transitionDevelopmentStatus(
  db: D1Database,
  actor: DevelopmentActor,
  input: { requestId: string; status: DevelopmentStatus; notes?: string },
) {
  assertCanWriteDevelopment(actor);
  const requestId = assertRequired(input.requestId, "Request ID");
  if (!DEVELOPMENT_STATUSES.includes(input.status)) {
    throw new Error("Invalid development status.");
  }

  await db.batch([
    db
      .prepare(
        `
      UPDATE development_requests
      SET overall_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      )
      .bind(input.status, requestId),
    insertActivity(db, {
      actorType: "HUMAN",
      actorIdentity: actor.email,
      eventType: "development_status_changed",
      requestId,
      summary: `${actor.displayName} moved the request to ${input.status}.`,
      metadata: { status: input.status, notes: input.notes || null },
    }),
  ]);
}
