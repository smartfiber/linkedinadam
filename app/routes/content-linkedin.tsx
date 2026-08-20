import { Link } from "react-router";

const groups = [
  { name: "Content", description: "Plan, draft, generate images, review, and schedule employee content.", links: [["Drafts & creation", "/#content"], ["Playbooks", "/playbooks"], ["Planner", "/planner"], ["Calendar", "/calendar"]] },
  { name: "Publishing", description: "Move approved work through orchestration and publishing.", links: [["Post orchestration", "/orchestration"], ["Scheduled posts", "/calendar"], ["Published posts", "/#content"]] },
  { name: "Network", description: "Manage LinkedIn identities, prospects, and connection recommendations.", links: [["Connections & prospects", "/connections"], ["Employees & LinkedIn accounts", "/#employees"]] },
  { name: "Engagement", description: "Review existing opportunities, conversations, signals, and handoffs.", links: [["Employee engagement activity", "/#employees"], ["Recommendations", "/connections"], ["Activity", "/#activity"]] },
  { name: "Analytics", description: "Inspect post performance and metric snapshots.", links: [["Post analytics", "/analytics"]] },
  { name: "Automation", description: "Use the existing approval-aware daily operations and autopilot tools.", links: [["Operations & autopilot", "/operations"]] },
];

export default function ContentLinkedIn() {
  return <main className="workspace-page"><header className="workspace-header"><div><p className="eyebrow">NET-X DEV OS</p><h1>Content &amp; LinkedIn</h1><p>The organized home for existing content, publishing, network, engagement, analytics, and automation tools in DEVOS.</p></div><Link className="secondary-link" to="/">Command Center</Link></header><section className="workspace-grid">{groups.map(group => <article className="workspace-card" key={group.name}><h2>{group.name}</h2><p>{group.description}</p><nav>{group.links.map(([label,to]) => <Link key={label} to={to}>{label}<span aria-hidden="true">→</span></Link>)}</nav></article>)}</section></main>;
}
