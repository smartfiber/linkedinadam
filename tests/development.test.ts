import { describe, expect, it } from "vitest";
import { assertCanWriteDevelopment, createDevelopmentRequest } from "../app/lib/development/service.server";
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
    expect(statusLabel("on_main_needs_verification")).toBe("On Main / Needs Verification");
    expect(statusLabel("verified")).toBe("Verified");
    expect(statusLabel("on_main_needs_verification")).not.toBe(statusLabel("verified"));
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
});
