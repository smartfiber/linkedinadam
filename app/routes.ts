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
  route(
    "employees/:employeeId",
    "routes/employees.$employeeId.tsx",
  ),
  route(
    "content/:draftId/edit",
    "routes/content.$draftId.edit.tsx",
  ),
] satisfies RouteConfig;
