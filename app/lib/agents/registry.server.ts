import { getAgentDefinition } from "./catalog";
import type { AgentDefinition } from "./types";

type AgentRegistryRow = {
  slug: string;
  name: string;
  category: AgentDefinition["category"];
  role: string;
  purpose: string;
  human_owner: string;
  status: AgentDefinition["status"];
  autonomy_level: string;
  default_model_provider: string;
  default_model: string;
  implementation: AgentDefinition["implementation"];
};

function hydrateAgent(row: AgentRegistryRow): AgentDefinition {
  const definition = getAgentDefinition(row.slug);
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    role: row.role,
    purpose: row.purpose,
    owner: row.human_owner,
    status: row.status,
    autonomy: row.autonomy_level,
    provider: row.default_model_provider,
    model: row.default_model,
    implementation: row.implementation,
    // Route adapters and executable capabilities are immutable code contracts.
    // A database edit cannot grant a tool or capability that code did not ship.
    capabilities: definition?.capabilities || [],
    tools: definition?.tools || [],
    route: definition?.route,
  };
}

export async function listRegisteredAgents(db: D1Database) {
  const result = await db
    .prepare(`SELECT slug,name,category,role,purpose,human_owner,status,
      autonomy_level,default_model_provider,default_model,implementation
      FROM devos_agents ORDER BY name`)
    .all<AgentRegistryRow>();
  return (result.results || []).map(hydrateAgent);
}

export async function getRegisteredAgent(db: D1Database, slug: string) {
  const row = await db
    .prepare(`SELECT slug,name,category,role,purpose,human_owner,status,
      autonomy_level,default_model_provider,default_model,implementation
      FROM devos_agents WHERE slug=?`)
    .bind(slug)
    .first<AgentRegistryRow>();
  return row ? hydrateAgent(row) : null;
}
