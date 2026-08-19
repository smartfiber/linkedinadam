import {
  createRemoteJWKSet,
  jwtVerify,
  type JWK,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
  type KeyLike,
  type JWTPayload,
} from "jose";

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
  CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
  CLOUDFLARE_ACCESS_AUD?: string;
};

export type CloudflareAccessClaims = JWTPayload & {
  sub: string;
  email: string;
  name?: string;
};

export type AccessJwtKeySet = KeyLike | Uint8Array | JWK | JWTVerifyGetKey;

const ROLE_ORDER: BackOfficeRole[] = [
  "OWNER",
  "ADMIN",
  "DEVELOPER",
  "MARKETING",
  "SALES",
  "VIEWER",
];

const remoteJwksByIssuer = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

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

function normalizedTeamDomain(value: string | undefined) {
  if (!value) return null;
  try {
    const withScheme = value.includes("://") ? value : `https://${value}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
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

function accessJwtConfiguration(environment: AccessEnvironment) {
  const teamDomain = normalizedTeamDomain(
    environment.CLOUDFLARE_ACCESS_TEAM_DOMAIN,
  );
  const audience = environment.CLOUDFLARE_ACCESS_AUD?.trim();
  if (!teamDomain || !audience) return null;

  return {
    issuer: `https://${teamDomain}`,
    jwksUrl: `https://${teamDomain}/cdn-cgi/access/certs`,
    audience,
  };
}

function remoteJwksFor(configuration: ReturnType<typeof accessJwtConfiguration>) {
  if (!configuration) return null;
  const existing = remoteJwksByIssuer.get(configuration.issuer);
  if (existing) return existing;

  const remoteJwks = createRemoteJWKSet(new URL(configuration.jwksUrl));
  remoteJwksByIssuer.set(configuration.issuer, remoteJwks);
  return remoteJwks;
}

export async function verifyAccessJwtToken(
  token: string,
  environment: AccessEnvironment,
  keySet: AccessJwtKeySet | null = remoteJwksFor(accessJwtConfiguration(environment)),
): Promise<CloudflareAccessClaims | null> {
  const configuration = accessJwtConfiguration(environment);
  if (!configuration || !keySet || !token.trim()) return null;

  try {
    const options: JWTVerifyOptions = {
      algorithms: ["RS256"],
      issuer: configuration.issuer,
      audience: configuration.audience,
      clockTolerance: 5,
    };
    const result =
      typeof keySet === "function"
        ? await jwtVerify(token, keySet as JWTVerifyGetKey, options)
        : await jwtVerify(token, keySet as KeyLike | Uint8Array | JWK, options);

    const { payload } = result;
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      !normalizedEmail(payload.email) ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    return {
      ...payload,
      sub: payload.sub,
      email: payload.email,
      ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    };
  } catch {
    // Authentication must fail closed for malformed, untrusted, expired, or
    // unverifiable tokens, including JWKS retrieval failures.
    return null;
  }
}

export async function getAuthenticatedUser(
  request: Request,
  environment: AccessEnvironment,
  keySet?: AccessJwtKeySet,
): Promise<AuthenticatedUser | null> {
  const token = accessHeader(request, "Cf-Access-Jwt-Assertion");

  if (token) {
    const claims = await verifyAccessJwtToken(token, environment, keySet);
    if (!claims) return null;

    const email = normalizedEmail(claims.email);
    const role = email ? roleForEmail(email, environment) : null;
    if (!email || !role) return null;

    return {
      email,
      displayName: claims.name?.trim() || email,
      subject: claims.sub,
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

export function isPublicAuthException(pathname: string) {
  return pathname === "/auth/linkedin/callback";
}

export async function requireAuthenticatedUser(
  request: Request,
  environment: AccessEnvironment,
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(request, environment);
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
