import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/development-environments";
import {
  requireAuthenticatedUser,
  type AccessEnvironment,
} from "../lib/auth.server";
import {
  environmentQaForRequest,
  getEnvironmentQaSummary,
  listDevelopmentEnvironments,
  listEnvironmentQaQueue,
  recordEnvironmentQaAttempt,
} from "../lib/development/environments.server";
import {
  composeEnvironmentTestUrl,
  type EnvironmentQaRow,
} from "../lib/development/environments";
import { statusLabel, statusTone } from "../lib/development/status";
import { getEnvironmentQaReadiness } from "../lib/development/environment-readiness.server";

type Env = AccessEnvironment & { linkedinadam_db: D1Database };

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as Env;
  const user = await requireAuthenticatedUser(request, env);
  const selectedRequest = new URL(request.url).searchParams.get("request");
  const readiness = await getEnvironmentQaReadiness(env.linkedinadam_db);
  if (readiness.state === "ERROR") throw readiness.error;
  if (readiness.state === "NOT_INITIALIZED")
    return {
      environments: [],
      queue: [],
      summary: { needsAdam: 0, needsJoe: 0, failedRetest: 0, readyForDev: 0 },
      user,
      initialized: false,
      selectedRequest,
    };
  const [environments, queue, summary] = await Promise.all([
    listDevelopmentEnvironments(env.linkedinadam_db),
    selectedRequest
      ? environmentQaForRequest(env.linkedinadam_db, selectedRequest).then(
          (results) => ({ results }),
        )
      : listEnvironmentQaQueue(env.linkedinadam_db),
    getEnvironmentQaSummary(env.linkedinadam_db),
  ]);
  return {
    environments: environments.results || [],
    queue: queue.results || [],
    summary,
    user,
    initialized: true,
    selectedRequest,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as unknown as Env;
  const user = await requireAuthenticatedUser(request, env);
  const readiness = await getEnvironmentQaReadiness(env.linkedinadam_db);
  if (readiness.state === "ERROR") throw readiness.error;
  if (readiness.state === "NOT_INITIALIZED")
    return {
      error: "Environment QA workspace is awaiting database initialization.",
    };
  const data = await request.formData();
  try {
    await recordEnvironmentQaAttempt(env.linkedinadam_db, user, {
      requestId: String(data.get("request_id") || ""),
      environmentId: Number(data.get("environment_id")),
      stage: String(data.get("stage") || ""),
      status: String(data.get("status") || ""),
      notes: String(data.get("notes") || ""),
    });
    return { ok: true, message: "Environment QA result recorded." };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Unable to record QA result.",
    };
  }
}

function QaStatus({ value }: { value: string }) {
  return (
    <span className={`development-status ${statusTone(value)}`}>
      {statusLabel(value)}
    </span>
  );
}

function EnvironmentQaCard({ row }: { row: EnvironmentQaRow }) {
  const testLink = composeEnvironmentTestUrl(row.base_url, row.test_path);
  return (
    <article className="environment-qa-card">
      <header>
        <div>
          <strong>
            {row.external_key || row.request_id.slice(0, 8)} — {row.title}
          </strong>
          <span>
            {row.priority} · {row.environment_name}
          </span>
        </div>
        <QaStatus value={row.qa_status} />
      </header>
      <dl>
        <div>
          <dt>Test URL</dt>
          <dd>
            <a href={testLink.url} target="_blank" rel="noreferrer">
              {testLink.url} ↗
            </a>
            {!testLink.specific ? (
              <small>Specific test route required</small>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Login As</dt>
          <dd>{row.test_user || "Not provided"}</dd>
        </div>
        <div>
          <dt>Navigation</dt>
          <dd>{row.navigation || "Not provided"}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>{row.test_steps || "Not provided"}</dd>
        </div>
        <div>
          <dt>Expected</dt>
          <dd>{row.expected_result || "Not provided"}</dd>
        </div>
        <div>
          <dt>Tester</dt>
          <dd>{row.tester_name || "Not tested"}</dd>
        </div>
        <div>
          <dt>Tested At</dt>
          <dd>{row.tested_at || "Never"}</dd>
        </div>
        {row.qa_notes ? (
          <div>
            <dt>Notes</dt>
            <dd>{row.qa_notes}</dd>
          </div>
        ) : null}
      </dl>
      <div className="environment-qa-actions">
        <a
          className="button-link"
          href={testLink.url}
          target="_blank"
          rel="noreferrer"
        >
          Open &amp; Test
        </a>
        <Link
          className="secondary-link"
          to={`/development?request=${row.request_id}&tab=qa`}
        >
          View QA Instructions
        </Link>
      </div>
      <Form method="post" className="environment-result-form">
        <input type="hidden" name="request_id" value={row.request_id} />
        <input type="hidden" name="environment_id" value={row.environment_id} />
        <input type="hidden" name="stage" value={row.stage} />
        <label>
          Status
          <select name="status" defaultValue={row.qa_status}>
            {["not_ready", "ready_to_test", "testing", "passed", "failed"].map(
              (status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Notes
          <input
            name="notes"
            aria-label={`${row.environment_name} QA notes for ${row.title}`}
            placeholder="Required when failed"
          />
        </label>
        <button type="submit">Record result</button>
      </Form>
    </article>
  );
}

export default function DevelopmentEnvironments({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const queues = {
    adam: loaderData.queue.filter(
      (row) =>
        row.environment_slug === "adam" &&
        (row.overall_status === "awaiting_adam" || row.qa_status === "failed"),
    ),
    joe: loaderData.queue.filter(
      (row) =>
        row.environment_slug === "joe" &&
        (row.overall_status === "awaiting_joe" || row.qa_status === "failed"),
    ),
    ready: loaderData.queue.filter(
      (row) => row.overall_status === "ready_for_dev",
    ),
  };
  return (
    <main className="development-page environment-workspace">
      <header className="development-header">
        <div>
          <p className="eyebrow">DEVELOPMENT / HUMAN VERIFICATION</p>
          <h1>Environments &amp; QA</h1>
          <p>
            Open Net-X test environments, run request-specific QA, and record
            verification before promotion.
          </p>
        </div>
        <div className="development-header-actions">
          <Link className="secondary-link" to="/development">
            Requests
          </Link>
          <Link className="secondary-link" to="/development/console">
            Development Console
          </Link>
        </div>
      </header>

      <nav className="development-subnav" aria-label="Development navigation">
        <Link to="/development">Requests</Link>
        <Link aria-current="page" to="/development/environments">
          Environments &amp; QA
        </Link>
        <Link to="/development/console">Development Console</Link>
      </nav>

      {actionData?.error ? (
        <p className="form-message error" role="alert">
          {actionData.error}
        </p>
      ) : actionData?.message ? (
        <p className="form-message success" role="status">
          {actionData.message}
        </p>
      ) : null}

      {!loaderData.initialized ? (
        <section className="panel agent-initialization-state">
          <strong>Environment QA workspace not initialized</strong>
          <p>
            Development requests and existing QA remain available. Apply
            migration 0018 to activate environment verification.
          </p>
        </section>
      ) : null}

      {loaderData.initialized ? (
        <>
          <section
            className="environment-summary"
            aria-label="Environment QA summary"
          >
            <a href="#needs-adam">
              <span>Needs Adam</span>
              <strong>{loaderData.summary.needsAdam}</strong>
            </a>
            <a href="#needs-joe">
              <span>Needs Joe</span>
              <strong>{loaderData.summary.needsJoe}</strong>
            </a>
            <a href="#failed-retest">
              <span>Failed / Retest</span>
              <strong>{loaderData.summary.failedRetest}</strong>
            </a>
            <a href="#ready-dev">
              <span>Ready for Dev</span>
              <strong>{loaderData.summary.readyForDev}</strong>
            </a>
          </section>

          <section
            className="environment-grid"
            aria-label="Net-X test environments"
          >
            {loaderData.environments.map((environment) => (
              <article className="environment-card" key={environment.id}>
                <header>
                  <div>
                    <p className="eyebrow">
                      {environment.environment_type.replaceAll("_", " ")}
                    </p>
                    <h2>{environment.name}</h2>
                  </div>
                  <span className="development-status">
                    Status not monitored
                  </span>
                </header>
                <p>{environment.purpose}</p>
                <dl>
                  <div>
                    <dt>Owner</dt>
                    <dd>{environment.owner_name}</dd>
                  </div>
                  <div>
                    <dt>Base URL</dt>
                    <dd>
                      <a
                        href={environment.base_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {environment.base_url}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Current QA workload</dt>
                    <dd>{environment.current_qa_workload}</dd>
                  </div>
                  <div>
                    <dt>Last verification</dt>
                    <dd>{environment.last_verification || "None recorded"}</dd>
                  </div>
                </dl>
                <a
                  className="button-link"
                  href={environment.base_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Environment
                </a>
              </article>
            ))}
          </section>

          {loaderData.selectedRequest ? (
            <section className="environment-queue panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">REQUEST-SPECIFIC QA</p>
                  <h2>Selected Request</h2>
                </div>
                <span>{loaderData.queue.length}</span>
              </div>
              <div className="environment-qa-grid">
                {loaderData.queue.map((row) => (
                  <EnvironmentQaCard
                    key={`selected-${row.request_id}-${row.environment_id}`}
                    row={row}
                  />
                ))}
              </div>
            </section>
          ) : (
            [
              { id: "needs-adam", title: "Needs Adam", rows: queues.adam },
              { id: "needs-joe", title: "Needs Joe", rows: queues.joe },
              {
                id: "failed-retest",
                title: "Failed / Retest",
                rows: loaderData.queue.filter(
                  (row) => row.qa_status === "failed",
                ),
              },
              { id: "ready-dev", title: "Ready for Dev", rows: queues.ready },
            ].map((section) => (
              <section
                className="environment-queue panel"
                id={section.id}
                key={section.id}
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">TEST QUEUE</p>
                    <h2>{section.title}</h2>
                  </div>
                  <span>{section.rows.length}</span>
                </div>
                {section.rows.length ? (
                  <div className="environment-qa-grid">
                    {section.rows.map((row) => (
                      <EnvironmentQaCard
                        key={`${section.id}-${row.request_id}-${row.environment_id}`}
                        row={row}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="empty-state">No requests in this queue.</p>
                )}
              </section>
            ))
          )}
          {navigation.state !== "idle" ? (
            <p className="sr-only" role="status">
              Saving QA result
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
