import type { PoolClient } from "pg";
import { normalizeIndianPhone, type leadPriorities } from "@eyeagle/crm-shared";
import { recordAudit } from "./http.js";

export type NormalizedEnquiry = {
  fullName: string;
  phone: string;
  email?: string;
  city?: string;
  summary: string;
  priority: typeof leadPriorities[number];
};

export type IngestOutcome =
  | "existing_open_lead"
  | "created_customer_and_lead"
  | "created_lead_for_customer"
  | "suppressed_do_not_contact";

export type IngestResult = {
  outcome: IngestOutcome;
  customerId: string;
  leadId: string | null;
};

/**
 * Shared by every inbound-enquiry source (signed website webhook, Jotform sync,
 * and any future one). Families legitimately share phone numbers, so a match is
 * never an automatic duplicate: an open lead on that number becomes a timeline
 * event on the existing lead, a known customer with no open lead gets a new
 * lead attached to their existing record, and a customer marked do-not-contact
 * is recorded but never re-queued. This logic must stay identical across
 * sources — duplicating it per-intake-route is how the two paths drift.
 */
export async function ingestEnquiry(
  client: PoolClient,
  enquiry: NormalizedEnquiry,
  context: { sourceName: string; auditAction: string; requestId: string; auditMetadata?: Record<string, unknown> },
): Promise<IngestResult> {
  const phone = normalizeIndianPhone(enquiry.phone);

  const existing = await client.query<{
    customer_id: string; lead_id: string | null; owner_user_id: string | null;
  }>(
    `select c.id as customer_id, l.id as lead_id, l.owner_user_id
       from customers c
       left join leads l on l.customer_id = c.id and l.status in ('unclaimed', 'active')
      where c.normalized_phone = $1
      order by l.created_at desc nulls last
      limit 1`,
    [phone],
  );

  let customerId = existing.rows[0]?.customer_id;
  let leadId = existing.rows[0]?.lead_id ?? null;

  if (leadId) {
    await recordAudit(client, {
      actorUserId: null,
      action: context.auditAction,
      entityType: "lead",
      entityId: leadId,
      // Summarised, not the raw payload: audit_events is immutable, so anything
      // written here can never be redacted later.
      metadata: { source: context.sourceName, priority: enquiry.priority, ...context.auditMetadata },
      requestId: context.requestId,
    });
    if (existing.rows[0].owner_user_id) {
      await client.query(
        `insert into notifications (user_id, type, title, body, entity_type, entity_id)
         values ($1, 'repeat_enquiry', 'New enquiry from an existing lead', $2, 'lead', $3)`,
        [existing.rows[0].owner_user_id, enquiry.summary, leadId],
      );
    }
    return { outcome: "existing_open_lead", customerId: customerId as string, leadId };
  }

  let outcome: IngestOutcome;
  if (!customerId) {
    const customer = await client.query<{ id: string }>(
      `insert into customers (full_name, primary_phone, normalized_phone, email, city)
       values ($1, $2, $3, $4, $5) returning id`,
      [enquiry.fullName, enquiry.phone, phone, enquiry.email || null, enquiry.city || null],
    );
    customerId = customer.rows[0].id;
    outcome = "created_customer_and_lead";
  } else {
    outcome = "created_lead_for_customer";
  }

  const consent = await client.query<{ do_not_contact: boolean }>(
    "select do_not_contact from customers where id = $1",
    [customerId],
  );
  if (consent.rows[0]?.do_not_contact) {
    return { outcome: "suppressed_do_not_contact", customerId, leadId: null };
  }

  const lead = await client.query<{ id: string }>(
    `insert into leads (customer_id, stage_id, source_id, priority, enquiry_summary, status)
     select $1, s.id, src.id, $2, $3, 'unclaimed'
       from pipeline_stages s, lead_sources src
      where s.name = 'New Enquiry' and src.name = $4
     returning id`,
    [customerId, enquiry.priority, enquiry.summary, context.sourceName],
  );
  if (!lead.rows[0]) {
    throw new Error(`Pipeline stage or lead source '${context.sourceName}' seed data is missing`);
  }
  leadId = lead.rows[0].id;

  await recordAudit(client, {
    actorUserId: null,
    action: context.auditAction,
    entityType: "lead",
    entityId: leadId,
    metadata: { source: context.sourceName, priority: enquiry.priority, outcome, ...context.auditMetadata },
    requestId: context.requestId,
  });

  return { outcome, customerId, leadId };
}
