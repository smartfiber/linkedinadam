import {
  type RouteConfig,
  index,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route(
    "employees/:employeeId",
    "routes/employees.$employeeId.tsx",
  ),
  route(
    "content/:draftId/edit",
    "routes/content.$draftId.edit.tsx",
  ),
] satisfies RouteConfig;
