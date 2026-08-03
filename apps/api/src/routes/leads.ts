import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  closeLeadSchema, createLeadSchema, createNoteSchema, escapeLikePattern,
  normalizeIndianPhone, reopenLeadSchema, setDoNotContactSchema,
  transitionStageSchema, updateCustomerSchema, wonCloseReasons,
} from "@eyeagle/crm-shared";
import { requireActor } from "../auth.js";
import { query, transaction } from "../db.js";
import { buildFormContext, buildSalesNextAction } from "../form-context.js";
import {
  fail, failFromTable, hasCode, paginationSchema, recordAudit, requestId, uuidParam, versionMismatch,
} from "../http.js";

const listFiltersSchema = paginationSchema.extend({
  scope: z.enum(["unclaimed", "mine", "all"]).default("all"),
  q: z.string().trim().max(120).optional(),
  stage: z.string().trim().max(60).optional(),
  includeClosed: z.coerce.boolean().default(false),
});

export async function leadRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/leads", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;

    const filters = listFiltersSchema.parse(request.query);
    const values: unknown[] = [];
    const where: string[] = [];

    if (filters.scope === "unclaimed") where.push("l.status = 'unclaimed'");
    if (filters.scope === "mine") {
      values.push(actor.id);
      where.push(`l.owner_user_id = $${values.length}`);
    }
    if (!filters.includeClosed) where.push("l.status in ('unclaimed', 'active')");
    if (filters.q) {
      // Escaped so a stray % or _ in operator input cannot widen the match.
      values.push(`%${escapeLikePattern(filters.q)}%`);
      where.push(`(
        c.full_name ilike $${values.length} escape '\\'
        or c.normalized_phone like $${values.length} escape '\\'
        or c.email ilike $${values.length} escape '\\'
        or c.city ilike $${values.length} escape '\\'
      )`);
    }
    if (filters.stage) {
      values.push(filters.stage);
      where.push(`s.name = $${values.length}`);
    }
    if (filters.cursor) {
      values.push(filters.cursor);
      where.push(`l.created_at > $${values.length}`);
    }
    values.push(filters.limit + 1);

    const result = await query<{ createdAt: string }>(
      `select l.id, l.priority, l.status, l.enquiry_summary as "summary", l.created_at as "createdAt",
              l.next_activity_at as "nextActivityAt", l.last_contacted_at as "lastContactedAt",
              l.first_contacted_at as "firstContactedAt", l.no_next_action_reason as "noNextActionReason",
              l.close_reason as "closeReason", l.version,
              c.id as "customerId", c.full_name as "customerName", c.primary_phone as phone,
              c.city, c.email, c.do_not_contact as "doNotContact",
              s.id as "stageId", s.name as stage, s.category as "stageCategory",
              u.id as "ownerId", u.name as "ownerName",
              coalesce(src.name, 'Manual Entry') as source
         from leads l
         join customers c on c.id = l.customer_id
         join pipeline_stages s on s.id = l.stage_id
         left join crm_users u on u.id = l.owner_user_id
         left join lead_sources src on src.id = l.source_id
        ${where.length ? `where ${where.join(" and ")}` : ""}
        order by case l.priority
                   when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4
                 end,
                 l.created_at asc
        limit $${values.length}`,
      values,
    );

    const rows = result.rows.slice(0, filters.limit);
    const hasMore = result.rows.length > filters.limit;
    return {
      data: rows,
      page: { hasMore, nextCursor: hasMore ? rows[rows.length - 1]?.createdAt ?? null : null },
    };
  });

  app.post("/api/v1/leads", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;

    const body = createLeadSchema.parse(request.body);
    const phone = normalizeIndianPhone(body.phone);

    /*
     * Families legitimately share a phone number, so a match is not automatically
     * a duplicate. Only an *open* lead blocks outright; a known customer with no
     * open lead is surfaced for the operator to confirm, and their acknowledgement
     * links the new lead to the existing customer record instead of forking it.
     */
    const match = await query<{
      customerId: string; customerName: string; leadId: string | null;
      ownerName: string | null; stage: string | null;
    }>(
      `select c.id as "customerId", c.full_name as "customerName", l.id as "leadId",
              u.name as "ownerName", s.name as stage
         from customers c
         left join leads l on l.customer_id = c.id and l.status in ('unclaimed', 'active')
         left join crm_users u on u.id = l.owner_user_id
         left join pipeline_stages s on s.id = l.stage_id
        where c.normalized_phone = $1
        order by l.created_at desc nulls last
        limit 1`,
      [phone],
    );
    const existing = match.rows[0];

    if (existing?.leadId) {
      return fail(reply, 409, "DUPLICATE_OPEN_LEAD", "This customer already has an open lead.", {
        existing,
      });
    }
    if (existing && body.acknowledgedDuplicateCustomerId !== existing.customerId) {
      return fail(
        reply,
        409,
        "EXISTING_CUSTOMER",
        "This phone number belongs to an existing customer with no open lead. Confirm to add a new enquiry for them.",
        { existing, acknowledgeAs: existing.customerId },
      );
    }

    const created = await transaction(async (client) => {
      let customerId = existing?.customerId;
      if (!customerId) {
        const customer = await client.query<{ id: string }>(
          `insert into customers (full_name, primary_phone, normalized_phone, email, city)
           values ($1, $2, $3, $4, $5) returning id`,
          [body.fullName, body.phone, phone, body.email || null, body.city || null],
        );
        customerId = customer.rows[0].id;
      }

      const lead = await client.query<{ id: string }>(
        `insert into leads (customer_id, owner_user_id, stage_id, source_id, priority,
                            enquiry_summary, status, claimed_at, first_action_due_at, created_by)
         select $1, $2, s.id, src.id, $3, $4, $5,
                case when $2::uuid is null then null else now() end,
                case when $2::uuid is null then null else now() + interval '2 hours' end,
                $6
           from pipeline_stages s, lead_sources src
          where s.name = $7 and src.name = 'Manual Entry'
         returning id`,
        [
          customerId,
          body.assignToSelf ? actor.id : null,
          body.priority,
          body.summary,
          body.assignToSelf ? "active" : "unclaimed",
          actor.id,
          body.assignToSelf ? "Picked Up" : "New Enquiry",
        ],
      );
      if (!lead.rows[0]) throw new Error("Pipeline stage or lead source seed data is missing");

      await recordAudit(client, {
        actorUserId: actor.id,
        action: "lead.created",
        entityType: "lead",
        entityId: lead.rows[0].id,
        metadata: { source: "manual", reusedCustomer: Boolean(existing) },
        requestId: requestId(request),
      });
      return lead.rows[0];
    });

    return reply.code(201).send({ data: created });
  });

  app.get("/api/v1/leads/:id", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);

    const lead = await query<{
      id: string; status: string; priority: string; enquiry_summary: string; created_at: string;
      no_next_action_reason: string | null; source_name: string;
    }>(
      `select l.*, c.full_name, c.primary_phone, c.email, c.city, c.address,
              c.preferred_contact_method, c.preferred_contact_start_time, c.preferred_contact_end_time,
              c.preferred_contact_days, c.contact_notes, c.do_not_contact, c.do_not_contact_reason,
              c.version as customer_version,
              s.name as stage, s.category as stage_category, u.name as owner_name,
              coalesce(src.name, 'Manual Entry') as source_name
         from leads l
         join customers c on c.id = l.customer_id
         join pipeline_stages s on s.id = l.stage_id
         left join crm_users u on u.id = l.owner_user_id
         left join lead_sources src on src.id = l.source_id
        where l.id = $1`,
      [id],
    );
    const row = lead.rows[0];
    if (!row) return fail(reply, 404, "NOT_FOUND", "Lead not found.");

    /*
     * Two things operators previously had to reconstruct themselves: what the
     * customer actually said on intake (enquiry_summary is a paraphrase, not the
     * original answers), and what the team is supposed to do next (scattered
     * across next_activity_at, no_next_action_reason, and the activity table).
     * Only Jotform and Manual Entry get a tailored form context; every other
     * source falls back to a plain summary rather than being unhandled.
     */
    const [formContext, salesNextAction] = await Promise.all([
      buildFormContext({
        id: row.id,
        sourceName: row.source_name,
        createdAt: row.created_at,
        enquirySummary: row.enquiry_summary,
        priority: row.priority,
      }),
      buildSalesNextAction({ id: row.id, status: row.status, noNextActionReason: row.no_next_action_reason }),
    ]);

    /*
     * Audit rows are summarised rather than dumped: the previous version rendered
     * metadata::text straight into the operator timeline, which for website leads
     * meant the entire enquiry payload including personal data. Activity rows now
     * carry outcome and notes, so a completed call shows what happened, not just
     * the word "completed" — work that's done stays visible, not just marked done.
     */
    const timeline = await query(
      `select * from (
         select 'activity' as kind, id, created_at, title as label, status::text as detail,
                outcome::text as outcome, notes as extra
           from activities where lead_id = $1
         union all
         select 'note', id, created_at, note_type, content, null::text, null::text
           from notes where lead_id = $1
         union all
         select 'ownership', id, created_at, event_type, coalesce(reason, ''), null::text, null::text
           from lead_ownership_events where lead_id = $1
         union all
         select 'audit', id, created_at, action, '', null::text, null::text
           from audit_events where entity_type = 'lead' and entity_id = $1
       ) t
       order by created_at desc
       limit $2`,
      [id, 200],
    );

    return { data: { ...row, formContext, salesNextAction, timeline: timeline.rows } };
  });

  app.post("/api/v1/leads/:id/claim", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);

    const result = await transaction(async (client) => {
      const capacity = await client.query<{ max_active_leads: number; active_count: string }>(
        `select u.max_active_leads, count(l.id) as active_count
           from crm_users u
           left join leads l on l.owner_user_id = u.id and l.status = 'active'
          where u.id = $1
          group by u.id`,
        [actor.id],
      );
      if (!capacity.rows[0] || Number(capacity.rows[0].active_count) >= capacity.rows[0].max_active_leads) {
        return { code: "LEAD_LIMIT" as const };
      }

      const updated = await client.query<{ id: string }>(
        `update leads
            set owner_user_id = $1, status = 'active', claimed_at = now(),
                first_action_due_at = now() + interval '2 hours',
                updated_at = now(), version = version + 1,
                stage_id = (select id from pipeline_stages where name = 'Picked Up')
          where id = $2 and status = 'unclaimed' and owner_user_id is null
         returning id`,
        [actor.id, id],
      );
      if (!updated.rowCount) return { code: "ALREADY_CLAIMED" as const };

      await client.query(
        `insert into lead_ownership_events (lead_id, new_owner_user_id, event_type, created_by)
         values ($1, $2, 'claimed', $2)`,
        [id, actor.id],
      );
      await recordAudit(client, {
        actorUserId: actor.id,
        action: "lead.claimed",
        entityType: "lead",
        entityId: id,
        requestId: requestId(request),
      });
      return { data: updated.rows[0] };
    });

    if (hasCode(result)) {
      return fail(
        reply,
        409,
        result.code,
        result.code === "LEAD_LIMIT"
          ? "Your active lead limit has been reached."
          : "This lead was picked up by another team member.",
      );
    }
    return result;
  });

  app.post("/api/v1/leads/:id/release", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(request.body);

    const result = await transaction(async (client) => {
      const lead = await client.query<{ owner_user_id: string; stage_id: string }>(
        "select owner_user_id, stage_id from leads where id = $1 for update",
        [id],
      );
      if (!lead.rows[0] || (lead.rows[0].owner_user_id !== actor.id && actor.role !== "admin")) return null;

      /*
       * The stage is deliberately preserved. Resetting it to 'New Enquiry' made a
       * lead that had already reached, say, Proposal Shared reappear in the queue
       * looking brand new, so the next owner restarted a conversation the customer
       * had already had.
       */
      await client.query(
        `update leads
            set owner_user_id = null, status = 'unclaimed', claimed_at = null,
                first_action_due_at = null, next_activity_at = null,
                no_next_action_reason = null, no_next_action_at = null, no_next_action_by = null,
                version = version + 1, updated_at = now()
          where id = $1`,
        [id],
      );
      await client.query(
        `insert into lead_ownership_events (lead_id, previous_owner_user_id, event_type, reason, created_by)
         values ($1, $2, 'released', $3, $4)`,
        [id, lead.rows[0].owner_user_id, reason, actor.id],
      );
      await recordAudit(client, {
        actorUserId: actor.id,
        action: "lead.released",
        entityType: "lead",
        entityId: id,
        requestId: requestId(request),
      });
      return { id };
    });

    return result
      ? { data: result }
      : fail(reply, 403, "FORBIDDEN", "Only the owner or an admin can release this lead.");
  });

  app.post("/api/v1/leads/:id/transfer", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = z.object({
      newOwnerUserId: z.string().uuid(),
      reason: z.string().trim().min(3).max(500),
      note: z.string().trim().max(2000).optional(),
    }).parse(request.body);

    const result = await transaction(async (client) => {
      const lead = await client.query<{ owner_user_id: string }>(
        "select owner_user_id from leads where id = $1 for update",
        [id],
      );
      if (!lead.rows[0]) return { code: "NOT_FOUND" as const };
      if (lead.rows[0].owner_user_id !== actor.id && actor.role !== "admin") {
        return { code: "FORBIDDEN" as const };
      }

      // The claim path enforces capacity carefully; transfer previously bypassed it
      // entirely and let a bad uuid surface as a foreign-key 500.
      const target = await client.query<{ id: string; max_active_leads: number; active_count: string }>(
        `select u.id, u.max_active_leads, count(l.id) as active_count
           from crm_users u
           left join leads l on l.owner_user_id = u.id and l.status = 'active'
          where u.id = $1 and u.status = 'active'
          group by u.id`,
        [body.newOwnerUserId],
      );
      if (!target.rows[0]) return { code: "INVALID_ASSIGNEE" as const };
      if (Number(target.rows[0].active_count) >= target.rows[0].max_active_leads) {
        return { code: "ASSIGNEE_AT_CAPACITY" as const };
      }

      await client.query(
        `update leads
            set owner_user_id = $1, status = 'active',
                first_action_due_at = now() + interval '2 hours',
                version = version + 1, updated_at = now()
          where id = $2`,
        [body.newOwnerUserId, id],
      );
      await client.query(
        `insert into lead_ownership_events
           (lead_id, previous_owner_user_id, new_owner_user_id, event_type, reason, created_by)
         values ($1, $2, $3, 'transferred', $4, $5)`,
        [id, lead.rows[0].owner_user_id, body.newOwnerUserId, body.reason, actor.id],
      );
      await client.query(
        `insert into notifications (user_id, type, title, body, entity_type, entity_id)
         values ($1, 'lead_transfer', 'Lead transferred to you', $2, 'lead', $3)`,
        [body.newOwnerUserId, body.note || body.reason, id],
      );
      await recordAudit(client, {
        actorUserId: actor.id,
        action: "lead.transferred",
        entityType: "lead",
        entityId: id,
        metadata: { to: body.newOwnerUserId, reason: body.reason },
        requestId: requestId(request),
      });
      return { data: { id } };
    });

    if (hasCode(result)) {
      return failFromTable(reply, result.code, {
        NOT_FOUND: [404, "Lead not found."],
        FORBIDDEN: [403, "Only the owner or an admin can transfer this lead."],
        INVALID_ASSIGNEE: [422, "That team member is not active."],
        ASSIGNEE_AT_CAPACITY: [409, "That team member is already at their active lead limit."],
      });
    }
    return result;
  });

  /** Stage progression had no route at all, so leads could never leave 'Picked Up'. */
  app.post("/api/v1/leads/:id/stage", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = transitionStageSchema.parse(request.body);

    const result = await transaction(async (client) => {
      const lead = await client.query<{ owner_user_id: string; stage_id: string; status: string; version: number }>(
        "select owner_user_id, stage_id, status, version from leads where id = $1 for update",
        [id],
      );
      if (!lead.rows[0]) return { code: "NOT_FOUND" as const };
      if (lead.rows[0].owner_user_id !== actor.id && actor.role !== "admin") return { code: "FORBIDDEN" as const };
      if (versionMismatch(body.expectedVersion, lead.rows[0].version)) return { code: "STALE_VERSION" as const };
      if (!["unclaimed", "active"].includes(lead.rows[0].status)) return { code: "LEAD_CLOSED" as const };

      const stage = await client.query<{ id: string; name: string; category: string }>(
        "select id, name, category from pipeline_stages where id = $1 and is_active",
        [body.stageId],
      );
      if (!stage.rows[0]) return { code: "INVALID_STAGE" as const };
      // Won/Lost are terminal and carry a close reason, so they go through /close.
      if (stage.rows[0].category !== "open") return { code: "USE_CLOSE_ROUTE" as const };

      const updated = await client.query<{ version: number }>(
        `update leads set stage_id = $1, updated_at = now(), version = version + 1
          where id = $2 returning version`,
        [body.stageId, id],
      );
      await recordAudit(client, {
        actorUserId: actor.id,
        action: "lead.stage_changed",
        entityType: "lead",
        entityId: id,
        metadata: { from: lead.rows[0].stage_id, to: body.stageId, reason: body.reason ?? null },
        requestId: requestId(request),
      });
      return { data: { id, stageId: body.stageId, version: updated.rows[0].version } };
    });

    if (hasCode(result)) {
      return failFromTable(reply, result.code, {
        NOT_FOUND: [404, "Lead not found."],
        FORBIDDEN: [403, "Only the owner or an admin can move this lead."],
        STALE_VERSION: [409, "This lead changed while you were editing. Reload and try again."],
        LEAD_CLOSED: [409, "This lead is closed. Reopen it before changing the stage."],
        INVALID_STAGE: [422, "That pipeline stage is not available."],
        USE_CLOSE_ROUTE: [422, "Use the close route to mark a lead won or lost."],
      });
    }
    return result;
  });

  /** Won/lost capture: previously closed_at and close_reason were dead columns. */
  app.post("/api/v1/leads/:id/close", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = closeLeadSchema.parse(request.body);

    const reasonMatchesStatus = body.status === "won"
      ? (wonCloseReasons as readonly string[]).includes(body.closeReason)
      : !(wonCloseReasons as readonly string[]).includes(body.closeReason);
    if (!reasonMatchesStatus) {
      return fail(reply, 422, "REASON_STATUS_MISMATCH", "The close reason does not match the outcome.");
    }

    const result = await transaction(async (client) => {
      const lead = await client.query<{ owner_user_id: string; status: string; version: number }>(
        "select owner_user_id, status, version from leads where id = $1 for update",
        [id],
      );
      if (!lead.rows[0]) return { code: "NOT_FOUND" as const };
      if (lead.rows[0].owner_user_id !== actor.id && actor.role !== "admin") return { code: "FORBIDDEN" as const };
      if (versionMismatch(body.expectedVersion, lead.rows[0].version)) return { code: "STALE_VERSION" as const };
      if (!["unclaimed", "active"].includes(lead.rows[0].status)) return { code: "ALREADY_CLOSED" as const };

      await client.query(
        `update leads
            set status = $1::lead_status, close_reason = $2::lead_close_reason, closed_at = now(),
                stage_id = (select id from pipeline_stages where name = $3),
                next_activity_at = null,
                no_next_action_reason = null, no_next_action_at = null, no_next_action_by = null,
                updated_at = now(), version = version + 1
          where id = $4`,
        [body.status, body.closeReason, body.status === "won" ? "Won" : "Lost", id],
      );
      // Nothing should keep nudging an operator about a closed lead.
      await client.query(
        `update activities set status = 'cancelled', cancelled_at = now(),
                cancellation_reason = 'Lead closed', updated_at = now(), version = version + 1
          where lead_id = $1 and status in ('scheduled', 'overdue')`,
        [id],
      );
      await client.query(
        `update activity_reminders set status = 'cancelled'
          where status in ('pending', 'failed', 'processing')
            and activity_id in (select id from activities where lead_id = $1)`,
        [id],
      );
      if (body.notes) {
        await client.query(
          `insert into notes (lead_id, customer_id, author_user_id, content, note_type)
           select $1, customer_id, $2, $3, 'general' from leads where id = $1`,
          [id, actor.id, body.notes],
        );
      }
      await recordAudit(client, {
        actorUserId: actor.id,
        action: `lead.${body.status}`,
        entityType: "lead",
        entityId: id,
        metadata: { closeReason: body.closeReason },
        requestId: requestId(request),
      });
      return { data: { id, status: body.status } };
    });

    if (hasCode(result)) {
      return failFromTable(reply, result.code, {
        NOT_FOUND: [404, "Lead not found."],
        FORBIDDEN: [403, "Only the owner or an admin can close this lead."],
        STALE_VERSION: [409, "This lead changed while you were editing. Reload and try again."],
        ALREADY_CLOSED: [409, "This lead is already closed."],
      });
    }
    return result;
  });

  app.post("/api/v1/leads/:id/reopen", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = reopenLeadSchema.parse(request.body);

    const result = await transaction(async (client) => {
      const lead = await client.query<{ owner_user_id: string; status: string; version: number }>(
        "select owner_user_id, status, version from leads where id = $1 for update",
        [id],
      );
      if (!lead.rows[0]) return { code: "NOT_FOUND" as const };
      if (!["won", "lost"].includes(lead.rows[0].status)) return { code: "NOT_CLOSED" as const };
      if (versionMismatch(body.expectedVersion, lead.rows[0].version)) return { code: "STALE_VERSION" as const };

      await client.query(
        `update leads
            set status = case when owner_user_id is null then 'unclaimed' else 'active' end::lead_status,
                close_reason = null, closed_at = null,
                stage_id = (select id from pipeline_stages where name = 'Decision Pending'),
                first_action_due_at = case when owner_user_id is null then null else now() + interval '2 hours' end,
                updated_at = now(), version = version + 1
          where id = $1`,
        [id],
      );
      await recordAudit(client, {
        actorUserId: actor.id,
        action: "lead.reopened",
        entityType: "lead",
        entityId: id,
        metadata: { reason: body.reason },
        requestId: requestId(request),
      });
      return { data: { id } };
    });

    if (hasCode(result)) {
      return failFromTable(reply, result.code, {
        NOT_FOUND: [404, "Lead not found."],
        NOT_CLOSED: [409, "This lead is not closed."],
        STALE_VERSION: [409, "This lead changed while you were editing. Reload and try again."],
      });
    }
    return result;
  });

  /** The timeline read from `notes`; nothing could write to it. */
  app.post("/api/v1/leads/:id/notes", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = createNoteSchema.parse(request.body);

    const created = await query<{ id: string }>(
      `insert into notes (lead_id, customer_id, author_user_id, content, note_type)
       select $1, customer_id, $2, $3, $4 from leads where id = $1
       returning id`,
      [id, actor.id, body.content, body.noteType],
    );
    if (!created.rows[0]) return fail(reply, 404, "NOT_FOUND", "Lead not found.");
    return reply.code(201).send({ data: created.rows[0] });
  });

  app.patch("/api/v1/customers/:id", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = updateCustomerSchema.parse(request.body);

    const result = await transaction(async (client) => {
      const current = await client.query<{ version: number }>(
        "select version from customers where id = $1 for update",
        [id],
      );
      if (!current.rows[0]) return { code: "NOT_FOUND" as const };
      if (versionMismatch(body.expectedVersion, current.rows[0].version)) return { code: "STALE_VERSION" as const };

      const updated = await client.query<{ id: string; version: number }>(
        `update customers set
           full_name = coalesce($2, full_name),
           email = coalesce($3, email),
           city = coalesce($4, city),
           address = coalesce($5, address),
           alternate_phone = coalesce($6, alternate_phone),
           preferred_contact_method = coalesce($7, preferred_contact_method),
           preferred_contact_start_time = coalesce($8::time, preferred_contact_start_time),
           preferred_contact_end_time = coalesce($9::time, preferred_contact_end_time),
           preferred_contact_days = coalesce($10::smallint[], preferred_contact_days),
           contact_notes = coalesce($11, contact_notes),
           updated_at = now(), version = version + 1
         where id = $1
         returning id, version`,
        [
          id, body.fullName ?? null, body.email ?? null, body.city ?? null, body.address ?? null,
          body.alternatePhone ?? null, body.preferredContactMethod ?? null,
          body.preferredContactStartTime ?? null, body.preferredContactEndTime ?? null,
          body.preferredContactDays ?? null, body.contactNotes ?? null,
        ],
      );
      await recordAudit(client, {
        actorUserId: actor.id,
        action: "customer.updated",
        entityType: "customer",
        entityId: id,
        metadata: { fields: Object.keys(body).filter((key) => key !== "expectedVersion") },
        requestId: requestId(request),
      });
      return { data: updated.rows[0] };
    });

    if (hasCode(result)) {
      return failFromTable(reply, result.code, {
        NOT_FOUND: [404, "Customer not found."],
        STALE_VERSION: [409, "This customer changed while you were editing. Reload and try again."],
      });
    }
    return result;
  });

  /**
   * do_not_contact blocked scheduling but no route could set it, and nothing
   * recorded who set it or why. That trail is a DPDP requirement, not a nicety.
   */
  app.post("/api/v1/customers/:id/do-not-contact", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = setDoNotContactSchema.parse(request.body);

    const result = await transaction(async (client) => {
      const customer = await client.query<{ id: string }>(
        "select id from customers where id = $1 for update",
        [id],
      );
      if (!customer.rows[0]) return null;

      await client.query(
        `update customers
            set do_not_contact = $2,
                do_not_contact_reason = case when $2 then $3 else null end,
                do_not_contact_at = case when $2 then now() else null end,
                do_not_contact_by = case when $2 then $4::uuid else null end,
                updated_at = now(), version = version + 1
          where id = $1`,
        [id, body.doNotContact, body.reason, actor.id],
      );

      if (body.doNotContact) {
        // Stop every scheduled touch immediately, and park the open leads.
        await client.query(
          `update activities set status = 'cancelled', cancelled_at = now(),
                  cancellation_reason = 'Customer marked do not contact',
                  updated_at = now(), version = version + 1
            where customer_id = $1 and status in ('scheduled', 'overdue')`,
          [id],
        );
        await client.query(
          `update activity_reminders set status = 'cancelled'
            where status in ('pending', 'failed', 'processing')
              and activity_id in (select id from activities where customer_id = $1)`,
          [id],
        );
        await client.query(
          `update leads
              set stage_id = (select id from pipeline_stages where name = 'Do Not Contact'),
                  next_activity_at = null, updated_at = now(), version = version + 1
            where customer_id = $1 and status in ('unclaimed', 'active')`,
          [id],
        );
      }

      await recordAudit(client, {
        actorUserId: actor.id,
        action: body.doNotContact ? "customer.do_not_contact_set" : "customer.do_not_contact_cleared",
        entityType: "customer",
        entityId: id,
        metadata: { reason: body.reason },
        requestId: requestId(request),
      });
      return { id, doNotContact: body.doNotContact };
    });

    return result ? { data: result } : fail(reply, 404, "NOT_FOUND", "Customer not found.");
  });
}
