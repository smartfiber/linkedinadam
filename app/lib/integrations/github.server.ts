/**
 * Read-only seam for the future Net-X GitHub App adapter.
 *
 * This module intentionally performs no network calls in the foundation
 * slice. A later implementation should use a GitHub App installation scoped
 * only to colossalbreacker/net-x, with webhook ingestion plus scheduled
 * polling fallback.
 */
export type GitHubRepositoryRef = {
  owner: "colossalbreacker";
  name: "net-x";
};

export type GitHubIssueSnapshot = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: string[];
  htmlUrl: string;
  updatedAt: string;
};

export type GitHubPullRequestSnapshot = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  sourceBranch: string;
  targetBranch: string;
  headSha: string;
  mergeSha: string | null;
  merged: boolean;
  htmlUrl: string;
  updatedAt: string;
};

export type GitHubReadAdapter = {
  listIssues(): Promise<GitHubIssueSnapshot[]>;
  listPullRequests(): Promise<GitHubPullRequestSnapshot[]>;
  compareBranches(source: string, target: string): Promise<unknown>;
};

export const NET_X_REPOSITORY: GitHubRepositoryRef = {
  owner: "colossalbreacker",
  name: "net-x",
};
