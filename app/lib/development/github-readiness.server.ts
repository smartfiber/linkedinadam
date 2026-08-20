import { requireRole, type AuthenticatedUser } from "../auth.server";
import type { GitHubEnvironment } from "../integrations/github.server";
import { syncNetXRepository, type GitHubSyncOptions } from "./sync.server";

export type ManualGitHubReadinessEnvironment = GitHubEnvironment & {
  linkedinadam_db: D1Database;
};

export async function runManualGitHubReadinessSync(
  env: ManualGitHubReadinessEnvironment,
  user: AuthenticatedUser,
  testOptions: Pick<GitHubSyncOptions, "adapter"> = {},
) {
  requireRole(user, ["OWNER", "ADMIN"]);
  return syncNetXRepository(env.linkedinadam_db, env, {
    trigger: "manual_readiness",
    initiator: user.email,
    ...testOptions,
  });
}
