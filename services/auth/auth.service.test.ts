import assert from "node:assert/strict";
import test from "node:test";
import type { AuthSession } from "./auth.types";

process.env.NEXT_PUBLIC_APP_ENV = "local";

const servicePromise = import("./auth.service").then(({ authService }) => authService);
const json = (body: unknown, status = 200) => Response.json(body, { status });

test("login fetches the authoritative user with the returned access token", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input, init = {}) => {
    const url = String(input);
    const authorization = new Headers(init.headers).get("authorization");
    calls.push({ url, authorization });
    if (url.endsWith("/login")) return json({ data: { accessToken: "access-1", refreshToken: "refresh-1" } });
    return json({ data: { id: "user-1", email: "asha@eyeagle.ai", firstName: "Asha", lastName: "Mehta", roles: ["CRM_USER"] } });
  }) as typeof fetch;

  try {
    const { login } = await servicePromise;
    const session = await login({ email: "asha@eyeagle.ai", password: "password" });
    assert.equal(session.user.name, "Asha Mehta");
    assert.equal(session.accessToken, "access-1");
    assert.equal(session.refreshToken, "refresh-1");
    assert.deepEqual(calls, [
      { url: "/sales/api/backend/crm/auth/login", authorization: null },
      { url: "/sales/api/backend/crm/auth/me", authorization: "Bearer access-1" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a 403 from me rotates both tokens and retries me once", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null }> = [];
  let meCalls = 0;
  globalThis.fetch = (async (input, init = {}) => {
    const url = String(input);
    const authorization = new Headers(init.headers).get("authorization");
    calls.push({ url, authorization });
    if (url.endsWith("/refresh-token")) return json({ data: { accessToken: "access-new", refreshToken: "refresh-new" } });
    meCalls += 1;
    if (meCalls === 1) return json({ error: { title: "Forbidden" } }, 403);
    return json({ data: { id: "user-1", email: "asha@eyeagle.ai", name: "Asha Mehta", roles: ["CRM_USER"] } });
  }) as typeof fetch;

  const stored: AuthSession = {
    accessToken: "access-old",
    refreshToken: "refresh-old",
    user: { id: "user-1", email: "asha@eyeagle.ai", name: "Asha", roles: ["crm_user"], permissions: [] },
  };

  try {
    const { verifySession } = await servicePromise;
    const verified = await verifySession(stored);
    assert.equal(verified.accessToken, "access-new");
    assert.equal(verified.refreshToken, "refresh-new");
    assert.deepEqual(calls, [
      { url: "/sales/api/backend/crm/auth/me", authorization: "Bearer access-old" },
      { url: "/sales/api/backend/crm/auth/refresh-token", authorization: "Bearer refresh-old" },
      { url: "/sales/api/backend/crm/auth/me", authorization: "Bearer access-new" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a non-403 me failure does not call refresh", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return json({ error: { title: "Unauthenticated" } }, 401); }) as typeof fetch;
  const stored: AuthSession = {
    accessToken: "access-old",
    refreshToken: "refresh-old",
    user: { id: "user-1", email: "asha@eyeagle.ai", name: "Asha", roles: ["crm_user"], permissions: [] },
  };

  try {
    const { verifySession } = await servicePromise;
    await assert.rejects(() => verifySession(stored), (error: { status?: number }) => error.status === 401);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
