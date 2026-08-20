import { readFileSync } from "node:fs";
import { describe,expect,it,vi } from "vitest";
import { assertAgentControlPlaneAvailable,getAgentControlPlaneStatus } from "../app/lib/agents/readiness.server";
import { listRegisteredAgents } from "../app/lib/agents/registry.server";
import { isNavigationItemActive } from "../app/components/AppShell";

const required=["devos_agents","devos_agent_tools","devos_agent_runs","devos_agent_run_events","devos_agent_approvals","devos_agent_schedules"];

function schemaDb(tables:string[]) {
  return { prepare(){ return { bind(){ return { async all(){ return { results:tables.map(name=>({name})) }; } }; } }; } } as unknown as D1Database;
}

describe("agent control-plane rollout readiness",()=>{
  it("reports the expected pre-migration state without querying agent tables",async()=>{
    const status=await getAgentControlPlaneStatus(schemaDb([]));
    expect(status).toEqual({state:"NOT_INITIALIZED",missingTables:required});
  });
  it("becomes ready only after all six tables exist",async()=>{
    await expect(getAgentControlPlaneStatus(schemaDb(required))).resolves.toEqual({state:"READY",missingTables:[]});
    await expect(getAgentControlPlaneStatus(schemaDb(required.slice(0,5)))).resolves.toMatchObject({state:"NOT_INITIALIZED"});
  });
  it("does not disguise unexpected D1 failures as missing schema",async()=>{
    const logged=vi.spyOn(console,"error").mockImplementation(()=>{});
    const failure=new Error("D1 unavailable");
    const db={prepare(){throw failure;}} as unknown as D1Database;
    const status=await getAgentControlPlaneStatus(db);
    expect(status.state).toBe("ERROR");
    expect(()=>assertAgentControlPlaneAvailable(status)).toThrow("D1 unavailable");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
  it("uses database operational fields while retaining immutable code permissions",async()=>{
    const db={prepare(){return {async all(){return {results:[{slug:"issue-hunter",name:"Configured Hunter",category:"Development",role:"Configured role",purpose:"Configured purpose",human_owner:"Joseph",status:"paused",autonomy_level:"Configured",default_model_provider:"Configured provider",default_model:"Configured model",implementation:"new"}]};}};}} as unknown as D1Database;
    const [agent]=await listRegisteredAgents(db);
    expect(agent).toMatchObject({name:"Configured Hunter",owner:"Joseph",status:"paused",model:"Configured model"});
    expect(agent.capabilities).toEqual(["READ","ANALYZE","DRAFT"]);
  });
});

describe("explicit navigation groups",()=>{
  it("separates root hash destinations",()=>{
    expect(isNavigationItemActive("Command Center","/","")).toBe(true);
    expect(isNavigationItemActive("Command Center","/","#activity")).toBe(false);
    expect(isNavigationItemActive("Activity","/","#activity")).toBe(true);
    expect(isNavigationItemActive("Settings","/","#activity")).toBe(false);
  });
  it.each(["/planner","/connections","/calendar","/orchestration","/analytics"])("keeps Content & LinkedIn active on %s",pathname=>{
    expect(isNavigationItemActive("Content & LinkedIn",pathname,"")).toBe(true);
  });
});

describe("migration-tolerant route states",()=>{
  const home=readFileSync(new URL("../app/routes/home.tsx",import.meta.url),"utf8");
  const agents=readFileSync(new URL("../app/routes/agents.tsx",import.meta.url),"utf8");
  const detail=readFileSync(new URL("../app/routes/agent-detail.tsx",import.meta.url),"utf8");
  const consoleRoute=readFileSync(new URL("../app/routes/development-console.tsx",import.meta.url),"utf8");
  it("provides safe pre-0017 states on every dependent surface",()=>{
    expect(home).toContain("Agent Control Center not initialized");
    expect(agents).toContain("awaiting database initialization");
    expect(detail).toContain("Agent runtime not initialized");
    expect(consoleRoute).toContain("Agent runtime not initialized");
  });
});
