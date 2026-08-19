import { importPKCS8, SignJWT } from "jose";

export type GitHubRepositoryRef = { owner: string; name: string };
export type GitHubEnvironment = {
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_REPOSITORY_OWNER?: string;
  GITHUB_REPOSITORY_NAME?: string;
  GITHUB_SYNC_ENABLED?: string;
};

export type GitHubIssueSnapshot = {
  id: number; number: number; title: string; body: string | null; state: "open" | "closed";
  labels: string[]; author: string | null; htmlUrl: string; createdAt: string; updatedAt: string; closedAt: string | null;
};
export type GitHubCheckSnapshot = { name: string; status: string; conclusion: string | null; detailsUrl: string | null };
export type GitHubChangedFileSnapshot = { filename: string; status: string; additions: number; deletions: number; patch: string | null };
export type GitHubPullRequestSnapshot = {
  id: number; number: number; title: string; body: string | null; state: "open" | "closed"; draft: boolean;
  sourceBranch: string; targetBranch: string; headSha: string; mergeSha: string | null; merged: boolean;
  mergeable: boolean | null; author: string | null; reviewers: string[]; approvals: number; changedFiles: GitHubChangedFileSnapshot[];
  checks: GitHubCheckSnapshot[]; htmlUrl: string; createdAt: string; updatedAt: string; mergedAt: string | null;
};
export type GitHubBranchSnapshot = { name: string; sha: string };
export type GitHubCompareSnapshot = { status: "ahead" | "behind" | "identical" | "diverged" | "unknown"; aheadBy: number; behindBy: number; files: GitHubChangedFileSnapshot[] };
export type GitHubReadAdapter = {
  repository: GitHubRepositoryRef;
  listIssues(): Promise<GitHubIssueSnapshot[]>;
  listPullRequests(): Promise<GitHubPullRequestSnapshot[]>;
  listBranches(): Promise<GitHubBranchSnapshot[]>;
  compare(base: string, head: string): Promise<GitHubCompareSnapshot>;
};

export const DEFAULT_NET_X_REPOSITORY: GitHubRepositoryRef = { owner: "colossalbreacker", name: "net-x" };

export function repositoryFromEnvironment(env: GitHubEnvironment): GitHubRepositoryRef {
  return { owner: env.GITHUB_REPOSITORY_OWNER?.trim() || DEFAULT_NET_X_REPOSITORY.owner, name: env.GITHUB_REPOSITORY_NAME?.trim() || DEFAULT_NET_X_REPOSITORY.name };
}

export function githubConfigurationError(env: GitHubEnvironment) {
  const missing = [["GITHUB_APP_ID", env.GITHUB_APP_ID], ["GITHUB_APP_PRIVATE_KEY", env.GITHUB_APP_PRIVATE_KEY], ["GITHUB_APP_INSTALLATION_ID", env.GITHUB_APP_INSTALLATION_ID]]
    .filter(([, value]) => !value).map(([name]) => name);
  return missing.length ? `GitHub App is not configured: ${missing.join(", ")}.` : null;
}

function parsePrivateKey(value: string) { return value.replace(/\\n/g, "\n").trim(); }
function githubHeaders(token: string) {
  return { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "user-agent": "Net-X-Back-Office" };
}
async function appToken(env: GitHubEnvironment) {
  const error = githubConfigurationError(env); if (error) throw new Error(error);
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(parsePrivateKey(env.GITHUB_APP_PRIVATE_KEY!), "RS256");
  const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(env.GITHUB_APP_ID!).setIssuedAt(now - 30).setExpirationTime(now + 9 * 60).sign(key);
  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(env.GITHUB_APP_INSTALLATION_ID!)}/access_tokens`, { method: "POST", headers: githubHeaders(jwt) });
  if (!response.ok) throw new Error(`GitHub installation token failed (${response.status}).`);
  const payload = await response.json() as { token?: string }; if (!payload.token) throw new Error("GitHub installation token was missing."); return payload.token;
}
export class GitHubAPIError extends Error {
  constructor(message: string, readonly status: number, readonly rateLimitRemaining: number | null, readonly retryAfter: number | null) { super(message); }
}
async function githubRequest<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers: githubHeaders(token) });
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const retryAfter = response.headers.get("retry-after");
    throw new GitHubAPIError(`GitHub API ${response.status} for ${path} (remaining: ${remaining || "unknown"}).`, response.status, remaining === null ? null : Number(remaining), retryAfter === null ? null : Number(retryAfter));
  }
  return response.json() as Promise<T>;
}
function changedFile(value: Record<string, unknown>): GitHubChangedFileSnapshot {
  return { filename: String(value.filename || ""), status: String(value.status || "modified"), additions: Number(value.additions || 0), deletions: Number(value.deletions || 0), patch: typeof value.patch === "string" ? value.patch : null };
}
async function paged<T>(token: string, path: string, map: (value: unknown) => T[]) {
  const values: T[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const rows = map(await githubRequest<unknown>(token, `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`)); values.push(...rows); if (rows.length < 100) break;
  }
  return values;
}

export function createGitHubReadAdapter(env: GitHubEnvironment): GitHubReadAdapter {
  const repository = repositoryFromEnvironment(env); let tokenPromise: Promise<string> | undefined; const token = () => tokenPromise ||= appToken(env);
  const base = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  return {
    repository,
    async listIssues() {
      const raw = await paged<Record<string, unknown>>(await token(), `${base}/issues?state=all`, value => Array.isArray(value) ? value as Record<string, unknown>[] : []);
      return raw.filter(value => !value.pull_request).map(value => ({ id: Number(value.id), number: Number(value.number), title: String(value.title || ""), body: typeof value.body === "string" ? value.body : null, state: value.state === "closed" ? "closed" : "open", labels: Array.isArray(value.labels) ? value.labels.map(label => String((label as { name?: unknown }).name || "")) : [], author: typeof (value.user as { login?: unknown } | null)?.login === "string" ? (value.user as { login: string }).login : null, htmlUrl: String(value.html_url || ""), createdAt: String(value.created_at || ""), updatedAt: String(value.updated_at || ""), closedAt: typeof value.closed_at === "string" ? value.closed_at : null }));
    },
    async listPullRequests() {
      const rows = await paged<Record<string, unknown>>(await token(), `${base}/pulls?state=all`, value => Array.isArray(value) ? value as Record<string, unknown>[] : []);
      return Promise.all(rows.map(async value => {
        const number = Number(value.number); const details = await githubRequest<Record<string, unknown>>(await token(), `${base}/pulls/${number}`);
        const headSha = String((details.head as { sha?: unknown })?.sha || "");
        const [reviews, files, checks, statuses] = await Promise.all([
          paged<Record<string, unknown>>(await token(), `${base}/pulls/${number}/reviews`, result => Array.isArray(result) ? result as Record<string, unknown>[] : []),
          paged<Record<string, unknown>>(await token(), `${base}/pulls/${number}/files`, result => Array.isArray(result) ? result as Record<string, unknown>[] : []),
          githubRequest<{ check_runs?: Record<string, unknown>[] }>(await token(), `${base}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100`),
          githubRequest<{ statuses?: Record<string, unknown>[] }>(await token(), `${base}/commits/${encodeURIComponent(headSha)}/status?per_page=100`),
        ]);
        const reviewRows = Array.isArray(reviews) ? reviews : [];
        const latestReviews = new Map<string, Record<string, unknown>>();
        for (const review of reviewRows) { const login = String((review.user as { login?: unknown } | null)?.login || ""); if (login) latestReviews.set(login, review); }
        const requested = Array.isArray(details.requested_reviewers) ? details.requested_reviewers.map(reviewer => String((reviewer as { login?: unknown }).login || "")) : [];
        const checkRuns: GitHubCheckSnapshot[] = Array.isArray(checks.check_runs) ? checks.check_runs.map(check => ({ name: String(check.name || ""), status: String(check.status || ""), conclusion: typeof check.conclusion === "string" ? check.conclusion : null, detailsUrl: typeof check.html_url === "string" ? check.html_url : null })) : [];
        const commitStatuses: GitHubCheckSnapshot[] = Array.isArray(statuses.statuses) ? statuses.statuses.map(status => ({ name: String(status.context || "commit status"), status: ["success", "failure", "error"].includes(String(status.state)) ? "completed" : "in_progress", conclusion: status.state === "success" ? "success" : status.state === "failure" || status.state === "error" ? "failure" : null, detailsUrl: typeof status.target_url === "string" ? status.target_url : null })) : [];
        return { id: Number(details.id || value.id), number, title: String(details.title || value.title || ""), body: typeof details.body === "string" ? details.body : null, state: details.state === "closed" ? "closed" : "open", draft: Boolean(details.draft), sourceBranch: String((details.head as { ref?: unknown })?.ref || ""), targetBranch: String((details.base as { ref?: unknown })?.ref || ""), headSha, mergeSha: typeof details.merge_commit_sha === "string" ? details.merge_commit_sha : null, merged: Boolean(details.merged), mergeable: typeof details.mergeable === "boolean" ? details.mergeable : null, author: typeof (details.user as { login?: unknown } | null)?.login === "string" ? (details.user as { login: string }).login : null, reviewers: Array.from(new Set([...requested, ...latestReviews.keys()].filter(Boolean))), approvals: Array.from(latestReviews.values()).filter(review => review.state === "APPROVED").length, changedFiles: Array.isArray(files) ? files.map(changedFile).filter(file => file.filename) : [], checks: [...checkRuns, ...commitStatuses], htmlUrl: String(details.html_url || value.html_url || ""), createdAt: String(details.created_at || value.created_at || ""), updatedAt: String(details.updated_at || value.updated_at || ""), mergedAt: typeof details.merged_at === "string" ? details.merged_at : null } satisfies GitHubPullRequestSnapshot;
      }));
    },
    async listBranches() {
      const rows = await paged<Record<string, unknown>>(await token(), `${base}/branches`, value => Array.isArray(value) ? value as Record<string, unknown>[] : []);
      return rows.map(value => ({ name: String(value.name || ""), sha: String((value.commit as { sha?: unknown })?.sha || "") }));
    },
    async compare(baseRef, headRef) {
      const value = await githubRequest<Record<string, unknown>>(await token(), `${base}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headRef)}`); const rawStatus = String(value.status || "unknown");
      return { status: ["ahead", "behind", "identical", "diverged"].includes(rawStatus) ? rawStatus as GitHubCompareSnapshot["status"] : "unknown", aheadBy: Number(value.ahead_by || 0), behindBy: Number(value.behind_by || 0), files: Array.isArray(value.files) ? (value.files as Record<string, unknown>[]).map(changedFile).filter(file => file.filename) : [] };
    },
  };
}
