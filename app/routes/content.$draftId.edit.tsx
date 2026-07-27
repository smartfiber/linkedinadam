import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/content.$draftId.edit";
import {
  normalizeScheduledFor,
} from "../lib/contentWorkflow";
import { findScheduleConflict } from "../lib/contentWorkflow.server";

type AppEnvironment = {
  linkedinadam_db: D1Database;
};

type ContentDraft = {
  id: number;
  employee_id: number;
  employee_name: string;
  title: string | null;
  body: string;
  post_format: string | null;
  topic: string | null;
  status: string;
  scheduled_for: string | null;
};

type EmployeeOption = {
  id: number;
  name: string;
};

function formatDateTimeLocal(value: string | null) {
  if (!value) {
    return "";
  }

  return value.replace(" ", "T").slice(0, 16);
}

export async function loader({
  params,
  context,
}: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const draftId = Number(params.draftId);

  if (!Number.isInteger(draftId)) {
    throw new Response("Invalid draft ID", { status: 400 });
  }

  const draft = await env.linkedinadam_db
    .prepare(`
      SELECT
        c.id,
        c.employee_id,
        e.name AS employee_name,
        c.title,
        c.body,
        c.post_format,
        c.topic,
        c.status,
        c.scheduled_for
      FROM content_drafts c
      JOIN employees e
        ON e.id = c.employee_id
      WHERE c.id = ?
    `)
    .bind(draftId)
    .first<ContentDraft>();

  if (!draft) {
    throw new Response("Content draft not found", {
      status: 404,
    });
  }

  const employeeQuery = await env.linkedinadam_db
    .prepare(`
      SELECT id, name
      FROM employees
      WHERE status = 'active'
      ORDER BY name ASC
    `)
    .all<EmployeeOption>();

  return {
    draft,
    employees: employeeQuery.results ?? [],
  };
}

export async function action({
  request,
  params,
  context,
}: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const draftId = Number(params.draftId);
  const formData = await request.formData();

  if (!Number.isInteger(draftId)) {
    throw new Response("Invalid draft ID", { status: 400 });
  }

  const existingDraft = await env.linkedinadam_db
    .prepare(`
      SELECT id, status, scheduled_for
      FROM content_drafts
      WHERE id = ?
    `)
    .bind(draftId)
    .first<{
      id: number;
      status: string;
      scheduled_for: string | null;
    }>();

  if (!existingDraft) {
    throw new Response("Content draft not found", {
      status: 404,
    });
  }

  if (existingDraft.status !== "draft") {
    return {
      error:
        "Only content that is still in draft status can be edited.",
    };
  }

  const employeeId = Number(formData.get("employee_id"));
  const title = String(formData.get("title") ?? "").trim();
  const topic = String(formData.get("topic") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const postFormat = String(
    formData.get("post_format") ?? "",
  );
  const scheduleChangedBy = String(
    formData.get("schedule_changed_by") ?? "",
  ).trim();
  const scheduleChangeNote = String(
    formData.get("schedule_change_note") ?? "",
  ).trim();
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

  if (!Number.isInteger(employeeId)) {
    return {
      error: "Select a valid employee.",
    };
  }

  if (!body) {
    return {
      error: "Post content is required.",
    };
  }

  if (!["original_post", "short_post"].includes(postFormat)) {
    return {
      error: "Select a valid post format.",
    };
  }

  const employee = await env.linkedinadam_db
    .prepare(`
      SELECT id
      FROM employees
      WHERE id = ?
    `)
    .bind(employeeId)
    .first<{ id: number }>();

  if (!employee) {
    return {
      error: "The selected employee could not be found.",
    };
  }

  const scheduleConflict = await findScheduleConflict(
    env.linkedinadam_db,
    employeeId,
    scheduledFor,
    draftId,
  );

  if (scheduleConflict) {
    return {
      error:
        `This employee already has “${scheduleConflict.title || "Untitled post"}” scheduled within 30 minutes of that time.`,
    };
  }

  const updateDraft = env.linkedinadam_db
    .prepare(`
        UPDATE content_drafts
        SET
          employee_id = ?,
          title = ?,
          body = ?,
          post_format = ?,
          topic = ?,
          scheduled_for = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'draft'
      `)
    .bind(
      employeeId,
      title || null,
      body,
      postFormat,
      topic || null,
      scheduledFor,
      draftId,
    );

  if (existingDraft.scheduled_for !== scheduledFor) {
    if (!scheduleChangedBy) {
      return {
        error: "Your name is required when changing the schedule.",
      };
    }

    await env.linkedinadam_db.batch([
      updateDraft,
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
          existingDraft.scheduled_for,
          scheduledFor,
          scheduleChangedBy,
          scheduleChangeNote || null,
        ),
    ]);
  } else {
    await updateDraft.run();
  }

  return redirect("/#content");
}

export default function EditContentDraft({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { draft, employees } = loaderData;
  const isLocked = draft.status !== "draft";

  return (
    <main className="edit-page">
      <div className="edit-shell">
        <Link className="back-link" to="/#content">
          ← Back to content queue
        </Link>

        <section className="panel edit-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CONTENT WORKFLOW</p>
              <h1>Edit draft</h1>
              <p>
                Revise the employee, format, topic, schedule,
                and post copy before approval.
              </p>
            </div>

            <span className={`draft-status ${draft.status}`}>
              {draft.status}
            </span>
          </div>

          {isLocked ? (
            <div className="locked-content-message">
              <strong>This content is locked.</strong>
              <p>
                Approved or published posts cannot be edited from
                this screen.
              </p>
            </div>
          ) : (
            <Form method="post" className="content-edit-form">
              <label>
                Employee
                <select
                  name="employee_id"
                  defaultValue={draft.employee_id.toString()}
                  required
                >
                  {employees.map((employee) => (
                    <option
                      key={employee.id}
                      value={employee.id}
                    >
                      {employee.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Post format
                <select
                  name="post_format"
                  defaultValue={
                    draft.post_format ?? "original_post"
                  }
                >
                  <option value="original_post">
                    Original post
                  </option>
                  <option value="short_post">
                    Short post
                  </option>
                </select>
              </label>

              <label>
                Internal title
                <input
                  name="title"
                  type="text"
                  defaultValue={draft.title ?? ""}
                />
              </label>

              <label>
                Topic
                <input
                  name="topic"
                  type="text"
                  defaultValue={draft.topic ?? ""}
                />
              </label>

              <label>
                Schedule
                <input
                  name="scheduled_for"
                  type="datetime-local"
                  defaultValue={formatDateTimeLocal(
                    draft.scheduled_for,
                  )}
                />
              </label>

              <label>
                Schedule changed by
                <input
                  name="schedule_changed_by"
                  type="text"
                  defaultValue="Adam Copenhaver"
                />
              </label>

              <label>
                Schedule change note
                <input
                  name="schedule_change_note"
                  type="text"
                  placeholder="Optional reason for the schedule change"
                />
              </label>

              <label className="content-edit-body">
                Post content
                <textarea
                  name="body"
                  rows={14}
                  defaultValue={draft.body}
                  required
                />
              </label>

              {actionData?.error ? (
                <p className="form-error">
                  {actionData.error}
                </p>
              ) : null}

              <div className="form-actions">
                <button type="submit">
                  Save draft changes
                </button>

                <Link className="cancel-link" to="/#content">
                  Cancel
                </Link>
              </div>
            </Form>
          )}
        </section>
      </div>
    </main>
  );
}
