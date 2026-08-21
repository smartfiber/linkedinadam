import OpenAI from "openai";
import { getSafeOpenAIErrorMessage } from "../aiErrors.server";
import type { DevelopmentActor } from "./types";
import { assertCanWriteDevelopment } from "./service.server";
import { COPILOT_ENTRY_TYPES, COPILOT_TARGETS, DEVELOPMENT_WORK_STATES, buildBatchReconciliationPrompt, buildBranchSyncPrompt, type BranchEvidence, type DevelopmentWorkState } from "./copilot";

export const DEVELOPMENT_COPILOT_MODEL = "gpt-5-mini";
const NOT_INITIALIZED = "Development Copilot not initialized";

export type CopilotEnvironment = { linkedinadam_db: D1Database; OPENAI_API_KEY?: string; LINKEDIN_IMAGES: R2Bucket };

export function isMissingCopilotSchema(error: unknown) {
  return error instanceof Error && /no such table: development_(?:copilot|prompts|thread|attachments|response|batch)/i.test(error.message);
}

export async function getCopilotContext(db: D1Database, requestId: string) {
  try {
    const [state, prompts, thread, attachments, analyses] = await Promise.all([
      db.prepare("SELECT * FROM development_copilot_state WHERE development_request_id=?").bind(requestId).first(),
      db.prepare("SELECT * FROM development_prompts WHERE development_request_id=? ORDER BY version DESC").bind(requestId).all(),
      db.prepare("SELECT * FROM development_thread_entries WHERE development_request_id=? ORDER BY created_at,id").bind(requestId).all(),
      db.prepare("SELECT id,development_request_id,original_filename,safe_filename,mime_type,size_bytes,uploaded_by,uploaded_at,caption,category,display_order,related_thread_entry_id,related_qa_attempt_id FROM development_attachments WHERE development_request_id=? ORDER BY display_order,uploaded_at").bind(requestId).all(),
      db.prepare("SELECT * FROM development_response_analyses WHERE development_request_id=? ORDER BY analyzed_at DESC").bind(requestId).all(),
    ]);
    return { initialized: true as const, state, prompts: prompts.results || [], thread: thread.results || [], attachments: attachments.results || [], analyses: analyses.results || [] };
  } catch (error) {
    if (isMissingCopilotSchema(error)) return { initialized: false as const, state: null, prompts: [], thread: [], attachments: [], analyses: [] };
    throw error;
  }
}

export async function listCopilotStates(db:D1Database){try{return {initialized:true as const,states:(await db.prepare("SELECT * FROM development_copilot_state").all()).results||[]};}catch(error){if(isMissingCopilotSchema(error))return {initialized:false as const,states:[]};throw error;}}

export async function initializeCopilotRequest(db: D1Database, requestId: string, actor: DevelopmentActor) {
  try {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO development_copilot_state (development_request_id,work_state) VALUES (?,'NEEDS_PROMPT')").bind(requestId),
      db.prepare("INSERT INTO development_thread_entries (id,development_request_id,entry_type,actor_identity,content) VALUES (?,?,'HUMAN',?,?)").bind(crypto.randomUUID(), requestId, actor.email, "Development Request captured. Human Problem / Why remains authoritative."),
    ]);
    return true;
  } catch (error) { if (isMissingCopilotSchema(error)) return false; throw error; }
}

function clean(value: unknown, max = 100_000) { return String(value || "").replaceAll("\0", "").trim().slice(0, max); }
function parseJson(text: string) { const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text; const start = fenced.indexOf("{"); const end = fenced.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("OpenAI returned an invalid structured response."); return JSON.parse(fenced.slice(start, end + 1)); }

async function respond(apiKey: string, instruction: string, content: string, images: { mime_type: string; bytes: ArrayBuffer }[] = []) {
  const client = new OpenAI({ apiKey });
  const userContent: any[] = [{ type: "input_text", text: content }];
  for (const image of images) {
    const bytes = new Uint8Array(image.bytes); let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    userContent.push({ type: "input_image", image_url: `data:${image.mime_type};base64,${btoa(binary)}`, detail: "low" });
  }
  const response = await client.responses.create({ model: DEVELOPMENT_COPILOT_MODEL, instructions: instruction, input: [{ role: "user", content: userContent }] });
  if (!response.output_text) throw new Error("OpenAI returned an empty Development Copilot result.");
  return response.output_text;
}

export async function generateSummary(env: CopilotEnvironment, actor: DevelopmentActor, requestRecord: any, github: any, attachments: any[]) {
  assertCanWriteDevelopment(actor); if (!env.OPENAI_API_KEY) throw new Error("The OpenAI API key is not configured.");
  const imageInputs: { mime_type: string; bytes: ArrayBuffer }[] = [];
  let visualAvailable = true;
  for (const attachment of attachments.slice(0, 4)) { const stored=await env.linkedinadam_db.prepare("SELECT storage_key,mime_type FROM development_attachments WHERE id=? AND development_request_id=?").bind(attachment.id,requestRecord.id).first<{storage_key:string;mime_type:string}>(); if(!stored)continue; const object = await env.LINKEDIN_IMAGES.get(stored.storage_key); if (object) imageInputs.push({ mime_type: stored.mime_type, bytes: await object.arrayBuffer() }); }
  let raw: string;
  try {
    raw = await respond(env.OPENAI_API_KEY, "You are DEVOS Development Copilot in Summarizer mode (READ + ANALYZE only). Return JSON with laymanSummary, technicalInterpretation, currentState, suggestedNextStep, visualObservations array. Describe only visible screenshot evidence and explicitly mark uncertainty. Never claim to have changed code or verified unprovided facts.", JSON.stringify({ request: requestRecord, github, screenshots: attachments.map((a: any, i: number) => ({ number: i + 1, category: a.category, caption: a.caption })) }), imageInputs);
  } catch (error) {
    if (imageInputs.length && error instanceof OpenAI.BadRequestError) { visualAvailable = false; raw = await respond(env.OPENAI_API_KEY, "You are DEVOS Development Copilot in Summarizer mode. Return JSON with laymanSummary, technicalInterpretation, currentState, suggestedNextStep, visualObservations array. Image input is unavailable; use captions only and do not infer unseen content.", JSON.stringify({ request: requestRecord, github, imageNotice: "Visual analysis unavailable", captions: attachments.map((a: any) => a.caption) })); }
    else throw new Error(getSafeOpenAIErrorMessage(error, "plan"));
  }
  const parsed = parseJson(raw); const now = new Date().toISOString();
  await env.linkedinadam_db.batch([
    env.linkedinadam_db.prepare(`INSERT INTO development_copilot_state (development_request_id,work_state,layman_summary,technical_interpretation,current_state_summary,suggested_next_step,visual_observations_json,generated_provider,generated_model,generated_at,updated_at) VALUES (?,'NEEDS_PROMPT',?,?,?,?,?,'OpenAI',?,?,CURRENT_TIMESTAMP) ON CONFLICT(development_request_id) DO UPDATE SET layman_summary=excluded.layman_summary,technical_interpretation=excluded.technical_interpretation,current_state_summary=excluded.current_state_summary,suggested_next_step=excluded.suggested_next_step,visual_observations_json=excluded.visual_observations_json,generated_provider=excluded.generated_provider,generated_model=excluded.generated_model,generated_at=excluded.generated_at,updated_at=CURRENT_TIMESTAMP`).bind(requestRecord.id, clean(parsed.laymanSummary), clean(parsed.technicalInterpretation), clean(parsed.currentState), clean(parsed.suggestedNextStep), JSON.stringify({ available: visualAvailable, observations: parsed.visualObservations || [] }), DEVELOPMENT_COPILOT_MODEL, now),
    env.linkedinadam_db.prepare("INSERT INTO development_thread_entries (id,development_request_id,entry_type,actor_identity,provider,model,content,metadata_json) VALUES (?,?,'DEVOS','Development Copilot','OpenAI',?,?,?)").bind(crypto.randomUUID(), requestRecord.id, DEVELOPMENT_COPILOT_MODEL, clean(parsed.laymanSummary), JSON.stringify({ kind: "summary", visualAvailable })),
  ]);
  return { ...parsed, visualAvailable };
}

function requestPromptContext(record: any, copilot: any, kind: string) {
  return { kind, request: record.request, links: record.links, branches: record.branches, qa: record.qa, approvals: record.approvals, githubItems: record.githubItems, copilotState: copilot.state, previousPrompts: copilot.prompts, previousConversation: copilot.thread, analyses: copilot.analyses, attachments: copilot.attachments };
}

export async function generateImplementationPrompt(env: CopilotEnvironment, actor: DevelopmentActor, record: any, targetTool: string, kind = "implementation", branchEvidence?: BranchEvidence) {
  assertCanWriteDevelopment(actor); if (!COPILOT_TARGETS.includes(targetTool as any)) targetTool = "Other";
  const copilot = await getCopilotContext(env.linkedinadam_db, record.request.id); if (!copilot.initialized) throw new Error(NOT_INITIALIZED);
  let generated: string; const snapshot = requestPromptContext(record, copilot, kind);
  if (kind === "branch_sync" && branchEvidence) generated = buildBranchSyncPrompt(branchEvidence);
  else {
    if (!env.OPENAI_API_KEY) throw new Error("The OpenAI API key is not configured.");
    const instruction = kind === "follow_up" ? "Continue from the current state. Reconcile the original request, prior prompts and responses, latest failure, GitHub/branch/QA/CI evidence. Do not restart unless evidence warrants it." : "Create a detailed implementation prompt for the selected coding assistant.";
    generated = await respond(env.OPENAI_API_KEY, `You are DEVOS Prompt Engineer (READ + ANALYZE + DRAFT; non-executing). ${instruction} Require diagnosis of current code, narrow scope, preservation of newer architecture and human fields, explicit tests and files, no push/merge/deploy unless authorized, and a structured final response. Do not include secrets.`, JSON.stringify(snapshot));
  }
  const next = ((copilot.prompts[0] as any)?.version || 0) + 1; const id = crypto.randomUUID();
  await env.linkedinadam_db.batch([
    env.linkedinadam_db.prepare("UPDATE development_prompts SET is_current=0 WHERE development_request_id=?").bind(record.request.id),
    env.linkedinadam_db.prepare("INSERT INTO development_prompts (id,development_request_id,version,prompt_type,target_tool,generated_text,source_snapshot_json,evidence_snapshot_json,generated_by,generated_provider,generated_model) VALUES (?,?,?,?,?,?,?,?,?,'OpenAI',?)").bind(id, record.request.id, next, kind, targetTool, generated, JSON.stringify(snapshot), branchEvidence ? JSON.stringify(branchEvidence) : null, actor.email, DEVELOPMENT_COPILOT_MODEL),
    env.linkedinadam_db.prepare("INSERT INTO development_thread_entries (id,development_request_id,entry_type,actor_identity,provider,model,content,related_prompt_id,metadata_json) VALUES (?,?,'DEVOS','Development Copilot','OpenAI',?,?,?,?)").bind(crypto.randomUUID(), record.request.id, DEVELOPMENT_COPILOT_MODEL, generated, id, JSON.stringify({ kind: "prompt", version: next, targetTool })),
    env.linkedinadam_db.prepare("UPDATE development_copilot_state SET work_state='PROMPT_READY',updated_at=CURRENT_TIMESTAMP WHERE development_request_id=?").bind(record.request.id),
  ]);
  return id;
}

export async function editPrompt(db: D1Database, actor: DevelopmentActor, promptId: string, text: string) { assertCanWriteDevelopment(actor); await db.prepare("UPDATE development_prompts SET edited_text=? WHERE id=?").bind(clean(text), promptId).run(); }
export async function markPromptSent(db: D1Database, actor: DevelopmentActor, promptId: string) { assertCanWriteDevelopment(actor); await db.prepare("UPDATE development_prompts SET sent_at=CURRENT_TIMESTAMP,sent_by=? WHERE id=?").bind(actor.email, promptId).run(); }

export async function addAndAnalyzeResponse(env: CopilotEnvironment, actor: DevelopmentActor, record: any, entryType: string, content: string, isFailure = false) {
  assertCanWriteDevelopment(actor); if (!COPILOT_ENTRY_TYPES.includes(entryType as any) || ["HUMAN","DEVOS","SYSTEM"].includes(entryType)) throw new Error("Select the assistant that produced the response.");
  const entryId = crypto.randomUUID(); const safeContent = clean(content); if (!safeContent) throw new Error("Response or failure details are required.");
  await env.linkedinadam_db.prepare("INSERT INTO development_thread_entries (id,development_request_id,entry_type,actor_identity,provider,content,metadata_json) VALUES (?,?,?,?,?,?,?)").bind(entryId, record.request.id, entryType, actor.email, entryType, safeContent, JSON.stringify({ kind: isFailure ? "failure_report" : "model_response" })).run();
  if (!env.OPENAI_API_KEY) return { analyzed: false, entryId };
  const analysisRaw = await respond(env.OPENAI_API_KEY, `You are DEVOS ${isFailure ? "Failure Analyst" : "Response Analyst"} (READ + ANALYZE${isFailure ? " + DRAFT" : ""}; non-executing). Return JSON: result (Success|Partial|Failure|Needs Clarification|Ready for Review), plainEnglishResult, importantFacts array of {fact,provenance:'Reported by ${entryType}'|'Verified by GitHub'|'Unverified'}, diagnosis, rootCause, filesChanged, tests, branch,commit,push,pr,schema,migration,securityImpact,blockers,recommendedNextStep,whatIsUncertain,priorWorkStillValid. Only call a claim Verified by GitHub when it appears in the supplied authoritative GitHub data.`, JSON.stringify({ authoritative: { githubItems: record.githubItems, branches: record.branches, qa: record.qa, approvals: record.approvals }, reported: safeContent }));
  const a = parseJson(analysisRaw); const analysisId = crypto.randomUUID();
  const allowedResults=["Success","Partial","Failure","Needs Clarification","Ready for Review"];
  const result=allowedResults.includes(a.result)?a.result:"Needs Clarification";
  await env.linkedinadam_db.batch([
    env.linkedinadam_db.prepare("INSERT INTO development_response_analyses (id,development_request_id,thread_entry_id,result,plain_english_result,important_facts_json,provenance_json,recommended_next_step,provider,model) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(analysisId, record.request.id, entryId, result, clean(a.plainEnglishResult), JSON.stringify(a.importantFacts || []), JSON.stringify({ reportedBy: entryType, authoritativeSources: ["github_sync_items","development_branch_states","qa_handoffs","development_approvals"] }), clean(a.recommendedNextStep), "OpenAI", DEVELOPMENT_COPILOT_MODEL),
    env.linkedinadam_db.prepare("INSERT INTO development_thread_entries (id,development_request_id,entry_type,actor_identity,provider,model,content,metadata_json) VALUES (?,?,'DEVOS','Development Copilot','OpenAI',?,?,?)").bind(crypto.randomUUID(), record.request.id, DEVELOPMENT_COPILOT_MODEL, clean(a.plainEnglishResult), JSON.stringify({ kind: isFailure ? "failure_analysis" : "response_analysis", analysisId, details: a })),
    env.linkedinadam_db.prepare("UPDATE development_copilot_state SET work_state=?,suggested_next_step=?,updated_at=CURRENT_TIMESTAMP WHERE development_request_id=?").bind(isFailure ? "NEEDS_FOLLOWUP" : result === "Ready for Review" ? "READY_FOR_REVIEW" : "RESPONSE_REVIEW", clean(a.recommendedNextStep), record.request.id),
  ]);
  return { analyzed: true, entryId, analysis: a };
}

export async function setWorkState(db: D1Database, actor: DevelopmentActor, requestId: string, state: string) { assertCanWriteDevelopment(actor); if (!DEVELOPMENT_WORK_STATES.includes(state as DevelopmentWorkState)) throw new Error("Invalid work state."); await db.prepare("INSERT INTO development_copilot_state (development_request_id,work_state,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(development_request_id) DO UPDATE SET work_state=excluded.work_state,archived_at=CASE WHEN excluded.work_state='ARCHIVED' THEN CURRENT_TIMESTAMP ELSE NULL END,archived_by=CASE WHEN excluded.work_state='ARCHIVED' THEN ? ELSE NULL END,updated_at=CURRENT_TIMESTAMP").bind(requestId,state,actor.email).run(); }

export async function hardDeleteRequest(env: CopilotEnvironment, actor: DevelopmentActor, requestId: string, reason: string, confirmation: string) {
  if (actor.role !== "OWNER") throw new Response("Only an OWNER may permanently delete a request.",{status:403});
  if (!['accidental entry','duplicate','test','junk'].includes(reason.toLowerCase())) throw new Error("Permanent deletion is limited to accidental entries, duplicates, tests, or junk.");
  if (confirmation !== `DELETE ${requestId}`) throw new Error("The deletion confirmation does not match.");
  const counts = await env.linkedinadam_db.prepare(`SELECT (SELECT COUNT(*) FROM qa_handoffs WHERE development_request_id=? AND status IN ('passed','in_progress')) qa,(SELECT COUNT(*) FROM development_approvals WHERE development_request_id=?) approvals`).bind(requestId,requestId).first<{qa:number;approvals:number}>();
  if ((counts?.qa || 0) > 0 || (counts?.approvals || 0) > 0) throw new Error("This request has meaningful QA or approval history. Archive it instead.");
  let attachments: { storage_key:string }[]=[]; try { attachments=(await env.linkedinadam_db.prepare("SELECT storage_key FROM development_attachments WHERE development_request_id=?").bind(requestId).all<{storage_key:string}>()).results || []; } catch(error){if(!isMissingCopilotSchema(error))throw error;}
  for(const attachment of attachments) await env.LINKEDIN_IMAGES.delete(attachment.storage_key);
  await env.linkedinadam_db.prepare("DELETE FROM development_requests WHERE id=?").bind(requestId).run();
}

export async function generateBatchPrompt(db: D1Database, actor: DevelopmentActor, evidence: BranchEvidence[], targetTool = "Codex") {
  assertCanWriteDevelopment(actor); if (!evidence.length) throw new Error("Select at least one actionable Development Request.");
  const id=crypto.randomUUID(); const prompt=buildBatchReconciliationPrompt(evidence);
  const statements=[db.prepare("INSERT INTO development_batch_prompts (id,target_tool,prompt_text,request_ids_json,evidence_snapshot_json,generated_by) VALUES (?,?,?,?,?,?)").bind(id,targetTool,prompt,JSON.stringify(evidence.map(item=>item.requestId)),JSON.stringify(evidence),actor.email)];
  for(const item of evidence) statements.push(db.prepare("INSERT INTO development_thread_entries (id,development_request_id,entry_type,actor_identity,content,metadata_json) VALUES (?,?,'DEVOS','Development Copilot',?,?)").bind(crypto.randomUUID(),item.requestId,`Batch reconciliation prompt ${id} includes this request.`,JSON.stringify({kind:"batch_prompt_reference",batchPromptId:id})) as never);
  await db.batch(statements); return {id,prompt};
}
