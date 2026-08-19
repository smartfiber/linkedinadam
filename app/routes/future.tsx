import { Link, useLocation } from "react-router";

const modules: Record<string, { title: string; description: string; items: string[] }> = {
  people: { title: "People", description: "Future CRM workspace built on existing LinkedIn identities and relationship signals.", items: ["Prospects and customers", "Partners and investors", "LinkedIn contacts", "Company relationships"] },
  outreach: { title: "Outreach", description: "Future approval-controlled communication workspace. No sending is enabled.", items: ["Email drafting", "Sequences", "Follow-ups", "Human approval before sending"] },
  newsletters: { title: "Newsletters", description: "Future monthly employee newsletter workflow that will reuse content review patterns.", items: ["Draft", "Review", "Approve", "Send"] },
};
export default function FutureModule() { const key = useLocation().pathname.slice(1); const module = modules[key] || modules.people; return <main className="workspace-page"><header className="workspace-header"><div><p className="eyebrow">COMING SOON</p><h1>{module.title}</h1><p>{module.description}</p></div><Link className="secondary-link" to="/">Command Center</Link></header><section className="workspace-card future-module"><span className="development-status attention">Not Connected</span><h2>Planned scope</h2><ul>{module.items.map(item => <li key={item}>{item}</li>)}</ul><p>No backend, provider, automation, or fake data is active for this module.</p></section></main>; }
