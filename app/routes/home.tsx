const agents = [
  { name: "Quote Agent", status: "Ready", tasks: 12 },
  { name: "Install Manager", status: "Ready", tasks: 7 },
  { name: "Support Agent", status: "Ready", tasks: 4 },
  { name: "Renewal Agent", status: "Needs setup", tasks: 0 },
];

export default function Home() {
  return (
    <main className="dashboard">
      <aside className="sidebar">
        <div className="logo">LinkedInAdam</div>

        <nav>
          <a className="active" href="/">Dashboard</a>
          <a href="#agents">Agents</a>
          <a href="#employees">Employees</a>
          <a href="#posts">Posts</a>
          <a href="#inbox">Inbox</a>
        </nav>
      </aside>

      <section className="content">
        <header className="header">
          <div>
            <p className="eyebrow">AI OPERATIONS CENTER</p>
            <h1>Good morning, Adam.</h1>
            <p>Manage your agents, employee activity, posts, and inbound work.</p>
          </div>

          <button>Add agent</button>
        </header>

        <section className="stats">
          <article><span>Active agents</span><strong>3</strong></article>
          <article><span>Open tasks</span><strong>23</strong></article>
          <article><span>Employees connected</span><strong>1</strong></article>
          <article><span>Unread messages</span><strong>4</strong></article>
        </section>

        <section className="panel" id="agents">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">NET-X AGENTS</p>
              <h2>Operational agents</h2>
            </div>
          </div>

          <div className="agent-list">
            {agents.map((agent) => (
              <div className="agent-row" key={agent.name}>
                <div>
                  <strong>{agent.name}</strong>
                  <span>{agent.tasks} open tasks</span>
                </div>

                <span className={agent.status === "Ready" ? "ready" : "setup"}>
                  {agent.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
