import {
  type RouteConfig,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("development", "routes/development.tsx"),
  route("development/environments", "routes/development-environments.tsx"),
  route("development/console", "routes/development-console.tsx"),
  route("agents", "routes/agents.tsx"),
  route("agents/:agentSlug", "routes/agent-detail.tsx"),
  route("content-linkedin", "routes/content-linkedin.tsx"),
  route("people", "routes/people.tsx"),
  route("outreach", "routes/outreach.tsx"),
  route("newsletters", "routes/newsletters.tsx"),
  route("calendar", "routes/calendar.tsx"),
  route("analytics", "routes/analytics.tsx"),
  route("planner", "routes/planner.tsx"),
  route("orchestration", "routes/orchestration.tsx"),
  route("playbooks", "routes/playbooks.tsx"),
  route("connections", "routes/connections.tsx"),
  route("operations", "routes/operations.tsx"),
  route(
    "auth/linkedin/start",
    "routes/auth.linkedin.start.ts",
  ),
  route(
    "auth/linkedin/callback",
    "routes/auth.linkedin.callback.tsx",
  ),
  route(
    "employees/:employeeId",
    "routes/employees.$employeeId.tsx",
  ),
  route(
    "content/:draftId/edit",
    "routes/content.$draftId.edit.tsx",
  ),
] satisfies RouteConfig;
