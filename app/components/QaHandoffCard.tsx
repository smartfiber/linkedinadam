import type { QaHandoff } from "../lib/development/types";
import { statusLabel, statusTone } from "../lib/development/status";
import { Form } from "react-router";

export function QaHandoffCard({
  handoff,
  requestId,
}: {
  handoff: QaHandoff;
  requestId: string;
}) {
  return (
    <article className="qa-handoff-card">
      <div className="development-detail-heading">
        <strong>{handoff.stage.replaceAll("_", " ")}</strong>
        <span className={`development-status ${statusTone(handoff.status)}`}>
          {statusLabel(handoff.status)}
        </span>
      </div>
      <dl className="qa-handoff-fields">
        {[
          ["Login As", handoff.test_user],
          ["Tenant", handoff.tenant],
          ["Login URL", handoff.login_url],
          ["Test URL", handoff.test_url],
          ["Navigation", handoff.navigation],
          ["Prerequisites", handoff.prerequisites],
          ["Steps", handoff.test_steps],
          ["Expected Result", handoff.expected_result],
          ["Automated Coverage", handoff.automated_coverage],
          ["Verified By", handoff.verified_by],
          ["Verified At", handoff.verified_at],
        ].map(([label, value]) =>
          value ? (
            <div key={String(label)}>
              <dt>{String(label)}</dt>
              <dd>
                {label === "Login URL" || label === "Test URL" ? (
                  <a href={String(value)} target="_blank" rel="noreferrer">
                    {String(value)}
                  </a>
                ) : (
                  String(value)
                )}
              </dd>
            </div>
          ) : null,
        )}
      </dl>
      <details className="qa-handoff-editor">
        <summary>Edit handoff</summary>
        <Form method="post" className="development-form compact-form">
          <input type="hidden" name="intent" value="save_handoff" />
          <input type="hidden" name="request_id" value={requestId} />
          <input type="hidden" name="stage" value={handoff.stage} />
          <div className="form-grid">
            <label>
              Test user
              <input name="test_user" defaultValue={handoff.test_user || ""} />
            </label>
            <label>
              Tenant / company
              <input name="tenant" defaultValue={handoff.tenant || ""} />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Login URL
              <input
                type="url"
                name="login_url"
                defaultValue={handoff.login_url || ""}
              />
            </label>
            <label>
              Test URL
              <input
                type="url"
                name="test_url"
                defaultValue={handoff.test_url || ""}
              />
            </label>
          </div>
          <label>
            Navigation
            <input name="navigation" defaultValue={handoff.navigation || ""} />
          </label>
          <label>
            Prerequisites
            <textarea
              name="prerequisites"
              rows={2}
              defaultValue={handoff.prerequisites || ""}
            />
          </label>
          <label>
            Test steps
            <textarea
              name="test_steps"
              rows={4}
              defaultValue={handoff.test_steps || ""}
            />
          </label>
          <label>
            Expected result
            <textarea
              name="expected_result"
              rows={2}
              defaultValue={handoff.expected_result || ""}
            />
          </label>
          <label>
            Automated coverage
            <textarea
              name="automated_coverage"
              rows={2}
              defaultValue={handoff.automated_coverage || ""}
            />
          </label>
          <label>
            Notes
            <textarea
              name="handoff_notes"
              rows={2}
              defaultValue={handoff.notes || ""}
            />
          </label>
          <label>
            Status
            <select name="handoff_status" defaultValue={handoff.status}>
              {[
                "pending",
                "in_progress",
                "passed",
                "failed",
                "blocked",
                "not_applicable",
              ].map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Save handoff</button>
        </Form>
      </details>
    </article>
  );
}
