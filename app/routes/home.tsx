import { Form, redirect } from "react-router";
import type { Route } from "./+types/home";

type Employee = {
  id: number;
  name: string;
  email: string | null;
  linkedin_profile_url: string | null;
  role_name: string;
  status: string;
  playbook_id: number | null;
  primary_audience: string | null;
  primary_expertise: string | null;
  positioning_statement: string | null;
  recurring_series: string | null;
  weekly_original_posts: number;
  weekly_short_posts: number;
  weekly_meaningful_comments: number;
  weekly_new_connections: number;
  lead_magnet: string | null;
  soft_cta: string | null;
  qualified_buying_signal: string | null;
  lead_handoff_action: string | null;
  guardrail: string | null;
};

type AppEnvironment = {
  linkedinadam_db: D1Database;
};

const agents = [
  {
    name: "Strategy Agent",
    description: "Assigns role, audience, positioning, targets, and guardrails.",
  },
  {
    name: "Content Planner",
    description: "Builds weekly post plans and prevents duplicate topics.",
  },
  {
    name: "Post Drafting Agent",
    description: "Drafts posts in each employee’s approved voice.",
  },
  {
    name: "Connection Targeting Agent",
    description: "Finds relevant people each employee should connect with.",
  },
  {
    name: "Engagement Queue Agent",
    description: "Surfaces posts and conversations worth engaging with.",
  },
  {
    name: "Conversation Signal Agent",
    description: "Detects buying signals, interest, and lead potential.",
  },
  {
    name: "Messaging Agent",
    description: "Drafts public replies and private follow-up messages.",
  },
  {
    name: "Lead Routing Agent",
    description: "Routes qualified conversations to the right owner.",
  },
];

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;

  const employeeQuery = await env.linkedinadam_db
    .prepare(`
      SELECT
        e.id,
        e.name,
        e.email,
        e.linkedin_profile_url,
        e.role_name,
        e.status,
        p.id AS playbook_id,
        p.primary_audience,
        p.primary_expertise,
        p.positioning_statement,
        p.recurring_series,
        COALESCE(p.weekly_original_posts, 0) AS weekly_original_posts,
        COALESCE(p.weekly_short_posts, 0) AS weekly_short_posts,
        COALESCE(p.weekly_meaningful_comments, 0) AS weekly_meaningful_comments,
        COALESCE(p.weekly_new_connections, 0) AS weekly_new_connections,
        p.lead_magnet,
        p.soft_cta,
        p.qualified_buying_signal,
        p.lead_handoff_action,
        p.guardrail
      FROM employees e
      LEFT JOIN employee_playbooks ep
        ON ep.employee_id = e.id
      LEFT JOIN playbooks p
        ON p.id = ep.playbook_id
      ORDER BY e.name ASC
    `)
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
    .prepare(`
      INSERT INTO employees
        (name, email, linkedin_profile_url, role_name)
      VALUES (?, ?, ?, ?)
    `)
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

  const totalOriginalPosts = employees.reduce(
    (total, employee) => total + employee.weekly_original_posts,
    0,
  );

  const totalComments = employees.reduce(
    (total, employee) => total + employee.weekly_meaningful_comments,
    0,
  );

  const totalConnections = employees.reduce(
    (total, employee) => total + employee.weekly_new_connections,
    0,
  );

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="logo">LinkedInAdam</div>

        <nav>
          <a className="active" href="/">
            Dashboard
          </a>
          <a href="#employees">Employees</a>
          <a href="#add-employee">Add Employee</a>
          <a href="#agents">Agents</a>
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
            <span>Active employees</span>
            <strong>{employees.length}</strong>
          </article>

          <article>
            <span>Original posts per week</span>
            <strong>{totalOriginalPosts}</strong>
          </article>

          <article>
            <span>Meaningful comments per week</span>
            <strong>{totalComments}</strong>
          </article>

          <article>
            <span>New connections per week</span>
            <strong>{totalConnections}</strong>
          </article>
        </section>

        <section className="panel" id="employees">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EMPLOYEE PLAYBOOKS</p>
              <h2>Team strategy</h2>
            </div>
          </div>

          {employees.length === 0 ? (
            <div className="empty-state">
              <strong>No employees have been added yet.</strong>
              <p>Add the first employee using the form below.</p>
            </div>
          ) : (
            <div className="playbook-list">
              {employees.map((employee) => (
                <article className="playbook-card" key={employee.id}>
                  <div className="playbook-header">
                    <div>
                      <div className="employee-title-row">
                        <h3>{employee.name}</h3>
                        <span
                          className={
                            employee.status === "active" ? "ready" : "setup"
                          }
                        >
                          {employee.status}
                        </span>
                      </div>

                      <p className="employee-role">{employee.role_name}</p>

                      <p className="employee-contact-line">
                        {employee.email || "No email added"}
                      </p>
                    </div>

                    <div className="playbook-badge">
                      {employee.playbook_id
                        ? "Playbook assigned"
                        : "Needs playbook"}
                    </div>
                  </div>

                  {employee.playbook_id ? (
                    <>
                      <div className="target-grid">
                        <div>
                          <strong>{employee.weekly_original_posts}</strong>
                          <span>original posts</span>
                        </div>

                        <div>
                          <strong>{employee.weekly_short_posts}</strong>
                          <span>short posts</span>
                        </div>

                        <div>
                          <strong>{employee.weekly_meaningful_comments}</strong>
                          <span>comments</span>
                        </div>

                        <div>
                          <strong>{employee.weekly_new_connections}</strong>
                          <span>connections</span>
                        </div>
                      </div>

                      <div className="strategy-grid">
                        <div className="strategy-item">
                          <span>Primary audience</span>
                          <p>{employee.primary_audience}</p>
                        </div>

                        <div className="strategy-item">
                          <span>Expertise</span>
                          <p>{employee.primary_expertise}</p>
                        </div>

                        <div className="strategy-item">
                          <span>Recurring series</span>
                          <p>{employee.recurring_series}</p>
                        </div>

                        <div className="strategy-item">
                          <span>Lead magnet</span>
                          <p>{employee.lead_magnet}</p>
                        </div>
                      </div>

                      <div className="strategy-callout">
                        <span>Positioning</span>
                        <p>{employee.positioning_statement}</p>
                      </div>

                      <div className="strategy-grid">
                        <div className="strategy-item signal-item">
                          <span>Qualified buying signal</span>
                          <p>{employee.qualified_buying_signal}</p>
                        </div>

                        <div className="strategy-item">
                          <span>Lead handoff</span>
                          <p>{employee.lead_handoff_action}</p>
                        </div>
                      </div>

                      <div className="guardrail">
                        <strong>Guardrail</strong>
                        <p>{employee.guardrail}</p>
                      </div>
                    </>
                  ) : (
                    <div className="empty-playbook">
                      This employee has not been connected to a playbook yet.
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="grid-two">
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
                  placeholder="Employee name"
                  required
                />
              </label>

              <label>
                Role
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

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">NEXT ACTIONS</p>
                <h2>Operations queue</h2>
              </div>
            </div>

            <div className="priority-list">
              <div className="priority-row">
                <span>1</span>
                <p>Draft Adam’s first recurring-series post.</p>
              </div>

              <div className="priority-row">
                <span>2</span>
                <p>Generate Adam’s target connection list.</p>
              </div>

              <div className="priority-row">
                <span>3</span>
                <p>Add Josh and assign his implementation playbook.</p>
              </div>

              <div className="priority-row">
                <span>4</span>
                <p>Begin tracking completed weekly activity.</p>
              </div>
            </div>
          </article>
        </section>

        <section className="panel" id="agents">
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
