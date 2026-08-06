import assert from "node:assert/strict";
import test from "node:test";
import { APP_BASE_PATH, withBasePath } from "./app-path";

test("prefixes internal application paths with the fixed sales base path", () => {
  assert.equal(APP_BASE_PATH, "/sales");
  assert.equal(withBasePath("/api/backend"), "/sales/api/backend");
  assert.equal(withBasePath("api/backend/crm/auth/login"), "/sales/api/backend/crm/auth/login");
});

test("does not double-prefix sales paths or alter external URLs", () => {
  assert.equal(withBasePath("/sales/api/backend"), "/sales/api/backend");
  assert.equal(withBasePath("/sales/sales/api/backend"), "/sales/api/backend");
  assert.equal(withBasePath("https://api.eyeagle.ai/api/v1"), "https://api.eyeagle.ai/api/v1");
});
