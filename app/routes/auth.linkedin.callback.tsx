import { Link, redirect } from "react-router";
import type { Route } from "./+types/auth.linkedin.callback";
import { hashOAuthState } from "../lib/linkedinCrypto.server";
import {
  exchangeLinkedInAuthorization,
} from "../lib/linkedinOAuth.server";
import {
  getSafeLinkedInErrorMessage,
  LinkedInAPIError,
} from "../lib/linkedinErrors.server";

type AppEnvironment = {
  linkedinadam_db: D1Database;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_TOKEN_ENCRYPTION_KEY?: string;
};

export async function loader({
  request,
  context,
}: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const oauthError = url.searchParams.get("error");

  if (!state) {
    return {
      error: "The LinkedIn authorization state is missing.",
      returnPath: "/",
    };
  }

  const stateHash = await hashOAuthState(state);
  const stateRecord = await env.linkedinadam_db
    .prepare(`
      SELECT employee_id, return_path
      FROM linkedin_oauth_states
      WHERE state_hash = ?
        AND expires_at > CURRENT_TIMESTAMP
    `)
    .bind(stateHash)
    .first<{
      employee_id: number;
      return_path: string;
    }>();

  await env.linkedinadam_db
    .prepare(`
      DELETE FROM linkedin_oauth_states
      WHERE state_hash = ? OR expires_at <= CURRENT_TIMESTAMP
    `)
    .bind(stateHash)
    .run();

  if (!stateRecord) {
    return {
      error:
        "This LinkedIn connection request expired or was already used. Start again from the employee page.",
      returnPath: "/",
    };
  }

  if (oauthError) {
    return {
      error: "LinkedIn authorization was cancelled or denied.",
      returnPath: stateRecord.return_path,
    };
  }

  if (!code) {
    return {
      error: "LinkedIn did not return an authorization code.",
      returnPath: stateRecord.return_path,
    };
  }

  if (
    !env.LINKEDIN_CLIENT_ID ||
    !env.LINKEDIN_CLIENT_SECRET ||
    !env.LINKEDIN_TOKEN_ENCRYPTION_KEY
  ) {
    return {
      error: "LinkedIn OAuth secrets are not fully configured.",
      returnPath: stateRecord.return_path,
    };
  }

  try {
    const connection = await exchangeLinkedInAuthorization({
      code,
      clientId: env.LINKEDIN_CLIENT_ID,
      clientSecret: env.LINKEDIN_CLIENT_SECRET,
      encryptionKey: env.LINKEDIN_TOKEN_ENCRYPTION_KEY,
    });
    const conflictingConnection = await env.linkedinadam_db
      .prepare(`
        SELECT employee_id, linkedin_member_id
        FROM linkedin_connections
        WHERE
          (
            employee_id = ?
            AND status != 'revoked'
            AND linkedin_member_id != ?
          )
          OR
          (
            employee_id != ?
            AND linkedin_member_id = ?
          )
        LIMIT 1
      `)
      .bind(
        stateRecord.employee_id,
        connection.memberId,
        stateRecord.employee_id,
        connection.memberId,
      )
      .first<{
        employee_id: number;
        linkedin_member_id: string;
      }>();

    if (conflictingConnection) {
      throw new LinkedInAPIError(
        "The LinkedIn identity conflicts with an existing connection.",
        { code: "wrong_account" },
      );
    }

    await env.linkedinadam_db
      .prepare(`
        INSERT INTO linkedin_connections (
          employee_id,
          linkedin_member_id,
          linkedin_person_urn,
          display_name,
          email,
          access_token_ciphertext,
          access_token_iv,
          encryption_key_version,
          scopes,
          expires_at,
          status,
          connected_at,
          last_verified_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'active',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(employee_id)
        DO UPDATE SET
          linkedin_member_id = excluded.linkedin_member_id,
          linkedin_person_urn = excluded.linkedin_person_urn,
          display_name = excluded.display_name,
          email = excluded.email,
          access_token_ciphertext =
            excluded.access_token_ciphertext,
          access_token_iv = excluded.access_token_iv,
          encryption_key_version =
            excluded.encryption_key_version,
          scopes = excluded.scopes,
          expires_at = excluded.expires_at,
          status = 'active',
          connected_at = CURRENT_TIMESTAMP,
          last_verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(
        stateRecord.employee_id,
        connection.memberId,
        connection.personUrn,
        connection.displayName,
        connection.email,
        connection.ciphertext,
        connection.iv,
        connection.scopes,
        connection.expiresAt,
      )
      .run();
  } catch (error) {
    console.error(
      "LinkedIn OAuth connection failed.",
      error instanceof Error ? error.name : "unknown",
    );

    return {
      error: getSafeLinkedInErrorMessage(error, "connect"),
      returnPath: stateRecord.return_path,
    };
  }

  return redirect(
    `${stateRecord.return_path}?linkedin=connected`,
  );
}

export default function LinkedInCallback({
  loaderData,
}: Route.ComponentProps) {
  return (
    <main className="edit-page">
      <div className="edit-shell">
        <section className="panel edit-panel">
          <p className="eyebrow">LINKEDIN CONNECTION</p>
          <h1>Connection not completed</h1>
          <p className="form-error">{loaderData.error}</p>
          <Link
            className="button-link"
            to={loaderData.returnPath}
          >
            Return to employee
          </Link>
        </section>
      </div>
    </main>
  );
}
