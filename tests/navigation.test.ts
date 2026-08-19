import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = readFileSync(new URL("../app/routes.ts", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/routes/home.tsx", import.meta.url), "utf8");
const migrations = Array.from({ length: 16 }, (_, index) => readFileSync(new URL(`../migrations/${String(index + 1).padStart(4, "0")}_${[
  "initial_schema", "seed_initial_playbooks", "add_activity_events", "add_content_review_history", "add_content_images", "add_content_schedule_history", "add_post_metric_snapshots", "add_content_plans", "add_linkedin_publishing", "add_playbook_writing_style", "expand_and_seed_playbooks", "add_connection_growth", "add_daily_operations_autopilot", "add_post_orchestration", "add_development_foundation", "add_github_sync",
][index]}.sql`, import.meta.url), "utf8")).join("\n");

describe("Content & LinkedIn navigation organization", () => {
  it.each(["calendar", "analytics", "planner", "orchestration", "playbooks", "connections", "operations", "employees/:employeeId", "content/:draftId/edit", "auth/linkedin/start", "auth/linkedin/callback"])("preserves the %s route", route => {
    expect(routes).toContain(`\"${route}\"`);
  });

  it("groups working routes and labels future areas without fake route modules", () => {
    expect(home).toContain("Content &amp; LinkedIn");
    for (const href of ["/playbooks", "/calendar", "/orchestration", "/planner", "/connections", "/analytics", "/operations"]) expect(home).toContain(`href=\"${href}\"`);
    for (const label of ["People", "Outreach", "Newsletters", "Settings"]) expect(home).toMatch(new RegExp(`${label}[\\s\\S]{0,80}Coming Soon`));
  });

  it("does not introduce replacement content or prospect tables", () => {
    expect(migrations.match(/CREATE TABLE content_drafts/g)).toHaveLength(1);
    expect(migrations.match(/CREATE TABLE connection_prospects/g)).toHaveLength(1);
    expect(migrations.match(/CREATE TABLE employees/g)).toHaveLength(1);
  });
});
