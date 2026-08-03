import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createSessionToken, decryptSecret, encryptSecret, hashSessionToken, validWebhookSignature,
} from "./security.js";

process.env.SESSION_ENCRYPTION_KEY ??= "a-test-encryption-key-of-sufficient-length";

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

test("rejects a signature of the wrong length without throwing", () => {
  process.env.WEBSITE_INTAKE_SECRET = "test-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  assert.equal(validWebhookSignature("{}", timestamp, "sha256=deadbeef"), false);
});

test("upstream tokens round-trip through encryption", () => {
  // decryptSecret did not exist, which is why tokens were written to
  // crm_sessions and never read back, leaving verify and refresh unbuildable.
  const token = "upstream-access-token-value";
  const ciphertext = encryptSecret(token);
  assert.notEqual(ciphertext, token);
  assert.equal(decryptSecret(ciphertext), token);
});

test("tampered ciphertext fails authentication rather than decrypting", () => {
  const ciphertext = encryptSecret("upstream-access-token-value");
  const [iv, authTag, payload] = ciphertext.split(".");
  const flipped = Buffer.from(payload, "base64url");
  flipped[0] ^= 0xff;
  assert.throws(() => decryptSecret([iv, authTag, flipped.toString("base64url")].join(".")));
  assert.throws(() => decryptSecret("not-a-valid-ciphertext"));
});

test("each encryption uses a fresh iv", () => {
  assert.notEqual(encryptSecret("same-value"), encryptSecret("same-value"));
});

test("session tokens are stored only as digests", () => {
  // The cookie used to carry the crm_sessions primary key in plaintext, so read
  // access to the table or a backup was enough to impersonate any user.
  const { token, hash } = createSessionToken();
  assert.notEqual(token, hash);
  assert.equal(hash, hashSessionToken(token));
  assert.equal(hash.length, 64);
  assert.notEqual(createSessionToken().token, token);
});
