import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../auth.js";
import { config } from "../config.js";
import { transaction } from "../db.js";
import { ingestEnquiry } from "../enquiries.js";
import { fail, recordAudit, requestId } from "../http.js";
import { fetchJotformSubmissions, mapJotformSubmission } from "../jotform.js";

export async function jotformRoutes(app: FastifyInstance): Promise<void> {
  /**
   * A manual "Sync now" trigger rather than a webhook or a poller: no public
   * endpoint to secure, no worker loop to run, and an admin decides when new
   * enquiries get pulled in. Safe to call repeatedly — every submission is
   * deduplicated on jotform_submissions.jotform_submission_id regardless of
   * how much the fetched page overlaps a previous run.
   */
  app.post("/api/v1/intake/jotform/sync", async (request, reply) => {
    const actor = requireAdmin(request, reply);
    if (!actor) return;

    if (!config.jotform.apiKey || !config.jotform.formId) {
      return fail(reply, 501, "JOTFORM_NOT_CONFIGURED", "Set JOTFORM_API_KEY and JOTFORM_FORM_ID to enable this sync.");
    }

    let submissions;
    try {
      submissions = await fetchJotformSubmissions({ apiKey: config.jotform.apiKey, formId: config.jotform.formId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordSyncFailure(actor.id, message);
      return fail(reply, 502, "JOTFORM_FETCH_FAILED", "Could not reach Jotform.", { detail: message });
    }

    let created = 0;
    let skipped = 0;
    const mappingWarnings: Array<{ submissionId: string; unmapped: string[] }> = [];
    const rejected: Array<{ submissionId: string; reason: string }> = [];
    let latestSubmittedAt: string | null = null;

    for (const submission of submissions) {
      const alreadySynced = await transaction((client) =>
        client.query("select 1 from jotform_submissions where jotform_submission_id = $1", [submission.id]));
      if (alreadySynced.rowCount) {
        skipped += 1;
        latestSubmittedAt = submission.created_at;
        continue;
      }

      const mapped = mapJotformSubmission(submission);
      if (!mapped) {
        rejected.push({ submissionId: submission.id, reason: "Missing required name or phone field" });
        await transaction((client) =>
          client.query(
            `insert into jotform_submissions
               (jotform_submission_id, submitted_at, payload, result, unmapped_fields)
             values ($1, $2, $3, 'rejected_missing_required_field', $4)
             on conflict (jotform_submission_id) do nothing`,
            [submission.id, submission.created_at, JSON.stringify(submission), []],
          ));
        latestSubmittedAt = submission.created_at;
        continue;
      }
      if (mapped.unmapped.length) mappingWarnings.push({ submissionId: submission.id, unmapped: mapped.unmapped });

      await transaction(async (client) => {
        const ingested = await ingestEnquiry(client, mapped.enquiry, {
          sourceName: "Jotform",
          auditAction: "jotform.enquiry_received",
          requestId: requestId(request),
          auditMetadata: { submissionId: submission.id, unmapped: mapped.unmapped },
        });
        await client.query(
          `insert into jotform_submissions
             (jotform_submission_id, submitted_at, payload, result, unmapped_fields, customer_id, lead_id)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (jotform_submission_id) do nothing`,
          [
            submission.id, submission.created_at, JSON.stringify(submission), ingested.outcome,
            mapped.unmapped, ingested.customerId, ingested.leadId,
          ],
        );
      });

      created += 1;
      latestSubmittedAt = submission.created_at;
    }

    await transaction((client) =>
      client.query(
        `insert into jotform_sync_state
           (form_id, last_synced_submitted_at, last_synced_at, last_synced_by, last_run_created, last_run_skipped, last_run_error)
         values ($1, $2, now(), $3, $4, $5, null)
         on conflict (form_id) do update
           set last_synced_submitted_at = greatest(jotform_sync_state.last_synced_submitted_at, excluded.last_synced_submitted_at),
               last_synced_at = excluded.last_synced_at,
               last_synced_by = excluded.last_synced_by,
               last_run_created = excluded.last_run_created,
               last_run_skipped = excluded.last_run_skipped,
               last_run_error = null`,
        [config.jotform.formId, latestSubmittedAt, actor.id, created, skipped],
      ));

    return {
      data: {
        fetched: submissions.length,
        created,
        skipped,
        rejected,
        mappingWarnings,
      },
    };
  });

  app.get("/api/v1/intake/jotform/status", async (request, reply) => {
    const actor = requireAdmin(request, reply);
    if (!actor) return;
    const result = await transaction((client) =>
      client.query(
        `select form_id as "formId", last_synced_submitted_at as "lastSyncedSubmittedAt",
                last_synced_at as "lastSyncedAt", last_run_created as "lastRunCreated",
                last_run_skipped as "lastRunSkipped", last_run_error as "lastRunError"
           from jotform_sync_state where form_id = $1`,
        [config.jotform.formId],
      ));
    return { data: result.rows[0] ?? null, configured: Boolean(config.jotform.apiKey && config.jotform.formId) };
  });

  async function recordSyncFailure(actorId: string, message: string): Promise<void> {
    await transaction(async (client) => {
      await client.query(
        `insert into jotform_sync_state (form_id, last_synced_at, last_synced_by, last_run_error)
         values ($1, now(), $2, $3)
         on conflict (form_id) do update
           set last_synced_at = excluded.last_synced_at, last_synced_by = excluded.last_synced_by,
               last_run_error = excluded.last_run_error`,
        [config.jotform.formId, actorId, message.slice(0, 1000)],
      );
      await recordAudit(client, {
        actorUserId: actorId,
        action: "jotform.sync_failed",
        entityType: "jotform_sync",
        entityId: null,
        metadata: { formId: config.jotform.formId, error: message.slice(0, 500) },
        requestId: "jotform-sync",
      });
    });
  }
}
