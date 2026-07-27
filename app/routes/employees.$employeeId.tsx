import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/employees.$employeeId";

type AppEnvironment = {
  linkedinadam_db: D1Database;
};

type Employee = {
  id: number;
  name: string;
  email: string | null;
  linkedin_profile_url: string | null;
  role_name: string;
  status: string;
  playbook_id: number | null;
};

type Playbook = {
  id: number;
  role_name: string;
  primary_audience: string | null;
  recurring_series: string | null;
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

  return {
    employee,
    playbooks: playbookQuery.results ?? [],
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

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const linkedinProfileUrl = String(
    formData.get("linkedin_profile_url") ?? "",
  ).trim();
  const status = String(formData.get("status") ?? "active");
  const playbookId = Number(formData.get("playbook_id"));

  if (!name) {
    return {
      error: "Employee name is required.",
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
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        name,
        email || null,
        linkedinProfileUrl || null,
        selectedPlaybook.role_name,
        status,
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
  const { employee, playbooks } = loaderData;

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
      </div>
    </main>
  );
}
