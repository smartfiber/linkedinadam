import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/playbooks";

type AppEnvironment = {
  linkedinadam_db: D1Database;
};

type Playbook = {
  id: number;
  role_name: string;
  relationship_type: string | null;
  primary_audience: string | null;
  secondary_audience: string | null;
  primary_expertise: string | null;
  core_buyer_problem: string | null;
  positioning_statement: string | null;
  recurring_series: string | null;
  weekly_original_posts: number;
  weekly_short_posts: number;
  weekly_meaningful_comments: number;
  weekly_new_connections: number;
  monthly_long_form_asset: string | null;
  content_sources: string | null;
  primary_post_formats: string | null;
  example_topics: string | null;
  lead_magnet: string | null;
  soft_cta: string | null;
  qualified_buying_signal: string | null;
  lead_handoff_action: string | null;
  cross_team_collaboration: string | null;
  ninety_day_audience_goal: string | null;
  ninety_day_content_goal: string | null;
  primary_kpi: string | null;
  secondary_kpi: string | null;
  guardrail: string | null;
  writing_style_prompt: string | null;
  employee_count: number;
};

const textFields = [
  ["relationship_type", "Relationship type"],
  ["primary_audience", "Primary audience"],
  ["secondary_audience", "Secondary audience"],
  ["primary_expertise", "Primary expertise"],
  ["core_buyer_problem", "Core buyer problem"],
  ["positioning_statement", "Positioning statement"],
  ["recurring_series", "Recurring series"],
  ["monthly_long_form_asset", "Monthly long-form asset"],
  ["content_sources", "Content sources"],
  ["primary_post_formats", "Primary post formats"],
  ["example_topics", "Example topics"],
  ["lead_magnet", "Lead magnet"],
  ["soft_cta", "Soft CTA"],
  ["qualified_buying_signal", "Qualified buying signal"],
  ["lead_handoff_action", "Lead handoff action"],
  ["cross_team_collaboration", "Cross-team collaboration"],
  ["ninety_day_audience_goal", "90-day audience goal"],
  ["ninety_day_content_goal", "90-day content goal"],
  ["primary_kpi", "Primary KPI"],
  ["secondary_kpi", "Secondary KPI"],
  ["guardrail", "Guardrail"],
] as const;

const textColumnNames = textFields.map(([field]) => field);

const targetFields = [
  ["weekly_original_posts", "Original posts"],
  ["weekly_short_posts", "Short posts"],
  ["weekly_meaningful_comments", "Meaningful comments"],
  ["weekly_new_connections", "New connections"],
] as const;

function parseTarget(value: FormDataEntryValue | null) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new Error("Weekly targets must be whole numbers from 0 to 100.");
  }

  return number;
}

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const query = await env.linkedinadam_db
    .prepare(`
      SELECT
        p.*,
        COUNT(ep.employee_id) AS employee_count
      FROM playbooks p
      LEFT JOIN employee_playbooks ep ON ep.playbook_id = p.id
      GROUP BY p.id
      ORDER BY p.role_name
    `)
    .all<Playbook>();

  return { playbooks: query.results ?? [] };
}

export async function action({
  request,
  context,
}: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const playbookId = Number(formData.get("playbook_id"));
  const roleName = String(formData.get("role_name") ?? "").trim();
  const writingStylePrompt = String(
    formData.get("writing_style_prompt") ?? "",
  ).trim();

  if (!roleName) {
    return { error: "Playbook name and role are required." };
  }

  if (writingStylePrompt.length > 4000) {
    return {
      error: "Writing-style instructions must be 4,000 characters or fewer.",
    };
  }

  let targets: number[];

  try {
    targets = targetFields.map(([field]) =>
      parseTarget(formData.get(field)),
    );
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Enter valid weekly targets.",
    };
  }

  const values = textFields.map(([field]) => {
    const value = String(formData.get(field) ?? "").trim();
    return value || null;
  });

  try {
    if (intent === "create_playbook") {
      const columns = textColumnNames.join(", ");
      const placeholders = textColumnNames.map(() => "?").join(", ");

      await env.linkedinadam_db
        .prepare(`
          INSERT INTO playbooks (
            role_name,
            ${columns},
            weekly_original_posts,
            weekly_short_posts,
            weekly_meaningful_comments,
            weekly_new_connections,
            writing_style_prompt,
            updated_at
          )
          VALUES (?, ${placeholders}, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `)
        .bind(
          roleName,
          ...values,
          ...targets,
          writingStylePrompt || null,
        )
        .run();
    } else if (
      intent === "update_playbook" &&
      Number.isInteger(playbookId)
    ) {
      const assignments = textColumnNames
        .map((column) => `${column} = ?`)
        .join(", ");

      await env.linkedinadam_db
        .prepare(`
          UPDATE playbooks
          SET
            role_name = ?,
            ${assignments},
            weekly_original_posts = ?,
            weekly_short_posts = ?,
            weekly_meaningful_comments = ?,
            weekly_new_connections = ?,
            writing_style_prompt = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(
          roleName,
          ...values,
          ...targets,
          writingStylePrompt || null,
          playbookId,
        )
        .run();

      await env.linkedinadam_db
        .prepare(`
          UPDATE employees
          SET role_name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id IN (
            SELECT employee_id
            FROM employee_playbooks
            WHERE playbook_id = ?
          )
        `)
        .bind(roleName, playbookId)
        .run();
    } else {
      return { error: "Choose a valid playbook action." };
    }
  } catch (error) {
    console.error(
      "Playbook save failed.",
      error instanceof Error ? error.name : "unknown",
    );
    return {
      error:
        "The playbook could not be saved. Use a unique role name and try again.",
    };
  }

  return redirect("/playbooks");
}

function PlaybookFields({
  playbook,
}: {
  playbook?: Playbook;
}) {
  return (
    <>
      <label className="playbook-field-wide">
        Playbook name / employee role
        <input
          name="role_name"
          defaultValue={playbook?.role_name ?? ""}
          required
        />
      </label>

      {textFields.map(([field, label]) => (
        <label key={field}>
          {label}
          <textarea
            name={field}
            defaultValue={playbook?.[field] ?? ""}
            rows={3}
          />
        </label>
      ))}

      <label className="playbook-field-wide style-prompt-field">
        AI writing-style instructions
        <textarea
          name="writing_style_prompt"
          defaultValue={playbook?.writing_style_prompt ?? ""}
          rows={7}
          maxLength={4000}
          placeholder="Example: Write in a direct, practical first-person voice. Open with an observation from experience. Avoid rhetorical hype, em dashes, and generic leadership language…"
        />
        <small>
          These instructions are added to every AI post generated for
          employees assigned to this playbook.
        </small>
      </label>

      <div className="playbook-target-editor playbook-field-wide">
        {targetFields.map(([field, label]) => (
          <label key={field}>
            {label} / week
            <input
              type="number"
              name={field}
              min={0}
              max={100}
              defaultValue={playbook?.[field] ?? 0}
              required
            />
          </label>
        ))}
      </div>
    </>
  );
}

export default function Playbooks({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <main className="playbooks-page">
      <header className="playbooks-header">
        <Link className="back-link" to="/">
          ← Dashboard
        </Link>
        <p className="eyebrow">CONTENT STRATEGY</p>
        <h1>Playbooks and writing style</h1>
        <p>
          Create reusable employee strategies and control how
          AI-generated posts should sound.
        </p>
      </header>

      {actionData?.error ? (
        <p className="form-error">{actionData.error}</p>
      ) : null}

      <section className="playbook-manager">
        <details className="panel managed-playbook create" open>
          <summary>
            <div>
              <span className="eyebrow">NEW PLAYBOOK</span>
              <strong>Create a strategy</strong>
            </div>
            <span>Expand / collapse</span>
          </summary>
          <Form method="post" className="playbook-editor-form">
            <input
              type="hidden"
              name="intent"
              value="create_playbook"
            />
            <PlaybookFields />
            <button disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Create playbook"}
            </button>
          </Form>
        </details>

        {loaderData.playbooks.map((playbook) => (
          <details className="panel managed-playbook" key={playbook.id}>
            <summary>
              <div>
                <span className="eyebrow">
                  {playbook.employee_count} EMPLOYEES
                </span>
                <strong>{playbook.role_name}</strong>
              </div>
              <span>Expand / edit</span>
            </summary>
            <Form method="post" className="playbook-editor-form">
              <input
                type="hidden"
                name="intent"
                value="update_playbook"
              />
              <input
                type="hidden"
                name="playbook_id"
                value={playbook.id}
              />
              <PlaybookFields playbook={playbook} />
              <button disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save playbook"}
              </button>
            </Form>
          </details>
        ))}
      </section>
    </main>
  );
}
