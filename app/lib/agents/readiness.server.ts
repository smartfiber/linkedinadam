const REQUIRED_AGENT_TABLES = [
  "devos_agents",
  "devos_agent_tools",
  "devos_agent_runs",
  "devos_agent_run_events",
  "devos_agent_approvals",
  "devos_agent_schedules",
] as const;

export type AgentControlPlaneStatus =
  | { state: "READY"; missingTables: [] }
  | { state: "NOT_INITIALIZED"; missingTables: string[] }
  | { state: "ERROR"; missingTables: []; error: unknown };

export async function getAgentControlPlaneStatus(
  db: D1Database,
): Promise<AgentControlPlaneStatus> {
  try {
    const placeholders = REQUIRED_AGENT_TABLES.map(() => "?").join(",");
    const result = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
      )
      .bind(...REQUIRED_AGENT_TABLES)
      .all<{ name: string }>();
    const present = new Set((result.results || []).map((row) => row.name));
    const missingTables = REQUIRED_AGENT_TABLES.filter(
      (table) => !present.has(table),
    );
    return missingTables.length
      ? { state: "NOT_INITIALIZED", missingTables: [...missingTables] }
      : { state: "READY", missingTables: [] };
  } catch (error) {
    console.error("DEVOS agent control-plane readiness check failed.", error);
    return { state: "ERROR", missingTables: [], error };
  }
}

export function assertAgentControlPlaneAvailable(
  status: AgentControlPlaneStatus,
) {
  if (status.state === "ERROR") throw status.error;
  if (status.state === "NOT_INITIALIZED") {
    throw new Error("Agent runtime not initialized.");
  }
}
