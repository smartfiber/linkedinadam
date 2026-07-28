import { redirect } from "react-router";
import type { Route } from "./+types/auth.linkedin.start";
import { createLinkedInAuthorization } from "../lib/linkedinOAuth.server";

type AppEnvironment = {
  linkedinadam_db: D1Database;
  LINKEDIN_CLIENT_ID?: string;
};

export async function loader({
  request,
  context,
}: Route.LoaderArgs) {
  const env = context.cloudflare.env as unknown as AppEnvironment;
  const url = new URL(request.url);
  const employeeId = Number(url.searchParams.get("employee"));

  if (!Number.isInteger(employeeId)) {
    throw new Response("Invalid employee ID", { status: 400 });
  }

  if (!env.LINKEDIN_CLIENT_ID) {
    throw new Response(
      "LinkedIn OAuth is not configured.",
      { status: 503 },
    );
  }

  const employee = await env.linkedinadam_db
    .prepare(`
      SELECT id
      FROM employees
      WHERE id = ? AND status = 'active'
    `)
    .bind(employeeId)
    .first<{ id: number }>();

  if (!employee) {
    throw new Response("Employee not found", { status: 404 });
  }

  const authorizationUrl = await createLinkedInAuthorization(
    env.linkedinadam_db,
    {
      employeeId,
      clientId: env.LINKEDIN_CLIENT_ID,
      returnPath: `/employees/${employeeId}`,
    },
  );

  return redirect(authorizationUrl);
}
