export type BackOfficeRole =
  | "OWNER"
  | "ADMIN"
  | "DEVELOPER"
  | "MARKETING"
  | "SALES"
  | "VIEWER";

export type AuthenticatedUser = {
  email: string;
  displayName: string;
  subject: string;
  role: BackOfficeRole;
  source: "cloudflare-access" | "local-development";
};

export type AccessEnvironment = {
  BACKOFFICE_ENVIRONMENT?: string;
  BACKOFFICE_LOCAL_AUTH?: string;
  BACKOFFICE_LOCAL_USER_EMAIL?: string;
  BACKOFFICE_LOCAL_USER_NAME?: string;
  BACKOFFICE_OWNER_EMAIL?: string;
  BACKOFFICE_ADMIN_EMAILS?: string;
  BACKOFFICE_DEVELOPER_EMAILS?: string;
  BACKOFFICE_MARKETING_EMAILS?: string;
  BACKOFFICE_SALES_EMAILS?: string;
  BACKOFFICE_VIEWER_EMAILS?: string;
};

const ROLE_ORDER: BackOfficeRole[] = [
  "OWNER",
  "ADMIN",
  "DEVELOPER",
  "MARKETING",
  "SALES",
  "VIEWER",
];

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function configuredEmails(value: string | undefined) {
  return new Set(
    (value || "")
      .split(/[\s,;]+/)
      .map((email) => normalizedEmail(email))
      .filter((email): email is string => Boolean(email)),
  );
}

export function roleForEmail(
  email: string,
  env: AccessEnvironment,
): BackOfficeRole | null {
  const normalized = normalizedEmail(email);
  if (!normalized) return null;

  const configured: Record<BackOfficeRole, Set<string>> = {
    OWNER: configuredEmails(env.BACKOFFICE_OWNER_EMAIL),
    ADMIN: configuredEmails(env.BACKOFFICE_ADMIN_EMAILS),
    DEVELOPER: configuredEmails(env.BACKOFFICE_DEVELOPER_EMAILS),
    MARKETING: configuredEmails(env.BACKOFFICE_MARKETING_EMAILS),
    SALES: configuredEmails(env.BACKOFFICE_SALES_EMAILS),
    VIEWER: configuredEmails(env.BACKOFFICE_VIEWER_EMAILS),
  };

  for (const role of ROLE_ORDER) {
    if (configured[role].has(normalized)) return role;
  }

  return null;
}

function isLocalRequest(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function accessHeader(request: Request, ...names: string[]) {
  for (const name of names) {
    const value = request.headers.get(name)?.trim();
    if (value) return value;
  }
  return null;
}

export function getAuthenticatedUser(
  request: Request,
  environment: AccessEnvironment,
): AuthenticatedUser | null {
  const email = normalizedEmail(
    accessHeader(
      request,
      "Cf-Access-Authenticated-User-Email",
      "Cf-Access-User-Email",
    ),
  );

  if (email) {
    const role = roleForEmail(email, environment);
    if (!role) return null;

    return {
      email,
      displayName:
        accessHeader(
          request,
          "Cf-Access-Authenticated-User-Name",
          "Cf-Access-User-Name",
        ) || email,
      subject:
        accessHeader(
          request,
          "Cf-Access-Authenticated-User-Id",
          "Cf-Access-User-Id",
        ) || email,
      role,
      source: "cloudflare-access",
    };
  }

  // Local auth requires both an explicit flag and a loopback hostname. It can
  // never activate for the production workers.dev hostname.
  if (
    environment.BACKOFFICE_LOCAL_AUTH === "true" &&
    environment.BACKOFFICE_ENVIRONMENT !== "production" &&
    isLocalRequest(request)
  ) {
    const localEmail = normalizedEmail(
      environment.BACKOFFICE_LOCAL_USER_EMAIL,
    );
    const role = localEmail ? roleForEmail(localEmail, environment) : null;
    if (!localEmail || !role) return null;

    return {
      email: localEmail,
      displayName:
        environment.BACKOFFICE_LOCAL_USER_NAME?.trim() || localEmail,
      subject: `local:${localEmail}`,
      role,
      source: "local-development",
    };
  }

  return null;
}

export function requireAuthenticatedUser(
  request: Request,
  environment: AccessEnvironment,
): AuthenticatedUser {
  const user = getAuthenticatedUser(request, environment);
  if (!user) {
    throw new Response("Authentication required.", {
      status: 401,
      headers: { "www-authenticate": "Cloudflare Access" },
    });
  }
  return user;
}

export function requireRole(
  user: AuthenticatedUser,
  roles: BackOfficeRole[],
) {
  if (!roles.includes(user.role)) {
    throw new Response("You are not authorized to perform this action.", {
      status: 403,
    });
  }
}

export function isPrivilegedDevelopmentUser(user: Pick<AuthenticatedUser, "role">) {
  return ["OWNER", "ADMIN", "DEVELOPER"].includes(user.role);
}
