import { generateKeyPairSync } from "node:crypto";
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { DEFAULT_NET_X_REPOSITORY, githubConfigurationError, normalizeGitHubAppPrivateKey, repositoryFromEnvironment } from "../app/lib/integrations/github.server";
import { checkState, computeBranchState, discoverBranchMappings, issueNumbersFromText, nextActionForPullRequest, patchEquivalence } from "../app/lib/development/sync.server";
import { supportedGitHubWebhookEvent, verifyGitHubWebhookSignature } from "../app/lib/integrations/github-webhook.server";

const file = (filename: string, patch: string | null) => ({ filename, patch, status: "modified", additions: 1, deletions: 1 });

describe("read-only GitHub sync helpers", () => {
  it("uses configurable repository identity with Net-X defaults", () => {
    expect(repositoryFromEnvironment({})).toEqual(DEFAULT_NET_X_REPOSITORY);
    expect(repositoryFromEnvironment({ GITHUB_REPOSITORY_OWNER: "other", GITHUB_REPOSITORY_NAME: "repo" })).toEqual({ owner: "other", name: "repo" });
  });

  it("fails closed when the read-only App is not configured", () => {
    expect(githubConfigurationError({})).toContain("GITHUB_APP_ID");
    expect(githubConfigurationError({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "key", GITHUB_APP_INSTALLATION_ID: "2" })).toBeNull();
  });

  it("accepts GitHub's downloaded PKCS#1 key and preserves valid RS256 signing", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const normalized = normalizeGitHubAppPrivateKey(pkcs1.replace(/\n/g, "\\n"));
    expect(normalized).toContain("-----BEGIN PRIVATE KEY-----");
    const signingKey = await importPKCS8(normalized, "RS256");
    const verificationKey = await importSPKI(publicKey.export({ type: "spki", format: "pem" }).toString(), "RS256");
    const token = await new SignJWT({ scope: "read-only" }).setProtectedHeader({ alg: "RS256" }).setIssuer("123").sign(signingKey);
    await expect(jwtVerify(token, verificationKey, { algorithms: ["RS256"], issuer: "123" })).resolves.toMatchObject({ payload: { scope: "read-only" } });
    expect(normalizeGitHubAppPrivateKey(normalized)).toBe(normalized);
  });

  it("fails closed for malformed PEM, Base64, and DER key material", async () => {
    expect(() => normalizeGitHubAppPrivateKey("not a key")).toThrow("PKCS#1 or PKCS#8");
    expect(() => normalizeGitHubAppPrivateKey("-----BEGIN RSA PRIVATE KEY-----\n%%%\n-----END RSA PRIVATE KEY-----")).toThrow();
    const malformedDer = normalizeGitHubAppPrivateKey("-----BEGIN RSA PRIVATE KEY-----\nAQID\n-----END RSA PRIVATE KEY-----");
    await expect(importPKCS8(malformedDer, "RS256")).rejects.toThrow();
  });

  it("discovers exact branches and flags ambiguous Joe mappings", () => {
    const mapped = discoverBranchMappings([{ name: "adam", sha: "a" }, { name: "dev", sha: "d" }, { name: "main", sha: "m" }, { name: "joe", sha: "j" }]);
    expect(mapped[0]).toMatchObject({ role: "adam", status: "MAPPED" });
    expect(mapped[1]).toMatchObject({ role: "joe", branchName: "joe", status: "MAPPED" });
    expect(discoverBranchMappings([{ name: "adam", sha: "a" }, { name: "joe", sha: "j" }, { name: "joe-work", sha: "jw" }])[1]).toMatchObject({ status: "NEEDS_MAPPING", branchName: null });
    expect(discoverBranchMappings([{ name: "Adam", sha: "a" }, { name: "dev", sha: "d" }, { name: "main", sha: "m" }])[1]).toMatchObject({ status: "NEEDS_MAPPING", branchName: null, candidates: [] });
  });

  it("extracts linked issue references and computes conservative equivalence", () => {
    expect(issueNumbersFromText("Fixes #603 and resolves #604")).toEqual([603, 604]);
    expect(issueNumbersFromText("See #605; unrelated text")).toEqual([605]);
    expect(patchEquivalence([file("a.ts", "@@ -1 +1 @@\n-old\n+new")], [file("a.ts", "@@ -9 +9 @@\n-old\n+new")])).toEqual({ state: "PATCH_EQUIVALENT", confidence: "HIGH" });
    expect(patchEquivalence([file("a.ts", "@@ -1 +1 @@\n-old\n+new")], [file("a.ts", "@@ -1 +1 @@\n-old\n+different")]).state).toBe("UNKNOWN");
    expect(patchEquivalence([file("a.ts", null)], [file("a.ts", null)]).state).toBe("UNKNOWN");
  });

  it("keeps CI and human verification separate", () => {
    const pr = { id: 1, number: 1, title: "Release", body: null, state: "open", draft: false, sourceBranch: "dev", targetBranch: "main", headSha: "sha", mergeSha: null, merged: false, mergeable: true, author: "adam", reviewers: ["joseph"], approvals: 1, changedFiles: [], checks: [{ name: "CI", status: "completed", conclusion: "success", detailsUrl: null }], htmlUrl: "https://github.com/x/y/pull/1", createdAt: "", updatedAt: "", mergedAt: null } as const;
    expect(checkState(pr)).toBe("CI Passed");
    expect(nextActionForPullRequest(pr)).toBe("Ready to merge to main");
    expect(nextActionForPullRequest({ ...pr, merged: true, mergeSha: "merge" })).toContain("production verification");
  });

  it("uses commit ancestry before patch equivalence for branch presence", async () => {
    const pr = { id: 1, number: 7, title: "Work", body: null, state: "open", draft: false, sourceBranch: "feature", targetBranch: "dev", headSha: "work", mergeSha: null, merged: false, mergeable: true, author: "adam", reviewers: [], approvals: 0, changedFiles: [file("a.ts", "@@ -1 +1 @@\n-old\n+new")], checks: [], htmlUrl: "", createdAt: "", updatedAt: "", mergedAt: null } as const;
    const present = await computeBranchState(pr, { name: "dev", sha: "tip" }, async () => ({ status: "ahead", aheadBy: 2, behindBy: 0, files: [] }));
    expect(present).toMatchObject({ state: "present", relationship: "EXACT", confidence: "HIGH" });
  });

  it("verifies webhook HMAC signatures and rejects unsupported events", async () => {
    const secret = "test-secret"; const payload = '{"action":"opened"}';
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
    const signature = `sha256=${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
    expect(await verifyGitHubWebhookSignature(payload, signature, secret)).toBe(true);
    expect(await verifyGitHubWebhookSignature(`${payload}x`, signature, secret)).toBe(false);
    expect(supportedGitHubWebhookEvent("pull_request_review")).toBe(true);
    expect(supportedGitHubWebhookEvent("workflow_dispatch")).toBe(false);
  });
});
