import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GROWTH_LIFECYCLES,
  INTEGRATION_HANDOFFS,
  canReceiveOutreach,
  integrationPrompt,
  scoreTechnologyAdvisorIcp,
  summarizeAttribution,
} from "../app/lib/growth";

const migration=readFileSync(new URL("../migrations/0022_add_devos_growth_platform.sql",import.meta.url),"utf8");
const route=readFileSync(new URL("../app/routes/growth.tsx",import.meta.url),"utf8");
const repository=readFileSync(new URL("../app/lib/growth.server.ts",import.meta.url),"utf8");
const routes=readFileSync(new URL("../app/routes.ts",import.meta.url),"utf8");
const shell=readFileSync(new URL("../app/components/AppShell.tsx",import.meta.url),"utf8");

describe("Growth CRM foundation",()=>{
  it("adds normalized, additive records without replacing the content engine",()=>{
    for(const table of ["growth_people","growth_companies","growth_company_relationships","growth_icp_profiles","growth_segments","growth_campaigns","growth_attribution_events","growth_timeline_events","growth_watchlists","growth_signals","growth_conversations","growth_messages","growth_outreach_sequences","growth_newsletters","growth_integrations"]){expect(migration).toContain(`CREATE TABLE ${table}`);}
    expect(migration).toContain("ALTER TABLE content_drafts ADD COLUMN growth_campaign_id");
    expect(migration).not.toContain("DROP TABLE"); expect(migration).not.toContain("DELETE FROM");
  });
  it("provides every controlled lifecycle and never infers customer",()=>{
    expect(GROWTH_LIFECYCLES).toEqual(expect.arrayContaining(["PROSPECT","DEMO_INTEREST","DEMO_BOOKED","TRIAL","OPPORTUNITY","CUSTOMER","NURTURE"]));
    expect(repository).toContain('"PROSPECT"'); expect(repository).not.toMatch(/lifecycle\s*=\s*["']CUSTOMER/);
  });
  it("enforces duplicate identities and preserves historical company relations",()=>{
    expect(migration).toContain("idx_growth_people_email_unique"); expect(migration).toContain("idx_growth_people_linkedin_unique"); expect(migration).toContain("idx_growth_companies_domain_unique"); expect(migration).toContain("ended_at TEXT");
    expect(repository).toContain("Duplicate person"); expect(repository).toContain("Duplicate company domain");
  });
});

describe("ICP scoring",()=>{
  it("scores only supplied evidence and explains the result",()=>{
    const result=scoreTechnologyAdvisorIcp({businessType:"Technology Advisor",employeeCount:4,title:"Founder",technologyFocus:"connectivity",signals:["operational hiring"]});
    expect(result.score).toBe(95); expect(result.label).toBe("Strong Fit"); expect(result.reasons).toContain("4 employees"); expect(result.missing).toEqual([]);
  });
  it("does not fabricate missing profile facts",()=>{
    const result=scoreTechnologyAdvisorIcp({businessType:"Technology Advisor"});
    expect(result.score).toBe(30); expect(result.missing).toEqual(expect.arrayContaining(["employee count","decision-maker title","technology focus"]));
  });
  it("honors authoritative disqualification",()=>{expect(scoreTechnologyAdvisorIcp({businessType:"Technology Advisor",disqualified:true}).score).toBe(0);});
});

describe("attribution and suppression",()=>{
  it("preserves first touch and advances last touch without mutation",()=>{
    const original=[{id:2,occurredAt:"2026-02-01",sourceChannel:"Email"},{id:1,occurredAt:"2026-01-01",sourceChannel:"LinkedIn"}]; const result=summarizeAttribution(original);
    expect(result.firstTouch?.sourceChannel).toBe("LinkedIn"); expect(result.lastTouch?.sourceChannel).toBe("Email"); expect(original[0].sourceChannel).toBe("Email");
  });
  it("permits only subscribed recipients",()=>{expect(canReceiveOutreach("SUBSCRIBED")).toBe(true); for(const state of ["UNSUBSCRIBED","SUPPRESSED","DO_NOT_CONTACT",null])expect(canReceiveOutreach(state)).toBe(false);});
  it("stores conversion events append-only with provenance",()=>{expect(migration).toContain("touch_kind IN ('FIRST','LAST','ASSISTED','CONVERSION')");expect(migration).toContain("provenance TEXT NOT NULL");});
});

describe("Growth product surfaces",()=>{
  it("routes the complete workspace and evolves old modules",()=>{expect(routes).toContain('route("growth/:module?"');for(const path of ["people","companies","prospecting","social-intelligence","inbox","outreach","campaigns","content","newsletters","paid","analytics","integrations"])expect(route).toContain(`["${path}"`);expect(shell).toContain('label: "Growth"');});
  it("contains command-center attention, CRM, social, inbox, campaigns and analytics UI",()=>{for(const phrase of ["DEVOS Growth Advisor","Add Prospect","Import Prospects","PROSPECT DISCOVERY INTEGRATION REQUIRED","Social / Competitor Intelligence","Growth Inbox","One-to-One Outreach","Generate Campaign Strategy","Growth Content Calendar","Awaiting integration data"])expect(route).toContain(phrase);});
  it("fails gracefully before migration",()=>{expect(repository).toContain("isMissingGrowthSchema");expect(route).toContain("Growth CRM not initialized");expect(route).not.toContain("D1_ERROR");});
});

describe("integration handoffs and outbound safety",()=>{
  it("defines the required provider boundaries",()=>{for(const key of ["unipile","linkedin_personal","linkedin_company","postmark","enrichment","signal_collector","scheduling","linkedin_ads","google_ads"])expect(INTEGRATION_HANDOFFS.some(item=>item.key===key)).toBe(true);});
  it("generates actionable prompts without secrets",()=>{for(const handoff of INTEGRATION_HANDOFFS){const prompt=integrationPrompt(handoff);expect(prompt).toContain("Existing boundary");expect(prompt).toContain("Acceptance tests");expect(prompt).toContain("Never include or expose secrets");expect(prompt).not.toMatch(/(?:api[_-]?key|token|secret)\s*[:=]\s*[A-Za-z0-9_-]{16,}/i);}});
  it("keeps all outbound records in draft/approval state",()=>{expect(repository).toContain('"DRAFT","DRAFT"');expect(repository).toContain("No message was sent");expect(route).toContain("Sending requires a connected provider and explicit human authorization");});
});
