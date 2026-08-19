import { beforeAll, describe, expect, it } from "vitest";
import {
  generateKeyPair,
  SignJWT,
  type KeyLike,
} from "jose";
import {
  getAuthenticatedUser,
  isPublicAuthException,
  requireRole,
  verifyAccessJwtToken,
  type AccessEnvironment,
} from "../app/lib/auth.server";

const issuer = "https://netx.cloudflareaccess.com";
const environment: AccessEnvironment = {
  BACKOFFICE_ENVIRONMENT: "production",
  BACKOFFICE_OWNER_EMAIL: "adam@net-x.io",
  BACKOFFICE_ADMIN_EMAILS: "joe@net-x.io",
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "netx.cloudflareaccess.com",
  CLOUDFLARE_ACCESS_AUD: "netx-backoffice-audience",
};

let privateKey: KeyLike;
let publicKey: KeyLike;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
});

async function signedToken(
  overrides: Record<string, unknown> = {},
  signingKey: KeyLike = privateKey,
) {
  return new SignJWT({
    email: "adam@net-x.io",
    name: "Adam From JWT",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject("access-subject-adam")
    .setIssuer(issuer)
    .setAudience(environment.CLOUDFLARE_ACCESS_AUD!)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(signingKey);
}

function request(url: string, headers?: Record<string, string>) {
  return new Request(url, { headers });
}

describe("Cloudflare Access JWT boundary", () => {
  it("accepts a valid signed JWT and derives identity from verified claims", async () => {
    const token = await signedToken();
    const claims = await verifyAccessJwtToken(token, environment, publicKey);
    const user = await getAuthenticatedUser(
      request("https://backoffice.example.com", {
        "Cf-Access-Jwt-Assertion": token,
        "Cf-Access-Authenticated-User-Email": "spoof@example.com",
        "Cf-Access-Authenticated-User-Name": "Spoofed Header",
      }),
      environment,
      publicKey,
    );

    expect(claims?.sub).toBe("access-subject-adam");
    expect(user).toMatchObject({
      email: "adam@net-x.io",
      displayName: "Adam From JWT",
      subject: "access-subject-adam",
      role: "OWNER",
    });
  });

  it("denies missing JWT even when fake Access email headers are supplied", async () => {
    await expect(
      getAuthenticatedUser(
        request("https://backoffice.example.com", {
          "Cf-Access-Authenticated-User-Email": "adam@net-x.io",
          "Cf-Access-Authenticated-User-Name": "Adam",
        }),
        environment,
        publicKey,
      ),
    ).resolves.toBeNull();
  });

  it("denies malformed JWTs", async () => {
    await expect(verifyAccessJwtToken("not.a.jwt", environment, publicKey)).resolves.toBeNull();
  });

  it("denies invalid signatures", async () => {
    const otherPair = await generateKeyPair("RS256");
    const token = await signedToken({}, otherPair.privateKey);
    await expect(verifyAccessJwtToken(token, environment, publicKey)).resolves.toBeNull();
  });

  it("denies expired tokens", async () => {
    const token = await new SignJWT({ email: "adam@net-x.io" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("expired-subject")
      .setIssuer(issuer)
      .setAudience(environment.CLOUDFLARE_ACCESS_AUD!)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(privateKey);
    await expect(verifyAccessJwtToken(token, environment, publicKey)).resolves.toBeNull();
  });

  it("denies wrong audience and wrong issuer", async () => {
    const wrongAudience = await new SignJWT({ email: "adam@net-x.io" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("wrong-aud")
      .setIssuer(issuer)
      .setAudience("other-audience")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const wrongIssuer = await new SignJWT({ email: "adam@net-x.io" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject("wrong-iss")
      .setIssuer("https://other.cloudflareaccess.com")
      .setAudience(environment.CLOUDFLARE_ACCESS_AUD!)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(verifyAccessJwtToken(wrongAudience, environment, publicKey)).resolves.toBeNull();
    await expect(verifyAccessJwtToken(wrongIssuer, environment, publicKey)).resolves.toBeNull();
  });

  it("denies missing required identity claims and unknown authenticated emails", async () => {
    const missingEmail = await signedToken({ email: undefined });
    const unknown = await signedToken({ email: "unknown@example.com" });
    await expect(verifyAccessJwtToken(missingEmail, environment, publicKey)).resolves.toBeNull();
    await expect(
      getAuthenticatedUser(
        request("https://backoffice.example.com", { "Cf-Access-Jwt-Assertion": unknown }),
        environment,
        publicKey,
      ),
    ).resolves.toBeNull();
  });

  it("maps Joe from verified JWT claims and ignores a submitted actor", async () => {
    const joeEnvironment = { ...environment, BACKOFFICE_OWNER_EMAIL: "adam@net-x.io" };
    const token = await signedToken({ email: "joe@net-x.io", name: "Joe From JWT" });
    const user = await getAuthenticatedUser(
      request("https://backoffice.example.com", {
        "Cf-Access-Jwt-Assertion": token,
        "X-Actor-Name": "Adam",
      }),
      joeEnvironment,
      publicKey,
    );
    expect(user).toMatchObject({ email: "joe@net-x.io", displayName: "Joe From JWT", role: "ADMIN" });
    expect(user?.displayName).not.toBe("Adam");
  });

  it("rejects viewer-only privileged writes server-side", () => {
    expect(() => requireRole({ role: "VIEWER" } as never, ["OWNER", "ADMIN", "DEVELOPER"])).toThrowError();
  });

  it("keeps local auth loopback-only and unavailable in production", async () => {
    const local: AccessEnvironment = {
      ...environment,
      BACKOFFICE_ENVIRONMENT: "development",
      BACKOFFICE_LOCAL_AUTH: "true",
      BACKOFFICE_LOCAL_USER_EMAIL: "adam@net-x.io",
      BACKOFFICE_LOCAL_USER_NAME: "Adam (local)",
    };
    await expect(getAuthenticatedUser(request("http://localhost:5173"), local)).resolves.toMatchObject({ source: "local-development" });
    await expect(getAuthenticatedUser(request("https://backoffice.example.com"), local)).resolves.toBeNull();
    await expect(getAuthenticatedUser(request("http://localhost:5173"), { ...local, BACKOFFICE_ENVIRONMENT: "production" })).resolves.toBeNull();
  });

  it("only exempts the intentional LinkedIn OAuth callback", () => {
    expect(isPublicAuthException("/auth/linkedin/callback")).toBe(true);
    expect(isPublicAuthException("/auth/linkedin/start")).toBe(false);
    expect(isPublicAuthException("/images/generated/example.png")).toBe(false);
    expect(isPublicAuthException("/development")).toBe(false);
  });
});
