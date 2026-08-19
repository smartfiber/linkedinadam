import type { QaHandoff } from "../lib/development/types";
import { statusLabel, statusTone } from "../lib/development/status";

export function QaHandoffCard({ handoff }: { handoff: QaHandoff }) {
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
              <dd>{String(value)}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </article>
  );
}
