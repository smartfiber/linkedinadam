import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildBatchReconciliationPrompt, buildBranchSyncPrompt, evidenceChanged, mergeReadiness, type BranchEvidence } from "../app/lib/development/copilot";
import { inspectDevelopmentImage, MAX_DEVELOPMENT_IMAGE_BYTES } from "../app/lib/development/attachments.server";
import { DEVELOPMENT_COPILOT_MODEL, isMissingCopilotSchema } from "../app/lib/development/copilot.server";

const evidence = (overrides: Partial<BranchEvidence> = {}): BranchEvidence => ({
  requestId:"DEV-1", title:"Preserve locations", issue:"#1", pr:"#2",
  adam:{sha:"a",state:"present",checkedAt:"2026-08-21T10:00:00Z"},
  joe:{sha:null,state:"not_present",checkedAt:"2026-08-21T10:00:00Z"},
  dev:{sha:null,state:"not_present",checkedAt:"2026-08-21T10:00:00Z"},
  main:{sha:null,state:"not_present",checkedAt:"2026-08-21T10:00:00Z"},
  confidence:"EXACT",ci:"Passing",adamQa:"passed",joeQa:"pending",generatedAt:"2026-08-21T10:01:00Z",...overrides,
});

describe("Development Copilot",()=>{
  it("generates request-specific, non-executing branch remediation",()=>{const prompt=buildBranchSyncPrompt(evidence());expect(prompt).toContain("DEV-1");expect(prompt).toContain("Do not merge branches wholesale");expect(prompt).toContain("Stop before push or merge");expect(prompt).not.toContain("Make all branches match");});
  it("puts patch equivalence, conflicts, unknown and partial freshness ahead of merges",()=>{
    expect(buildBranchSyncPrompt(evidence({joe:{sha:"b",state:"patch_equivalent",checkedAt:"now"}}))).toContain("patch-equivalent");
    expect(buildBranchSyncPrompt(evidence({dev:{sha:"d",state:"conflict",checkedAt:"now"}}))).toContain("semantic behavior");
    expect(buildBranchSyncPrompt(evidence({main:{sha:null,state:"unknown",checkedAt:null}}))).toContain("refresh authoritative");
    expect(buildBranchSyncPrompt(evidence({syncOutcome:"PARTIALLY_FRESH",deferred:2}))).toContain("2 comparisons were deferred");
  });
  it("builds independent batch audits and prohibits wholesale reconciliation",()=>{const prompt=buildBatchReconciliationPrompt([evidence(),evidence({requestId:"DEV-2",title:"Second"})]);expect(prompt).toContain("Treat every Development Request independently");expect(prompt).toContain("Do NOT merge one branch wholesale");expect(prompt).toContain("| Request | Adam | Joe | dev | main |");});
  it("detects branch evidence changes",()=>expect(evidenceChanged(evidence(),evidence({main:{sha:"new",state:"present",checkedAt:"later"}}))).toBe(true));
  it("scores deterministic readiness and caps hard blockers",()=>{expect(mergeReadiness({ci:"Passing",mergeable:true,adamQa:"passed",joeQa:"passed"}).overall).toBeGreaterThan(70);const blocked=mergeReadiness({ci:"Failing",conflict:true,securityBlocker:true});expect(blocked.overall).toBeLessThanOrEqual(40);expect(blocked.blockers).toContain("Security blocker");});
  it("validates actual image signatures and mismatches",()=>{const png=new Uint8Array([137,80,78,71,13,10,26,10,0]);expect(inspectDevelopmentImage({name:"proof.png",type:"image/png",size:png.length},png).mime).toBe("image/png");expect(()=>inspectDevelopmentImage({name:"proof.jpg",type:"image/jpeg",size:png.length},png)).toThrow(/MIME|extension/);expect(()=>inspectDevelopmentImage({name:"huge.png",type:"image/png",size:MAX_DEVELOPMENT_IMAGE_BYTES+1},png)).toThrow(/8 MB/);});
  it("uses the existing Responses model and provides migration fallback",()=>{expect(DEVELOPMENT_COPILOT_MODEL).toBe("gpt-5-mini");expect(isMissingCopilotSchema(new Error("no such table: development_prompts"))).toBe(true);});
  it("keeps provider credentials and R2 access server-side",()=>{const server=readFileSync("app/lib/development/copilot.server.ts","utf8");const route=readFileSync("app/routes/development-attachment.ts","utf8");expect(server).toContain("new OpenAI({ apiKey })");expect(server).toContain("input_image");expect(route).toContain("requireAuthenticatedUser");expect(route).toContain("cache-control\":\"private");});
  it("keeps append-only prompts, conversations, provenance, archive and guarded delete in schema",()=>{const migration=readFileSync("migrations/0021_add_development_copilot.sql","utf8");for(const table of ["development_copilot_state","development_prompts","development_thread_entries","development_attachments","development_response_analyses","development_batch_prompts"])expect(migration).toContain(`CREATE TABLE ${table}`);expect(migration).toContain("UNIQUE(development_request_id, version)");expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|ALTER TABLE/);});
});
