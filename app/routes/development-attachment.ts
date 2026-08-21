import type { Route } from "./+types/development-attachment";
import { requireAuthenticatedUser, type AccessEnvironment } from "../lib/auth.server";

type Env = AccessEnvironment & { linkedinadam_db:D1Database; LINKEDIN_IMAGES:R2Bucket };
export async function loader({request,context,params}:Route.LoaderArgs){
  const env=context.cloudflare.env as unknown as Env; await requireAuthenticatedUser(request,env);
  let attachment:{storage_key:string;mime_type:string;safe_filename:string}|null=null;try{attachment=await env.linkedinadam_db.prepare("SELECT storage_key,mime_type,safe_filename FROM development_attachments WHERE id=?").bind(params.attachmentId).first<{storage_key:string;mime_type:string;safe_filename:string}>();}catch(error){if(error instanceof Error&&/no such table: development_attachments/i.test(error.message))throw new Response("Development Copilot not initialized",{status:503});throw error;}
  if(!attachment)throw new Response("Attachment not found",{status:404}); const object=await env.LINKEDIN_IMAGES.get(attachment.storage_key); if(!object)throw new Response("Attachment data not found",{status:404});
  return new Response(object.body,{headers:{"content-type":attachment.mime_type,"content-disposition":`inline; filename*=UTF-8''${encodeURIComponent(attachment.safe_filename)}`,"cache-control":"private, max-age=300","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; img-src 'self' data:"}});
}
