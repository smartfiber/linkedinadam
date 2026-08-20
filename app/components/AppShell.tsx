import { Link, useLocation } from "react-router";
import { useEffect, useState, type ReactNode } from "react";

const navigation = [
  { to: "/", label: "Command Center", icon: "⌂", end: true },
  { to: "/development", label: "Development", icon: "◇" },
  { to: "/content-linkedin", label: "Content & LinkedIn", icon: "✦" },
  { to: "/people", label: "People", icon: "♙", future: true },
  { to: "/outreach", label: "Outreach", icon: "↗", future: true },
  { to: "/newsletters", label: "Newsletters", icon: "▤", future: true },
  { to: "/agents", label: "Agents", icon: "◎" },
  { to: "/#activity", label: "Activity", icon: "◷", end: true },
  { to: "/#settings", label: "Settings", icon: "⚙", future: true, end: true },
];

const contentRoutes = new Set(["/content-linkedin","/planner","/connections","/calendar","/orchestration","/analytics","/playbooks","/operations"]);

export function isNavigationItemActive(label:string,pathname:string,hash:string) {
  if (label === "Command Center") return pathname === "/" && !hash;
  if (label === "Activity") return pathname === "/" && hash === "#activity";
  if (label === "Settings") return pathname === "/" && hash === "#settings";
  if (label === "Content & LinkedIn") return contentRoutes.has(pathname) || pathname.startsWith("/content/") || pathname.startsWith("/employees/");
  if (label === "Development") return pathname === "/development" || pathname.startsWith("/development/");
  if (label === "Agents") return pathname === "/agents" || pathname.startsWith("/agents/");
  const item=navigation.find(candidate=>candidate.label === label);
  return item ? pathname === item.to : false;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname,hash } = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("devos.sidebar.collapsed") === "true");
  }, []);

  if (pathname === "/auth/linkedin/callback") return children;

  function toggle() {
    setCollapsed((value) => {
      localStorage.setItem("devos.sidebar.collapsed", String(!value));
      return !value;
    });
  }

  return <div className={`devos-shell${collapsed ? " nav-collapsed" : ""}`}>
    <aside className="devos-sidebar" aria-label="Primary navigation">
      <div className="devos-brand">
        <img src="https://net-x.io/assets/logo.svg" alt="Net-X" />
        <div><strong>DEVOS</strong><span>Net-X Dev OS</span></div>
      </div>
      <button className="nav-collapse" type="button" onClick={toggle} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!collapsed} title={collapsed ? "Expand navigation" : "Collapse navigation"}>
        <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
      </button>
      <nav>
        {navigation.map((item) => { const active=isNavigationItemActive(item.label,pathname,hash); return <Link key={item.label} to={item.to} aria-label={item.label} aria-current={active ? "page" : undefined} className={active ? "active" : undefined}>
          <span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-label">{item.label}</span>{item.future ? <small>SOON</small> : null}<span className="nav-tooltip" aria-hidden="true">{item.label}</span>
        </Link>; })}
      </nav>
      <div className="devos-sidebar-foot"><span className="nav-icon" aria-hidden="true">●</span><span className="nav-label">Human-controlled operations</span></div>
    </aside>
    <div className="devos-main">{children}</div>
  </div>;
}
