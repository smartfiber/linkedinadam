import { Form, redirect } from "react-router";
import type { Route } from "./+types/home";

type Employee = {
  id: number;
  name: string;
  email: string | null;
  linkedin_profile_url: string | null;
  role_name: string;
  status: string;
};

type AppEnvironment = {
  linkedinadam_db: D1Database;
};

const agents = [
  {
    name: "Strategy Agent",
    description:
      "Assigns role, audience, positioning, targets, and guardrails.",
  },
  {
    name: "Content Planner",
    description:
      "Builds weekly post plans and prevents duplicate topics.",
  },
  {
    name: "Post Drafting Agent",
    description:
      "Drafts posts in each employee’s approved voice.",
  },
  {
    name: "Connection Targeting Agent",
    description:
      "Finds relevant people each employee should connect with.",
  },
  {
    name: "Engagement Queue Agent",
    description:
      "Surfaces posts and conversations worth engaging with.",
  },
  {
    name: "Conversation Signal Agent",
    description:
      "Detects buying signals, interest, and lead potential.",
  },
  {
    name: "Messaging Agent",
    description:
      "Drafts public replies and private follow-up messages.",
  },
  {
    name: "Lead Routing Agent",
    description:
      "Routes qualified conversations to the right owner.",
  },
];

const priorities = [
  "Approve the next executive telecom procurement post",
  "Review recommended target connections",
  "Reply to conversations with target buyers",
  "Review buying signals for possible sales handoff",
];

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;

  const employeeQuery = await env.linkedinadam_db
    .prepare(
      `SELECT
        id,
        name,
        email,
        linkedin_profile_url,
        role_name,
        status
      FROM employees
      ORDER BY name ASC`,
    )
    .all<Employee>();

  return {
    employees: employeeQuery.results ?? [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const formData = await request.formData();

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const linkedinProfileUrl = String(
    formData.get("linkedin_profile_url") ?? "",
  ).trim();
  const roleName = String(formData.get("role_name") ?? "").trim();

  if (!name || !roleName) {
    return {
      error: "Employee name and role are required.",
    };
  }

  await env.linkedinadam_db
    .prepare(
      `INSERT INTO employees
        (name, email, linkedin_profile_url, role_name)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(
      name,
      email || null,
      linkedinProfileUrl || null,
      roleName,
    )
    .run();

  return redirect("/#employees");
}

export default function Home({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const employees = loaderData.employees;

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="logo">LinkedInAdam</div>

        <nav>
          <a className="active" href="/">
            Dashboard
          </a>
          <a href="#add-employee">Add Employee</a>
          <a href="#employees">Employees</a>
          <a href="#playbooks">Playbooks</a>
          <a href="#content">Content</a>
          <a href="#engagement">Engagement</a>
          <a href="#conversations">Conversations</a>
          <a href="#leads">Lead Signals</a>
        </nav>
      </aside>

      <section className="content">
        <header className="header">
          <div>
            <p className="eyebrow">LINKEDIN OPERATIONS CENTER</p>
            <h1>Good morning, Adam.</h1>
            <p>
              Coordinate employee content, connections, engagement,
              conversations, and lead handoffs from one place.
            </p>
          </div>

          <a className="button-link" href="#add-employee">
            Add employee
          </a>
        </header>

        <section className="stats">
          <article>
            <span>Employees loaded</span>
            <strong>{employees.length}</strong>
          </article>

          <article>
            <span>Posts due this week</span>
            <strong>0</strong>
          </article>

          <article>
            <span>Conversations requiring replies</span>
            <strong>0</strong>
          </article>

          <article>
            <span>Buying signals detected</span>
            <strong>0</strong>
          </article>
        </section>

        <section className="grid-two">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">TODAY</p>
                <h2>Priority queue</h2>
              </div>
            </div>

            <div className="priority-list">
              {priorities.map((item, index) => (
                <div className="priority-row" key={item}>
                  <span>{index + 1}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="panel" id="add-employee">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">TEAM SETUP</p>
                <h2>Add an employee</h2>
              </div>
            </div>

            <Form method="post" className="employee-form">
              <label>
                Employee name
                <input
                  name="name"
                  type="text"
                  placeholder="Adam Copenhaver"
                  required
                />
              </label>

              <label>
                Role or playbook
                <input
                  name="role_name"
                  type="text"
                  placeholder="Founder / Managing Partner"
                  required
                />
              </label>

              <label>
                Email
                <input
                  name="email"
                  type="email"
                  placeholder="employee@company.com"
                />
              </label>

              <label>
                LinkedIn profile
                <input
                  name="linkedin_profile_url"
                  type="url"
                  placeholder="https://www.linkedin.com/in/..."
                />
              </label>

              {actionData?.error ? (
                <p className="form-error">{actionData.error}</p>
              ) : null}

              <button type="submit">Save employee</button>
            </Form>
          </article>
        </section>

        <section className="panel" id="employees">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EMPLOYEE PLAYBOOKS</p>
              <h2>Team members</h2>
            </div>
          </div>

          {employees.length === 0 ? (
            <div className="empty-state">
              <strong>No employees have been added yet.</strong>
              <p>
                Use the form above to create the first employee record.
              </p>
            </div>
          ) : (
            <div className="employee-list">
              {employees.map((employee) => (
                <div className="employee-row" key={employee.id}>
                  <div>
                    <strong>{employee.name}</strong>
                    <span>{employee.role_name}</span>
                  </div>

                  <div className="employee-contact">
                    <strong>{employee.email || "No email added"}</strong>
                    <span>
                      {employee.linkedin_profile_url
                        ? "LinkedIn profile added"
                        : "LinkedIn profile needed"}
                    </span>
                  </div>

                  <div className="metric">
                    <strong>0</strong>
                    <span>posts due</span>
                  </div>

                  <div className="metric">
                    <strong>0</strong>
                    <span>conversations</span>
                  </div>

                  <span
                    className={
                      employee.status === "active" ? "ready" : "setup"
                    }
                  >
                    {employee.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel" id="playbooks">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AI WORKFORCE</p>
              <h2>LinkedInAdam agents</h2>
            </div>
          </div>

          <div className="agent-grid">
            {agents.map((agent) => (
              <article className="agent-card" key={agent.name}>
                <strong>{agent.name}</strong>
                <p>{agent.description}</p>
                <span>Human approval required</span>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
