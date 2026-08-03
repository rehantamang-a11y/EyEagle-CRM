import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { query } from "./db.js";
import { hashSessionToken } from "./security.js";

export const SESSION_COOKIE = "crm_session";

export type Actor = {
  id: string;
  externalUserId: string;
  name: string;
  email: string;
  role: "team_member" | "admin";
};

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}

/**
 * Routes that run before a session exists. This is an exact-match list because
 * the previous substring test on "/auth/" also matched GET /auth/session, which
 * reads request.actor — so that route returned 401 even with a valid cookie.
 */
const UNAUTHENTICATED_ROUTES = new Set([
  "/api/v1/health",
  "/api/v1/ready",
  "/api/v1/auth/login",
  "/api/v1/auth/verify",
  "/api/v1/intake/website",
]);

const pathOf = (url: string): string => url.split("?")[0];

export function isUnauthenticatedRoute(url: string): boolean {
  return UNAUTHENTICATED_ROUTES.has(pathOf(url));
}

export async function attachActor(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;
  const result = await query<Actor & { status: string; sessionId: string }>(
    `select u.id, u.external_user_id as "externalUserId", u.name, u.email, u.role, u.status,
            s.id as "sessionId"
       from crm_sessions s
       join crm_users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];
  if (row?.status !== "active") return;
  request.actor = {
    id: row.id,
    externalUserId: row.externalUserId,
    name: row.name,
    email: row.email,
    role: row.role,
  };
  // Best-effort liveness tracking; never block the request on it.
  void query("update crm_sessions set last_seen_at = now() where id = $1", [row.sessionId]).catch(() => undefined);
}

export function requireActor(request: FastifyRequest, reply: FastifyReply): Actor | undefined {
  if (!request.actor) {
    void reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
    return;
  }
  return request.actor;
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): Actor | undefined {
  const actor = requireActor(request, reply);
  if (!actor) return;
  if (actor.role !== "admin") {
    void reply.code(403).send({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
    return;
  }
  return actor;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
    signed: false,
    maxAge: 60 * 60 * 24 * config.sessionDays,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
  });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * With SameSite=None the cookie is attached to cross-site requests, so SameSite is
 * no longer acting as a CSRF defense. Every state-changing request must therefore
 * carry an Origin (or Referer) we recognise. The signed webhook authenticates
 * itself and is exempt.
 */
export function originAllowed(request: FastifyRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  if (pathOf(request.url) === "/api/v1/intake/website") return true;

  const origin = request.headers.origin
    ?? (request.headers.referer ? safeOrigin(request.headers.referer) : undefined);
  if (!origin) {
    // A browser always sends Origin on cross-site state-changing requests. Absence
    // means a non-browser client, which cookie-based CSRF does not apply to — but
    // only trust that when there is no session cookie riding along.
    return !request.cookies[SESSION_COOKIE];
  }
  return config.webOrigins.includes(origin);
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
