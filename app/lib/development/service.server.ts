import { isPrivilegedDevelopmentUser } from "../auth.server";
import { DEVELOPMENT_STATUSES, type DevelopmentActor, type DevelopmentStatus } from "./types";
import { insertActivity, insertDevelopmentRequest } from "./repository.server";

function assertRequired(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

export function assertCanWriteDevelopment(actor: DevelopmentActor) {
  if (!isPrivilegedDevelopmentUser(actor)) {
    throw new Response("A developer, admin, or owner role is required.", { status: 403 });
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
  },
) {
  assertCanWriteDevelopment(actor);
  const title = assertRequired(input.title, "Title");
  const id = crypto.randomUUID();

  await db.batch([
    insertDevelopmentRequest(db, {
      id,
      title,
      problem: input.problem,
      whyDecision: input.whyDecision,
      priority: input.priority,
      type: input.type,
      productArea: input.productArea,
      requestedByType: "human",
      requestedByName: actor.displayName,
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
  ]);

  return id;
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
    db.prepare(`
      INSERT INTO development_approvals (
        development_request_id, stage, actor_email, actor_name, decision, notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(requestId, stage, actor.email, actor.displayName, decision, input.notes || null),
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
    db.prepare(`
      UPDATE development_requests
      SET overall_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(input.status, requestId),
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
