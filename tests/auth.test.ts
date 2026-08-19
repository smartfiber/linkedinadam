import { describe, expect, it } from "vitest";
import {
  getAuthenticatedUser,
  requireRole,
  type AccessEnvironment,
} from "../app/lib/auth.server";

const production: AccessEnvironment = {
  BACKOFFICE_ENVIRONMENT: "production",
  BACKOFFICE_OWNER_EMAIL: "adam@net-x.io",
  BACKOFFICE_ADMIN_EMAILS: "joe@net-x.io",
};

function request(url: string, headers?: Record<string, string>) {
  return new Request(url, { headers });
}

describe("Cloudflare Access identity boundary", () => {
  it("fails closed for an unauthenticated production request", () => {
    expect(getAuthenticatedUser(request("https://backoffice.example.com"), production)).toBeNull();
  });

  it("maps an allowed Access identity to its configured role", () => {
    const user = getAuthenticatedUser(
      request("https://backoffice.example.com", {
        "Cf-Access-Authenticated-User-Email": "joe@net-x.io",
        "Cf-Access-Authenticated-User-Name": "Joe",
        "Cf-Access-Authenticated-User-Id": "access-subject-joe",
      }),
      production,
    );
    expect(user).toMatchObject({
      email: "joe@net-x.io",
      displayName: "Joe",
      subject: "access-subject-joe",
      role: "ADMIN",
      source: "cloudflare-access",
    });
  });

  it("does not trust an unmapped or spoofed identity", () => {
    const user = getAuthenticatedUser(
      request("https://backoffice.example.com", {
        "Cf-Access-Authenticated-User-Email": "attacker@example.com",
        "X-Actor-Name": "Adam",
      }),
      production,
    );
    expect(user).toBeNull();
    expect(user?.displayName).not.toBe("Adam");
  });

  it("permits explicit local auth only on loopback and never in production", () => {
    const local: AccessEnvironment = {
      ...production,
      BACKOFFICE_ENVIRONMENT: "development",
      BACKOFFICE_LOCAL_AUTH: "true",
      BACKOFFICE_LOCAL_USER_EMAIL: "adam@net-x.io",
      BACKOFFICE_LOCAL_USER_NAME: "Adam (local)",
    };
    expect(getAuthenticatedUser(request("http://localhost:5173"), local)?.source).toBe("local-development");
    expect(getAuthenticatedUser(request("https://backoffice.example.com"), local)).toBeNull();
    expect(getAuthenticatedUser(request("http://localhost:5173"), { ...local, BACKOFFICE_ENVIRONMENT: "production" })).toBeNull();
  });

  it("rejects viewer-only users from privileged development writes", () => {
    expect(() => requireRole({ role: "VIEWER" } as never, ["OWNER", "ADMIN", "DEVELOPER"])).toThrowError();
  });
});
