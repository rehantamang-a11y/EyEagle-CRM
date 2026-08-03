import type { FastifyInstance, FastifyRequest } from "fastify";
import { websiteIntakeSchema } from "@eyeagle/crm-shared";
import { config } from "../config.js";
import { transaction } from "../db.js";
import { ingestEnquiry } from "../enquiries.js";
import { fail, requestId } from "../http.js";
import { validWebhookSignature } from "../security.js";

export async function intakeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/intake/website", {
    config: {
      rawBody: true,
      rateLimit: { max: config.rateLimit.intakeMax, timeWindow: "1 minute" },
    },
  }, async (request, reply) => {
    const exactBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? "";
    const timestamp = String(request.headers["x-eyeagle-timestamp"] || "");
    const signature = String(request.headers["x-eyeagle-signature"] || "");
    const idempotencyKey = String(request.headers["idempotency-key"] || "");

    if (!idempotencyKey || !validWebhookSignature(exactBody, timestamp, signature)) {
      return fail(reply, 401, "INVALID_SIGNATURE", "Webhook authentication failed.");
    }

    const payload = websiteIntakeSchema.parse(request.body);

    const result = await transaction(async (client) => {
      const prior = await client.query<{ id: string; result: string }>(
        "select id, result from website_intake_submissions where idempotency_key = $1",
        [idempotencyKey],
      );
      if (prior.rows[0]) {
        return { intakeId: prior.rows[0].id, result: prior.rows[0].result, replayed: true };
      }

      const ingested = await ingestEnquiry(client, payload, {
        sourceName: "Website",
        auditAction: "website.enquiry_received",
        requestId: requestId(request),
        auditMetadata: { summaryLength: payload.summary.length },
      });

      const intake = await client.query<{ id: string }>(
        `insert into website_intake_submissions (idempotency_key, payload, result, customer_id, lead_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [idempotencyKey, JSON.stringify(payload), ingested.outcome, ingested.customerId, ingested.leadId],
      );
      return { intakeId: intake.rows[0].id, result: ingested.outcome, replayed: false };
    });

    return reply.code(result.replayed ? 200 : 202).send(result);
  });
}
