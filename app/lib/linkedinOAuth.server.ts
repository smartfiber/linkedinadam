import {
  createOAuthState,
  encryptLinkedInToken,
  hashOAuthState,
} from "./linkedinCrypto.server";
import { LinkedInAPIError } from "./linkedinErrors.server";

export const LINKEDIN_REDIRECT_URI =
  "https://linkedinadam.adam-9ce.workers.dev/auth/linkedin/callback";
export const LINKEDIN_SCOPES = [
  "openid",
  "profile",
  "email",
  "w_member_social",
];

export async function createLinkedInAuthorization(
  database: D1Database,
  input: {
    employeeId: number;
    clientId: string;
    returnPath: string;
  },
) {
  const state = createOAuthState();
  const stateHash = await hashOAuthState(state);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  await database.batch([
    database
      .prepare(`
        DELETE FROM linkedin_oauth_states
        WHERE expires_at <= CURRENT_TIMESTAMP
      `),
    database
      .prepare(`
        INSERT INTO linkedin_oauth_states (
          state_hash,
          employee_id,
          return_path,
          expires_at
        )
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        stateHash,
        input.employeeId,
        input.returnPath,
        expiresAt,
      ),
  ]);

  const authorizationUrl = new URL(
    "https://www.linkedin.com/oauth/v2/authorization",
  );
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", input.clientId);
  authorizationUrl.searchParams.set(
    "redirect_uri",
    LINKEDIN_REDIRECT_URI,
  );
  authorizationUrl.searchParams.set(
    "scope",
    LINKEDIN_SCOPES.join(" "),
  );
  authorizationUrl.searchParams.set("state", state);

  return authorizationUrl.toString();
}

type LinkedInTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
};

type LinkedInUserInfo = {
  sub?: string;
  name?: string;
  email?: string;
};

export async function exchangeLinkedInAuthorization(
  input: {
    code: string;
    clientId: string;
    clientSecret: string;
    encryptionKey: string;
  },
) {
  let tokenResponse: Response;

  try {
    tokenResponse = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          client_id: input.clientId,
          client_secret: input.clientSecret,
          redirect_uri: LINKEDIN_REDIRECT_URI,
        }),
      },
    );
  } catch {
    throw new LinkedInAPIError(
      "LinkedIn token exchange failed.",
      { code: "oauth_connection" },
    );
  }

  if (!tokenResponse.ok) {
    throw new LinkedInAPIError(
      "LinkedIn token exchange was rejected.",
      {
        status: tokenResponse.status,
        code: "oauth_rejected",
      },
    );
  }

  const tokenData =
    (await tokenResponse.json()) as LinkedInTokenResponse;

  if (!tokenData.access_token || !tokenData.expires_in) {
    throw new LinkedInAPIError(
      "LinkedIn returned an incomplete token.",
      { code: "oauth_invalid_response" },
    );
  }

  let userResponse: Response;

  try {
    userResponse = await fetch(
      "https://api.linkedin.com/v2/userinfo",
      {
        headers: {
          authorization: `Bearer ${tokenData.access_token}`,
        },
      },
    );
  } catch {
    throw new LinkedInAPIError(
      "LinkedIn identity lookup failed.",
      { code: "identity_connection" },
    );
  }

  if (!userResponse.ok) {
    throw new LinkedInAPIError(
      "LinkedIn identity lookup was rejected.",
      {
        status: userResponse.status,
        code: "identity_rejected",
      },
    );
  }

  const user = (await userResponse.json()) as LinkedInUserInfo;

  if (!user.sub || !user.name) {
    throw new LinkedInAPIError(
      "LinkedIn returned an incomplete identity.",
      { code: "identity_invalid_response" },
    );
  }

  const encrypted = await encryptLinkedInToken(
    tokenData.access_token,
    input.encryptionKey,
  );
  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000,
  )
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  return {
    memberId: user.sub,
    personUrn: `urn:li:person:${user.sub}`,
    displayName: user.name,
    email: user.email ?? null,
    scopes: tokenData.scope || LINKEDIN_SCOPES.join(" "),
    expiresAt,
    ...encrypted,
  };
}
