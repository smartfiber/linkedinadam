import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/connections";
import { getSafeOpenAIErrorMessage } from "../lib/aiErrors.server";
import {
  findOrCreateProspect,
  parseProspectRows,
  recordRecommendationEvent,
} from "../lib/connectionGrowth";
import {
  generateConnectionRecommendations,
  type EmployeePlaybookForRecommendation,
  type ProspectForRecommendation,
} from "../lib/generateConnectionRecommendations.server";

type AppEnvironment = {
  linkedinadam_db: D1Database;
  OPENAI_API_KEY?: string;
};

type Source = {
  id: number;
  source_type: string;
  name: string;
  source_url: string | null;
  source_text: string | null;
  notes: string | null;
  prospect_count: number;
  recommendation_count: number;
  created_at: string;
};

type Employee = {
  id: number;
  name: string;
  role_name: string;
  playbook_id: number | null;
};

type Recommendation = {
  id: number;
  prospect_id: number;
  prospect_name: string;
  job_title: string | null;
  company_name: string | null;
  location: string | null;
  linkedin_profile_url: string | null;
  employee_id: number;
  employee_name: string;
  playbook_id: number;
  playbook_name: string;
  score: number;
  relevance_reason: string;
  suggested_note: string | null;
  status: string;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  follow_up_due: string | null;
  source_names: string | null;
  updated_at: string;
};

type Summary = {
  recommended: number;
  approved: number;
  sent: number;
  accepted: number;
};

const sourceTypes = [
  ["group", "LinkedIn group"],
  ["post", "LinkedIn post"],
  ["csv", "CSV / spreadsheet"],
  ["crm", "CRM export"],
  ["manual", "Manual research"],
] as const;

const recommendationStatuses = [
  "recommended",
  "approved",
  "rejected",
  "sent",
  "accepted",
  "declined",
  "withdrawn",
] as const;

function toOptionalInteger(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toSafeUrl(value: FormDataEntryValue | null) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(
      trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
    );

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error();
    }

    return url.toString();
  } catch {
    throw new Error("Enter a valid source URL.");
  }
}

function clampScore(value: string | null) {
  const score = Number(value ?? "0");

  if (!Number.isInteger(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, score));
}

function selectedRecommendationIds(formData: FormData) {
  return Array.from(
    new Set(
      formData
        .getAll("recommendation_id")
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
}

async function visibleRecommendedIds(
  db: D1Database,
  formData: FormData,
) {
  const sourceId = toOptionalInteger(formData.get("filter_source"));
  const employeeId = toOptionalInteger(
    formData.get("filter_employee"),
  );
  const minScore = clampScore(
    String(formData.get("filter_min_score") ?? "0"),
  );
  const conditions = [
    "r.status = 'recommended'",
    "r.score >= ?",
  ];
  const bindings: Array<number> = [minScore];

  if (sourceId) {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM connection_prospect_sources cps
        WHERE cps.prospect_id = r.prospect_id
          AND cps.source_id = ?
      )
    `);
    bindings.push(sourceId);
  }

  if (employeeId) {
    conditions.push("r.employee_id = ?");
    bindings.push(employeeId);
  }

  const result = await db
    .prepare(`
      SELECT r.id
      FROM connection_recommendations r
      WHERE ${conditions.join(" AND ")}
      ORDER BY r.score DESC
      LIMIT 500
    `)
    .bind(...bindings)
    .all<{ id: number }>();

  return (result.results ?? []).map((row) => row.id);
}

export async function loader({
  request,
  context,
}: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const url = new URL(request.url);
  const sourceId = toOptionalInteger(url.searchParams.get("source"));
  const employeeId = toOptionalInteger(
    url.searchParams.get("employee"),
  );
  const requestedStatus = url.searchParams.get("status");
  const status = recommendationStatuses.some(
    (value) => value === requestedStatus,
  )
    ? requestedStatus!
    : "recommended";
  const minScore = clampScore(url.searchParams.get("min_score"));
  const conditions = ["r.status = ?", "r.score >= ?"];
  const bindings: Array<string | number> = [status, minScore];

  if (sourceId) {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM connection_prospect_sources cps_filter
        WHERE cps_filter.prospect_id = r.prospect_id
          AND cps_filter.source_id = ?
      )
    `);
    bindings.push(sourceId);
  }

  if (employeeId) {
    conditions.push("r.employee_id = ?");
    bindings.push(employeeId);
  }

  const [
    sourcesQuery,
    employeesQuery,
    recommendationsQuery,
    summary,
  ] = await Promise.all([
    env.linkedinadam_db
      .prepare(`
        SELECT
          s.*,
          (
            SELECT COUNT(*)
            FROM connection_prospect_sources cps
            WHERE cps.source_id = s.id
          ) AS prospect_count,
          (
            SELECT COUNT(DISTINCT r.id)
            FROM connection_prospect_sources cps
            JOIN connection_recommendations r
              ON r.prospect_id = cps.prospect_id
            WHERE cps.source_id = s.id
          ) AS recommendation_count
        FROM connection_sources s
        ORDER BY s.created_at DESC
      `)
      .all<Source>(),
    env.linkedinadam_db
      .prepare(`
        SELECT
          e.id,
          e.name,
          e.role_name,
          ep.playbook_id
        FROM employees e
        LEFT JOIN employee_playbooks ep
          ON ep.employee_id = e.id
        WHERE e.status = 'active'
        ORDER BY e.name
      `)
      .all<Employee>(),
    env.linkedinadam_db
      .prepare(`
        SELECT
          r.id,
          r.prospect_id,
          p.name AS prospect_name,
          p.job_title,
          p.company_name,
          p.location,
          p.linkedin_profile_url,
          r.employee_id,
          e.name AS employee_name,
          r.playbook_id,
          pb.role_name AS playbook_name,
          r.score,
          r.relevance_reason,
          r.suggested_note,
          r.status,
          r.reviewed_by,
          r.review_note,
          r.reviewed_at,
          r.sent_at,
          r.accepted_at,
          r.follow_up_due,
          GROUP_CONCAT(DISTINCT s.name) AS source_names,
          r.updated_at
        FROM connection_recommendations r
        JOIN connection_prospects p ON p.id = r.prospect_id
        JOIN employees e ON e.id = r.employee_id
        JOIN playbooks pb ON pb.id = r.playbook_id
        LEFT JOIN connection_prospect_sources cps
          ON cps.prospect_id = p.id
        LEFT JOIN connection_sources s ON s.id = cps.source_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY r.id
        ORDER BY r.score DESC, r.updated_at DESC
        LIMIT 500
      `)
      .bind(...bindings)
      .all<Recommendation>(),
    env.linkedinadam_db
      .prepare(`
        SELECT
          SUM(CASE WHEN status = 'recommended' THEN 1 ELSE 0 END)
            AS recommended,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)
            AS approved,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END)
            AS sent,
          SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END)
            AS accepted
        FROM connection_recommendations
      `)
      .first<Summary>(),
  ]);

  return {
    sources: sourcesQuery.results ?? [],
    employees: employeesQuery.results ?? [],
    recommendations: recommendationsQuery.results ?? [],
    filters: {
      sourceId,
      employeeId,
      status,
      minScore,
    },
    summary: summary ?? {
      recommended: 0,
      approved: 0,
      sent: 0,
      accepted: 0,
    },
  };
}

export async function action({
  request,
  context,
}: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const db = env.linkedinadam_db;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const actorName = String(
    formData.get("actor_name") ?? "",
  ).trim();

  if (intent === "create_source") {
    const sourceType = String(
      formData.get("source_type") ?? "",
    );
    const name = String(formData.get("name") ?? "").trim();
    const sourceText = String(
      formData.get("source_text") ?? "",
    ).trim();
    const notes = String(formData.get("notes") ?? "").trim();

    if (
      !sourceTypes.some(([value]) => value === sourceType) ||
      !name ||
      !actorName
    ) {
      return {
        error:
          "Source type, source name, and your name are required.",
      };
    }

    let sourceUrl: string | null;

    try {
      sourceUrl = toSafeUrl(formData.get("source_url"));
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Enter a valid source URL.",
      };
    }

    try {
      await db
        .prepare(`
          INSERT INTO connection_sources (
            source_type,
            name,
            source_url,
            source_text,
            notes,
            created_by
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .bind(
          sourceType,
          name,
          sourceUrl,
          sourceText || null,
          notes || null,
          actorName,
        )
        .run();
    } catch (error) {
      console.error(
        "Connection source creation failed.",
        error instanceof Error ? error.name : "unknown",
      );
      return { error: "The connection source could not be saved." };
    }

    return { success: `Saved source “${name}”.` };
  }

  if (intent === "import_prospects") {
    const sourceId = toOptionalInteger(formData.get("source_id"));
    const sourceContext = String(
      formData.get("source_context") ?? "",
    ).trim();
    let prospects;

    if (!sourceId) {
      return { error: "Select a source before importing prospects." };
    }

    try {
      prospects = parseProspectRows(
        String(formData.get("prospect_rows") ?? ""),
      );
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "The prospect list could not be parsed.",
      };
    }

    try {
      const source = await db
        .prepare("SELECT id FROM connection_sources WHERE id = ?")
        .bind(sourceId)
        .first<{ id: number }>();

      if (!source) {
        return { error: "The selected source no longer exists." };
      }

      let created = 0;
      let linked = 0;

      for (const prospect of prospects) {
        const saved = await findOrCreateProspect(db, prospect);
        created += saved.created ? 1 : 0;
        const result = await db
          .prepare(`
            INSERT OR IGNORE INTO connection_prospect_sources (
              prospect_id,
              source_id,
              source_context
            )
            VALUES (?, ?, ?)
          `)
          .bind(saved.id, sourceId, sourceContext || null)
          .run();
        linked += result.meta.changes ? 1 : 0;
      }

      return {
        success:
          `Imported ${created} new prospect${created === 1 ? "" : "s"} and linked ${linked} to this source.`,
      };
    } catch (error) {
      console.error(
        "Prospect import failed.",
        error instanceof Error ? error.name : "unknown",
      );
      return {
        error:
          "The prospects could not be imported. No LinkedIn account was accessed.",
      };
    }
  }

  if (intent === "analyze_source") {
    const sourceId = toOptionalInteger(formData.get("source_id"));

    if (!sourceId) {
      return { error: "Select a valid source to analyze." };
    }

    if (!env.OPENAI_API_KEY) {
      return { error: "The OpenAI API key is not configured." };
    }

    try {
      const [source, prospectsQuery, assignmentsQuery] =
        await Promise.all([
          db
            .prepare(`
              SELECT id, source_type, name, source_text
              FROM connection_sources
              WHERE id = ?
            `)
            .bind(sourceId)
            .first<{
              id: number;
              source_type: string;
              name: string;
              source_text: string | null;
            }>(),
          db
            .prepare(`
              SELECT
                p.id,
                p.name,
                p.job_title AS jobTitle,
                p.company_name AS companyName,
                p.location,
                cps.source_context AS sourceContext
              FROM connection_prospects p
              JOIN connection_prospect_sources cps
                ON cps.prospect_id = p.id
              LEFT JOIN connection_recommendations r
                ON r.prospect_id = p.id
              WHERE cps.source_id = ? AND r.id IS NULL
              ORDER BY p.created_at
              LIMIT 25
            `)
            .bind(sourceId)
            .all<ProspectForRecommendation>(),
          db
            .prepare(`
              SELECT
                e.id AS employeeId,
                e.name AS employeeName,
                p.id AS playbookId,
                p.role_name AS roleName,
                p.primary_audience AS primaryAudience,
                p.secondary_audience AS secondaryAudience,
                p.primary_expertise AS primaryExpertise,
                p.qualified_buying_signal AS qualifiedBuyingSignal,
                p.guardrail
              FROM employees e
              JOIN employee_playbooks ep ON ep.employee_id = e.id
              JOIN playbooks p ON p.id = ep.playbook_id
              WHERE e.status = 'active'
              ORDER BY e.name
            `)
            .all<EmployeePlaybookForRecommendation>(),
        ]);

      const prospects = prospectsQuery.results ?? [];
      const assignments = assignmentsQuery.results ?? [];

      if (!source) {
        return { error: "The selected source no longer exists." };
      }

      if (!prospects.length) {
        return {
          error:
            "This source has no unscored prospects. Import more people or review its existing recommendations.",
        };
      }

      if (!assignments.length) {
        return {
          error:
            "Add active employees with assigned playbooks before generating recommendations.",
        };
      }

      const recommendations =
        await generateConnectionRecommendations({
          apiKey: env.OPENAI_API_KEY,
          prospects,
          assignments,
          sourceName: source.name,
          sourceType: source.source_type,
          sourceText: source.source_text,
        });

      const statements: D1PreparedStatement[] = [];

      for (const recommendation of recommendations) {
        statements.push(
          db
            .prepare(`
              INSERT INTO connection_recommendations (
                prospect_id,
                employee_id,
                playbook_id,
                score,
                relevance_reason,
                suggested_note
              )
              VALUES (?, ?, ?, ?, ?, ?)
            `)
            .bind(
              recommendation.prospect_id,
              recommendation.employee_id,
              recommendation.playbook_id,
              recommendation.score,
              recommendation.relevance_reason,
              recommendation.suggested_note,
            ),
        );
      }

      const results = await db.batch(statements);
      const eventStatements: D1PreparedStatement[] = [];

      results.forEach((result) => {
        eventStatements.push(
          db
            .prepare(`
              INSERT INTO connection_recommendation_events (
                recommendation_id,
                from_status,
                to_status,
                actor_name,
                note
              )
              VALUES (?, NULL, 'recommended', ?, ?)
            `)
            .bind(
              Number(result.meta.last_row_id),
              actorName || "AI recommendation workflow",
              `Generated from source: ${source.name}`,
            ),
        );
      });

      if (eventStatements.length) {
        await db.batch(eventStatements);
      }

      return {
        success:
          `Generated ${recommendations.length} connection recommendation${recommendations.length === 1 ? "" : "s"}.`,
      };
    } catch (error) {
      console.error(
        "Connection recommendation generation failed.",
        error instanceof Error ? error.name : "unknown",
      );
      return {
        error: getSafeOpenAIErrorMessage(
          error,
          "recommendation",
        ),
      };
    }
  }

  if (
    intent === "approve_selected" ||
    intent === "reject_selected" ||
    intent === "approve_all_visible"
  ) {
    if (!actorName) {
      return { error: "Your name is required for the audit trail." };
    }

    const nextStatus =
      intent === "reject_selected" ? "rejected" : "approved";
    const reviewNote = String(
      formData.get("review_note") ?? "",
    ).trim();
    const ids =
      intent === "approve_all_visible"
        ? await visibleRecommendedIds(db, formData)
        : selectedRecommendationIds(formData);

    if (!ids.length) {
      return {
        error:
          "Select at least one recommended connection to review.",
      };
    }

    try {
      const placeholders = ids.map(() => "?").join(", ");
      const existing = await db
        .prepare(`
          SELECT id
          FROM connection_recommendations
          WHERE id IN (${placeholders})
            AND status = 'recommended'
        `)
        .bind(...ids)
        .all<{ id: number }>();
      const validIds = (existing.results ?? []).map((row) => row.id);

      if (!validIds.length) {
        return {
          error:
            "The selected recommendations are no longer awaiting review.",
        };
      }

      const statements: D1PreparedStatement[] = [];

      for (const id of validIds) {
        statements.push(
          db
            .prepare(`
              UPDATE connection_recommendations
              SET
                status = ?,
                reviewed_by = ?,
                review_note = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND status = 'recommended'
            `)
            .bind(
              nextStatus,
              actorName,
              reviewNote || null,
              id,
            ),
          db
            .prepare(`
              INSERT INTO connection_recommendation_events (
                recommendation_id,
                from_status,
                to_status,
                actor_name,
                note
              )
              VALUES (?, 'recommended', ?, ?, ?)
            `)
            .bind(
              id,
              nextStatus,
              actorName,
              reviewNote || null,
            ),
        );
      }

      await db.batch(statements);

      return {
        success:
          `${nextStatus === "approved" ? "Approved" : "Rejected"} ${validIds.length} recommendation${validIds.length === 1 ? "" : "s"}.`,
      };
    } catch (error) {
      console.error(
        "Bulk connection review failed.",
        error instanceof Error ? error.name : "unknown",
      );
      return { error: "The bulk review could not be saved." };
    }
  }

  if (intent === "reassign") {
    const recommendationId = toOptionalInteger(
      formData.get("recommendation_id"),
    );
    const employeeId = toOptionalInteger(formData.get("employee_id"));

    if (!recommendationId || !employeeId || !actorName) {
      return {
        error:
          "Recommendation, employee, and reviewer are required.",
      };
    }

    const assignment = await db
      .prepare(`
        SELECT ep.playbook_id, e.name
        FROM employee_playbooks ep
        JOIN employees e ON e.id = ep.employee_id
        WHERE ep.employee_id = ? AND e.status = 'active'
      `)
      .bind(employeeId)
      .first<{ playbook_id: number; name: string }>();

    const current = await db
      .prepare(`
        SELECT status
        FROM connection_recommendations
        WHERE id = ?
      `)
      .bind(recommendationId)
      .first<{ status: string }>();

    if (!assignment || !current) {
      return {
        error:
          "The recommendation or employee assignment no longer exists.",
      };
    }

    if (!["recommended", "approved"].includes(current.status)) {
      return {
        error:
          "Only recommended or approved connections can be reassigned.",
      };
    }

    await db.batch([
      db
        .prepare(`
          UPDATE connection_recommendations
          SET
            employee_id = ?,
            playbook_id = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(employeeId, assignment.playbook_id, recommendationId),
      db
        .prepare(`
          INSERT INTO connection_recommendation_events (
            recommendation_id,
            from_status,
            to_status,
            actor_name,
            note
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          recommendationId,
          current.status,
          current.status,
          actorName,
          `Reassigned to ${assignment.name}.`,
        ),
    ]);

    return { success: `Reassigned to ${assignment.name}.` };
  }

  if (intent === "update_connection_status") {
    const recommendationId = toOptionalInteger(
      formData.get("recommendation_id"),
    );
    const nextStatus = String(formData.get("next_status") ?? "");
    const note = String(formData.get("note") ?? "").trim();

    if (!recommendationId || !actorName) {
      return {
        error: "Recommendation and employee name are required.",
      };
    }

    const current = await db
      .prepare(`
        SELECT status
        FROM connection_recommendations
        WHERE id = ?
      `)
      .bind(recommendationId)
      .first<{ status: string }>();
    const allowedTransitions: Record<string, string[]> = {
      approved: ["sent", "withdrawn"],
      sent: ["accepted", "declined", "withdrawn"],
      accepted: ["withdrawn"],
    };

    if (
      !current ||
      !allowedTransitions[current.status]?.includes(nextStatus)
    ) {
      return {
        error:
          "That connection status change is not allowed from its current state.",
      };
    }

    await db.batch([
      db
        .prepare(`
          UPDATE connection_recommendations
          SET
            status = ?,
            sent_at = CASE
              WHEN ? = 'sent' THEN CURRENT_TIMESTAMP
              ELSE sent_at
            END,
            accepted_at = CASE
              WHEN ? = 'accepted' THEN CURRENT_TIMESTAMP
              ELSE accepted_at
            END,
            follow_up_due = CASE
              WHEN ? = 'accepted'
                THEN DATETIME(CURRENT_TIMESTAMP, '+7 days')
              ELSE follow_up_due
            END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(
          nextStatus,
          nextStatus,
          nextStatus,
          nextStatus,
          recommendationId,
        ),
      db
        .prepare(`
          INSERT INTO connection_recommendation_events (
            recommendation_id,
            from_status,
            to_status,
            actor_name,
            note
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          recommendationId,
          current.status,
          nextStatus,
          actorName,
          note || null,
        ),
    ]);

    return {
      success: `Connection marked ${nextStatus}.`,
    };
  }

  return { error: "Choose a valid connection-growth action." };
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export default function Connections({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const {
    sources,
    employees,
    recommendations,
    filters,
    summary,
  } = loaderData;
  const filterParams = {
    filter_source: filters.sourceId ?? "",
    filter_employee: filters.employeeId ?? "",
    filter_min_score: filters.minScore,
  };

  return (
    <main className="connections-page">
      <header className="connections-header">
        <Link className="back-link" to="/">
          ← Dashboard
        </Link>
        <p className="eyebrow">AUDIENCE GROWTH</p>
        <h1>Recommended connections</h1>
        <p>
          Import permitted prospect data, match people to employee
          playbooks, approve centrally, and keep the final LinkedIn
          invitation human-operated.
        </p>
      </header>

      {actionData?.error ? (
        <p className="form-error">{actionData.error}</p>
      ) : null}
      {actionData?.success ? (
        <p className="form-success">{actionData.success}</p>
      ) : null}

      <section className="connection-stats">
        <article>
          <span>Awaiting review</span>
          <strong>{summary.recommended ?? 0}</strong>
        </article>
        <article>
          <span>Approved queue</span>
          <strong>{summary.approved ?? 0}</strong>
        </article>
        <article>
          <span>Sent manually</span>
          <strong>{summary.sent ?? 0}</strong>
        </article>
        <article>
          <span>Accepted</span>
          <strong>{summary.accepted ?? 0}</strong>
        </article>
      </section>

      <section className="connection-setup-grid">
        <details className="panel connection-setup" open>
          <summary>
            <div>
              <span className="eyebrow">STEP 1</span>
              <strong>Save a group, post, or import source</strong>
            </div>
            <span>Expand / collapse</span>
          </summary>
          <Form method="post" className="connection-form">
            <input type="hidden" name="intent" value="create_source" />
            <label>
              Source type
              <select name="source_type" defaultValue="group">
                {sourceTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source name
              <input
                name="name"
                required
                placeholder="Retail Technology Leaders group"
              />
            </label>
            <label>
              LinkedIn or source URL
              <input
                name="source_url"
                type="url"
                placeholder="https://www.linkedin.com/…"
              />
            </label>
            <label>
              Your name
              <input name="actor_name" required placeholder="Adam" />
            </label>
            <label className="connection-field-wide">
              Visible post text or search context
              <textarea
                name="source_text"
                rows={5}
                placeholder="Paste the post text, group description, or search criteria. The app does not fetch or scrape LinkedIn."
              />
            </label>
            <label className="connection-field-wide">
              Internal notes
              <textarea name="notes" rows={3} />
            </label>
            <button disabled={isSubmitting}>Save source</button>
          </Form>
        </details>

        <details className="panel connection-setup" open>
          <summary>
            <div>
              <span className="eyebrow">STEP 2</span>
              <strong>Paste people from an approved source</strong>
            </div>
            <span>Expand / collapse</span>
          </summary>
          <Form method="post" className="connection-form">
            <input
              type="hidden"
              name="intent"
              value="import_prospects"
            />
            <label className="connection-field-wide">
              Source
              <select name="source_id" required defaultValue="">
                <option value="" disabled>
                  Select a saved source
                </option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="connection-field-wide">
              People — one per line
              <textarea
                name="prospect_rows"
                rows={9}
                required
                placeholder={
                  "Name\tTitle\tCompany\tLocation\tLinkedIn profile URL\nJane Smith\tVP Infrastructure\tExample Co\tChicago\thttps://www.linkedin.com/in/jane-smith"
                }
              />
              <small>
                Tab-separated is recommended. Comma-separated rows are
                also accepted. Name is required; other fields are
                optional.
              </small>
            </label>
            <label className="connection-field-wide">
              Context shared by these people
              <textarea
                name="source_context"
                rows={3}
                placeholder="Commented on the pasted outage-resilience post."
              />
            </label>
            <button disabled={isSubmitting}>Import and deduplicate</button>
          </Form>
        </details>
      </section>

      <section className="panel source-library">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">STEP 3</p>
            <h2>Source library and AI matching</h2>
          </div>
        </div>
        {sources.length ? (
          <div className="source-list">
            {sources.map((source) => (
              <article key={source.id}>
                <div>
                  <span className="source-type">
                    {statusLabel(source.source_type)}
                  </span>
                  <strong>{source.name}</strong>
                  <p>
                    {source.prospect_count} prospects ·{" "}
                    {source.recommendation_count} recommendations
                  </p>
                </div>
                <div className="source-actions">
                  {source.source_url ? (
                    <a
                      href={source.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open source
                    </a>
                  ) : null}
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="analyze_source"
                    />
                    <input
                      type="hidden"
                      name="source_id"
                      value={source.id}
                    />
                    <input
                      type="hidden"
                      name="actor_name"
                      value="AI recommendation workflow"
                    />
                    <button disabled={isSubmitting}>
                      Score unreviewed prospects
                    </button>
                  </Form>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Save a group, post, or import source to begin.
          </p>
        )}
      </section>

      <section className="panel recommendation-workspace">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">CENTRAL REVIEW</p>
            <h2>Connection recommendations</h2>
          </div>
        </div>

        <Form method="get" className="connection-filters">
          <label>
            Status
            <select name="status" defaultValue={filters.status}>
              {recommendationStatuses.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select
              name="source"
              defaultValue={filters.sourceId ?? ""}
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Employee
            <select
              name="employee"
              defaultValue={filters.employeeId ?? ""}
            >
              <option value="">All employees</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Minimum score
            <input
              type="number"
              name="min_score"
              min={0}
              max={100}
              defaultValue={filters.minScore}
            />
          </label>
          <button>Apply filters</button>
        </Form>

        <Form method="post" className="bulk-review-form">
          <input
            type="hidden"
            name="filter_source"
            value={filterParams.filter_source}
          />
          <input
            type="hidden"
            name="filter_employee"
            value={filterParams.filter_employee}
          />
          <input
            type="hidden"
            name="filter_min_score"
            value={filterParams.filter_min_score}
          />
          {filters.status === "recommended" ? (
            <div className="bulk-review-bar">
              <label>
                Reviewer
                <input
                  name="actor_name"
                  required
                  placeholder="Adam"
                />
              </label>
              <label>
                Review note
                <input
                  name="review_note"
                  placeholder="Optional audit note"
                />
              </label>
              <div>
                <button
                  name="intent"
                  value="approve_selected"
                  disabled={isSubmitting}
                >
                  Approve selected
                </button>
                <button
                  className="danger-secondary"
                  name="intent"
                  value="reject_selected"
                  disabled={isSubmitting}
                >
                  Reject selected
                </button>
                <button
                  name="intent"
                  value="approve_all_visible"
                  disabled={isSubmitting}
                  onClick={(event) => {
                    if (
                      !window.confirm(
                        "Approve every recommended connection matching the current source, employee, and score filters?",
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  Approve all visible
                </button>
              </div>
            </div>
          ) : null}

          {recommendations.length ? (
            <div className="recommendation-list">
              {recommendations.map((recommendation) => (
                <details
                  className="recommendation-card"
                  key={recommendation.id}
                >
                  <summary>
                    {filters.status === "recommended" ? (
                      <input
                        aria-label={`Select ${recommendation.prospect_name}`}
                        type="checkbox"
                        name="recommendation_id"
                        value={recommendation.id}
                        onClick={(event) => event.stopPropagation()}
                      />
                    ) : null}
                    <div className="recommendation-person">
                      <strong>{recommendation.prospect_name}</strong>
                      <span>
                        {[
                          recommendation.job_title,
                          recommendation.company_name,
                          recommendation.location,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Prospect details not supplied"}
                      </span>
                    </div>
                    <div className="recommendation-assignment">
                      <span>{recommendation.employee_name}</span>
                      <small>{recommendation.playbook_name}</small>
                    </div>
                    <span className="score-badge">
                      {recommendation.score}
                    </span>
                  </summary>
                  <div className="recommendation-details">
                    <div>
                      <span>Why this match</span>
                      <p>{recommendation.relevance_reason}</p>
                    </div>
                    <div>
                      <span>Suggested invitation note</span>
                      <textarea
                        readOnly
                        rows={3}
                        value={recommendation.suggested_note ?? ""}
                      />
                      <small>
                        Review and copy this note only when manually
                        sending the invitation in LinkedIn.
                      </small>
                    </div>
                    <div className="recommendation-meta">
                      <span>
                        Sources: {recommendation.source_names || "Unknown"}
                      </span>
                      <span>
                        Status: {statusLabel(recommendation.status)}
                      </span>
                      {recommendation.follow_up_due ? (
                        <span>
                          Follow-up due:{" "}
                          {recommendation.follow_up_due}
                        </span>
                      ) : null}
                    </div>
                    {recommendation.linkedin_profile_url ? (
                      <a
                        className="button-link"
                        href={recommendation.linkedin_profile_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open LinkedIn profile
                      </a>
                    ) : (
                      <p className="connection-warning">
                        Add a profile URL before attempting this
                        connection.
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              No recommendations match these filters.
            </p>
          )}
        </Form>
      </section>

      {filters.status !== "recommended" &&
      recommendations.length ? (
        <section className="panel connection-action-queue">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">HUMAN ACTION QUEUE</p>
              <h2>Assignment and status controls</h2>
            </div>
          </div>
          <div className="action-queue-list">
            {recommendations.map((recommendation) => (
              <article key={recommendation.id}>
                <div>
                  <strong>{recommendation.prospect_name}</strong>
                  <p>
                    {recommendation.employee_name} ·{" "}
                    {statusLabel(recommendation.status)}
                  </p>
                </div>
                {["recommended", "approved"].includes(
                  recommendation.status,
                ) ? (
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="reassign"
                    />
                    <input
                      type="hidden"
                      name="recommendation_id"
                      value={recommendation.id}
                    />
                    <input
                      name="actor_name"
                      required
                      placeholder="Your name"
                    />
                    <select
                      name="employee_id"
                      defaultValue={recommendation.employee_id}
                    >
                      {employees
                        .filter((employee) => employee.playbook_id)
                        .map((employee) => (
                          <option
                            key={employee.id}
                            value={employee.id}
                          >
                            {employee.name}
                          </option>
                        ))}
                    </select>
                    <button disabled={isSubmitting}>Reassign</button>
                  </Form>
                ) : null}
                {["approved", "sent", "accepted"].includes(
                  recommendation.status,
                ) ? (
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="update_connection_status"
                    />
                    <input
                      type="hidden"
                      name="recommendation_id"
                      value={recommendation.id}
                    />
                    <input
                      name="actor_name"
                      required
                      placeholder="Employee name"
                    />
                    <select name="next_status">
                      {recommendation.status === "approved" ? (
                        <>
                          <option value="sent">
                            Mark manually sent
                          </option>
                          <option value="withdrawn">Withdraw</option>
                        </>
                      ) : null}
                      {recommendation.status === "sent" ? (
                        <>
                          <option value="accepted">
                            Mark accepted
                          </option>
                          <option value="declined">
                            Mark declined
                          </option>
                          <option value="withdrawn">Withdraw</option>
                        </>
                      ) : null}
                      {recommendation.status === "accepted" ? (
                        <option value="withdrawn">Close / withdraw</option>
                      ) : null}
                    </select>
                    <input name="note" placeholder="Optional note" />
                    <button disabled={isSubmitting}>Update</button>
                  </Form>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <aside className="connection-policy-note">
        <strong>LinkedIn safety boundary</strong>
        <p>
          This workspace does not scrape LinkedIn, browse group
          membership, or send invitations. Every invitation remains a
          deliberate human action in LinkedIn.
        </p>
      </aside>
    </main>
  );
}
