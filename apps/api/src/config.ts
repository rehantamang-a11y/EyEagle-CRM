/**
 * Configuration is validated once at boot so a misconfigured deployment fails
 * loudly on start rather than silently at the first request that needs a secret.
 */
const isProduction = process.env.NODE_ENV === "production";

function required(name: string, minimumLength = 1): string {
  const value = process.env[name];
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} is required and must be at least ${minimumLength} characters`);
  }
  return value;
}

/**
 * Demo auth accepts any password for any @eyeagle.in address and grants admin to
 * anything starting with "admin". A single stray env var would be a total auth
 * bypass, so production refuses to boot with it enabled.
 */
const allowDemoAuth = process.env.ALLOW_DEMO_AUTH === "true";
if (allowDemoAuth && isProduction) {
  throw new Error("ALLOW_DEMO_AUTH must be false in production: it accepts any password and grants admin by email prefix");
}

const webOrigins = (process.env.WEB_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (isProduction && !webOrigins.length) {
  throw new Error("WEB_ORIGIN must list at least one allowed origin in production");
}

/**
 * A cross-site frontend (Vercel web app, separately hosted API) needs SameSite=None
 * or the browser drops the session cookie on every XHR. That in turn requires the
 * Origin check in the CSRF hook, since SameSite is no longer providing one.
 */
const cookieSameSite = (process.env.COOKIE_SAMESITE ?? (isProduction ? "none" : "lax")) as "lax" | "none" | "strict";
if (!["lax", "none", "strict"].includes(cookieSameSite)) {
  throw new Error("COOKIE_SAMESITE must be one of lax, none, strict");
}
if (cookieSameSite === "none" && !isProduction && process.env.COOKIE_SECURE !== "true") {
  // SameSite=None without Secure is rejected by browsers; surface it at boot.
  throw new Error("COOKIE_SAMESITE=none requires COOKIE_SECURE=true");
}

export const config = {
  isProduction,
  port: Number(process.env.PORT || 4000),
  databaseUrl: required("DATABASE_URL"),
  databaseSsl: process.env.DATABASE_SSL !== "false" && isProduction,
  sessionSecret: required("SESSION_SECRET", 32),
  sessionEncryptionKey: required("SESSION_ENCRYPTION_KEY", 32),
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  webOrigins,
  cookieSameSite,
  cookieSecure: process.env.COOKIE_SECURE === "true" || isProduction,
  allowDemoAuth,
  websiteIntakeSecret: process.env.WEBSITE_INTAKE_SECRET ?? "",
  auth: {
    baseUrl: process.env.EYEAGLE_AUTH_BASE_URL ?? "",
    loginPath: process.env.EYEAGLE_AUTH_LOGIN_PATH ?? "",
    verifyPath: process.env.EYEAGLE_AUTH_VERIFY_PATH ?? "",
    mePath: process.env.EYEAGLE_AUTH_ME_PATH ?? "",
  },
  rateLimit: {
    globalMax: Number(process.env.RATE_LIMIT_GLOBAL_MAX || 300),
    loginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX || 10),
    intakeMax: Number(process.env.RATE_LIMIT_INTAKE_MAX || 120),
  },
  // Optional: only the admin-triggered Jotform sync needs these, so absence does
  // not block boot the way the required website-intake secret does.
  jotform: {
    apiKey: process.env.JOTFORM_API_KEY ?? "",
    formId: process.env.JOTFORM_FORM_ID ?? "",
  },
} as const;

if (config.isProduction && !config.websiteIntakeSecret) {
  throw new Error("WEBSITE_INTAKE_SECRET is required in production");
}
if (config.isProduction && !config.auth.baseUrl) {
  throw new Error("EYEAGLE_AUTH_BASE_URL is required in production");
}
