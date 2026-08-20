import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { BUILTIN_AGENT_DEFINITIONS,getAgentDefinition } from "../app/lib/agents/catalog";
import { canExecuteCapability,classifyAgentAction } from "../app/lib/agents/permissions";
import { MODEL_PROVIDERS } from "../app/lib/agents/providers";

const worker=readFileSync(new URL("../workers/app.ts",import.meta.url),"utf8");
const config=readFileSync(new URL("../wrangler.json",import.meta.url),"utf8");
const migration=readFileSync(new URL("../migrations/0017_add_devos_agent_control_plane.sql",import.meta.url),"utf8");
const agentsRoute=readFileSync(new URL("../app/routes/agents.tsx",import.meta.url),"utf8");
const detailRoute=readFileSync(new URL("../app/routes/agent-detail.tsx",import.meta.url),"utf8");

describe("DEVOS agent control plane",()=>{
  it("registers existing workflows without duplicating their implementations",()=>{
    for(const slug of ["strategy-agent","content-planner","post-drafting-agent","image-generation","connection-targeting-agent","post-orchestration","daily-autopilot"]) expect(getAgentDefinition(slug)?.implementation).toBe("existing");
    expect(BUILTIN_AGENT_DEFINITIONS.filter(agent=>agent.implementation === "existing").length).toBeGreaterThanOrEqual(10);
  });
  it("adds only safe missing Development and cross-functional agents",()=>{
    for(const slug of ["issue-hunter","release-readiness","qa-agent","chief-of-staff"]) expect(getAgentDefinition(slug)).toMatchObject({implementation:"new",status:"active"});
    expect(getAgentDefinition("pr-reviewer")).toMatchObject({implementation:"scaffold",status:"waiting"});
  });
  it("enforces automatic, approval-required, disabled, and prohibited capabilities",()=>{
    for(const action of ["read","analyze","draft"]) expect(canExecuteCapability(classifyAgentAction(action))).toBe(true);
    expect(classifyAgentAction("publish_linkedin")).toBe("APPROVAL_REQUIRED");
    expect(classifyAgentAction("commit_code")).toBe("APPROVAL_REQUIRED");
    expect(canExecuteCapability(classifyAgentAction("modify_sandbox"))).toBe(false);
    for(const action of ["force_push","push_main","disable_authentication","reveal_secrets"]) expect(classifyAgentAction(action)).toBe("PROHIBITED");
  });
  it("uses a Durable Object control state and append-only D1 history",()=>{
    expect(worker).toContain("class DevosAgentRuntime");
    expect(config).toContain('"DEVOS_AGENT_RUNTIME"');
    expect(config).toContain('"new_sqlite_classes"');
    expect(migration).toContain("CREATE TABLE devos_agent_runs");
    expect(migration).toContain("CREATE TABLE devos_agent_run_events");
    expect(migration).not.toContain("UPDATE devos_agent_run_events");
  });
  it("keeps approval decisions server-authorized and external execution absent",()=>{
    expect(agentsRoute).toContain('requireRole(user,["OWNER","ADMIN"])');
    expect(detailRoute).toContain('requireRole(user,["OWNER","ADMIN","DEVELOPER","MARKETING","SALES"])');
    expect(detailRoute).toContain("Use the existing workflow link");
    for(const forbidden of ["child_process","exec(","git push","createPullRequest","publishLinkedInPost"]) expect(worker+agentsRoute+detailRoute).not.toContain(forbidden);
  });
  it("reuses the existing OpenAI integration and leaves future providers inactive",()=>{
    expect(MODEL_PROVIDERS.find(provider=>provider.provider === "OPENAI")).toMatchObject({active:true,authenticationMode:"API_KEY"});
    expect(MODEL_PROVIDERS.filter(provider=>provider.provider !== "OPENAI").every(provider=>!provider.active)).toBe(true);
  });
});
