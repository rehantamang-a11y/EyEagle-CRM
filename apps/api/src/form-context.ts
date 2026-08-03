import { query } from "./db.js";
import { describeJotformSubmission, type JotformSubmission } from "./jotform.js";

export type FormContext =
  | { source: "Jotform"; submittedAt: string; raw: ReturnType<typeof describeJotformSubmission> }
  | { source: "Manual Entry"; submittedAt: string; raw: { summary: string; priority: string } }
  | { source: string; submittedAt: string; raw: { summary: string } };

/**
 * What the customer actually told us, kept separate from enquiry_summary (which
 * is a paraphrase built at intake time for search and the pipeline card, and
 * from lead source to lead source is worded differently). Only Jotform and
 * Manual Entry get a tailored shape; every other source falls back to a plain
 * summary so the route never breaks on a lead it wasn't built to describe in
 * detail.
 */
export async function buildFormContext(
  lead: { id: string; sourceName: string; createdAt: string; enquirySummary: string; priority: string },
): Promise<FormContext> {
  if (lead.sourceName === "Jotform") {
    // A lead can accumulate more than one Jotform submission if the customer
    // re-submits while their enquiry is still open (see ingestEnquiry's
    // existing_open_lead path); the earliest is the original context shown here.
    const result = await query<{ payload: JotformSubmission; submitted_at: string }>(
      `select payload, submitted_at from jotform_submissions
        where lead_id = $1
        order by submitted_at asc
        limit 1`,
      [lead.id],
    );
    const row = result.rows[0];
    if (row) {
      return { source: "Jotform", submittedAt: row.submitted_at, raw: describeJotformSubmission(row.payload) };
    }
  }

  if (lead.sourceName === "Manual Entry") {
    return {
      source: "Manual Entry",
      submittedAt: lead.createdAt,
      raw: { summary: lead.enquirySummary, priority: lead.priority },
    };
  }

  return { source: lead.sourceName, submittedAt: lead.createdAt, raw: { summary: lead.enquirySummary } };
}

export type SalesNextAction =
  | { type: "scheduled"; activity: { id: string; type: string; title: string; scheduledStart: string }; noNextActionReason: null }
  | { type: "closed"; activity: null; noNextActionReason: null }
  | { type: "none_justified"; activity: null; noNextActionReason: string }
  | { type: "none_unresolved"; activity: null; noNextActionReason: null };

/**
 * The single answer to "what is the team actually supposed to do about this
 * lead." The underlying data (next_activity_at, no_next_action_reason, the
 * activity row itself) already existed; this is what was missing — one field a
 * client can render without cross-referencing three others.
 */
export async function buildSalesNextAction(
  lead: { id: string; status: string; noNextActionReason: string | null },
): Promise<SalesNextAction> {
  const upcoming = await query<{ id: string; type: string; title: string; scheduled_start: string }>(
    `select id, type, title, scheduled_start
       from activities
      where lead_id = $1 and status in ('scheduled', 'overdue')
      order by scheduled_start asc
      limit 1`,
    [lead.id],
  );
  if (upcoming.rows[0]) {
    const row = upcoming.rows[0];
    return {
      type: "scheduled",
      activity: { id: row.id, type: row.type, title: row.title, scheduledStart: row.scheduled_start },
      noNextActionReason: null,
    };
  }
  if (["won", "lost"].includes(lead.status)) {
    return { type: "closed", activity: null, noNextActionReason: null };
  }
  if (lead.noNextActionReason) {
    return { type: "none_justified", activity: null, noNextActionReason: lead.noNextActionReason };
  }
  return { type: "none_unresolved", activity: null, noNextActionReason: null };
}
