import { useState } from "react";
import { INTEGRATION_HANDOFFS, integrationPrompt, type IntegrationDefinition } from "../lib/growth";

export function IntegrationHandoff({ integrationKey, status = "NOT_CONNECTED" }: { integrationKey:string; status?:string }) {
  const definition=INTEGRATION_HANDOFFS.find(item=>item.key===integrationKey);
  const [copied,setCopied]=useState(false);
  if(!definition)return null;
  const prompt=integrationPrompt(definition);
  async function copy(){ await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(()=>setCopied(false),1800); }
  return <article className="growth-handoff">
    <header><div><p className="eyebrow">INTEGRATION REQUIRED</p><h3>{definition.provider}</h3><p>{definition.capability}</p></div><span className={`growth-status ${status.toLowerCase()}`}>{status.replaceAll("_"," ")}</span></header>
    <details><summary>View Technical Handoff</summary><HandoffBody definition={definition}/><div className="prompt-preview"><strong>Generated implementation prompt</strong><pre>{prompt}</pre></div></details>
    <button type="button" className="primary-action" onClick={copy}>{copied?"Copied":"Copy Integration Prompt"}</button>
  </article>;
}

function List({items}:{items:string[]}){return <ul>{items.map(item=><li key={item}>{item}</li>)}</ul>}
function HandoffBody({definition:d}:{definition:IntegrationDefinition}){
  return <div className="handoff-grid">
    <section><h4>Purpose</h4><p>{d.purpose}</p></section>
    <section><h4>User Experience Once Connected</h4><List items={d.experience}/></section>
    <section><h4>DEVOS Data Sent</h4><List items={d.sent}/></section>
    <section><h4>DEVOS Data Received</h4><List items={d.received}/></section>
    <section><h4>Authentication</h4><p>{d.authentication}</p></section>
    <section><h4>Required Permissions</h4><List items={d.permissions}/></section>
    <section><h4>Webhooks / Polling · Idempotency · Rate Limits</h4><p>{d.sync}</p></section>
    <section><h4>Security & Error Handling</h4><List items={d.security}/></section>
    <section><h4>Existing Internal Interfaces</h4><p>{d.boundary}</p></section>
    <section><h4>Acceptance Tests</h4><List items={d.acceptanceTests}/></section>
  </div>;
}

export function IntegrationGrid({ statuses = {} }: { statuses?:Record<string,string> }) {
  return <div className="integration-grid">{INTEGRATION_HANDOFFS.map(item=><IntegrationHandoff key={item.key} integrationKey={item.key} status={statuses[item.key]||"NOT_CONNECTED"}/>)}</div>;
}
