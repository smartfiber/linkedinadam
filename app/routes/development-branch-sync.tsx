import { Link } from "react-router";
import type { Route } from "./+types/development-branch-sync";
import {
  requireAuthenticatedUser,
  type AccessEnvironment,
} from "../lib/auth.server";
import {
  getBranchMappings,
  listBranchSyncRows,
  summarizeBranchSync,
} from "../lib/development/branch-sync.server";
import {
  branchSyncGuidance,
  displayBranchState,
  rowMatchesBranchView,
  syncConfidence,
  type BranchSyncState,
} from "../lib/development/branch-sync";
import { statusLabel, statusTone } from "../lib/development/status";

type Env = AccessEnvironment & { linkedinadam_db: D1Database };

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as Env;
  const user = await requireAuthenticatedUser(request, env);
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "all";
  const [rows, mappings] = await Promise.all([
    listBranchSyncRows(env.linkedinadam_db),
    getBranchMappings(env.linkedinadam_db),
  ]);
  const joe = mappings.find((mapping) => mapping.role === "joe");
  const joeMapped = joe?.status === "MAPPED" && Boolean(joe.branchName);
  return {
    rows: rows.filter((row) => rowMatchesBranchView(row, view, joeMapped)),
    summary: summarizeBranchSync(rows, joeMapped),
    mappings,
    view,
    user,
  };
}

function BranchState({ value }: { value: BranchSyncState }) {
  const label = displayBranchState(value);
  const tone =
    label === "Exact" || label === "Present" || label === "Patch Equivalent"
      ? "complete"
      : label === "Conflict"
        ? "blocked"
        : label === "Not Present"
          ? ""
          : "attention";
  return (
    <span className={`development-status ${tone}`}>
      {label}
      {syncConfidence(value) !== "UNKNOWN" ? (
        <small>{syncConfidence(value).replaceAll("_", " ")}</small>
      ) : null}
    </span>
  );
}

const summaryLinks = [
  ["Adam Only", "adamOnly", "adam-only"],
  ["Joe Only", "joeOnly", "joe-only"],
  ["Personal → Dev", "personalDev", "personal-dev"],
  ["Dev → Main", "devMain", "dev-main"],
  ["Main Needs Verification", "mainVerify", "main-verify"],
  ["CI Blocking", "ciBlocking", "ci-blocking"],
  ["Mapping Required", "mappingRequired", "mapping-required"],
  ["Unknown", "unknown", "unknown"],
] as const;

export default function DevelopmentBranchSync({
  loaderData,
}: Route.ComponentProps) {
  const joe = loaderData.mappings.find((mapping) => mapping.role === "joe");
  const joeMapped = joe?.status === "MAPPED" && Boolean(joe.branchName);
  return (
    <main className="development-page branch-sync-page">
      <header className="development-header">
        <div>
          <p className="eyebrow">DEVELOPMENT / GIT STATE</p>
          <h1>Branch Sync</h1>
          <p>
            Compare Adam, Joe, dev, and main without treating branch presence as
            human QA.
          </p>
        </div>
        <div className="branch-mapping-summary" aria-label="Branch mappings">
          {loaderData.mappings.map((mapping) => (
            <span key={mapping.role}>
              <strong>{mapping.role}</strong>
              {mapping.branchName || mapping.status.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      </header>

      <nav className="development-subnav" aria-label="Development navigation">
        <Link to="/development">Requests</Link>
        <Link aria-current="page" to="/development/branch-sync">
          Branch Sync
        </Link>
        <Link to="/development/environments">Environments &amp; QA</Link>
        <Link to="/development/console">Development Console</Link>
      </nav>

      {!joeMapped ? (
        <section className="panel branch-mapping-warning" role="status">
          <strong>Joe branch mapping required</strong>
          <p>
            DEVOS found {joe?.candidates.length || 0} plausible candidates. An
            OWNER or ADMIN must confirm the mapping before personal-branch
            guidance is authoritative.
          </p>
        </section>
      ) : null}

      <section className="branch-summary" aria-label="Branch Sync summary">
        {summaryLinks.map(([label, key, view]) => (
          <Link
            className={loaderData.view === view ? "active" : ""}
            key={key}
            to={`/development/branch-sync?view=${view}`}
          >
            <span>{label}</span>
            <strong>{loaderData.summary[key]}</strong>
          </Link>
        ))}
      </section>

      <div className="branch-sync-toolbar">
        <nav aria-label="Branch comparison views">
          <Link
            className={loaderData.view === "all" ? "active" : ""}
            to="/development/branch-sync"
          >
            All GitHub work
          </Link>
          <Link
            className={loaderData.view === "adam-joe" ? "active" : ""}
            to="/development/branch-sync?view=adam-joe"
          >
            Adam ↔ Joe
          </Link>
          <Link
            className={loaderData.view === "dev-main" ? "active" : ""}
            to="/development/branch-sync?view=dev-main"
          >
            dev ↔ main
          </Link>
        </nav>
        <span>{loaderData.rows.length} records</span>
      </div>

      <section
        className="branch-matrix-wrap"
        aria-label="Branch comparison matrix"
      >
        <table className="branch-matrix">
          <thead>
            <tr>
              <th>Request</th>
              <th>Issue / PR</th>
              <th>Adam</th>
              <th>Joe</th>
              <th>dev</th>
              <th>main</th>
              <th>CI</th>
              <th>QA</th>
              <th>Next Promotion</th>
              <th>Sync Confidence</th>
              <th>Next Action</th>
            </tr>
          </thead>
          <tbody>
            {loaderData.rows.map((row) => {
              const guidance = branchSyncGuidance(row, joeMapped);
              const confidenceStates = [
                row.adam,
                row.joe,
                row.dev,
                row.main,
              ].map(syncConfidence);
              const confidence = confidenceStates.includes("UNKNOWN")
                ? "UNKNOWN"
                : confidenceStates.includes("PROBABLE")
                  ? "PROBABLE"
                  : confidenceStates.includes("PATCH_EQUIVALENT")
                    ? "PATCH_EQUIVALENT"
                    : "EXACT";
              return (
                <tr key={row.id}>
                  <td className="branch-request-cell">
                    <Link to={`/development?request=${row.id}`}>
                      {row.title}
                    </Link>
                    <small>{row.externalKey || row.id.slice(0, 8)}</small>
                    <details>
                      <summary>Why DEVOS thinks these differ</summary>
                      <div className="branch-difference-detail">
                        {(["adam", "joe", "dev", "main"] as const).map(
                          (branch) => (
                            <p key={branch}>
                              <strong>{branch}</strong>:{" "}
                              {row[branch].sha?.slice(0, 12) || "No SHA"} ·{" "}
                              {row[branch].comparison} ·{" "}
                              {syncConfidence(row[branch])}
                            </p>
                          ),
                        )}
                        <p>
                          PR:{" "}
                          {row.prNumber
                            ? `#${row.prNumber} · ${row.sourceBranch} → ${row.targetBranch}`
                            : "No PR linked"}
                        </p>
                        <p>
                          Files:{" "}
                          {row.changedFiles.length
                            ? row.changedFiles
                                .slice(0, 6)
                                .map((file) => file.filename)
                                .join(", ")
                            : "No changed-file summary available"}
                        </p>
                      </div>
                    </details>
                  </td>
                  <td>
                    {row.issueNumber && row.issueUrl ? (
                      <a href={row.issueUrl} target="_blank" rel="noreferrer">
                        Issue #{row.issueNumber}
                      </a>
                    ) : (
                      "—"
                    )}
                    {row.prNumber && row.prUrl ? (
                      <a href={row.prUrl} target="_blank" rel="noreferrer">
                        PR #{row.prNumber}
                      </a>
                    ) : null}
                  </td>
                  <td>
                    <BranchState value={row.adam} />
                  </td>
                  <td>
                    <BranchState value={row.joe} />
                  </td>
                  <td>
                    <BranchState value={row.dev} />
                  </td>
                  <td>
                    <BranchState value={row.main} />
                  </td>
                  <td>
                    <span
                      className={`development-status ${row.ci === "Failing" ? "blocked" : row.ci === "Passing" ? "complete" : "attention"}`}
                    >
                      {row.ci}
                    </span>
                  </td>
                  <td className="branch-qa-state">
                    <span>Adam: {statusLabel(row.adamQa)}</span>
                    <span>Joe: {statusLabel(row.joeQa)}</span>
                    <span
                      className={`development-status ${statusTone(row.overallStatus)}`}
                    >
                      {statusLabel(row.overallStatus)}
                    </span>
                  </td>
                  <td>{guidance.promotion}</td>
                  <td>
                    <span className="branch-confidence">
                      {confidence.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="branch-next-action">
                    <strong>{guidance.action}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loaderData.rows.length ? (
          <p className="empty-state">No records match this Branch Sync view.</p>
        ) : null}
      </section>
    </main>
  );
}
