import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = readFileSync(
  new URL("../app/routes.ts", import.meta.url),
  "utf8",
);
const home = readFileSync(
  new URL("../app/routes/home.tsx", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../app/routes/content-linkedin.tsx", import.meta.url),
  "utf8",
);
const consoleScaffold = readFileSync(
  new URL("../app/routes/development-console.tsx", import.meta.url),
  "utf8",
);
const developmentRoute = readFileSync(
  new URL("../app/routes/development.tsx", import.meta.url),
  "utf8",
);
const appShell = readFileSync(
  new URL("../app/components/AppShell.tsx", import.meta.url),
  "utf8",
);
const root = readFileSync(new URL("../app/root.tsx", import.meta.url), "utf8");
const migrations = Array.from({ length: 18 }, (_, index) =>
  readFileSync(
    new URL(
      `../migrations/${String(index + 1).padStart(4, "0")}_${
        [
          "initial_schema",
          "seed_initial_playbooks",
          "add_activity_events",
          "add_content_review_history",
          "add_content_images",
          "add_content_schedule_history",
          "add_post_metric_snapshots",
          "add_content_plans",
          "add_linkedin_publishing",
          "add_playbook_writing_style",
          "expand_and_seed_playbooks",
          "add_connection_growth",
          "add_daily_operations_autopilot",
          "add_post_orchestration",
          "add_development_foundation",
          "add_github_sync",
          "add_devos_agent_control_plane",
          "add_development_environments",
        ][index]
      }.sql`,
      import.meta.url,
    ),
    "utf8",
  ),
).join("\n");

describe("Content & LinkedIn navigation organization", () => {
  it.each([
    "calendar",
    "analytics",
    "planner",
    "orchestration",
    "playbooks",
    "connections",
    "operations",
    "employees/:employeeId",
    "content/:draftId/edit",
    "auth/linkedin/start",
    "auth/linkedin/callback",
  ])("preserves the %s route", (route) => {
    expect(routes).toContain(`\"${route}\"`);
  });

  it("groups working routes and labels future areas without fake route modules", () => {
    expect(appShell).toContain("Content & LinkedIn");
    for (const href of [
      "/content-linkedin",
      "/development",
      "/people",
      "/outreach",
      "/newsletters",
      "/agents",
    ])
      expect(appShell).toContain(`to: \"${href}\"`);
    for (const label of ["People", "Outreach", "Newsletters", "Settings"])
      expect(appShell).toMatch(
        new RegExp(`label: \"${label}\"[\\s\\S]{0,80}future: true`),
      );
  });

  it("does not introduce replacement content or prospect tables", () => {
    expect(migrations.match(/CREATE TABLE content_drafts/g)).toHaveLength(1);
    expect(migrations.match(/CREATE TABLE connection_prospects/g)).toHaveLength(
      1,
    );
    expect(migrations.match(/CREATE TABLE employees/g)).toHaveLength(1);
  });

  it("links the Content & LinkedIn landing to existing working routes", () => {
    for (const route of [
      "/playbooks",
      "/planner",
      "/calendar",
      "/orchestration",
      "/connections",
      "/analytics",
      "/operations",
    ])
      expect(workspace).toContain(`\"${route}\"`);
    expect(appShell).toContain('to: "/content-linkedin"');
    expect(workspace).not.toContain("/#engagement");
  });

  it("limits the Development Console to safe control-plane actions", () => {
    expect(consoleScaffold).toContain("Code execution is disabled");
    expect(consoleScaffold).toContain("runSafeAgent");
    expect(consoleScaffold).toContain("repository checkout");
    expect(consoleScaffold).not.toContain("exec_command");
    expect(consoleScaffold).not.toContain("git push");
  });

  it("renders DEVOS branding and accessible persistent collapse controls", () => {
    expect(root).toContain("DEVOS — Net-X Dev OS");
    expect(appShell).toContain("https://net-x.io/assets/logo.svg");
    expect(appShell).toContain("devos.sidebar.collapsed");
    expect(appShell).toContain("Collapse navigation");
    expect(appShell).toContain("Expand navigation");
    expect(appShell).toContain('aria-label="Primary navigation"');
    expect(appShell).not.toContain("LinkedInAdam");
    expect(appShell).toContain("isNavigationItemActive");
    expect(appShell).toContain("nav-tooltip");
    expect(appShell).toContain('hash === "#activity"');
    expect(appShell).toContain('hash === "#settings"');
    for (const route of [
      "/planner",
      "/connections",
      "/calendar",
      "/orchestration",
      "/analytics",
    ])
      expect(appShell).toContain(`\"${route}\"`);
  });

  it("renders Development summary and user attention on the Command Center", () => {
    expect(home).toContain("developmentSummary.p0Open");
    expect(home).toContain("developmentAttention");
    expect(home).toContain("Needs Your Attention");
  });

  it("keeps manual Development usable when GitHub is unavailable", () => {
    expect(developmentRoute).toContain("GitHub sync not connected");
    expect(developmentRoute).toContain(
      "manual QA workflow remain fully usable",
    );
    expect(developmentRoute).toContain("Pending GitHub connection");
  });

  it("exposes operational saved views and explicit QA actions", () => {
    for (const view of [
      "needs_adam",
      "needs_joe",
      "urgent",
      "awaiting_approval",
      "ready_dev",
      "on_dev",
      "ready_main",
      "main_verify",
      "blocked",
      "ci_failing",
      "sync_unknown",
      "verified",
    ])
      expect(developmentRoute).toContain(`value="${view}"`);
    for (const action of [
      "Adam Pass",
      "Adam Fail",
      "Joe Pass",
      "Joe Fail",
      "Mutual Approval",
      "Dev QA Pass",
      "Main Verification Pass",
    ])
      expect(developmentRoute).toContain(action);
  });

  it("renders the dense Development operations hierarchy", () => {
    for (const summary of [
      "P0 Open",
      "P1 Open",
      "Needs Adam",
      "Needs Joe",
      "Ready for Dev",
      "Ready for Main",
      "Main Needs Verification",
      "Blocked",
    ])
      expect(developmentRoute).toContain(summary);
    for (const column of [
      "Request",
      "Priority",
      "Area",
      "Owner",
      "QA",
      "Issue / PR",
      "Adam",
      "Joe",
      "Dev",
      "Main",
      "CI",
      "Next Action",
      "Updated",
    ])
      expect(developmentRoute).toContain(`"${column}"`);
    for (const label of [
      "Search",
      "Saved view",
      "Product area",
      "QA partner",
      "Status",
      "Sort",
    ])
      expect(developmentRoute).toContain(label);
  });

  it("provides accessible routed request tabs and offline GitHub states", () => {
    expect(developmentRoute).toContain(
      'aria-label="Development request detail"',
    );
    expect(developmentRoute).toContain('aria-label="Request detail sections"');
    for (const tab of ["overview", "qa", "github", "activity"])
      expect(developmentRoute).toContain(`"${tab}"`);
    expect(developmentRoute).toContain("QA workflow stages");
    expect(developmentRoute).toContain("branch-state-matrix");
    expect(developmentRoute).toContain("Issue data is not synced.");
    expect(developmentRoute).toContain("PR, CI, and reviewer data are");
    expect(developmentRoute).toContain("not synced.");
    expect(consoleScaffold).toContain("loaderData.selectedRequest");
  });

  it("preserves active filters through routed request drawer navigation", () => {
    expect(developmentRoute).toContain("function developmentUrl");
    expect(developmentRoute).toContain("developmentListUrl");
    expect(developmentRoute).toContain('params.set("request", detail.request)');
    expect(developmentRoute).toContain('params.set("tab", detail.tab)');
  });

  it("presents synchronized PR review and CI metadata without mutation controls", () => {
    for (const field of [
      "Reviewers",
      "Approvals",
      "Source",
      "Target",
      "Head SHA",
      "Merge SHA",
    ])
      expect(developmentRoute).toContain(field);
    expect(developmentRoute).toContain("ciFromPayload");
    expect(developmentRoute).toContain("githubItems");
    expect(developmentRoute).not.toContain('name="ci_state"');
    expect(developmentRoute).not.toContain('name="branch_state"');
  });
});
