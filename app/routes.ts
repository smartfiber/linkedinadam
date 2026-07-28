import {
  type RouteConfig,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("calendar", "routes/calendar.tsx"),
  route("analytics", "routes/analytics.tsx"),
  route("planner", "routes/planner.tsx"),
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
