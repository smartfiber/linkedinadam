export const DEVELOPMENT_CONTEXT_BUDGETS = {
  "gpt-5-mini": {
    safeInputTokens: 30_000,
    reservedOutputTokens: 8_000,
    aggressiveInputTokens: 16_000,
    approximateCharactersPerToken: 3.5,
    normalImages: 2,
    aggressiveImages: 1,
  },
} as const;

type BuildMode = "normal" | "aggressive";
type CopilotContext = { state:any; prompts:any[]; thread:any[]; attachments:any[]; analyses:any[] };
type DevelopmentRecord = { request:any; links:any[]; branches:any[]; qa:any[]; approvals:any[]; githubItems:any[]; activity?:any[] };

export type ContextDiagnostics = {
  operation:string; model:string; mode:BuildMode; estimatedInputTokens:number; safeInputTokens:number;
  reservedOutputTokens:number; characters:number; threadEntriesConsidered:number; threadEntriesIncludedVerbatim:number;
  threadEntriesSummarized:number; promptsConsidered:number; promptsIncluded:number; attachmentsConsidered:number;
  attachmentsIncluded:number; imageTokenReserve:number; compactMode:boolean; duplicateGitHubPayloadsRemoved:number;
};

function text(value:unknown,max:number){return String(value||"").replaceAll("\0","").trim().slice(0,max);}
function json(value:unknown){try{return typeof value==="string"?JSON.parse(value):value||{};}catch{return {};}}
function compactChecks(checks:any[]){const grouped:Record<string,number>={};for(const check of checks||[]){const key=text(check.conclusion||check.status||"unknown",40);grouped[key]=(grouped[key]||0)+1;}return grouped;}
function canonicalBranches(branches:any[]){return (branches||[]).map(value=>({branch:value.branch,state:value.state,sha:value.commit_sha||value.sha||null,comparison:value.comparison_state||value.comparison||null,confidence:value.confidence||null,notes:text(value.equivalence_notes||value.notes,800),checkedAt:value.checked_at||value.checkedAt||null}));}
function canonicalQa(qa:any[]){return (qa||[]).map(value=>({stage:value.stage,status:value.status,verifiedBy:value.verified_by||null,verifiedAt:value.verified_at||null,notes:text(value.notes,1000),expectedResult:text(value.expected_result,800)}));}
function canonicalGitHub(items:any[]){return (items||[]).map(item=>{const payload=json(item.payload_json);return {kind:item.kind,number:item.number,title:text(item.title,500),body:text(payload.body,2000),state:item.state,githubUpdatedAt:item.github_updated_at,sourceBranch:payload.sourceBranch||null,targetBranch:payload.targetBranch||null,headSha:payload.headSha||payload.head?.sha||null,baseSha:payload.baseSha||payload.base?.sha||null,mergeSha:payload.mergeSha||null,mergeable:payload.mergeable??null,merged:payload.merged??null,ci:compactChecks(Array.isArray(payload.checks)?payload.checks:[]),reviews:{approvals:payload.approvals??null,reviewers:Array.isArray(payload.reviewers)?payload.reviewers.slice(0,12):[],recent:(Array.isArray(payload.reviews)?payload.reviews:[]).slice(-8).map((review:any)=>({state:review.state,user:review.user?.login||review.author||null,submittedAt:review.submittedAt||review.submitted_at||null}))},changedFiles:(Array.isArray(payload.changedFiles)?payload.changedFiles:[]).slice(0,20).map((file:any)=>({filename:text(file.filename,300),status:file.status}))};});}

function historicalSummary(record:DevelopmentRecord,copilot:CopilotContext,mode:BuildMode){
  const thread=copilot.thread||[];const human=thread.filter(entry=>entry.entry_type==="HUMAN");const systems=thread.filter(entry=>entry.entry_type==="SYSTEM");
  const analyses=(copilot.analyses||[]).slice(0,mode==="normal"?5:3).map(a=>({result:a.result,summary:text(a.plain_english_result,mode==="normal"?1200:650),facts:text(JSON.stringify(json(a.important_facts_json)),1200),next:text(a.recommended_next_step,500)}));
  const decisionEntries=human.filter(entry=>/decision|must|should|approved|do not|preserve|require/i.test(entry.content||""));
  const failures=thread.filter(entry=>/failure|failed|error|blocked/i.test(`${entry.metadata_json||""} ${entry.content||""}`)).slice(-(mode==="normal"?4:2));
  return {
    goal:text(record.request?.problem||record.request?.title,1800),
    decisions:[text(record.request?.why_decision,2200),...decisionEntries.slice(-5).map(entry=>text(entry.content,700))].filter(Boolean),
    workCompleted:analyses.filter(a=>a.result==="Success"||a.result==="Ready for Review"),
    currentTechnicalState:"See authoritativeState for the single canonical GitHub, branch, CI, and QA representation.",
    failuresAndLessons:failures.map(entry=>text(entry.content,mode==="normal"?900:500)),
    openQuestionsAndBlockers:analyses.filter(a=>a.result==="Failure"||a.result==="Needs Clarification").map(a=>({summary:a.summary,next:a.next})),
    nextExpectedAction:text(copilot.state?.suggested_next_step||record.request?.next_action,800),
    auditNote:`Derived from ${thread.length} preserved conversation entries (${human.length} human, ${systems.length} system). Original history remains in DEVOS.`,
  };
}

function boundedRecent(thread:any[],mode:BuildMode){const limit=mode==="normal"?8:4;const per=mode==="normal"?1800:900;return thread.filter(entry=>{const meta=json(entry.metadata_json);return entry.entry_type!=="SYSTEM"&&meta.kind!=="prompt"&&meta.kind!=="summary";}).slice(-limit).map(entry=>({type:entry.entry_type,at:entry.created_at,content:text(entry.content,per),metadata:json(entry.metadata_json)?.kind||null}));}

function fitSections(sections:Record<string,unknown>,maxChars:number,required:string[]){const output:Record<string,unknown>={};let used=2;for(const [key,value] of Object.entries(sections)){let encoded=JSON.stringify(value);const remaining=maxChars-used-key.length-8;if(remaining<=0){if(required.includes(key))output[key]="[Retained field exceeded safe representation; inspect DEVOS record.]";continue;}if(encoded.length>remaining){if(required.includes(key))encoded=JSON.stringify(text(encoded,remaining));else continue;}output[key]=JSON.parse(encoded);used+=key.length+encoded.length+6;}return output;}

export function buildDevelopmentCopilotContext(input:{operation:string;model?:keyof typeof DEVELOPMENT_CONTEXT_BUDGETS;mode?:BuildMode;record:DevelopmentRecord;copilot:CopilotContext;currentInstruction?:string;providerInstruction?:string;availableImageCount?:number}){
  const model=input.model||"gpt-5-mini";const config=DEVELOPMENT_CONTEXT_BUDGETS[model];const mode=input.mode||"normal";const maxTokens=mode==="aggressive"?config.aggressiveInputTokens:config.safeInputTokens;const imageLimit=mode==="aggressive"?config.aggressiveImages:config.normalImages;const imageTokenReserve=Math.min(input.availableImageCount||0,imageLimit)*1500;const instructionTokens=Math.ceil(String(input.providerInstruction||"").length/config.approximateCharactersPerToken);const maxChars=Math.floor(Math.max(4000,maxTokens-imageTokenReserve-instructionTokens)*config.approximateCharactersPerToken);
  const {record,copilot}=input;const canonical=canonicalGitHub(record.githubItems||[]);const prompts=copilot.prompts||[];const currentPrompt=prompts.find(prompt=>prompt.is_current)||prompts[0];const thread=copilot.thread||[];const latestFailure=[...thread].reverse().find(entry=>/failure|failed|error/i.test(`${entry.metadata_json||""} ${entry.content||""}`));const latestResponse=[...thread].reverse().find(entry=>["CODEX","CLAUDE","CHATGPT","GEMINI"].includes(entry.entry_type));
  const attachmentLimit=mode==="normal"?12:6;const sections={
    currentInstruction:text(input.currentInstruction,1200),
    humanRequest:{id:record.request?.id,title:text(record.request?.title,1200),problem:text(record.request?.problem,4000),whyDecision:text(record.request?.why_decision,4000),priority:record.request?.priority,area:record.request?.product_area,owner:record.request?.owner_email,notes:text(record.request?.notes,1800)},
    workState:{state:copilot.state?.work_state||"NEEDS_PROMPT",currentState:text(copilot.state?.current_state_summary,1600),next:text(copilot.state?.suggested_next_step||record.request?.next_action,1000),securityOrHardBlockers:(record.request?.overall_status==="blocked"?["Request is blocked"]:[])},
    authoritativeState:{links:(record.links||[]).map(link=>({provider:link.provider,type:link.type,externalId:link.external_id,url:link.url})),github:canonical,branches:canonicalBranches(record.branches),qa:canonicalQa(record.qa),approvals:(record.approvals||[]).slice(0,12).map(a=>({stage:a.stage,decision:a.decision,actor:a.actor_name,at:a.created_at}))},
    currentFailure:latestFailure?{at:latestFailure.created_at,content:text(latestFailure.content,mode==="normal"?5000:2400)}:null,
    latestRelevantResponse:latestResponse?{type:latestResponse.entry_type,at:latestResponse.created_at,content:text(latestResponse.content,mode==="normal"?6000:2600)}:null,
    currentPrompt:currentPrompt?{version:currentPrompt.version,type:currentPrompt.prompt_type,target:currentPrompt.target_tool,content:text(currentPrompt.edited_text||currentPrompt.generated_text,mode==="normal"?7000:2800)}:null,
    compactHistory:historicalSummary(record,copilot,mode),
    structuredAnalyses:(copilot.analyses||[]).slice(0,mode==="normal"?5:2).map(a=>({result:a.result,summary:text(a.plain_english_result,1000),facts:text(JSON.stringify(json(a.important_facts_json)),1200),next:text(a.recommended_next_step,500)})),
    recentConversation:boundedRecent(thread,mode),
    screenshots:(copilot.attachments||[]).slice(-(attachmentLimit)).map((a,index)=>({number:index+1,category:a.category,caption:text(a.caption||a.original_filename,500),uploadedAt:a.uploaded_at})),
    visualObservations:text(copilot.state?.visual_observations_json,mode==="normal"?5000:1800),
  };
  const required=["currentInstruction","humanRequest","workState","authoritativeState","currentFailure","compactHistory"];
  const bounded=fitSections(sections,maxChars,required);const serialized=JSON.stringify(bounded);const recentIncluded=Array.isArray((bounded as any).recentConversation)?(bounded as any).recentConversation.length:0;
  const diagnostics:ContextDiagnostics={operation:input.operation,model,mode,estimatedInputTokens:Math.ceil(serialized.length/config.approximateCharactersPerToken)+instructionTokens+imageTokenReserve,safeInputTokens:maxTokens,reservedOutputTokens:config.reservedOutputTokens,characters:serialized.length,threadEntriesConsidered:thread.length,threadEntriesIncludedVerbatim:recentIncluded,threadEntriesSummarized:Math.max(0,thread.length-recentIncluded),promptsConsidered:prompts.length,promptsIncluded:currentPrompt?1:0,attachmentsConsidered:(copilot.attachments||[]).length,attachmentsIncluded:Array.isArray((bounded as any).screenshots)?(bounded as any).screenshots.length:0,imageTokenReserve,compactMode:mode==="aggressive",duplicateGitHubPayloadsRemoved:(record.githubItems||[]).length};
  return {context:bounded,serialized,diagnostics,imageLimit};
}

export function isContextOverflow(error:unknown){return Boolean(error&&typeof error==="object"&&(((error as any).code==="context_length_exceeded")||String((error as any).message||"").includes("context_length_exceeded")));}

export async function withContextOverflowFallback<T>(invoke:(mode:BuildMode)=>Promise<T>){try{return {value:await invoke("normal"),mode:"normal" as const,retried:false};}catch(error){if(!isContextOverflow(error))throw error;try{return {value:await invoke("aggressive"),mode:"aggressive" as const,retried:true};}catch(retryError){if(isContextOverflow(retryError))throw Object.assign(new Error("Development Copilot context is too large to process safely. Reduce or archive unusually large pasted artifacts."),{code:"context_length_exceeded"});throw retryError;}}}
