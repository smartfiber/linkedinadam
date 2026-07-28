import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/employees.$employeeId";

type AppEnvironment = {
  linkedinadam_db: D1Database;
  LINKEDIN_IMAGES: R2Bucket;
};

type Employee = {
  id: number;
  name: string;
  email: string | null;
  linkedin_profile_url: string | null;
  role_name: string;
  status: string;
  playbook_id: number | null;
  writing_style_prompt_override: string | null;
};

type Playbook = {
  id: number;
  role_name: string;
  primary_audience: string | null;
  recurring_series: string | null;
};

type LinkedInConnection = {
  display_name: string;
  email: string | null;
  scopes: string;
  expires_at: string;
  status: string;
  connected_at: string;
};

type EmployeeRecordCounts = {
  content_drafts: number;
  content_plans: number;
  connection_recommendations: number;
  conversations: number;
  activity_events: number;
};

export async function loader({
  params,
  context,
}: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const employeeId = Number(params.employeeId);

  if (!Number.isInteger(employeeId)) {
    throw new Response("Invalid employee ID", { status: 400 });
  }

  const employee = await env.linkedinadam_db
    .prepare(`
      SELECT
        e.id,
        e.name,
        e.email,
        e.linkedin_profile_url,
        e.role_name,
        e.status,
        ep.playbook_id
        ,e.writing_style_prompt_override
      FROM employees e
      LEFT JOIN employee_playbooks ep
        ON ep.employee_id = e.id
      WHERE e.id = ?
    `)
    .bind(employeeId)
    .first<Employee>();

  if (!employee) {
    throw new Response("Employee not found", { status: 404 });
  }

  const playbookQuery = await env.linkedinadam_db
    .prepare(`
      SELECT
        id,
        role_name,
        primary_audience,
        recurring_series
      FROM playbooks
      ORDER BY role_name ASC
    `)
    .all<Playbook>();
  const linkedinConnection = await env.linkedinadam_db
    .prepare(`
      SELECT
        display_name,
        email,
        scopes,
        expires_at,
        CASE
          WHEN status = 'active'
            AND expires_at <= CURRENT_TIMESTAMP
          THEN 'expired'
          ELSE status
        END AS status,
        connected_at
      FROM linkedin_connections
      WHERE employee_id = ?
    `)
    .bind(employeeId)
    .first<LinkedInConnection>();
  const recordCounts = await env.linkedinadam_db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM content_drafts
          WHERE employee_id = ?) AS content_drafts,
        (SELECT COUNT(*) FROM content_plans
          WHERE employee_id = ?) AS content_plans,
        (SELECT COUNT(*) FROM connection_recommendations
          WHERE employee_id = ?) AS connection_recommendations,
        (SELECT COUNT(*) FROM conversations
          WHERE employee_id = ?) AS conversations,
        (SELECT COUNT(*) FROM activity_events
          WHERE employee_id = ?) AS activity_events
    `)
    .bind(
      employeeId,
      employeeId,
      employeeId,
      employeeId,
      employeeId,
    )
    .first<EmployeeRecordCounts>();

  return {
    employee,
    playbooks: playbookQuery.results ?? [],
    linkedinConnection,
    recordCounts: recordCounts ?? {
      content_drafts: 0,
      content_plans: 0,
      connection_recommendations: 0,
      conversations: 0,
      activity_events: 0,
    },
  };
}

export async function action({
  request,
  params,
  context,
}: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const employeeId = Number(params.employeeId);
  const formData = await request.formData();

  if (!Number.isInteger(employeeId)) {
    throw new Response("Invalid employee ID", { status: 400 });
  }

  const intent = String(
    formData.get("intent") ?? "update_employee",
  );

  if (intent === "archive_employee" || intent === "restore_employee") {
    const actorName = String(
      formData.get("actor_name") ?? "",
    ).trim();

    if (!actorName) {
      return { error: "Your name is required for the audit trail." };
    }

    await env.linkedinadam_db
      .prepare(`
        UPDATE employees
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        intent === "archive_employee" ? "inactive" : "active",
        employeeId,
      )
      .run();

    return redirect(
      `/employees/${employeeId}?employee=${
        intent === "archive_employee" ? "archived" : "restored"
      }`,
    );
  }

  if (intent === "delete_employee") {
    const employee = await env.linkedinadam_db
      .prepare(`
        SELECT name, email, role_name
        FROM employees
        WHERE id = ?
      `)
      .bind(employeeId)
      .first<{
        name: string;
        email: string | null;
        role_name: string;
      }>();
    const confirmation = String(
      formData.get("confirmation") ?? "",
    );
    const actorName = String(
      formData.get("actor_name") ?? "",
    ).trim();

    if (!employee) {
      return { error: "The employee no longer exists." };
    }

    if (!actorName || confirmation !== employee.name) {
      return {
        error:
          "Enter your name and type the employee’s exact name to permanently delete them.",
      };
    }

    const counts = await env.linkedinadam_db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM content_drafts
            WHERE employee_id = ?) AS content_drafts,
          (SELECT COUNT(*) FROM content_plans
            WHERE employee_id = ?) AS content_plans,
          (SELECT COUNT(*) FROM connection_recommendations
            WHERE employee_id = ?) AS connection_recommendations,
          (SELECT COUNT(*) FROM conversations
            WHERE employee_id = ?) AS conversations,
          (SELECT COUNT(*) FROM activity_events
            WHERE employee_id = ?) AS activity_events
      `)
      .bind(
        employeeId,
        employeeId,
        employeeId,
        employeeId,
        employeeId,
      )
      .first<EmployeeRecordCounts>();
    const images = await env.linkedinadam_db
      .prepare(`
        SELECT image_key
        FROM content_drafts
        WHERE employee_id = ? AND image_key IS NOT NULL
      `)
      .bind(employeeId)
      .all<{ image_key: string }>();

    try {
      const imageKeys = (images.results ?? []).map(
        (row) => row.image_key,
      );

      await env.linkedinadam_db.batch([
        env.linkedinadam_db
          .prepare(`
            INSERT INTO employee_deletion_audit (
              employee_name,
              employee_email,
              role_name,
              deleted_by,
              record_counts
            )
            VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            employee.name,
            employee.email,
            employee.role_name,
            actorName,
            JSON.stringify(counts ?? {}),
          ),
        env.linkedinadam_db
          .prepare(`
            DELETE FROM linkedin_publish_attempts
            WHERE content_draft_id IN (
              SELECT id FROM content_drafts WHERE employee_id = ?
            )
            OR linkedin_connection_id IN (
              SELECT id FROM linkedin_connections
              WHERE employee_id = ?
            )
          `)
          .bind(employeeId, employeeId),
        env.linkedinadam_db
          .prepare("DELETE FROM employees WHERE id = ?")
          .bind(employeeId),
      ]);

      if (imageKeys.length) {
        try {
          await env.LINKEDIN_IMAGES.delete(imageKeys);
        } catch (error) {
          console.error(
            "Deleted employee image cleanup failed.",
            error instanceof Error ? error.name : "unknown",
          );
        }
      }
    } catch (error) {
      console.error(
        "Permanent employee deletion failed.",
        error instanceof Error ? error.name : "unknown",
      );
      return {
        error:
          "The employee could not be fully deleted. No further deletion steps will run.",
      };
    }

    return redirect("/?employee=deleted#employees");
  }

  if (intent === "disconnect_linkedin") {
    await env.linkedinadam_db
      .prepare(`
        UPDATE linkedin_connections
        SET
          status = 'revoked',
          access_token_ciphertext = '',
          access_token_iv = '',
          updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = ?
      `)
      .bind(employeeId)
      .run();

    return redirect(`/employees/${employeeId}?linkedin=disconnected`);
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const linkedinProfileUrl = String(
    formData.get("linkedin_profile_url") ?? "",
  ).trim();
  const writingStylePromptOverride = String(
    formData.get("writing_style_prompt_override") ?? "",
  ).trim();
  const status = String(formData.get("status") ?? "active");
  const playbookId = Number(formData.get("playbook_id"));

  if (!name) {
    return {
      error: "Employee name is required.",
    };
  }

  if (writingStylePromptOverride.length > 4000) {
    return {
      error:
        "Employee writing-style instructions must be 4,000 characters or fewer.",
    };
  }

  if (!Number.isInteger(playbookId)) {
    return {
      error: "Select a valid playbook.",
    };
  }

  const selectedPlaybook = await env.linkedinadam_db
    .prepare(`
      SELECT id, role_name
      FROM playbooks
      WHERE id = ?
    `)
    .bind(playbookId)
    .first<{ id: number; role_name: string }>();

  if (!selectedPlaybook) {
    return {
      error: "The selected playbook could not be found.",
    };
  }

  await env.linkedinadam_db.batch([
    env.linkedinadam_db
      .prepare(`
        UPDATE employees
        SET
          name = ?,
          email = ?,
          linkedin_profile_url = ?,
          role_name = ?,
          status = ?,
          writing_style_prompt_override = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        name,
        email || null,
        linkedinProfileUrl || null,
        selectedPlaybook.role_name,
        status,
        writingStylePromptOverride || null,
        employeeId,
      ),

    env.linkedinadam_db
      .prepare(`
        INSERT INTO employee_playbooks (
          employee_id,
          playbook_id,
          assigned_at
        )
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(employee_id)
        DO UPDATE SET
          playbook_id = excluded.playbook_id,
          assigned_at = CURRENT_TIMESTAMP
      `)
      .bind(employeeId, playbookId),
  ]);

  return redirect("/#employees");
}

export default function EditEmployee({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    employee,
    playbooks,
    linkedinConnection,
    recordCounts,
  } = loaderData;

  return (
    <main className="edit-page">
      <div className="edit-shell">
        <Link className="back-link" to="/#employees">
          ← Back to dashboard
        </Link>

        <section className="panel edit-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EMPLOYEE MANAGEMENT</p>
              <h1>Edit {employee.name}</h1>
              <p>
                Update the employee profile and assign the correct
                LinkedIn strategy playbook.
              </p>
            </div>
          </div>

          <Form method="post" className="employee-form">
            <label>
              Employee name
              <input
                name="name"
                type="text"
                defaultValue={employee.name}
                required
              />
            </label>

            <label>
              Email
              <input
                name="email"
                type="email"
                defaultValue={employee.email ?? ""}
              />
            </label>

            <label>
              LinkedIn profile
              <input
                name="linkedin_profile_url"
                type="url"
                defaultValue={
                  employee.linkedin_profile_url ?? ""
                }
                placeholder="https://www.linkedin.com/in/..."
              />
            </label>

            <label>
              Assigned playbook
              <select
                name="playbook_id"
                defaultValue={
                  employee.playbook_id?.toString() ?? ""
                }
                required
              >
                <option value="" disabled>
                  Select a playbook
                </option>

                {playbooks.map((playbook) => (
                  <option
                    key={playbook.id}
                    value={playbook.id}
                  >
                    {playbook.role_name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Employee status
              <select
                name="status"
                defaultValue={employee.status}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>

            <label className="employee-form-wide">
              Employee-specific AI writing style
              <textarea
                name="writing_style_prompt_override"
                defaultValue={
                  employee.writing_style_prompt_override ?? ""
                }
                rows={7}
                maxLength={4000}
                placeholder="Optional override for this employee. Leave blank to inherit the assigned playbook’s writing style."
              />
              <small>
                This overrides the playbook style only for{" "}
                {employee.name}.
              </small>
            </label>

            {actionData?.error ? (
              <p className="form-error">
                {actionData.error}
              </p>
            ) : null}

            <div className="form-actions">
              <button type="submit">Save changes</button>

              <Link
                className="cancel-link"
                to="/#employees"
              >
                Cancel
              </Link>
            </div>
          </Form>
        </section>

        <section className="panel linkedin-connection-panel">
          <p className="eyebrow">LINKEDIN PUBLISHING</p>
          <h2>Member connection</h2>

          {linkedinConnection ? (
            <>
              <div className="linkedin-connection-summary">
                <div>
                  <strong>{linkedinConnection.display_name}</strong>
                  <span>
                    {linkedinConnection.email ||
                      "Email not returned by LinkedIn"}
                  </span>
                </div>
                <span
                  className={`connection-status ${linkedinConnection.status}`}
                >
                  {linkedinConnection.status}
                </span>
              </div>
              <p>
                Expires {linkedinConnection.expires_at}. LinkedIn may
                require reconnection when this token expires.
              </p>
              <div className="linkedin-connection-actions">
                <a
                  className="button-link"
                  href={`/auth/linkedin/start?employee=${employee.id}`}
                >
                  Reconnect LinkedIn
                </a>
                <Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="disconnect_linkedin"
                  />
                  <button type="submit" className="secondary">
                    Disconnect
                  </button>
                </Form>
              </div>
            </>
          ) : (
            <>
              <p>
                Connect the LinkedIn member who owns this employee
                profile. LinkedIn will show its own consent screen.
              </p>
              <a
                className="button-link"
                href={`/auth/linkedin/start?employee=${employee.id}`}
              >
                Connect LinkedIn
              </a>
            </>
          )}
        </section>

        <section className="panel">
          <p className="eyebrow">AVAILABLE PLAYBOOKS</p>
          <h2>Strategy options</h2>

          <div className="playbook-option-list">
            {playbooks.map((playbook) => (
              <article
                className="playbook-option"
                key={playbook.id}
              >
                <strong>{playbook.role_name}</strong>
                <p>
                  {playbook.primary_audience ||
                    "Audience not specified"}
                </p>
                <span>
                  {playbook.recurring_series ||
                    "No recurring series"}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel employee-removal-panel">
          <p className="eyebrow">EMPLOYEE LIFECYCLE</p>
          <h2>Archive or permanently delete</h2>
          <p>
            Archiving stops planning and automation while preserving
            the employee’s history. Permanent deletion cannot be
            undone.
          </p>

          <Form method="post" className="employee-archive-form">
            <input
              type="hidden"
              name="intent"
              value={
                employee.status === "active"
                  ? "archive_employee"
                  : "restore_employee"
              }
            />
            <input
              name="actor_name"
              required
              placeholder="Your name"
            />
            <button type="submit">
              {employee.status === "active"
                ? "Archive employee"
                : "Restore employee"}
            </button>
          </Form>

          <details className="permanent-delete">
            <summary>Permanently delete {employee.name}</summary>
            <div>
              <p>This will permanently remove:</p>
              <ul>
                <li>{recordCounts.content_drafts} content drafts</li>
                <li>{recordCounts.content_plans} content plans</li>
                <li>
                  {recordCounts.connection_recommendations} connection
                  recommendations
                </li>
                <li>{recordCounts.conversations} conversations</li>
                <li>{recordCounts.activity_events} activity events</li>
              </ul>
              <Form method="post" className="permanent-delete-form">
                <input
                  type="hidden"
                  name="intent"
                  value="delete_employee"
                />
                <label>
                  Deleted by
                  <input name="actor_name" required />
                </label>
                <label>
                  Type “{employee.name}” to confirm
                  <input name="confirmation" required />
                </label>
                <button
                  type="submit"
                  onClick={(event) => {
                    if (
                      !window.confirm(
                        `Permanently delete ${employee.name} and all related data?`,
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  Permanently delete employee
                </button>
              </Form>
            </div>
          </details>
        </section>
      </div>
    </main>
  );
}
