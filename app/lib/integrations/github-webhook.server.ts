export type GitHubWebhookEvent = "issues" | "pull_request" | "pull_request_review" | "check_run" | "check_suite" | "push";

/**
 * Verification seam for a future public webhook route. The route is not
 * registered yet because Cloudflare Access must not be bypassed for an
 * unsigned mutation endpoint. A future route must call this before enqueueing
 * a sync and must remain idempotent on GitHub delivery id.
 */
export async function verifyGitHubWebhookSignature(payload: string, signature: string | null, secret: string | undefined) {
  if (!signature || !secret || !signature.startsWith("sha256=")) return false;
  const expected = signature.slice(7).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  const expectedBytes = Uint8Array.from(expected.match(/.{2}/g)!, value => Number.parseInt(value, 16));
  const verificationKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", verificationKey, expectedBytes, new TextEncoder().encode(payload));
}

export function supportedGitHubWebhookEvent(value: string): value is GitHubWebhookEvent {
  return ["issues", "pull_request", "pull_request_review", "check_run", "check_suite", "push"].includes(value);
}
