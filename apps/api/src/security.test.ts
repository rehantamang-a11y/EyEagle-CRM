import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { validWebhookSignature } from "./security.js";

test("accepts an exact, current HMAC and rejects changed payloads", () => {
  process.env.WEBSITE_INTAKE_SECRET = "test-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ fullName: "Kavita Sharma", phone: "9876543210" });
  const signature = crypto.createHmac("sha256", "test-secret").update(`${timestamp}.${body}`).digest("hex");
  assert.equal(validWebhookSignature(body, timestamp, `sha256=${signature}`), true);
  assert.equal(validWebhookSignature(`${body} `, timestamp, `sha256=${signature}`), false);
});

test("rejects signatures outside the replay window", () => {
  process.env.WEBSITE_INTAKE_SECRET = "test-secret";
  const timestamp = String(Math.floor(Date.now() / 1000) - 601);
  const body = "{}";
  const signature = crypto.createHmac("sha256", "test-secret").update(`${timestamp}.${body}`).digest("hex");
  assert.equal(validWebhookSignature(body, timestamp, signature), false);
});
