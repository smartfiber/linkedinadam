import type { DevelopmentActor } from "./types";
import { assertCanWriteDevelopment } from "./service.server";
import { isMissingCopilotSchema, type CopilotEnvironment } from "./copilot.server";

export const MAX_DEVELOPMENT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DEVELOPMENT_IMAGES_PER_ACTION = 8;
const signatures = {
  "image/png": (b: Uint8Array) => b.length > 8 && [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v),
  "image/jpeg": (b: Uint8Array) => b.length > 3 && b[0]===0xff && b[1]===0xd8 && b[2]===0xff,
  "image/webp": (b: Uint8Array) => b.length > 12 && new TextDecoder().decode(b.slice(0,4))==="RIFF" && new TextDecoder().decode(b.slice(8,12))==="WEBP",
} as const;

export function inspectDevelopmentImage(file: Pick<File,"name"|"type"|"size">, bytes: Uint8Array) {
  if (!file.size || file.size > MAX_DEVELOPMENT_IMAGE_BYTES) throw new Error(`Each screenshot must be between 1 byte and ${MAX_DEVELOPMENT_IMAGE_BYTES / 1024 / 1024} MB.`);
  const actual = (Object.entries(signatures).find(([,check])=>check(bytes))?.[0]) as keyof typeof signatures | undefined;
  if (!actual) throw new Error("Only valid PNG, JPEG, and WEBP images are supported.");
  if (file.type && file.type !== actual && !(file.type === "image/jpg" && actual === "image/jpeg")) throw new Error("The attachment MIME type does not match its contents.");
  const extension = file.name.split(".").pop()?.toLowerCase(); const expected = actual === "image/png" ? ["png"] : actual === "image/webp" ? ["webp"] : ["jpg","jpeg"];
  if (extension && !expected.includes(extension)) throw new Error("The attachment filename extension does not match its contents.");
  return { mime: actual, extension: actual === "image/jpeg" ? "jpg" : actual.split("/")[1] };
}

function safeFilename(name: string) { return name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,120) || "screenshot"; }

export async function saveDevelopmentAttachments(env: CopilotEnvironment, actor: DevelopmentActor, requestId: string, files: File[], input: { caption?: string; category?: string; threadEntryId?: string; qaAttemptId?: number } = {}) {
  assertCanWriteDevelopment(actor); if (files.length > MAX_DEVELOPMENT_IMAGES_PER_ACTION) throw new Error(`Upload at most ${MAX_DEVELOPMENT_IMAGES_PER_ACTION} images at once.`);
  const prepared=[] as {file:File;bytes:ArrayBuffer;mime:string;extension:string;id:string;key:string}[];
  for(const file of files){const bytes=await file.arrayBuffer();const inspected=inspectDevelopmentImage(file,new Uint8Array(bytes));const id=crypto.randomUUID();prepared.push({file,bytes,...inspected,id,key:`development/${requestId}/${id}.${inspected.extension}`});}
  const uploaded:string[]=[];
  try {
    for(let i=0;i<prepared.length;i++){const item=prepared[i];await env.LINKEDIN_IMAGES.put(item.key,item.bytes,{httpMetadata:{contentType:item.mime},customMetadata:{requestId,uploadedBy:actor.email}});uploaded.push(item.key);await env.linkedinadam_db.prepare("INSERT INTO development_attachments (id,development_request_id,storage_key,original_filename,safe_filename,mime_type,size_bytes,uploaded_by,caption,category,display_order,related_thread_entry_id,related_qa_attempt_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(item.id,requestId,item.key,item.file.name,safeFilename(item.file.name),item.mime,item.file.size,actor.email,input.caption?.trim()||null,input.category||"Other",i,input.threadEntryId||null,input.qaAttemptId||null).run();}
  } catch(error){for(const key of uploaded)await env.LINKEDIN_IMAGES.delete(key);if(isMissingCopilotSchema(error))throw new Error("Development Copilot not initialized");throw error;}
  return prepared.map(({id})=>id);
}
