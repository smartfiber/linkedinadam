import { describe, expect, it } from "vitest";
import {
  assertCanWriteDevelopment,
  createDevelopmentRequest,
  recordQaAction,
  saveQaHandoff,
  updateDevelopmentRequest,
} from "../app/lib/development/service.server";
import { statusLabel } from "../app/lib/development/status";
import type { DevelopmentActor } from "../app/lib/development/types";

const adam: DevelopmentActor = {
  email: "adam@net-x.io",
  displayName: "Adam",
  subject: "adam-subject",
  role: "OWNER",
};

const viewer: DevelopmentActor = { ...adam, role: "VIEWER" };

function fakeDatabase() {
  const statements: unknown[] = [];
  return {
    statements,
    prepare(sql: string) {
      return {
        sql,
        bind: (...values: unknown[]) => ({ sql, values }),
      };
    },
    async batch(values: unknown[]) {
      statements.push(...values);
      return [];
    },
  } as unknown as D1Database & { statements: unknown[] };
}

describe("development foundation", () => {
  it("keeps Main merge/branch state separate from Main verification", () => {
    expect(statusLabel("on_main_needs_verification")).toBe(
      "On Main / Needs Verification",
    );
    expect(statusLabel("verified")).toBe("Verified");
    expect(statusLabel("on_main_needs_verification")).not.toBe(
      statusLabel("verified"),
    );
  });

  it("allows owner/developer/admin actors to write and rejects viewers", () => {
    expect(() => assertCanWriteDevelopment(adam)).not.toThrow();
    expect(() => assertCanWriteDevelopment(viewer)).toThrowError();
  });

  it("records a request and its activity event in one service operation", async () => {
    const db = fakeDatabase();
    const id = await createDevelopmentRequest(db, adam, {
      title: "Protect development control center",
      priority: "P1",
      type: "Security",
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.statements).toHaveLength(2);
  });

  it("keeps manual GitHub links optional and reconciliation-friendly", async () => {
    const db = fakeDatabase();
    await createDevelopmentRequest(db, adam, {
      title: "Manual work",
      priority: "P2",
      type: "Feature",
      requestedBy: "Support",
      issueUrl: "https://github.com/colossalbreacker/net-x/issues/12",
      prUrl: "https://github.com/colossalbreacker/net-x/pull/13",
      branch: "Adam",
    });
    expect(db.statements).toHaveLength(4);
  });

  it("requires notes on QA failure and preserves actor-attributed history", async () => {
    const db = fakeDatabase();
    await expect(
      recordQaAction(db, adam, {
        requestId: "request-1",
        stage: "ADAM_QA",
        outcome: "failed",
      }),
    ).rejects.toThrow("failure note");
    await recordQaAction(db, adam, {
      requestId: "request-1",
      stage: "ADAM_QA",
      outcome: "failed",
      notes: "Login fails",
    });
    expect(db.statements).toHaveLength(3);
    expect(JSON.stringify(db.statements)).toContain("adam@net-x.io");
    expect(JSON.stringify(db.statements)).toContain("Login fails");
  });

  it("saves handoffs without advancing human QA automatically", async () => {
    const db = fakeDatabase();
    await saveQaHandoff(db, adam, {
      requestId: "request-1",
      stage: "MAIN_VERIFICATION",
      testUser: "qa@example.com",
      status: "pending",
    });
    expect(db.statements).toHaveLength(2);
    expect(JSON.stringify(db.statements)).not.toContain(
      "UPDATE development_requests SET overall_status",
    );
  });

  it("updates only human-managed request fields and appends actor history", async () => {
    const db = fakeDatabase();
    await updateDevelopmentRequest(db, adam, {
      requestId: "request-1",
      title: "Refined request",
      priority: "P1",
      type: "Feature",
      productArea: "Development",
      ownerEmail: "adam@net-x.io",
      qaPartnerEmail: "joseph@net-x.io",
      problem: "Dense table needed",
      whyDecision: "Faster operations",
      notes: "Human-managed note",
    });
    expect(db.statements).toHaveLength(2);
    const serialized = JSON.stringify(db.statements);
    expect(serialized).toContain("development_request_updated");
    expect(serialized).not.toContain("github_issue_id");
    expect(serialized).not.toContain("ci_state");
  });
});
