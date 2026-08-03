import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { updateReminderChannelsSchema } from "@eyeagle/crm-shared";
import { z } from "zod";
import { clearSessionCookie, requireActor, SESSION_COOKIE, setSessionCookie } from "../auth.js";
import { config } from "../config.js";
import { query, transaction } from "../db.js";
import { createSessionToken, decryptSecret, encryptSecret, hashSessionToken } from "../security.js";
import { fail } from "../http.js";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

type UpstreamIdentity = { id: string; name: string; email: string; role?: string };

async function upstreamLogin(credentials: z.infer<typeof credentialsSchema>) {
  const response = await fetch(`${config.auth.baseUrl}${config.auth.loginPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;

  const payload = await response.json() as Record<string, any>;
  const session = payload.data?.session ?? payload.session ?? payload.data ?? payload;
  const identity: UpstreamIdentity | undefined = session.user ?? session.operator ?? payload.user;
  const accessToken: string | undefined = session.accessToken ?? session.access_token ?? session.token;
  const refreshToken: string = session.refreshToken ?? session.refresh_token ?? "";
  if (!identity?.id || !accessToken) throw new Error("Identity response is missing user or access token");
  return { identity, accessToken, refreshToken };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/auth/login", {
    config: { rateLimit: { max: config.rateLimit.loginMax, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = credentialsSchema.parse(request.body);

    let identity: UpstreamIdentity;
    let accessToken: string;
    let refreshToken = "";

    if (config.allowDemoAuth && body.email.endsWith("@eyeagle.in")) {
      // Boot refuses this combination in production; see config.ts.
      identity = {
        id: `demo:${body.email}`,
        name: body.email.startsWith("admin") ? "Rey Tamang" : "Asha Mehta",
        email: body.email,
        role: body.email.startsWith("admin") ? "admin" : "team_member",
      };
      accessToken = `demo-${crypto.randomUUID()}`;
    } else {
      const upstream = await upstreamLogin(body);
      if (!upstream) return fail(reply, 401, "INVALID_CREDENTIALS", "Email or password was not accepted.");
      ({ identity, accessToken, refreshToken } = upstream);
    }

    const { token, hash } = createSessionToken();
    const session = await transaction(async (client) => {
      const user = await client.query<{
        id: string; externalUserId: string; name: string; email: string;
        role: "team_member" | "admin"; status: string;
      }>(
        `insert into crm_users (external_user_id, name, email, role)
         values ($1, $2, $3, $4)
         on conflict (external_user_id) do update
           set name = excluded.name, email = excluded.email,
               updated_at = now(), version = crm_users.version + 1
         returning id, external_user_id as "externalUserId", name, email, role, status`,
        [identity.id, identity.name, identity.email.toLowerCase(), identity.role === "admin" ? "admin" : "team_member"],
      );
      if (user.rows[0].status !== "active") return null;

      await client.query(
        `insert into crm_sessions
           (user_id, token_hash, upstream_access_token_ciphertext, upstream_refresh_token_ciphertext, expires_at)
         values ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
        [
          user.rows[0].id,
          hash,
          encryptSecret(accessToken),
          refreshToken ? encryptSecret(refreshToken) : null,
          String(config.sessionDays),
        ],
      );
      return user.rows[0];
    });

    if (!session) return fail(reply, 403, "ACCOUNT_INACTIVE", "This account is not active in the CRM.");

    setSessionCookie(reply, token);
    const { status, ...user } = session;
    return { user };
  });

  /**
   * Confirms the CRM session is still backed by a live upstream identity. This
   * needed decryptSecret, which did not exist — tokens were written and never read.
   */
  app.post("/api/v1/auth/verify", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return fail(reply, 401, "UNAUTHENTICATED", "No active session.");
    if (!config.auth.baseUrl || !config.auth.mePath) {
      return fail(reply, 501, "AUTH_CONTRACT_PENDING", "Configure the Eyeagle verification contract before production.");
    }

    const result = await query<{ id: string; ciphertext: string }>(
      `select s.id, s.upstream_access_token_ciphertext as ciphertext
         from crm_sessions s
        where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()`,
      [hashSessionToken(token)],
    );
    if (!result.rows[0]) return fail(reply, 401, "UNAUTHENTICATED", "No active session.");

    const response = await fetch(`${config.auth.baseUrl}${config.auth.mePath}`, {
      headers: { authorization: `Bearer ${decryptSecret(result.rows[0].ciphertext)}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await query("update crm_sessions set revoked_at = now() where id = $1", [result.rows[0].id]);
      clearSessionCookie(reply);
      return fail(reply, 401, "UPSTREAM_SESSION_ENDED", "Sign in again.");
    }
    return { verified: true };
  });

  app.get("/api/v1/auth/session", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const preferences = await query<{ reminder_channels: string[] }>(
      "select reminder_channels from crm_users where id = $1",
      [actor.id],
    );
    return { user: { ...actor, reminderChannels: preferences.rows[0]?.reminder_channels ?? [] } };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await query(
        "update crm_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null",
        [hashSessionToken(token)],
      );
    }
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.patch("/api/v1/me/reminder-channels", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const body = updateReminderChannelsSchema.parse(request.body);
    await query(
      "update crm_users set reminder_channels = $1::text[], updated_at = now(), version = version + 1 where id = $2",
      [body.reminderChannels, actor.id],
    );
    return { data: { reminderChannels: body.reminderChannels } };
  });
}
