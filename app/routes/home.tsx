const employees = [
  {
    name: "Adam Copenhaver",
    role: "Founder / Managing Partner",
    postsDue: 2,
    commentsDue: 8,
    connectionsDue: 12,
    status: "On track",
  },
  {
    name: "Josh Longe",
    role: "Implementation & Project Management Advisor",
    postsDue: 2,
    commentsDue: 10,
    connectionsDue: 15,
    status: "Needs attention",
  },
];

const agents = [
  { name: "Strategy Agent", description: "Assigns role, audience, positioning, targets, and guardrails." },
  { name: "Content Planner", description: "Builds weekly post plans and prevents duplicate topics." },
  { name: "Post Drafting Agent", description: "Drafts posts in each employee’s approved voice." },
  { name: "Connection Targeting Agent", description: "Finds relevant people each employee should connect with." },
  { name: "Engagement Queue Agent", description: "Surfaces posts and conversations worth engaging with." },
  { name: "Conversation Signal Agent", description: "Detects buying signals, interest, and lead potential." },
  { name: "Messaging Agent", description: "Drafts public replies and private follow-up messages." },
  { name: "Lead Routing Agent", description: "Routes qualified conversations to the right owner." },
];

const priorities = [
  "Approve Adam’s executive telecom procurement post",
  "Review 14 recommended retail IT connections",
  "Reply to 6 conversations with target buyers",
  "Review 2 buying signals for possible sales handoff",
];

export default function Home() {
  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="logo">LinkedInAdam</div>

        <nav>
          <a className="active" href="/">Dashboard</a>
          <a href="#employees">Employees</a>
          <a href="#playbooks">Playbooks</a>
          <a href="#content">Content</a>
          <a href="#engagement">Engagement</a>
          <a href="#conversations">Conversations</a>
          <a href="#leads">Lead Signals</a>
        </nav>
      </aside>

      <section className="content">
        <header className="header">
          <div>
            <p className="eyebrow">LINKEDIN OPERATIONS CENTER</p>
            <h1>Good morning, Adam.</h1>
            <p>
              Coordinate employee content, connections, engagement, conversations,
              and lead handoffs from one place.
            </p>
          </div>

          <button>Add employee</button>
        </header>

        <section className="stats">
          <article>
            <span>Posts due this week</span>
            <strong>4</strong>
          </article>
          <article>
            <span>Comments due today</span>
            <strong>18</strong>
          </article>
          <article>
            <span>Recommended connections</span>
            <strong>27</strong>
          </article>
          <article>
            <span>Buying signals detected</span>
            <strong>2</strong>
          </article>
        </section>

        <section className="grid-two">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">TODAY</p>
                <h2>Priority queue</h2>
              </div>
            </div>

            <div className="priority-list">
              {priorities.map((item, index) => (
                <div className="priority-row" key={item}>
                  <span>{index + 1}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">CONVERSATIONS</p>
                <h2>Active opportunities</h2>
              </div>
            </div>

            <div className="signal">
              <strong>Retail CIO discussing 18 new store openings</strong>
              <p>Recommended owner: Josh · Suggested action: reply with opening-timeline insight.</p>
            </div>

            <div className="signal">
              <strong>CFO mentioned rising telecom costs and renewal pressure</strong>
              <p>Recommended owner: Adam · Suggested action: offer the procurement scorecard.</p>
            </div>
          </article>
        </section>

        <section className="panel" id="employees">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">EMPLOYEE PLAYBOOKS</p>
              <h2>Team activity</h2>
            </div>
            <button className="secondary">Manage employees</button>
          </div>

          <div className="employee-list">
            {employees.map((employee) => (
              <div className="employee-row" key={employee.name}>
                <div>
                  <strong>{employee.name}</strong>
                  <span>{employee.role}</span>
                </div>

                <div className="metric">
                  <strong>{employee.postsDue}</strong>
                  <span>posts due</span>
                </div>

                <div className="metric">
                  <strong>{employee.commentsDue}</strong>
                  <span>comments due</span>
                </div>

                <div className="metric">
                  <strong>{employee.connectionsDue}</strong>
                  <span>connections due</span>
                </div>

                <span className={employee.status === "On track" ? "ready" : "setup"}>
                  {employee.status}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel" id="playbooks">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AI WORKFORCE</p>
              <h2>LinkedInAdam agents</h2>
            </div>
          </div>

          <div className="agent-grid">
            {agents.map((agent) => (
              <article className="agent-card" key={agent.name}>
                <strong>{agent.name}</strong>
                <p>{agent.description}</p>
                <span>Human approval required</span>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
