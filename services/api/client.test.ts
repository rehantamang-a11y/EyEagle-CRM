import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_APP_ENV = "local";

test("preserves unsafe JSON integers as exact strings before DTO mapping", async () => {
  const { apiRequest, resolveApiUrl } = await import("./client");
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => new Response(
    '{"id":872822016364622823,"owner":{"id":872822016364622824},"count":12}',
    { headers: { "content-type": "application/json" } },
  )) as typeof fetch;

  try {
    assert.equal(resolveApiUrl("/crm/auth/login"), "/sales/api/backend/crm/auth/login");
    assert.equal(resolveApiUrl("/sales/api/backend/crm/auth/login"), "/sales/api/backend/crm/auth/login");
    assert.equal(resolveApiUrl("https://api.eyeagle.ai/api/v1/crm/auth/login"), "https://api.eyeagle.ai/api/v1/crm/auth/login");
    const result = await apiRequest<{ id: string; owner: { id: string }; count: number }>("/precision-test");
    assert.equal(result.id, "872822016364622823");
    assert.equal(result.owner.id, "872822016364622824");
    assert.equal(result.count, 12);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
