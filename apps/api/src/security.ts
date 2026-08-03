import crypto from "node:crypto";

const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function encryptionKey(): Buffer {
  const raw = process.env.SESSION_ENCRYPTION_KEY;
  if (!raw) throw new Error("SESSION_ENCRYPTION_KEY is required");
  return crypto.createHash("sha256").update(raw).digest().subarray(0, KEY_LENGTH);
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

/**
 * The counterpart to encryptSecret. Its absence was why upstream tokens were
 * written to crm_sessions and never read back, leaving verify/refresh unbuildable.
 */
export function decryptSecret(payload: string): string {
  const [iv, authTag, encrypted] = payload.split(".");
  if (!iv || !authTag || !encrypted) throw new Error("Ciphertext is malformed");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Opaque session token handed to the browser; only its digest is persisted. */
export function createSessionToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function validWebhookSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const secret = process.env.WEBSITE_INTAKE_SECRET;
  if (!secret || !timestamp || !signature) return false;
  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp) || Math.abs(Date.now() - parsedTimestamp * 1000) > 300_000) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const provided = signature.replace(/^sha256=/, "");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
