import { Form, redirect, useNavigation } from "react-router";
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
  original_posts_completed: number;
  short_posts_completed: number;
  meaningful_comments_completed: number;
  relevant_connections_completed: number;
  qualified_conversations: number;
  leads_handed_off: number;
  lead_magnet: string | null;
  soft_cta: string | null;
  qualified_buying_signal: string | null;
  lead_handoff_action: string | null;
  guardrail: string | null;
};

type AppEnvironment = {
  linkedinadam_db: D1Database;
};

type PlaybookOption = {
  id: number;
  role_name: string;
};

type ActivityEvent = {
  id: number;
  employee_name: string;
  event_type: string;
  source: string;
  description: string | null;
  content_url: string | null;
  occurred_at: string;
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

function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;

  now.setUTCDate(now.getUTCDate() - daysSinceMonday);

  return now.toISOString().slice(0, 10);
}

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const weekStart = getCurrentWeekStart();

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
        COALESCE(SUM(
          CASE WHEN a.event_type = 'original_post' THEN 1 ELSE 0 END
        ), 0) AS original_posts_completed,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'short_post' THEN 1 ELSE 0 END
        ), 0) AS short_posts_completed,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'meaningful_comment' THEN 1 ELSE 0 END
        ), 0) AS meaningful_comments_completed,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'relevant_connection' THEN 1 ELSE 0 END
        ), 0) AS relevant_connections_completed,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'qualified_conversation' THEN 1 ELSE 0 END
        ), 0) AS qualified_conversations,
        COALESCE(SUM(
          CASE WHEN a.event_type = 'lead_handoff' THEN 1 ELSE 0 END
        ), 0) AS leads_handed_off,
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
      LEFT JOIN activity_events a
        ON a.employee_id = e.id
        AND date(a.occurred_at) >= ?
        AND date(a.occurred_at) < date(?, '+7 days')
      GROUP BY
        e.id,
        e.name,
        e.email,
        e.linkedin_profile_url,
        e.role_name,
        e.status,
        p.id,
        p.primary_audience,
        p.primary_expertise,
        p.positioning_statement,
        p.recurring_series,
        p.weekly_original_posts,
        p.weekly_short_posts,
        p.weekly_meaningful_comments,
        p.weekly_new_connections,
        p.lead_magnet,
        p.soft_cta,
        p.qualified_buying_signal,
        p.lead_handoff_action,
        p.guardrail
      ORDER BY e.name ASC
    `)
    .bind(weekStart, weekStart)
    .all<Employee>();

  const playbookQuery = await env.linkedinadam_db
    .prepare(`
      SELECT id, role_name
      FROM playbooks
      ORDER BY role_name ASC
    `)
    .all<PlaybookOption>();

  const activityQuery = await env.linkedinadam_db
    .prepare(`
      SELECT
        a.id,
        e.name AS employee_name,
        a.event_type,
        a.source,
        a.description,
        a.content_url,
        a.occurred_at
      FROM activity_events a
      JOIN employees e
        ON e.id = a.employee_id
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT 25
    `)
    .all<ActivityEvent>();

  return {
    employees: employeeQuery.results ?? [],
    playbooks: playbookQuery.results ?? [],
    recentActivities: activityQuery.results ?? [],
    weekStart,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "add_employee");

  if (intent === "log_activity") {
    const employeeId = Number(formData.get("employee_id"));
    const eventType = String(formData.get("event_type") ?? "");
    const description = String(
      formData.get("description") ?? "",
    ).trim();
    const contentUrl = String(
      formData.get("content_url") ?? "",
    ).trim();
    const weekStart = getCurrentWeekStart();

    const activityColumns: Record<string, string> = {
      original_post: "original_posts_completed",
      short_post: "short_posts_completed",
      meaningful_comment: "meaningful_comments_completed",
      relevant_connection: "relevant_connections_completed",
      qualified_conversation: "qualified_conversations",
      lead_handoff: "leads_handed_off",
    };

    const activityColumn = activityColumns[eventType];

    if (!Number.isInteger(employeeId)) {
      return {
        error: "A valid employee is required.",
      };
    }

    if (!activityColumn) {
      return {
        error: "Select a valid activity type.",
      };
    }

    await env.linkedinadam_db.batch([
      env.linkedinadam_db
        .prepare(`
          INSERT INTO activity_events (
            employee_id,
            event_type,
            source,
            content_url,
            description,
            occurred_at
          )
          VALUES (?, ?, 'manual', ?, ?, CURRENT_TIMESTAMP)
        `)
        .bind(
          employeeId,
          eventType,
          contentUrl || null,
          description || null,
        ),

      env.linkedinadam_db
        .prepare(`
          INSERT INTO weekly_activity (
            employee_id,
            week_start,
            ${activityColumn}
          )
          VALUES (?, ?, 1)
          ON CONFLICT(employee_id, week_start)
          DO UPDATE SET
            ${activityColumn} = ${activityColumn} + 1
        `)
        .bind(employeeId, weekStart),
    ]);

    return redirect("/#employees");
  }

  if (intent === "update_activity") {
    const employeeId = Number(formData.get("employee_id"));
    const weekStart = getCurrentWeekStart();

    const toCount = (value: FormDataEntryValue | null) => {
      const count = Number(value ?? 0);

      if (!Number.isFinite(count)) {
        return 0;
      }

      return Math.max(0, Math.floor(count));
    };

    if (!Number.isInteger(employeeId)) {
      return {
        error: "A valid employee is required.",
      };
    }

    const originalPosts = toCount(
      formData.get("original_posts_completed"),
    );
    const shortPosts = toCount(
      formData.get("short_posts_completed"),
    );
    const comments = toCount(
      formData.get("meaningful_comments_completed"),
    );
    const connections = toCount(
      formData.get("relevant_connections_completed"),
    );
    const conversations = toCount(
      formData.get("qualified_conversations"),
    );
    const leads = toCount(formData.get("leads_handed_off"));

    await env.linkedinadam_db
      .prepare(`
        INSERT INTO weekly_activity (
          employee_id,
          week_start,
          original_posts_completed,
          short_posts_completed,
          meaningful_comments_completed,
          relevant_connections_completed,
          qualified_conversations,
          leads_handed_off
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, week_start)
        DO UPDATE SET
          original_posts_completed =
            excluded.original_posts_completed,
          short_posts_completed =
            excluded.short_posts_completed,
          meaningful_comments_completed =
            excluded.meaningful_comments_completed,
          relevant_connections_completed =
            excluded.relevant_connections_completed,
          qualified_conversations =
            excluded.qualified_conversations,
          leads_handed_off =
            excluded.leads_handed_off
      `)
      .bind(
        employeeId,
        weekStart,
        originalPosts,
        shortPosts,
        comments,
        connections,
        conversations,
        leads,
      )
      .run();

    return redirect("/#employees");
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const linkedinProfileUrl = String(
    formData.get("linkedin_profile_url") ?? "",
  ).trim();
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

  const employeeInsert = await env.linkedinadam_db
    .prepare(`
      INSERT INTO employees
        (name, email, linkedin_profile_url, role_name)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `)
    .bind(
      name,
      email || null,
      linkedinProfileUrl || null,
      selectedPlaybook.role_name,
    )
    .first<{ id: number }>();

  if (!employeeInsert) {
    return {
      error: "The employee could not be created.",
    };
  }

  await env.linkedinadam_db
    .prepare(`
      INSERT INTO employee_playbooks (
        employee_id,
        playbook_id,
        assigned_at
      )
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `)
    .bind(employeeInsert.id, playbookId)
    .run();

  return redirect("/#employees");
}

export default function Home({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const employees = loaderData.employees;
  const playbooks = loaderData.playbooks;
  const recentActivities = loaderData.recentActivities;
  const weekStart = loaderData.weekStart;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

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
          <a href="#activity">Activity</a>
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

                    <div className="playbook-header-actions">
                      <div className="playbook-badge">
                        {employee.playbook_id
                          ? "Playbook assigned"
                          : "Needs playbook"}
                      </div>

                      <a
                        className="edit-employee-link"
                        href={`/employees/${employee.id}`}
                      >
                        Edit employee
                      </a>
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

                      <div className="activity-event-panel">
                        <div>
                          <span className="eyebrow">LOG ACTIVITY</span>
                          <h4>Add one completed action</h4>
                        </div>

                        <Form method="post" className="event-form">
                          <input
                            type="hidden"
                            name="intent"
                            value="log_activity"
                          />

                          <input
                            type="hidden"
                            name="employee_id"
                            value={employee.id}
                          />

                          <label>
                            Activity type
                            <select
                              name="event_type"
                              defaultValue=""
                              required
                            >
                              <option value="" disabled>
                                Select an activity
                              </option>

                              <option value="original_post">
                                Original post
                              </option>

                              <option value="short_post">
                                Short post
                              </option>

                              <option value="meaningful_comment">
                                Meaningful comment
                              </option>

                              <option value="relevant_connection">
                                Relevant connection
                              </option>

                              <option value="qualified_conversation">
                                Qualified conversation
                              </option>

                              <option value="lead_handoff">
                                Lead handed off
                              </option>
                            </select>
                          </label>

                          <label>
                            Description
                            <input
                              type="text"
                              name="description"
                              placeholder="Optional note about the activity"
                            />
                          </label>

                          <label>
                            LinkedIn URL
                            <input
                              type="url"
                              name="content_url"
                              placeholder="https://www.linkedin.com/..."
                            />
                          </label>

                          <button type="submit" disabled={isSubmitting}>
                            {isSubmitting
                              ? "Saving..."
                              : "Log completed activity"}
                          </button>
                        </Form>
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
              <input
                type="hidden"
                name="intent"
                value="add_employee"
              />

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
                Assigned playbook
                <select name="playbook_id" defaultValue="" required>
                  <option value="" disabled>
                    Select a playbook
                  </option>

                  {playbooks.map((playbook) => (
                    <option key={playbook.id} value={playbook.id}>
                      {playbook.role_name}
                    </option>
                  ))}
                </select>
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

        <section className="panel" id="activity">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ACTIVITY HISTORY</p>
              <h2>Recent employee activity</h2>
            </div>

            <span className="activity-count">
              {recentActivities.length} recent events
            </span>
          </div>

          {recentActivities.length === 0 ? (
            <div className="empty-state">
              <strong>No activity has been logged yet.</strong>
              <p>
                Completed posts, comments, connections, conversations,
                and lead handoffs will appear here.
              </p>
            </div>
          ) : (
            <div className="activity-feed">
              {recentActivities.map((activity) => {
                const labels: Record<string, string> = {
                  original_post: "Original post",
                  short_post: "Short post",
                  meaningful_comment: "Meaningful comment",
                  relevant_connection: "Relevant connection",
                  qualified_conversation: "Qualified conversation",
                  lead_handoff: "Lead handed off",
                };

                const activityLabel =
                  labels[activity.event_type] ?? activity.event_type;

                const activityDate = new Date(
                  activity.occurred_at.replace(" ", "T") + "Z",
                );

                return (
                  <article className="activity-feed-row" key={activity.id}>
                    <div className="activity-icon">
                      {activity.employee_name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")}
                    </div>

                    <div className="activity-feed-content">
                      <div className="activity-feed-title">
                        <strong>{activity.employee_name}</strong>
                        <span>{activityLabel}</span>
                      </div>

                      <p>
                        {activity.description ||
                          `${activityLabel} logged without a description.`}
                      </p>

                      <div className="activity-feed-meta">
                        <span>
                          {activityDate.toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>

                        <span className="activity-source">
                          Source: {activity.source}
                        </span>

                        {activity.content_url ? (
                          <a
                            href={activity.content_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open LinkedIn activity ↗
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
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
