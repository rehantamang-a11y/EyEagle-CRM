import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { z } from "zod";
import { attachActor, isUnauthenticatedRoute, originAllowed } from "./auth.js";
import { config } from "./config.js";
import { databaseReachable, pool } from "./db.js";
import { fail } from "./http.js";
import { activityRoutes } from "./routes/activities.js";
import { authRoutes } from "./routes/auth.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { intakeRoutes } from "./routes/intake.js";
import { jotformRoutes } from "./routes/jotform.js";
import { leadRoutes } from "./routes/leads.js";

const app = Fastify({
  trustProxy: true,
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-eyeagle-signature']",
      "body.password",
    ],
  },
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cookie, { secret: config.sessionSecret });
await app.register(cors, { origin: config.webOrigins, credentials: true });
await app.register(rawBody, { field: "rawBody", global: false, encoding: "utf8", runFirst: true });
await app.register(rateLimit, {
  max: config.rateLimit.globalMax,
  timeWindow: "1 minute",
  // Sessions are the better bucket where one exists; fall back to source address.
  keyGenerator: (request) => request.cookies?.crm_session ?? request.ip,
});

/**
 * SameSite=None is required for a cross-site frontend, which means SameSite is no
 * longer providing CSRF protection. Every state-changing request must carry a
 * recognised Origin; the signed webhook authenticates itself and is exempt.
 */
app.addHook("onRequest", async (request, reply) => {
  if (!originAllowed(request)) {
    return fail(reply, 403, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed.");
  }
});

app.addHook("onRequest", async (request) => {
  if (!request.url.startsWith("/api/v1") || isUnauthenticatedRoute(request.url)) return;
  await attachActor(request);
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error, requestId: request.id }, "request failed");

  if (error instanceof z.ZodError) {
    return reply.code(422).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Some fields need attention.",
        fields: error.flatten().fieldErrors,
      },
    });
  }
  const databaseCode = (error as { code?: string }).code;
  if (databaseCode === "23505") {
    return reply.code(409).send({ error: { code: "CONFLICT", message: "That record already exists." } });
  }
  if (databaseCode === "23503") {
    return reply.code(422).send({ error: { code: "INVALID_REFERENCE", message: "A referenced record does not exist." } });
  }
  if (databaseCode === "23514") {
    return reply.code(422).send({ error: { code: "CONSTRAINT_VIOLATION", message: "That change is not allowed." } });
  }
  const statusCode = (error as { statusCode?: number }).statusCode;
  return reply.code(statusCode && statusCode < 500 ? statusCode : 500).send({
    error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", requestId: request.id },
  });
});

app.get("/api/v1/health", async () => ({
  status: "ok",
  service: "eyeagle-crm-api",
  now: new Date().toISOString(),
}));

/** Liveness said "ok" with the database down, so load balancers kept routing traffic. */
app.get("/api/v1/ready", async (_request, reply) => {
  const reachable = await databaseReachable();
  return reply.code(reachable ? 200 : 503).send({
    status: reachable ? "ready" : "degraded",
    database: reachable ? "up" : "down",
  });
});

await app.register(authRoutes);
await app.register(leadRoutes);
await app.register(activityRoutes);
await app.register(dashboardRoutes);
await app.register(intakeRoutes);
await app.register(jotformRoutes);

await app.listen({ port: config.port, host: "0.0.0.0" });

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "shutdown failed");
      process.exit(1);
    }
  });
}
