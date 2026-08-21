import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordEnvironmentQaAttempt } from "../app/lib/development/environments.server";
import { composeEnvironmentTestUrl } from "../app/lib/development/environments";
import { getEnvironmentQaReadiness } from "../app/lib/development/environment-readiness.server";
import type { DevelopmentActor } from "../app/lib/development/types";

const migration = readFileSync(
  new URL(
    "../migrations/0018_add_development_environments.sql",
    import.meta.url,
  ),
  "utf8",
);
const route = readFileSync(
  new URL("../app/routes/development-environments.tsx", import.meta.url),
  "utf8",
);
const development = readFileSync(
  new URL("../app/routes/development.tsx", import.meta.url),
  "utf8",
);
const home = readFileSync(
  new URL("../app/routes/home.tsx", import.meta.url),
  "utf8",
);
const adam: DevelopmentActor = {
  email: "adam@net-x.io",
  displayName: "Adam",
  subject: "adam-subject",
  role: "OWNER",
};

function qaDatabase(handoffId = 7) {
  const batches: unknown[][] = [];
  return {
    batches,
    prepare(sql: string) {
      return {
        bind: (...values: unknown[]) => ({
          sql,
          values,
          first: async () =>
            sql.includes("SELECT qa_stage FROM development_environments")
              ? { qa_stage: values[0] === 1 ? "ADAM_QA" : "JOE_QA" }
              : sql.includes("SELECT id FROM qa_handoffs")
                ? { id: handoffId }
                : null,
        }),
      };
    },
    async batch(statements: unknown[]) {
      batches.push(statements);
      return [];
    },
  } as unknown as D1Database & { batches: unknown[][] };
}

describe("DEVOS environment QA", () => {
  it("seeds the exact Adam and Joe live-view definitions", () => {
    expect(migration).toContain("'adam', 'Adam Live View', 'Adam'");
    expect(migration).toContain(
      "https://netx-web-adam-792780081355.us-central1.run.app",
    );
    expect(migration).toContain("'joe', 'Joe Live View', 'Joe'");
    expect(migration).toContain(
      "https://netx-web-joe-792780081355.us-central1.run.app",
    );
    expect(migration).not.toMatch(/INSERT[^;]+\('dev'|INSERT[^;]+\('main'/i);
  });

  it("composes only a route from an explicitly stored handoff URL or path", () => {
    expect(
      composeEnvironmentTestUrl(
        "https://example.run.app",
        "/opportunities/abc123",
      ),
    ).toEqual({
      url: "https://example.run.app/opportunities/abc123",
      specific: true,
    });
    expect(composeEnvironmentTestUrl("https://example.run.app", null)).toEqual({
      url: "https://example.run.app",
      specific: false,
    });
    expect(
      composeEnvironmentTestUrl(
        "https://example.run.app",
        "opportunities/invented",
      ),
    ).toEqual({ url: "https://example.run.app", specific: false });
    expect(
      composeEnvironmentTestUrl(
        "https://example.run.app",
        "//evil.example/path",
      ).specific,
    ).toBe(false);
    expect(
      composeEnvironmentTestUrl(
        "https://example.run.app",
        "https://source.example/opportunities/abc123?tab=files",
      ),
    ).toEqual({
      url: "https://example.run.app/opportunities/abc123?tab=files",
      specific: true,
    });
  });

  it("records independent append-only attempts and requires failure notes", async () => {
    const db = qaDatabase();
    await recordEnvironmentQaAttempt(db, adam, {
      requestId: "request-1",
      environmentId: 1,
      stage: "ADAM_QA",
      status: "passed",
    });
    await recordEnvironmentQaAttempt(db, adam, {
      requestId: "request-1",
      environmentId: 2,
      stage: "JOE_QA",
      status: "testing",
    });
    expect(db.batches).toHaveLength(3);
    expect(JSON.stringify(db.batches[0])).toContain(
      '"values":["request-1",1,7,"ADAM_QA","passed"',
    );
    expect(JSON.stringify(db.batches[2])).toContain(
      '"values":["request-1",2,7,"JOE_QA","testing"',
    );
    await expect(
      recordEnvironmentQaAttempt(db, adam, {
        requestId: "request-1",
        environmentId: 1,
        stage: "ADAM_QA",
        status: "failed",
      }),
    ).rejects.toThrow("failure note");
    await expect(
      recordEnvironmentQaAttempt(db, adam, {
        requestId: "request-1",
        environmentId: 1,
        stage: "JOE_QA",
        status: "testing",
      }),
    ).rejects.toThrow("does not match");
  });

  it("keeps history append-only and exposes all operational queues", () => {
    expect(migration).toContain("CREATE TABLE environment_qa_attempts");
    expect(migration).not.toMatch(
      /UPDATE environment_qa_attempts|DELETE FROM environment_qa_attempts/,
    );
    for (const label of [
      "Needs Adam",
      "Needs Joe",
      "Failed / Retest",
      "Ready for Dev",
    ])
      expect(route).toContain(label);
  });

  it("links environments from requests, drawer QA, and Command Center", () => {
    expect(route).toContain("Open Environment");
    expect(route).toContain("Specific test route required");
    expect(development).toContain("Test Environments");
    expect(development).toContain("Open &amp; Test");
    expect(home).toContain("ENVIRONMENT QA");
    expect(home).toContain("/development/environments");
    expect(route).not.toContain("iframe");
    expect(route).not.toMatch(/type=["']password/);
  });

  it("distinguishes missing schema from unexpected readiness failures", async () => {
    const missing = {
      prepare: () => ({
        first: async () => ({
          environments_table: 0,
          attempts_table: 0,
          test_path_column: 0,
        }),
      }),
    } as unknown as D1Database;
    await expect(getEnvironmentQaReadiness(missing)).resolves.toEqual({
      state: "NOT_INITIALIZED",
    });
    const failing = {
      prepare: () => ({
        first: async () => {
          throw new Error("D1 unavailable");
        },
      }),
    } as unknown as D1Database;
    expect((await getEnvironmentQaReadiness(failing)).state).toBe("ERROR");
  });
});
