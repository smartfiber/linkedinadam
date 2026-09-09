import type { AuthenticatedUser } from "./auth.server";
import { canReceiveOutreach, GROWTH_LIFECYCLES } from "./growth";

export type GrowthEnvironment = { linkedinadam_db: D1Database };
export type GrowthRecord = Record<string, unknown> & { id: number };

export type GrowthSnapshot = {
  initialized: boolean;
  metrics: Record<string, number>;
  people: GrowthRecord[];
  companies: GrowthRecord[];
  icpProfiles: GrowthRecord[];
  segments: GrowthRecord[];
  campaigns: GrowthRecord[];
  signals: GrowthRecord[];
  watchlists: GrowthRecord[];
  conversations: GrowthRecord[];
  newsletters: GrowthRecord[];
  outreachDrafts: GrowthRecord[];
  integrations: GrowthRecord[];
  timeline: GrowthRecord[];
  assets: GrowthRecord[];
  leadCaptures: GrowthRecord[];
  demoEvents: GrowthRecord[];
};

export function isMissingGrowthSchema(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table|no such column|D1_ERROR/i.test(message) && /growth_/i.test(message);
}

async function all(db: D1Database, sql: string, ...bindings: unknown[]) {
  const result = await db.prepare(sql).bind(...bindings).all<GrowthRecord>();
  return result.results ?? [];
}

export async function loadGrowthSnapshot(db: D1Database, query = ""): Promise<GrowthSnapshot> {
  const blank: GrowthSnapshot = { initialized:false, metrics:{}, people:[], companies:[], icpProfiles:[], segments:[], campaigns:[], signals:[], watchlists:[], conversations:[], newsletters:[], outreachDrafts:[], integrations:[], timeline:[], assets:[], leadCaptures:[], demoEvents:[] };
  try {
    const term = `%${query.trim()}%`;
    const [people, companies, icpProfiles, segments, campaigns, signals, watchlists, conversations, newsletters, outreachDrafts, integrations, timeline, assets, leadCaptures, demoEvents, metricRows] = await Promise.all([
      all(db, `SELECT p.*, c.name AS company_name FROM growth_people p LEFT JOIN growth_companies c ON c.id=p.company_id WHERE (?='' OR p.full_name LIKE ? OR p.email LIKE ? OR c.name LIKE ?) ORDER BY p.icp_score DESC,p.updated_at DESC LIMIT 200`, query.trim(), term, term, term),
      all(db, `SELECT * FROM growth_companies WHERE (?='' OR name LIKE ? OR domain LIKE ?) ORDER BY icp_score DESC,updated_at DESC LIMIT 200`, query.trim(), term, term),
      all(db, `SELECT * FROM growth_icp_profiles WHERE active=1 ORDER BY id`),
      all(db, `SELECT s.*,
        (SELECT COUNT(*) FROM growth_segment_memberships sm WHERE sm.segment_id=s.id) AS static_count,
        CASE s.name
          WHEN 'Technology Advisors · 1–5 Employees' THEN (SELECT COUNT(*) FROM growth_people p JOIN growth_companies c ON c.id=p.company_id WHERE c.employee_count BETWEEN 1 AND 5 AND lower(COALESCE(c.business_type,'')) LIKE '%technology advis%')
          WHEN 'ICP >80' THEN (SELECT COUNT(*) FROM growth_people WHERE icp_score>80)
          WHEN 'No Outreach Yet' THEN (SELECT COUNT(*) FROM growth_people WHERE last_outbound_at IS NULL)
          WHEN 'Demo Interest' THEN (SELECT COUNT(*) FROM growth_people WHERE lifecycle='DEMO_INTEREST')
          WHEN 'Newsletter Subscribers' THEN (SELECT COUNT(*) FROM growth_people WHERE subscription_status='SUBSCRIBED')
          WHEN 'High-Fit / No Conversation' THEN (SELECT COUNT(*) FROM growth_people p WHERE p.icp_score>80 AND NOT EXISTS(SELECT 1 FROM growth_conversations c WHERE c.person_id=p.id))
          WHEN 'Hiring Operations Staff' THEN (SELECT COUNT(DISTINCT person_id) FROM growth_signals WHERE signal_type='HIRING' AND lower(COALESCE(summary,'')) LIKE '%operation%')
          WHEN 'Connectivity-Focused' THEN (SELECT COUNT(*) FROM growth_people p JOIN growth_companies c ON c.id=p.company_id WHERE lower(COALESCE(c.technology_focus,'')) LIKE '%connectivity%')
          ELSE (SELECT COUNT(*) FROM growth_segment_memberships sm WHERE sm.segment_id=s.id)
        END AS member_count
      FROM growth_segments s WHERE active=1 ORDER BY name`),
      all(db, `SELECT c.*,s.name AS segment_name FROM growth_campaigns c LEFT JOIN growth_segments s ON s.id=c.segment_id WHERE (?='' OR c.name LIKE ? OR c.objective LIKE ?) ORDER BY c.updated_at DESC LIMIT 100`,query.trim(),term,term),
      all(db, `SELECT s.*,p.full_name,c.name AS company_name FROM growth_signals s LEFT JOIN growth_people p ON p.id=s.person_id LEFT JOIN growth_companies c ON c.id=s.company_id WHERE (?='' OR s.title LIKE ? OR s.summary LIKE ?) ORDER BY s.observed_at DESC LIMIT 100`,query.trim(),term,term),
      all(db, `SELECT w.*, (SELECT COUNT(*) FROM growth_watchlist_items i WHERE i.watchlist_id=w.id) AS item_count FROM growth_watchlists w WHERE active=1 ORDER BY w.created_at DESC`),
      all(db, `SELECT c.*,p.full_name,p.icp_score,p.lifecycle,co.name AS company_name FROM growth_conversations c LEFT JOIN growth_people p ON p.id=c.person_id LEFT JOIN growth_companies co ON co.id=c.company_id ORDER BY COALESCE(c.last_message_at,c.updated_at) DESC LIMIT 100`),
      all(db, `SELECT n.*,c.name AS campaign_name,s.name AS segment_name FROM growth_newsletters n LEFT JOIN growth_campaigns c ON c.id=n.campaign_id LEFT JOIN growth_segments s ON s.id=n.segment_id ORDER BY n.updated_at DESC LIMIT 100`),
      all(db, `SELECT d.*,p.full_name FROM growth_outreach_drafts d JOIN growth_people p ON p.id=d.person_id ORDER BY d.updated_at DESC LIMIT 100`),
      all(db, `SELECT * FROM growth_integrations ORDER BY integration_key`),
      all(db, `SELECT t.*,p.full_name,c.name AS company_name FROM growth_timeline_events t LEFT JOIN growth_people p ON p.id=t.person_id LEFT JOIN growth_companies c ON c.id=t.company_id ORDER BY t.occurred_at DESC LIMIT 100`),
      all(db, `SELECT a.*,c.name AS campaign_name FROM growth_assets a LEFT JOIN growth_campaigns c ON c.id=a.campaign_id ORDER BY a.updated_at DESC LIMIT 100`),
      all(db, `SELECT l.*,p.full_name,c.name AS company_name FROM growth_lead_captures l LEFT JOIN growth_people p ON p.id=l.person_id LEFT JOIN growth_companies c ON c.id=l.company_id ORDER BY l.captured_at DESC LIMIT 100`),
      all(db, `SELECT d.*,p.full_name,c.name AS company_name FROM growth_demo_events d LEFT JOIN growth_people p ON p.id=d.person_id LEFT JOIN growth_companies c ON c.id=d.company_id ORDER BY d.occurred_at DESC LIMIT 100`),
      all(db, `SELECT
        (SELECT COUNT(*) FROM growth_people) AS total_prospects,
        (SELECT COUNT(*) FROM growth_people WHERE icp_score>80) AS high_icp,
        (SELECT COUNT(*) FROM growth_people WHERE created_at>=datetime('now','-7 days')) AS new_week,
        (SELECT COUNT(*) FROM growth_people WHERE assigned_to IS NULL OR assigned_to='') AS unassigned,
        (SELECT COUNT(*) FROM growth_people WHERE enrichment_status IN ('NOT_ENRICHED','FAILED')) AS needs_enrichment,
        (SELECT COUNT(*) FROM growth_people WHERE lifecycle IN ('ENGAGED','QUALIFIED','DEMO_INTEREST')) AS engaged,
        (SELECT COUNT(*) FROM growth_conversations WHERE status='ACTIVE') AS active_conversations,
        (SELECT COUNT(*) FROM growth_conversations WHERE reply_needed=1) AS replies_needed,
        (SELECT COUNT(*) FROM growth_signals WHERE status='NEW') AS new_signals,
        (SELECT COUNT(*) FROM growth_signals WHERE status='NEW' AND confidence>=80) AS high_intent,
        (SELECT COUNT(*) FROM growth_campaigns WHERE status='ACTIVE') AS active_campaigns,
        (SELECT COUNT(*) FROM growth_demo_events WHERE event_type='DEMO_REQUESTED') AS demo_requests,
        (SELECT COUNT(*) FROM growth_demo_events WHERE event_type='OPPORTUNITY_CREATED') AS opportunities,
        (SELECT COUNT(*) FROM growth_newsletters WHERE status='DRAFT') AS newsletter_drafts,
        (SELECT COUNT(*) FROM growth_assets WHERE status='DRAFT') AS asset_drafts,
        (SELECT COUNT(*) FROM growth_assets WHERE status='SCHEDULED') AS assets_scheduled
      `),
    ]);
    return { initialized:true, metrics:metricRows[0] as Record<string,number> || {}, people, companies, icpProfiles, segments, campaigns, signals, watchlists, conversations, newsletters, outreachDrafts, integrations, timeline, assets, leadCaptures, demoEvents };
  } catch (error) {
    if (isMissingGrowthSchema(error)) return blank;
    throw error;
  }
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const nullable = (value: string) => value || null;
const numberOrNull = (value: string) => value ? Number(value) : null;

async function timeline(db: D1Database, values: { personId?: number|null; companyId?: number|null; type:string; summary:string; actor:string; source?:string; provenance?:string }) {
  await db.prepare(`INSERT INTO growth_timeline_events(person_id,company_id,event_type,source,actor_email,summary,provenance) VALUES(?,?,?,?,?,?,?)`)
    .bind(values.personId ?? null,values.companyId ?? null,values.type,values.source ?? "DEVOS",values.actor,values.summary,values.provenance ?? "user_action").run();
}

export async function executeGrowthAction(db: D1Database, user: AuthenticatedUser, form: FormData) {
  const intent = text(form,"intent");
  if (user.role === "VIEWER") throw new Response("Viewers cannot change Growth records.",{status:403});
  if (intent === "create-person") {
    const first=text(form,"first_name"), last=text(form,"last_name"), email=text(form,"email").toLowerCase(), linkedin=text(form,"linkedin_url").toLowerCase();
    if (!first || !last) return { error:"First and last name are required." };
    const duplicate = await db.prepare(`SELECT id,full_name FROM growth_people WHERE (?<>'' AND lower(email)=?) OR (?<>'' AND lower(linkedin_url)=?) LIMIT 1`).bind(email,email,linkedin,linkedin).first<GrowthRecord>();
    if (duplicate) return { error:`Duplicate person: ${duplicate.full_name}.` };
    const companyId=numberOrNull(text(form,"company_id"));
    const result=await db.prepare(`INSERT INTO growth_people(first_name,last_name,full_name,title,company_id,email,phone,linkedin_url,geography,lifecycle,source_channel,source_type,owner_email,assigned_to,created_by,human_notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(first,last,`${first} ${last}`,nullable(text(form,"title")),companyId,nullable(email),nullable(text(form,"phone")),nullable(linkedin),nullable(text(form,"geography")),GROWTH_LIFECYCLES.includes(text(form,"lifecycle") as never)?text(form,"lifecycle"):"PROSPECT",text(form,"source_channel")||"Manual",nullable(text(form,"source_type")),user.email,nullable(text(form,"assigned_to")),user.email,nullable(text(form,"notes"))).run();
    const id=Number(result.meta.last_row_id);
    if(companyId)await db.prepare(`INSERT INTO growth_company_relationships(person_id,company_id,title,is_primary,provenance) VALUES(?,?,?,?,?)`).bind(id,companyId,nullable(text(form,"title")),1,"manual_create").run();
    await timeline(db,{personId:id,companyId,type:"PROSPECT_CREATED",summary:`${first} ${last} added as a prospect`,actor:user.email,source:text(form,"source_channel")||"Manual"});
    await db.prepare(`INSERT INTO growth_attribution_events(person_id,event_type,source_channel,source_type,touch_kind,provenance) VALUES(?,?,?,?,?,?)`).bind(id,"PROSPECT_CREATED",text(form,"source_channel")||"Manual",nullable(text(form,"source_type")),"FIRST","manual_create").run();
    return { ok:"Prospect created." };
  }
  if (intent === "import-people") {
    const rows = text(form,"csv").split(/\r?\n/).map(row=>row.trim()).filter(Boolean);
    if(rows.length<2)return{error:"Paste a CSV with a header and at least one data row."};
    const headers=rows[0].split(",").map(value=>value.trim().toLowerCase());
    const required=["first_name","last_name"]; if(required.some(key=>!headers.includes(key)))return{error:"CSV requires first_name and last_name headers."};
    let created=0,duplicates=0,invalid=0;
    for(const row of rows.slice(1,501)){
      const values=row.split(",").map(value=>value.trim().replace(/^"|"$/g,"")); const item=Object.fromEntries(headers.map((key,index)=>[key,values[index]||""]));
      if(!item.first_name||!item.last_name){invalid++;continue;}
      const email=item.email.toLowerCase(),linkedin=(item.linkedin_url||"").toLowerCase();
      const duplicate=await db.prepare(`SELECT id FROM growth_people WHERE (?<>'' AND lower(email)=?) OR (?<>'' AND lower(linkedin_url)=?) LIMIT 1`).bind(email,email,linkedin,linkedin).first();
      if(duplicate){duplicates++;continue;}
      const result=await db.prepare(`INSERT INTO growth_people(first_name,last_name,full_name,title,email,linkedin_url,geography,lifecycle,source_channel,source_type,owner_email,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(item.first_name,item.last_name,`${item.first_name} ${item.last_name}`,nullable(item.title),nullable(email),nullable(linkedin),nullable(item.geography),"PROSPECT","Import","Imported List",user.email,user.email).run();
      const id=Number(result.meta.last_row_id); await timeline(db,{personId:id,type:"IMPORTED",summary:`${item.first_name} ${item.last_name} imported`,actor:user.email,source:"Import",provenance:"csv_import"}); created++;
    }
    return{ok:`Import complete: ${created} created, ${duplicates} duplicates skipped, ${invalid} invalid rows skipped.`};
  }
  if (intent === "create-company") {
    const name=text(form,"name"),domain=text(form,"domain").toLowerCase(); if(!name)return{error:"Company name is required."};
    const duplicate=domain?await db.prepare(`SELECT id,name FROM growth_companies WHERE lower(domain)=? LIMIT 1`).bind(domain).first<GrowthRecord>():null;
    if(duplicate)return{error:`Duplicate company domain belongs to ${duplicate.name}.`};
    const result=await db.prepare(`INSERT INTO growth_companies(name,domain,website,linkedin_url,geography,employee_count,advisor_count,business_type,technology_focus,lifecycle,source_channel,owner_email,created_by,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(name,nullable(domain),nullable(text(form,"website")),nullable(text(form,"linkedin_url")),nullable(text(form,"geography")),numberOrNull(text(form,"employee_count")),numberOrNull(text(form,"advisor_count")),nullable(text(form,"business_type")),nullable(text(form,"technology_focus")),"PROSPECT",text(form,"source_channel")||"Manual",user.email,user.email,nullable(text(form,"notes"))).run();
    const id=Number(result.meta.last_row_id); await timeline(db,{companyId:id,type:"COMPANY_CREATED",summary:`${name} added to Growth CRM`,actor:user.email,source:text(form,"source_channel")||"Manual"}); return{ok:"Company created."};
  }
  if(intent==="change-lifecycle"){
    const id=Number(text(form,"person_id")), lifecycle=text(form,"lifecycle"); if(!GROWTH_LIFECYCLES.includes(lifecycle as never))return{error:"Invalid lifecycle."};
    await db.prepare(`UPDATE growth_people SET lifecycle=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(lifecycle,id).run(); await timeline(db,{personId:id,type:"LIFECYCLE_CHANGED",summary:`Lifecycle changed to ${lifecycle}`,actor:user.email}); return{ok:"Lifecycle updated."};
  }
  if(intent==="create-campaign"){
    const name=text(form,"name"),objective=text(form,"objective"); if(!name||!objective)return{error:"Name and objective are required."};
    await db.prepare(`INSERT INTO growth_campaigns(name,objective,segment_id,offer,problem,promise,cta,owner_email,status,channel_plan,strategy,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(name,objective,numberOrNull(text(form,"segment_id")),nullable(text(form,"offer")),nullable(text(form,"problem")),nullable(text(form,"promise")),nullable(text(form,"cta")),user.email,"DRAFT",JSON.stringify(form.getAll("channel")),nullable(text(form,"strategy")),user.email).run(); return{ok:"Campaign draft created."};
  }
  if(intent==="create-outreach-draft"){
    const personId=Number(text(form,"person_id")); const person=await db.prepare(`SELECT subscription_status FROM growth_people WHERE id=?`).bind(personId).first<{subscription_status:string}>();
    if(!person)return{error:"Select a person."}; if(!canReceiveOutreach(person.subscription_status))return{error:`Outreach blocked: person is ${person.subscription_status.replaceAll("_"," ").toLowerCase()}.`};
    await db.prepare(`INSERT INTO growth_outreach_drafts(person_id,campaign_id,channel,subject,body,scheduled_at,status,approval_status,created_by) VALUES(?,?,?,?,?,?,?,?,?)`).bind(personId,numberOrNull(text(form,"campaign_id")),text(form,"channel")||"EMAIL",nullable(text(form,"subject")),text(form,"body"),nullable(text(form,"scheduled_at")),"DRAFT","DRAFT",user.email).run(); return{ok:"Draft saved. No message was sent."};
  }
  if(intent==="create-newsletter"){
    const title=text(form,"title"),subject=text(form,"subject"),content=text(form,"content"); if(!title||!subject||!content)return{error:"Title, subject and content are required."};
    await db.prepare(`INSERT INTO growth_newsletters(title,campaign_id,segment_id,subject,preview_text,content,cta,scheduled_at,status,approval_status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(title,numberOrNull(text(form,"campaign_id")),numberOrNull(text(form,"segment_id")),subject,nullable(text(form,"preview_text")),content,nullable(text(form,"cta")),nullable(text(form,"scheduled_at")),"DRAFT","DRAFT",user.email).run(); return{ok:"Newsletter draft saved. Delivery remains disabled."};
  }
  if(intent==="create-segment"){
    const name=text(form,"name"); if(!name)return{error:"Segment name is required."}; await db.prepare(`INSERT INTO growth_segments(name,description,kind,rules_json,owner_email) VALUES(?,?,?,?,?)`).bind(name,nullable(text(form,"description")),text(form,"kind")==="STATIC"?"STATIC":"DYNAMIC",text(form,"rules_json")||"[]",user.email).run(); return{ok:"Segment created. Joining never triggers sends."};
  }
  if(intent==="create-signal"){
    const title=text(form,"title"); if(!title)return{error:"Signal title is required."}; await db.prepare(`INSERT INTO growth_signals(person_id,company_id,source,external_url,signal_type,title,summary,confidence,recommended_action,status,provenance) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(numberOrNull(text(form,"person_id")),numberOrNull(text(form,"company_id")),text(form,"source")||"Manual",nullable(text(form,"external_url")),text(form,"signal_type")||"MANUAL",title,nullable(text(form,"summary")),Math.max(0,Math.min(100,Number(text(form,"confidence"))||0)),nullable(text(form,"recommended_action")),"NEW","manual_capture").run(); return{ok:"Signal captured with manual provenance."};
  }
  if(intent==="create-watchlist"){
    const name=text(form,"name"); if(!name)return{error:"Watchlist name is required."};
    const result=await db.prepare(`INSERT INTO growth_watchlists(name,description,created_by) VALUES(?,?,?)`).bind(name,nullable(text(form,"description")),user.email).run();
    const watchlistId=Number(result.meta.last_row_id),label=text(form,"item_label"),itemType=text(form,"item_type");
    if(label)await db.prepare(`INSERT INTO growth_watchlist_items(watchlist_id,item_type,label,external_url,polling_policy) VALUES(?,?,?,?,?)`).bind(watchlistId,itemType||"Keyword",label,nullable(text(form,"external_url")),"MANUAL").run();
    return{ok:"Watchlist created. Collection remains manual until a collector is connected."};
  }
  if(intent==="signal-to-prospect"){
    const signalId=Number(text(form,"signal_id")); const signal=await db.prepare(`SELECT id,person_id,title,external_url,source FROM growth_signals WHERE id=?`).bind(signalId).first<{id:number;person_id:number|null;title:string;external_url:string|null;source:string}>();
    if(!signal)return{error:"Signal not found."}; if(signal.person_id)return{ok:"Signal is already linked to an existing prospect."};
    const firstName=text(form,"first_name"),lastName=text(form,"last_name"); if(!firstName||!lastName)return{error:"Enter the prospect name before creating from this signal."};
    const existing=signal.external_url?await db.prepare(`SELECT id FROM growth_people WHERE lower(linkedin_url)=lower(?) LIMIT 1`).bind(signal.external_url).first<{id:number}>():null;
    let personId=existing?.id;
    if(!personId){const result=await db.prepare(`INSERT INTO growth_people(first_name,last_name,full_name,linkedin_url,lifecycle,source_channel,source_type,source_asset_type,source_asset_id,owner_email,created_by,human_notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(firstName,lastName,`${firstName} ${lastName}`,signal.external_url,"PROSPECT",signal.source,"Social Signal","SIGNAL",String(signal.id),user.email,user.email,`Draft prospect created from signal: ${signal.title}`).run();personId=Number(result.meta.last_row_id);}
    await db.prepare(`UPDATE growth_signals SET person_id=?,status='LINKED' WHERE id=?`).bind(personId,signal.id).run(); await timeline(db,{personId,type:"SIGNAL_LINKED",summary:`Prospect linked from signal: ${signal.title}`,actor:user.email,source:signal.source,provenance:"signal_conversion"}); return{ok:existing?"Signal linked to the existing prospect.":"Draft prospect created from signal with provenance."};
  }
  if(intent==="capture-lead"){
    const personId=numberOrNull(text(form,"person_id")),companyId=numberOrNull(text(form,"company_id")),source=text(form,"source_channel"); if(!personId&&!companyId)return{error:"Link the lead capture to a person or company."};
    const result=await db.prepare(`INSERT INTO growth_lead_captures(person_id,company_id,source_channel,source_type,source_asset_id,campaign_id,payload_json,status,provenance) VALUES(?,?,?,?,?,?,?,?,?)`).bind(personId,companyId,source||"Manual",text(form,"source_type")||"Manual",nullable(text(form,"source_asset_id")),numberOrNull(text(form,"campaign_id")),"{}","NEW","manual_capture").run();
    await db.prepare(`INSERT INTO growth_attribution_events(person_id,company_id,event_type,source_channel,source_type,source_asset_id,campaign_id,touch_kind,provenance) VALUES(?,?,?,?,?,?,?,?,?)`).bind(personId,companyId,"LEAD_CAPTURED",source||"Manual",text(form,"source_type")||"Manual",nullable(text(form,"source_asset_id")),numberOrNull(text(form,"campaign_id")),"CONVERSION","lead_capture").run();
    await timeline(db,{personId,companyId,type:"LEAD_CAPTURED",summary:`Lead captured via ${source||"Manual"}`,actor:user.email,source:source||"Manual",provenance:"manual_capture"}); return{ok:`Lead capture ${result.meta.last_row_id} recorded with attribution.`};
  }
  if(intent==="record-demo-event"){
    const personId=numberOrNull(text(form,"person_id")),companyId=numberOrNull(text(form,"company_id")),eventType=text(form,"event_type"); if(!personId&&!companyId)return{error:"Link the demo event to a person or company."};
    const allowed=["DEMO_INTEREST","DEMO_REQUESTED","DEMO_BOOKED","DEMO_COMPLETED","NO_SHOW","FOLLOW_UP","TRIAL","OPPORTUNITY_CREATED"]; if(!allowed.includes(eventType))return{error:"Invalid demo event."};
    await db.prepare(`INSERT INTO growth_demo_events(person_id,company_id,campaign_id,event_type,scheduled_at,notes,provenance,created_by) VALUES(?,?,?,?,?,?,?,?)`).bind(personId,companyId,numberOrNull(text(form,"campaign_id")),eventType,nullable(text(form,"scheduled_at")),nullable(text(form,"notes")),"manual_record",user.email).run();
    if(personId&&["DEMO_INTEREST","DEMO_BOOKED","DEMO_COMPLETED","TRIAL"].includes(eventType))await db.prepare(`UPDATE growth_people SET lifecycle=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lifecycle<>'CUSTOMER'`).bind(eventType,personId).run();
    await db.prepare(`INSERT INTO growth_attribution_events(person_id,company_id,event_type,source_channel,campaign_id,touch_kind,provenance) VALUES(?,?,?,?,?,?,?)`).bind(personId,companyId,eventType,"Demo",numberOrNull(text(form,"campaign_id")),"CONVERSION","manual_demo_event").run(); await timeline(db,{personId,companyId,type:eventType,summary:eventType.replaceAll("_"," "),actor:user.email,source:"Demo",provenance:"manual_demo_event"}); return{ok:"Demo conversion event recorded."};
  }
  return { error:"Unsupported Growth action." };
}
