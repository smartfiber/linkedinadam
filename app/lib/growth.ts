export const GROWTH_LIFECYCLES = [
  "PROSPECT", "TARGET", "ENGAGED", "QUALIFIED", "DEMO_INTEREST",
  "DEMO_BOOKED", "DEMO_COMPLETED", "EVALUATION", "TRIAL",
  "OPPORTUNITY", "CUSTOMER", "DISQUALIFIED", "NURTURE",
] as const;

export type GrowthLifecycle = (typeof GROWTH_LIFECYCLES)[number];
export type SubscriptionStatus = "SUBSCRIBED" | "UNSUBSCRIBED" | "SUPPRESSED" | "DO_NOT_CONTACT";
export type EnrichmentStatus = "NOT_ENRICHED" | "PENDING" | "PARTIALLY_ENRICHED" | "ENRICHED" | "FAILED" | "MANUAL";

export const GROWTH_MODULES = [
  "people", "companies", "icp", "segments", "prospecting", "social-intelligence",
  "inbox", "outreach", "campaigns", "content", "newsletters", "paid",
  "analytics", "integrations",
] as const;

export type GrowthModule = (typeof GROWTH_MODULES)[number];

export function isGrowthModule(value: string | undefined): value is GrowthModule {
  return !!value && (GROWTH_MODULES as readonly string[]).includes(value);
}

export function canReceiveOutreach(status: SubscriptionStatus | string | null | undefined) {
  return status === "SUBSCRIBED";
}

export type IcpEvidence = {
  businessType?: string | null;
  employeeCount?: number | null;
  title?: string | null;
  technologyFocus?: string | null;
  signals?: string[];
  disqualified?: boolean;
};

export type IcpScore = { score: number; label: string; reasons: string[]; missing: string[] };

/** Deterministic, evidence-only baseline. Missing facts never earn points. */
export function scoreTechnologyAdvisorIcp(evidence: IcpEvidence): IcpScore {
  if (evidence.disqualified) return { score: 0, label: "Not a Fit", reasons: ["Known disqualifier"], missing: [] };
  let score = 0;
  const reasons: string[] = [];
  const missing: string[] = [];
  const business = evidence.businessType?.toLowerCase() || "";
  if (/technology advisor|technology broker|telecom agent|msp/.test(business)) {
    score += 30; reasons.push(evidence.businessType || "Technology advisory business");
  } else if (!business) missing.push("business type");
  if (evidence.employeeCount != null) {
    if (evidence.employeeCount >= 1 && evidence.employeeCount <= 5) { score += 25; reasons.push(`${evidence.employeeCount} employees`); }
    else if (evidence.employeeCount <= 25) { score += 18; reasons.push(`${evidence.employeeCount} employees`); }
    else score += 8;
  } else missing.push("employee count");
  const title = evidence.title?.toLowerCase() || "";
  if (/founder|owner|president|partner|ceo|technology advisor/.test(title)) { score += 20; reasons.push(evidence.title || "Decision-maker title"); }
  else if (!title) missing.push("decision-maker title");
  const technology = evidence.technologyFocus?.toLowerCase() || "";
  if (/connectivity|telecom|ucaas|cloud|cyber|mobility/.test(technology)) { score += 15; reasons.push(`${evidence.technologyFocus} focus`); }
  else if (!technology) missing.push("technology focus");
  if (evidence.signals?.length) { score += Math.min(10, evidence.signals.length * 5); reasons.push(...evidence.signals.slice(0, 2)); }
  const bounded = Math.max(0, Math.min(100, score));
  return { score: bounded, label: bounded >= 80 ? "Strong Fit" : bounded >= 60 ? "Good Fit" : bounded >= 40 ? "Possible Fit" : "Needs Evidence", reasons, missing };
}

export type AttributionTouch = { id: number; occurredAt: string; campaignId?: number | null; sourceChannel: string };

/** Append-only touches: first never changes, last follows the newest event. */
export function summarizeAttribution(events: AttributionTouch[]) {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id);
  return { firstTouch: ordered[0] ?? null, lastTouch: ordered.at(-1) ?? null };
}

export type IntegrationDefinition = {
  key: string; provider: string; capability: string; purpose: string;
  experience: string[]; sent: string[]; received: string[]; authentication: string;
  permissions: string[]; sync: string; security: string[]; boundary: string;
  acceptanceTests: string[];
};

export const INTEGRATION_HANDOFFS: IntegrationDefinition[] = [
  { key:"unipile", provider:"Unipile", capability:"LinkedIn conversations and outreach", purpose:"Connect DEVOS Inbox and approved outreach without making Unipile the CRM source of truth.", experience:["Sync accounts, conversations, participants and messages","Queue approved outbound messages","Update read and delivery state"], sent:["DEVOS account key","recipient profile URL","approved message body","thread external ID","attachment references when supported"], received:["provider account and thread IDs","participants and messages","timestamps","read and delivery state","cursor and webhook IDs"], authentication:"Server-side encrypted Unipile credentials only.", permissions:["accounts:read","messages:read","messages:write after explicit approval"], sync:"Cursor pagination, webhook verification, idempotent external IDs, bounded retry with backoff and rate-limit handling.", security:["No credentials in browser","Audit every outbound send","Human authorization","Account protection and bounded polling"], boundary:"Implement a server-side Signal/Conversation adapter that reads growth_conversations and growth_messages; never write around the DEVOS approval state.", acceptanceTests:["Inbound sync is idempotent","Outbound draft cannot send before approval","Retries do not duplicate messages","Secrets never enter loader data"] },
  { key:"linkedin_company", provider:"LinkedIn Company Pages", capability:"Organization publishing and analytics", purpose:"Extend the existing LinkedIn publisher for authorized organization-page posts.", experience:["List authorized organization pages","Upload media","Publish approved organization posts","Collect publication URLs and metrics"], sent:["authorized organization URN","approved asset body","media bytes/reference","campaign attribution tags"], received:["organization identities","publication URN and URL","publish status","available metrics"], authentication:"Existing server-side LinkedIn OAuth architecture with organization scopes added only when required.", permissions:["organization authorization","least-privilege organization read/write","no personal-profile expansion unless required"], sync:"Idempotent publish attempts and bounded metric snapshots.", security:["Tokens encrypted server-side","Human approval before publish","No organization token in client data"], boundary:"Add an organization-capable publisher beside linkedinPublishing.server.ts and retain content_drafts as the asset source of truth.", acceptanceTests:["Only authorized pages appear","Approval required","Duplicate retries return original publication","Personal publishing regressions pass"] },
  { key:"postmark", provider:"Postmark", capability:"Newsletter and email delivery", purpose:"Deliver approved DEVOS email while preserving suppression and attribution.", experience:["Send approved newsletters and one-to-one drafts","Track delivery state","Apply bounce, complaint and unsubscribe suppression"], sent:["From and Reply-To","recipient","subject and content","campaign/person IDs as metadata"], received:["delivered","bounced","spam complaint","open/click when appropriate","unsubscribe and reply events"], authentication:"Postmark server token stored as a Worker secret.", permissions:["server:send","signed webhook receive"], sync:"Verify webhook signatures, dedupe provider event IDs, and use bounded retry only for transient failures.", security:["Suppression checked at queue and send","No mass send without explicit approval","No token in D1 or client"], boundary:"A provider adapter may consume APPROVED/SCHEDULED growth_newsletters and growth_outreach_drafts; it must append attribution/timeline events and never bypass canReceiveOutreach.", acceptanceTests:["Suppressed people never send","Webhooks are idempotent","First touch is preserved","Secrets absent from rendered handoff"] },
  { key:"signal_collector", provider:"Compliant collector TBD", capability:"Social and public-web signal collection", purpose:"Monitor configured public sources and normalize observations into Growth Signals.", experience:["Poll active watchlist items","Deduplicate normalized signals","Surface action-oriented intelligence"], sent:["watched URL","last checked timestamp","requested signal types","bounded polling policy"], received:["source ID","profile/page","post ID and URL","author","summary/body","published timestamp","available engagement metadata"], authentication:"Provider-specific secret in Worker environment; never browser storage.", permissions:["public-source read only"], sync:"Collector interface with cursor, polling budget, rate-limit state, and unique source/source_external_id.", security:["Respect provider terms","No hidden browser automation","Authenticated account protection","Raw payloads referenced, not exposed"], boundary:"Implement one collector that writes normalized growth_signals and updates growth_watchlist_items.last_checked_at.", acceptanceTests:["Duplicate source events collapse","Polling is bounded","Missing evidence is not fabricated","Collector failure leaves manual workflows usable"] },
  { key:"enrichment", provider:"Provider TBD", capability:"Person and company enrichment", purpose:"Enrich existing records while preserving source, confidence and provenance.", experience:["Request enrichment from a Person or Company","Review fields and confidence before applying","Retain prior values and provenance"], sent:["record ID","known name/domain/email/profile URL","requested field categories"], received:["candidate fields","field-level source","confidence","observed timestamp"], authentication:"Provider token in Worker secret.", permissions:["lookup only; no provider-side writes"], sync:"Provider-neutral adapter, request idempotency key, bounded retry and explicit MANUAL fallback.", security:["Minimize personal data","No sensitive data in logs","Human review for low confidence"], boundary:"Update enrichment status and append timeline/attribution provenance; do not overwrite trusted data silently.", acceptanceTests:["Missing provider shows handoff","Confidence is retained","Duplicates are not created","Failed enrichment is retryable"] },
  { key:"scheduling", provider:"Calendly / Google Calendar", capability:"Demo scheduling", purpose:"Create demo conversion events from an approved scheduling provider.", experience:["Associate booking links with campaigns","Create booked/completed/no-show events","Update lifecycle with evidence"], sent:["booking owner","campaign/person context","availability or booking-link metadata"], received:["event ID","invitee","start/end","status","cancellation/reschedule"], authentication:"OAuth or webhook secret stored server-side.", permissions:["events read","webhook receive","write only if booking creation is required"], sync:"Signed webhooks with external-event idempotency and reconciliation polling.", security:["Least privilege","No calendar tokens client-side","Do not expose unrelated calendar events"], boundary:"Normalize provider events into growth_demo_events and append conversion attribution; never mark CUSTOMER.", acceptanceTests:["Duplicate webhook is ignored","Booked lifecycle uses authoritative event","Cancellation preserved","No unrelated events stored"] },
  { key:"linkedin_personal", provider:"LinkedIn Personal", capability:"Personal publishing", purpose:"Use the proven existing personal-profile LinkedIn connection.", experience:["Draft, approve, schedule and publish personal posts"], sent:["approved content and media"], received:["publication URN/URL and metrics"], authentication:"Existing encrypted LinkedIn OAuth token.", permissions:["openid","profile","w_member_social"], sync:"Existing publishing and metric snapshot services.", security:["Explicit approval","Employee voice playbooks remain distinct"], boundary:"Reuse existing services; Growth only adds campaign, audience, objective and CTA metadata.", acceptanceTests:["Existing LinkedIn tests pass","No cross-employee voice leakage"] },
  { key:"linkedin_ads", provider:"LinkedIn Ads", capability:"Paid campaigns", purpose:"Publish approved paid campaigns and retrieve spend/performance later.", experience:["Plan creative now; publish and sync metrics once connected"], sent:["approved campaign, audience, creative, budget"], received:["campaign IDs, spend, impressions, clicks, conversions"], authentication:"Server-side OAuth.", permissions:["campaign read/write only when enabled","analytics read"], sync:"Daily bounded metrics with attribution IDs.", security:["Budget and publish approval","No automatic spend"], boundary:"Consume approved growth_assets of paid type; do not make provider the strategy source of truth.", acceptanceTests:["Disconnected state never spends","Budget requires approval"] },
  { key:"google_ads", provider:"Google Ads", capability:"Paid search", purpose:"Publish approved search campaigns and retrieve performance later.", experience:["Plan copy and landing pages now; connect delivery later"], sent:["approved keywords, copy, landing page and budget"], received:["campaign IDs, spend, clicks and conversions"], authentication:"Server-side OAuth.", permissions:["ads read/write only when enabled"], sync:"Bounded reporting and conversion reconciliation.", security:["Explicit budget approval","No automatic spend"], boundary:"Provider adapter consumes approved paid assets only.", acceptanceTests:["Disconnected state never spends","No fabricated metrics"] },
];

export function integrationPrompt(definition: IntegrationDefinition) {
  const lines = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  return `Implement the ${definition.provider} integration for SmartFiber/LinkedinAdam.\n\nGoal\n${definition.purpose}\n\nExisting boundary\n${definition.boundary}\n\nDEVOS data sent\n${lines(definition.sent)}\n\nDEVOS data received\n${lines(definition.received)}\n\nAuthentication and permissions\n${definition.authentication}\n${lines(definition.permissions)}\n\nSync contract\n${definition.sync}\n\nSecurity\n${lines(definition.security)}\n\nAcceptance tests\n${lines(definition.acceptanceTests)}\n\nKeep DEVOS/D1 as the source of truth. Preserve explicit approval, idempotency, provenance, suppression, Cloudflare Access, and existing provider-independent UI. Never include or expose secrets.`;
}
