import { z } from "zod";
import { ApiError, apiRequest } from "@/services/api/client";
import type { AuthSession, AuthUser, LoginCredentials } from "./auth.types";

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const asText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const authority = (value: string) => value.replace(/^ROLE_/i, "").toLowerCase();
const asAuthorities = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.flatMap((entry) => {
    if (typeof entry === "string") return [authority(entry)];
    const item = asRecord(entry);
    const name = asText(item.authority) || asText(item.name) || asText(item.role);
    return name ? [authority(name)] : [];
  }))];
};

function readJwtClaims(token?: string): Record<string, unknown> {
  if (!token || typeof window === "undefined") return {};
  try {
    const segment = token.split(".")[1];
    if (!segment) return {};
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    return asRecord(JSON.parse(window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))));
  } catch {
    return {};
  }
}

function normalizeUserResponse(payload: unknown, fallback?: Partial<AuthUser>): AuthUser {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const explicitUser = asRecord(data.user ?? data.principal ?? root.user ?? root.principal);
  const userSource = Object.keys(explicitUser).length ? explicitUser : Object.keys(data).length ? data : root;
  const firstName = asText(userSource.firstName) || asText(userSource.first_name);
  const lastName = asText(userSource.lastName) || asText(userSource.last_name);
  const composedName = [firstName, lastName].filter(Boolean).join(" ");
  const email = asText(userSource.email) || fallback?.email || "";
  const roles = asAuthorities(userSource.roles ?? userSource.authorities ?? userSource.role);
  const permissions = asAuthorities(userSource.permissions ?? userSource.scopes ?? userSource.scope);

  return {
    id: asText(userSource.id) || asText(userSource.userId) || asText(userSource.externalUserId) || asText(userSource.sub) || fallback?.id || email,
    email,
    name: asText(userSource.name) || asText(userSource.fullName) || asText(userSource.displayName) || composedName || fallback?.name || email.split("@")[0],
    roles: roles.length ? roles : fallback?.roles || ["crm_user"],
    permissions: permissions.length ? permissions : fallback?.permissions || [],
  };
}

function normalizeLoginResponse(payload: unknown, email: string): AuthSession {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const session = asRecord(data.session ?? root.session ?? data);
  const tokens = asRecord(session.tokens ?? data.tokens ?? root.tokens);
  const accessToken = asText(tokens.accessToken) || asText(tokens.access_token) || asText(tokens.token)
    || asText(session.accessToken) || asText(session.access_token) || asText(session.token)
    || asText(data.accessToken) || asText(data.access_token) || asText(data.token)
    || asText(root.accessToken) || asText(root.access_token) || asText(root.token);
  const refreshToken = asText(tokens.refreshToken) || asText(tokens.refresh_token)
    || asText(session.refreshToken) || asText(session.refresh_token)
    || asText(data.refreshToken) || asText(data.refresh_token)
    || asText(root.refreshToken) || asText(root.refresh_token);
  const claims = readJwtClaims(accessToken);
  const explicitUser = asRecord(session.user ?? session.operator ?? data.user ?? root.user);
  const userSource = Object.keys(explicitUser).length
    ? explicitUser
    : asText(session.email) || asText(session.id)
      ? session
      : asText(data.email) || asText(data.id)
        ? data
        : root;
  const roles = asAuthorities(userSource.roles ?? userSource.authorities ?? userSource.role ?? claims.roles ?? claims.authorities ?? claims.role);
  const permissions = asAuthorities(userSource.permissions ?? claims.permissions ?? claims.scope);
  const user: AuthUser = {
    id: asText(userSource.id) || asText(userSource.userId) || asText(userSource.externalUserId) || asText(claims.sub) || email,
    email: asText(userSource.email) || asText(claims.email) || email,
    name: asText(userSource.name) || asText(userSource.fullName) || asText(claims.name) || email.split("@")[0],
    roles: roles.length ? roles : ["crm_user"],
    permissions,
  };
  return { user, accessToken, refreshToken };
}

async function fetchCurrentUser(accessToken?: string, fallback?: Partial<AuthUser>): Promise<AuthUser> {
  const payload = await apiRequest<unknown>("/crm/auth/me", {
    method: "GET",
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
    skipAuthEvent: true,
  });
  return normalizeUserResponse(payload, fallback);
}

async function refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = await apiRequest<unknown>("/crm/auth/refresh-token", {
    method: "POST",
    headers: { authorization: `Bearer ${refreshToken}` },
    skipAuthEvent: true,
  });
  const normalized = normalizeLoginResponse(payload, "");
  if (!normalized.accessToken) throw new Error("The refresh response did not include a new access token.");
  return { accessToken: normalized.accessToken, refreshToken: normalized.refreshToken || refreshToken };
}

async function verifySession(session: AuthSession): Promise<AuthSession> {
  try {
    const user = await fetchCurrentUser(session.accessToken, session.user);
    return { ...session, user };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 403 || !session.refreshToken) throw error;
    const refreshed = await refreshTokens(session.refreshToken);
    const user = await fetchCurrentUser(refreshed.accessToken, session.user);
    return { ...session, ...refreshed, user };
  }
}

export const authService = {
  async login(input: LoginCredentials): Promise<AuthSession> {
    const credentials = credentialsSchema.parse(input);
    const payload = await apiRequest<unknown>("/crm/auth/login", { method: "POST", body: credentials, skipAuthEvent: true });
    const session = normalizeLoginResponse(payload, credentials.email);
    return verifySession(session);
  },

  async me(accessToken?: string, fallback?: Partial<AuthUser>): Promise<AuthUser> {
    return fetchCurrentUser(accessToken, fallback);
  },

  async verifySession(session: AuthSession): Promise<AuthSession> {
    return verifySession(session);
  },

  async logout(): Promise<void> {
    await apiRequest<void>("/crm/auth/logout", { method: "POST", skipAuthEvent: true });
  },
};
