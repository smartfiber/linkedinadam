export type EnvironmentQaReadiness =
  | { state: "READY" }
  | { state: "NOT_INITIALIZED" }
  | { state: "ERROR"; error: unknown };

export async function getEnvironmentQaReadiness(
  db: D1Database,
): Promise<EnvironmentQaReadiness> {
  try {
    const result = await db
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='development_environments') AS environments_table,
        (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='environment_qa_attempts') AS attempts_table
    `,
      )
      .first<{
        environments_table: number;
        attempts_table: number;
      }>();
    return result?.environments_table === 1 && result.attempts_table === 1
      ? { state: "READY" }
      : { state: "NOT_INITIALIZED" };
  } catch (error) {
    return { state: "ERROR", error };
  }
}
