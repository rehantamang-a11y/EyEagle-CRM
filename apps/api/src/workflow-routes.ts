import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import {
  auditAppointmentSchema,
  claimOpportunitySchema,
  closeLostSchema,
  followUpSchema,
  interactionSchema,
  mapJotformSubmission,
  markSoldSchema,
  nextWorkingDayAfter,
  normalizeIndianPhone,
  purchaseLinkSchema,
  reopenOpportunitySchema,
  sendPurchaseLinkSchema,
  snoozeOpportunitySchema,
  transferOpportunitySchema,
  updateAuditAppointmentSchema,
  websiteIntakeSchema,
  type JotformFieldMap,
  type JotformSubmission,
} from "@eyeagle/crm-shared";
import { z } from "zod";
import { query, transaction } from "./db.js";

type Actor = { id: string; name: string; role: "team_member" | "admin" };

function actor(request: FastifyRequest, reply: FastifyReply): Actor | undefined {
  const value = request.actor;
  if (!value) void reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
  return value;
}

function admin(request: FastifyRequest, reply: FastifyReply): Actor | undefined {
  const value = actor(request, reply);
  if (value && value.role !== "admin") {
    void reply.code(403).send({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
    return;
  }
  return value;
}

async function ownedOpportunity(client: PoolClient, opportunityId: string, user: Actor) {
  const result = await client.query<{ customer_id: string; owner_user_id: string | null; status: string; do_not_contact: boolean }>(`
    select l.customer_id,l.owner_user_id,l.status,c.do_not_contact
    from leads l join customers c on c.id=l.customer_id
    where l.id=$1 for update`, [opportunityId]);
  const opportunity = result.rows[0];
  if (!opportunity) return { error: "NOT_FOUND" as const };
  if (opportunity.owner_user_id !== user.id && user.role !== "admin") return { error: "FORBIDDEN" as const };
  return { opportunity };
}

async function addActivity(client: PoolClient, input: {
  leadId: string; customerId: string; ownerId: string; actorId: string; type: string; title: string;
  start: string | Date; durationMinutes: number; notes?: string; reminders?: number[];
}) {
  const start = new Date(input.start);
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  const created = await client.query<{ id: string }>(`
    insert into activities(lead_id,customer_id,assigned_user_id,type,title,scheduled_start,scheduled_end,duration_minutes,notes,created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
  [input.leadId, input.customerId, input.ownerId, input.type, input.title, start, end, input.durationMinutes, input.notes || null, input.actorId]);
  for (const minutes of input.reminders ?? [30]) {
    await client.query(`insert into activity_reminders(activity_id,reminder_at,channel)
      values($1,$2::timestamptz-($3||' minutes')::interval,'in_app') on conflict do nothing`, [created.rows[0].id, start, minutes]);
  }
  return { id: created.rows[0].id, start, end };
}

function routeError(reply: FastifyReply, code: string | undefined) {
  code ||= "FORBIDDEN";
  const status = code === "NOT_FOUND" ? 404 : code === "ALREADY_CLAIMED" || code === "LEAD_LIMIT" || code === "HANDOFF_PENDING" ? 409 : 403;
  const message = code === "NOT_FOUND" ? "Opportunity not found."
    : code === "DO_NOT_CONTACT" ? "Outreach is blocked for this customer."
      : code === "ALREADY_CLAIMED" ? "Another team member picked up this enquiry."
        : code === "LEAD_LIMIT" ? "Your active opportunity limit has been reached."
          : code === "HANDOFF_PENDING" ? "Void the pending order handoff before reopening this converted opportunity."
          : "This action is not allowed.";
  return reply.code(status).send({ error: { code, message } });
}

export function registerWorkflowRoutes(app: FastifyInstance) {
  app.get("/api/v1/opportunities", async (request, reply) => {
    const user = actor(request, reply); if (!user) return;
    const filters = z.object({
      view: z.enum(["all", "unclaimed", "mine", "due", "overdue", "no_next_action", "audits", "awaiting_purchase", "snoozed", "handoffs", "closed"]).default("all"),
      q: z.string().trim().optional(),
    }).parse(request.query);
    const values: unknown[] = [];
    const where: string[] = [];
    if (filters.view === "unclaimed") where.push("l.status='unclaimed'");
    if (filters.view === "mine") { values.push(user.id); where.push(`l.owner_user_id=$${values.length}`, "l.status in ('active','snoozed')"); }
    if (filters.view === "due") { values.push(user.id); where.push(`l.owner_user_id=$${values.length}`, "l.next_activity_at::date=(now() at time zone 'Asia/Kolkata')::date", "l.status in ('active','snoozed')"); }
    if (filters.view === "overdue") { values.push(user.id); where.push(`l.owner_user_id=$${values.length}`, "l.next_activity_at<now()", "l.status in ('active','snoozed')"); }
    if (filters.view === "no_next_action") { values.push(user.id); where.push(`l.owner_user_id=$${values.length}`, "l.next_activity_at is null", "l.status='active'"); }
    if (filters.view === "audits") where.push("exists(select 1 from audit_appointments aa where aa.lead_id=l.id and aa.status='scheduled')");
    if (filters.view === "awaiting_purchase") where.push("s.name='Awaiting purchase'");
    if (filters.view === "snoozed") where.push("l.status='snoozed'");
    if (filters.view === "handoffs") where.push("oh.status='awaiting_shopify_link'");
    if (filters.view === "closed") where.push("l.status in ('won','lost','do_not_contact')");
    if (filters.q) { values.push(`%${filters.q}%`); where.push(`(c.full_name ilike $${values.length} or c.normalized_phone like $${values.length} or c.email ilike $${values.length})`); }
    const result = await query(`
      select l.id,l.priority,l.status,l.enquiry_summary as "summary",l.created_at as "createdAt",coalesce(l.submitted_at,l.created_at) as "submittedAt",l.next_activity_at as "nextActionAt",
        l.last_interaction_at as "lastInteractionAt",l.unsuccessful_attempts as "unsuccessfulAttempts",l.snoozed_until as "snoozedUntil",
        l.considering_for as "consideringFor",l.safety_concerns as "safetyConcerns",l.immediate_safety_concern as "immediateSafetyConcern",
        l.expressed_interest as "expressedInterest",l.preferred_contact_day as "preferredContactDay",l.preferred_contact_period as "preferredContactPeriod",
        c.id as "customerId",c.full_name as "customerName",c.primary_phone as phone,c.email,c.city,c.do_not_contact as "doNotContact",
        s.name as stage,u.id as "ownerId",u.name as "ownerName",src.name as source,oh.id as "handoffId",oh.status as "handoffStatus",
        case when l.status='unclaimed' and l.created_at<now()-interval '2 hours' then 'Waiting for pickup'
          when l.next_activity_at<now() then 'Overdue'
          when l.status='active' and l.next_activity_at is null then 'No next action'
          when l.unsuccessful_attempts>=3 then 'Decision needed' end as warning
      from leads l join customers c on c.id=l.customer_id join pipeline_stages s on s.id=l.stage_id
      left join crm_users u on u.id=l.owner_user_id left join lead_sources src on src.id=l.source_id left join order_handoffs oh on oh.lead_id=l.id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by case when l.next_activity_at<now() then 0 when l.status='unclaimed' then 1 else 2 end,
        case l.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,coalesce(l.next_activity_at,l.created_at) limit 300`, values);
    return { data: result.rows };
  });

  app.get("/api/v1/opportunities/:id", async (request, reply) => {
    if (!actor(request, reply)) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const opportunity = await query(`select l.*,c.full_name,c.primary_phone,c.email,c.city,c.address,c.preferred_contact_method,c.contact_notes,c.do_not_contact,
      s.name as stage,u.name as owner_name,src.name as source,oh.id as handoff_id,oh.status as handoff_status
      from leads l join customers c on c.id=l.customer_id join pipeline_stages s on s.id=l.stage_id
      left join crm_users u on u.id=l.owner_user_id left join lead_sources src on src.id=l.source_id left join order_handoffs oh on oh.lead_id=l.id where l.id=$1`, [id]);
    if (!opportunity.rows[0]) return routeError(reply, "NOT_FOUND");
    const timeline = await query(`select * from (
      select 'interaction' kind,i.id,i.created_at,u.name label,concat(i.channel,': ',i.outcome,' — ',i.notes) detail from interactions i join crm_users u on u.id=i.actor_user_id where i.lead_id=$1
      union all select 'activity',id,created_at,title,concat(status,' · ',scheduled_start) from activities where lead_id=$1
      union all select 'purchase_link',opl.id,opl.created_at,pl.name,concat(opl.channel,' · review ',opl.review_at) from opportunity_purchase_links opl join purchase_links pl on pl.id=opl.purchase_link_id where opl.lead_id=$1
      union all select 'audit',aa.id,aa.created_at,'Bathroom audit',concat(aa.status,' · ',aa.scheduled_start,' · ',aa.calendar_sync_status) from audit_appointments aa where aa.lead_id=$1
      union all select 'ownership',id,created_at,event_type,coalesce(reason,'') from lead_ownership_events where lead_id=$1
      union all select 'system',id,created_at,action,metadata::text from audit_events where entity_type='lead' and entity_id=$1
    ) t order by created_at desc`, [id]);
    return { data: { ...opportunity.rows[0], timeline: timeline.rows } };
  });

  app.get("/api/v1/dashboard/sales", async (request, reply) => {
    const user = actor(request, reply); if (!user) return;
    const result = await query(`select
      count(*) filter(where l.status='unclaimed')::int as "waitingForPickup",
      count(*) filter(where l.owner_user_id=$1 and l.status in ('active','snoozed'))::int as "myOpen",
      count(*) filter(where l.owner_user_id=$1 and l.next_activity_at<=now()+interval '1 day' and l.status in ('active','snoozed'))::int as "dueOrOverdue",
      count(*) filter(where exists(select 1 from audit_appointments aa where aa.lead_id=l.id and aa.status='scheduled'))::int as "auditsScheduled",
      count(*) filter(where s.name='Awaiting purchase' and l.status='active')::int as "awaitingPurchase",
      count(*) filter(where oh.status='awaiting_shopify_link')::int as "pendingHandoffs",
      count(*) filter(where l.status='won')::int as converted,
      count(*) filter(where l.status in ('lost','do_not_contact'))::int as "notProceeding"
      from leads l join pipeline_stages s on s.id=l.stage_id left join order_handoffs oh on oh.lead_id=l.id`, [user.id]);
    return { data: result.rows[0] };
  });

  app.post("/api/v1/opportunities/:id/claim", async (request, reply) => {
    const user = actor(request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    claimOpportunitySchema.parse(request.body);
    const result = await transaction(async (client) => {
      const capacity = await client.query<{ max_active_leads: number; active_count: string }>(`select u.max_active_leads,count(l.id) active_count from crm_users u left join leads l on l.owner_user_id=u.id and l.status in ('active','snoozed') where u.id=$1 group by u.id`, [user.id]);
      if (!capacity.rows[0] || Number(capacity.rows[0].active_count) >= capacity.rows[0].max_active_leads) return { error: "LEAD_LIMIT" };
      const updated = await client.query<{ id: string }>(`update leads set owner_user_id=$1,status='active',claimed_at=now(),first_action_due_at=null,next_activity_at=null,stage_id=(select id from pipeline_stages where name='Contacting'),updated_at=now(),version=version+1 where id=$2 and status='unclaimed' and owner_user_id is null returning id`, [user.id, id]);
      if (!updated.rowCount) return { error: "ALREADY_CLAIMED" };
      await client.query(`insert into lead_ownership_events(lead_id,new_owner_user_id,event_type,created_by) values($1,$2,'claimed',$2)`, [id, user.id]);
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'opportunity.claimed','lead',$2,$3)`, [user.id, id, JSON.stringify({ nextActionCreated: false })]);
      return { data: { id, nextActionAt: null } };
    });
    if ("error" in result) return routeError(reply, result.error);
    return result;
  });

  app.post("/api/v1/opportunities/:id/interactions", async (request, reply) => {
    const user = actor(request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = interactionSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      if (owned.opportunity.do_not_contact && body.nextStep.type !== "do_not_contact") return { error: "DO_NOT_CONTACT" };
      const storedOutcome = body.contactResult === "reached" ? "connected" : body.contactResult;
      const interaction = await client.query<{ id: string }>(`insert into interactions(lead_id,customer_id,actor_user_id,channel,outcome,notes) values($1,$2,$3,$4,$5,$6) returning id`, [id, owned.opportunity.customer_id, user.id, body.channel, storedOutcome, body.notes]);
      await client.query(`update leads set last_interaction_at=now(),last_contacted_at=case when $2='no_answer' then last_contacted_at else now() end,
        unsuccessful_attempts=case when $2='no_answer' then unsuccessful_attempts+1 else 0 end,updated_at=now(),version=version+1 where id=$1`, [id, storedOutcome]);
      const next = body.nextStep;
      let nextActionAt: Date | null = null;
      let auditId: string | undefined;
      let handoffId: string | undefined;
      if (next.type === "schedule_follow_up" || next.type === "confirm_audit_date") {
        const activity = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: "call", title: next.type === "confirm_audit_date" ? "Confirm audit date" : next.title, start: next.scheduledStart, durationMinutes: 15, notes: body.notes });
        nextActionAt = activity.start;
        await client.query(`update leads set status='active',snoozed_until=null,next_activity_at=$1,stage_id=(select id from pipeline_stages where name='Contacting'),updated_at=now(),version=version+1 where id=$2`, [activity.start, id]);
      } else if (next.type === "confirm_audit") {
        const start = new Date(next.scheduledStart); const end = new Date(start.getTime() + next.durationMinutes * 60_000); const followUp = nextWorkingDayAfter(end);
        const followUpActivity = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: "call", title: "Post-audit follow-up", start: followUp, durationMinutes: 15, notes: "Review audit outcome and agree the next step.", reminders: [30] });
        const appointment = await client.query<{ id: string }>(`insert into audit_appointments(lead_id,customer_id,owner_user_id,scheduled_start,scheduled_end,address,context,google_event_id,post_audit_activity_id,created_by,customer_confirmed_at,customer_confirmed_by)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$10) returning id`, [id, owned.opportunity.customer_id, owned.opportunity.owner_user_id || user.id, start, end, next.address, next.context || null, `eyeagle${crypto.randomUUID().replaceAll("-", "")}`, followUpActivity.id, user.id]);
        auditId = appointment.rows[0].id; nextActionAt = start;
        await client.query(`insert into jobs(type,payload) values('calendar.audit.upsert',$1)`, [JSON.stringify({ auditId })]);
        await client.query(`update leads set status='active',stage_id=(select id from pipeline_stages where name='Audit scheduled'),next_activity_at=$1,updated_at=now(),version=version+1 where id=$2`, [start, id]);
      } else if (next.type === "send_purchase_link") {
        const link = await client.query(`select id from purchase_links where id=$1 and is_active`, [next.purchaseLinkId]); if (!link.rows[0]) return { error: "NOT_FOUND" };
        await client.query(`insert into opportunity_purchase_links(lead_id,purchase_link_id,sent_by,channel,review_at,note) values($1,$2,$3,$4,$5,$6)`, [id, next.purchaseLinkId, user.id, next.channel, next.reviewAt, body.notes]);
        const activity = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: "call", title: "Purchase review", start: next.reviewAt, durationMinutes: 15, notes: body.notes });
        nextActionAt = activity.start;
        await client.query(`update leads set status='active',stage_id=(select id from pipeline_stages where name='Awaiting purchase'),next_activity_at=$1,updated_at=now(),version=version+1 where id=$2`, [activity.start, id]);
      } else if (next.type === "snooze") {
        const activity = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: "general_task", title: "Snooze review", start: next.reviewAt, durationMinutes: 15, notes: next.reason });
        nextActionAt = activity.start;
        await client.query(`update leads set status='snoozed',stage_id=(select id from pipeline_stages where name='Snoozed'),snoozed_until=$1,next_activity_at=$1,updated_at=now(),version=version+1 where id=$2`, [activity.start, id]);
      } else if (next.type === "not_proceeding" || next.type === "do_not_contact") {
        const dnc = next.type === "do_not_contact"; const status = dnc ? "do_not_contact" : "lost"; const stage = dnc ? "Do not contact" : "Not proceeding";
        await client.query(`update activities set status='cancelled',cancelled_at=now(),cancellation_reason='Opportunity closed',updated_at=now() where lead_id=$1 and status in ('scheduled','overdue')`, [id]);
        await client.query(`update leads set status=$1,stage_id=(select id from pipeline_stages where name=$2),close_reason=$3,closed_at=now(),next_activity_at=null,snoozed_until=null,updated_at=now(),version=version+1 where id=$4`, [status, stage, next.reason, id]);
        if (dnc) await client.query(`update customers set do_not_contact=true,contact_notes=concat_ws(E'\n',contact_notes,$1),updated_at=now(),version=version+1 where id=$2`, [next.note || "Do not contact requested", owned.opportunity.customer_id]);
      } else if (next.type === "mark_sold") {
        await client.query(`update activities set status='cancelled',cancelled_at=now(),cancellation_reason='Opportunity converted',updated_at=now() where lead_id=$1 and status in ('scheduled','overdue')`, [id]);
        await client.query(`update leads set status='won',stage_id=(select id from pipeline_stages where name='Converted'),closed_at=now(),next_activity_at=null,snoozed_until=null,updated_at=now(),version=version+1 where id=$1`, [id]);
        const handoff = await client.query<{ id: string }>(`insert into order_handoffs(lead_id,customer_id,sales_confirmation_note,created_by) values($1,$2,$3,$4) on conflict(lead_id) do update set status='awaiting_shopify_link',sales_confirmation_note=excluded.sales_confirmation_note,updated_at=now() returning id`, [id, owned.opportunity.customer_id, next.confirmationNote, user.id]);
        handoffId = handoff.rows[0].id;
      } else {
        const normalized = normalizeIndianPhone(next.phone);
        await client.query(`update customers set primary_phone=$1,normalized_phone=$2,updated_at=now(),version=version+1 where id=$3`, [next.phone, normalized, owned.opportunity.customer_id]);
        const activity = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: "call", title: "Retry updated number", start: next.scheduledStart, durationMinutes: 15, notes: body.notes });
        nextActionAt = activity.start;
        await client.query(`update leads set status='active',stage_id=(select id from pipeline_stages where name='Contacting'),next_activity_at=$1,updated_at=now(),version=version+1 where id=$2`, [activity.start, id]);
      }
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'interaction.logged','lead',$2,$3)`, [user.id, id, JSON.stringify({ interactionId: interaction.rows[0].id, channel: body.channel, contactResult: body.contactResult, nextStep: next.type, auditId, handoffId })]);
      return { data: { id: interaction.rows[0].id, nextActionAt: nextActionAt?.toISOString(), auditId, handoffId } };
    });
    if ("error" in result) return routeError(reply, result.error);
    return reply.code(201).send(result);
  });

  app.post("/api/v1/opportunities/:id/follow-ups", async (request, reply) => {
    const user = actor(request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = followUpSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      if (owned.opportunity.do_not_contact) return { error: "DO_NOT_CONTACT" };
      const activity = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: body.type, title: body.title, start: body.scheduledStart, durationMinutes: body.durationMinutes, notes: body.notes });
      await client.query(`update leads set status='active',snoozed_until=null,next_activity_at=$1,stage_id=case when status='snoozed' then (select id from pipeline_stages where name='Contacting') else stage_id end,updated_at=now(),version=version+1 where id=$2`, [activity.start, id]);
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'follow_up.scheduled','lead',$2,$3)`, [user.id, id, JSON.stringify({ activityId: activity.id })]);
      return { data: { id: activity.id } };
    });
    if ("error" in result) return routeError(reply, result.error);
    return reply.code(201).send(result);
  });

  app.post("/api/v1/opportunities/:id/audits", async (request, reply) => {
    const user = actor(request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = auditAppointmentSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      if (owned.opportunity.do_not_contact) return { error: "DO_NOT_CONTACT" };
      const start = new Date(body.scheduledStart); const end = new Date(start.getTime() + body.durationMinutes * 60_000); const followUp = nextWorkingDayAfter(end);
      const activity = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: "call", title: "Post-audit follow-up", start: followUp, durationMinutes: 15, notes: "Review audit outcome and agree the next step.", reminders: [30] });
      const appointment = await client.query<{ id: string }>(`insert into audit_appointments(lead_id,customer_id,owner_user_id,scheduled_start,scheduled_end,address,context,google_event_id,post_audit_activity_id,created_by,customer_confirmed_at,customer_confirmed_by)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$10) returning id`, [id, owned.opportunity.customer_id, owned.opportunity.owner_user_id || user.id, start, end, body.address, body.context || null, `eyeagle${crypto.randomUUID().replaceAll("-", "")}`, activity.id, user.id]);
      await client.query(`insert into jobs(type,payload) values('calendar.audit.upsert',$1)`, [JSON.stringify({ auditId: appointment.rows[0].id })]);
      await client.query(`update leads set status='active',stage_id=(select id from pipeline_stages where name='Audit scheduled'),next_activity_at=$1,updated_at=now(),version=version+1 where id=$2`, [start, id]);
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'audit.scheduled','lead',$2,$3)`, [user.id, id, JSON.stringify({ auditId: appointment.rows[0].id, postAuditActivityId: activity.id })]);
      return { data: { id: appointment.rows[0].id, calendarSyncStatus: "pending", postAuditFollowUpAt: followUp.toISOString() } };
    });
    if ("error" in result) return routeError(reply, result.error);
    return reply.code(201).send(result);
  });

  app.patch("/api/v1/opportunities/:id/audits/:auditId", async (request, reply) => {
    const user = actor(request, reply); if (!user) return;
    const { id, auditId } = z.object({ id: z.string().uuid(), auditId: z.string().uuid() }).parse(request.params); const body = updateAuditAppointmentSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      const audit = await client.query<{ post_audit_activity_id: string; owner_user_id: string }>(`select post_audit_activity_id,owner_user_id from audit_appointments where id=$1 and lead_id=$2 for update`, [auditId, id]);
      if (!audit.rows[0]) return { error: "NOT_FOUND" };
      await client.query(`update jobs set status='cancelled' where type in ('calendar.audit.upsert','calendar.audit.cancel') and payload->>'auditId'=$1 and status in ('pending','failed')`, [auditId]);
      if (body.action === "reschedule") {
        const start = new Date(body.scheduledStart); const end = new Date(start.getTime() + body.durationMinutes * 60_000); const followUp = nextWorkingDayAfter(end);
        await client.query(`update audit_appointments set scheduled_start=$1,scheduled_end=$2,customer_confirmed_at=now(),customer_confirmed_by=$3,calendar_sync_status='pending',calendar_error=null,updated_at=now(),version=version+1 where id=$4`, [start, end, user.id, auditId]);
        await client.query(`update activities set scheduled_start=$1,scheduled_end=$1::timestamptz+interval '15 minutes',status='scheduled',updated_at=now(),version=version+1 where id=$2`, [followUp, audit.rows[0].post_audit_activity_id]);
        await client.query(`insert into jobs(type,payload) values('calendar.audit.upsert',$1)`, [JSON.stringify({ auditId })]);
        await client.query(`update leads set next_activity_at=$1,updated_at=now(),version=version+1 where id=$2`, [start, id]);
      } else {
        await client.query(`update audit_appointments set status='cancelled',calendar_sync_status='pending',updated_at=now(),version=version+1 where id=$1`, [auditId]);
        await client.query(`update activities set status='cancelled',cancelled_at=now(),cancellation_reason=$1,updated_at=now() where id=$2`, [body.reason, audit.rows[0].post_audit_activity_id]);
        const next = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: audit.rows[0].owner_user_id, actorId: user.id, type: "general_task", title: "Choose next step after cancelled audit", start: body.nextActionAt, durationMinutes: 15, notes: body.reason });
        await client.query(`insert into jobs(type,payload) values('calendar.audit.cancel',$1)`, [JSON.stringify({ auditId })]);
        await client.query(`update leads set stage_id=(select id from pipeline_stages where name='Contacting'),next_activity_at=$1,updated_at=now(),version=version+1 where id=$2`, [next.start, id]);
      }
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,'lead',$3,$4)`, [user.id, `audit.${body.action}`, id, JSON.stringify({ auditId, reason: body.reason })]);
      return { data: { id: auditId, calendarSyncStatus: "pending" } };
    });
    if ("error" in result) return routeError(reply, result.error);
    return result;
  });

  app.get("/api/v1/purchase-links", async (request, reply) => {
    if (!actor(request, reply)) return; const filters = z.object({ includeDisabled: z.coerce.boolean().default(false) }).parse(request.query);
    const result = await query(`select id,name,url,description,is_active as "isActive",created_at as "createdAt" from purchase_links ${filters.includeDisabled ? "" : "where is_active"} order by name`);
    return { data: result.rows };
  });

  app.post("/api/v1/purchase-links", async (request, reply) => {
    const user = admin(request, reply); if (!user) return; const body = purchaseLinkSchema.parse(request.body);
    const result = await query(`insert into purchase_links(name,url,description,created_by) values($1,$2,$3,$4) returning id,name,url,description,is_active as "isActive"`, [body.name, body.url, body.description || null, user.id]);
    return reply.code(201).send({ data: result.rows[0] });
  });

  app.patch("/api/v1/purchase-links/:id", async (request, reply) => {
    const user = admin(request, reply); if (!user) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = z.object({ isActive: z.boolean() }).parse(request.body);
    const result = await query(`update purchase_links set is_active=$1,updated_at=now() where id=$2 returning id,is_active as "isActive"`, [body.isActive, id]);
    if (!result.rows[0]) return routeError(reply, "NOT_FOUND"); return { data: result.rows[0] };
  });

  app.post("/api/v1/opportunities/:id/purchase-links", async (request, reply) => {
    const user = actor(request, reply); if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = sendPurchaseLinkSchema.parse(request.body);
    const result = await transaction(async (client) => {
      const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      if (owned.opportunity.do_not_contact) return { error: "DO_NOT_CONTACT" };
      const link = await client.query(`select id from purchase_links where id=$1 and is_active`, [body.purchaseLinkId]); if (!link.rows[0]) return { error: "NOT_FOUND" };
      const sent = await client.query<{ id: string }>(`insert into opportunity_purchase_links(lead_id,purchase_link_id,sent_by,channel,review_at,note) values($1,$2,$3,$4,$5,$6) returning id`, [id, body.purchaseLinkId, user.id, body.channel, body.reviewAt, body.note || null]);
      const review = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: "call", title: "Purchase review", start: body.reviewAt, durationMinutes: 15, notes: body.note });
      await client.query(`update leads set status='active',stage_id=(select id from pipeline_stages where name='Awaiting purchase'),next_activity_at=$1,updated_at=now(),version=version+1 where id=$2`, [review.start, id]);
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'purchase_link.sent','lead',$2,$3)`, [user.id, id, JSON.stringify({ sentId: sent.rows[0].id, purchaseLinkId: body.purchaseLinkId, channel: body.channel })]);
      return { data: sent.rows[0] };
    });
    if ("error" in result) return routeError(reply, result.error); return reply.code(201).send(result);
  });

  app.post("/api/v1/opportunities/:id/snooze", async (request, reply) => {
    const user = actor(request, reply); if (!user) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = snoozeOpportunitySchema.parse(request.body);
    const result = await transaction(async (client) => { const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      const activity = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: "general_task", title: "Snooze review", start: body.reviewAt, durationMinutes: 15, notes: body.reason });
      await client.query(`update leads set status='snoozed',stage_id=(select id from pipeline_stages where name='Snoozed'),snoozed_until=$1,next_activity_at=$1,updated_at=now(),version=version+1 where id=$2`, [activity.start, id]);
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'opportunity.snoozed','lead',$2,$3)`, [user.id, id, JSON.stringify({ reason: body.reason, reviewAt: body.reviewAt })]); return { data: { id } }; });
    if ("error" in result) return routeError(reply, result.error); return result;
  });

  app.post("/api/v1/opportunities/:id/close-lost", async (request, reply) => {
    const user = actor(request, reply); if (!user) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = closeLostSchema.parse(request.body);
    const result = await transaction(async (client) => { const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      const status = body.doNotContact ? "do_not_contact" : "lost"; const stage = body.doNotContact ? "Do not contact" : "Not proceeding";
      await client.query(`update activities set status='cancelled',cancelled_at=now(),cancellation_reason='Opportunity closed',updated_at=now() where lead_id=$1 and status in ('scheduled','overdue')`, [id]);
      await client.query(`update leads set status=$1,stage_id=(select id from pipeline_stages where name=$2),close_reason=$3,closed_at=now(),next_activity_at=null,snoozed_until=null,updated_at=now(),version=version+1 where id=$4`, [status, stage, body.reason, id]);
      if (body.doNotContact) await client.query(`update customers set do_not_contact=true,contact_notes=concat_ws(E'\n',contact_notes,$1),updated_at=now(),version=version+1 where id=$2`, [body.note || "Do not contact requested", owned.opportunity.customer_id]);
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'opportunity.closed_lost','lead',$2,$3)`, [user.id, id, JSON.stringify(body)]); return { data: { id, status } }; });
    if ("error" in result) return routeError(reply, result.error); return result;
  });

  app.post("/api/v1/opportunities/:id/mark-sold", async (request, reply) => {
    const user = actor(request, reply); if (!user) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = markSoldSchema.parse(request.body);
    const result = await transaction(async (client) => { const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      await client.query(`update activities set status='cancelled',cancelled_at=now(),cancellation_reason='Opportunity converted',updated_at=now() where lead_id=$1 and status in ('scheduled','overdue')`, [id]);
      await client.query(`update leads set status='won',stage_id=(select id from pipeline_stages where name='Converted'),close_reason=null,closed_at=now(),next_activity_at=null,snoozed_until=null,updated_at=now(),version=version+1 where id=$1`, [id]);
      const handoff = await client.query<{ id: string }>(`insert into order_handoffs(lead_id,customer_id,sales_confirmation_note,created_by) values($1,$2,$3,$4)
        on conflict(lead_id) do update set status='awaiting_shopify_link',sales_confirmation_note=excluded.sales_confirmation_note,shopify_order_id=null,shopify_order_url=null,linked_at=null,voided_at=null,void_reason=null,created_by=excluded.created_by,updated_at=now() returning id`, [id, owned.opportunity.customer_id, body.confirmationNote, user.id]);
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'opportunity.converted','lead',$2,$3)`, [user.id, id, JSON.stringify({ handoffId: handoff.rows[0].id, paymentConfirmed: false })]); return { data: { id, handoffId: handoff.rows[0].id, handoffStatus: "awaiting_shopify_link" } }; });
    if ("error" in result) return routeError(reply, result.error); return result;
  });

  app.post("/api/v1/opportunities/:id/reopen", async (request, reply) => {
    const user = admin(request, reply); if (!user) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = reopenOpportunitySchema.parse(request.body);
    const result = await transaction(async (client) => { const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      if (!['lost','do_not_contact','won'].includes(owned.opportunity.status)) return { error: "FORBIDDEN" };
      if (owned.opportunity.status === "won") { const pending = await client.query(`select id from order_handoffs where lead_id=$1 and status='awaiting_shopify_link'`, [id]); if (pending.rows[0]) return { error: "HANDOFF_PENDING" }; }
      const activity = await addActivity(client, { leadId: id, customerId: owned.opportunity.customer_id, ownerId: owned.opportunity.owner_user_id || user.id, actorId: user.id, type: "general_task", title: "Reopened opportunity review", start: body.nextActionAt, durationMinutes: 15, notes: body.reason });
      await client.query(`update leads set status='active',stage_id=(select id from pipeline_stages where name='Contacting'),closed_at=null,close_reason=null,next_activity_at=$1,snoozed_until=null,updated_at=now(),version=version+1 where id=$2`, [activity.start, id]);
      if (owned.opportunity.status === "do_not_contact") await client.query(`update customers set do_not_contact=false,updated_at=now(),version=version+1 where id=$1`, [owned.opportunity.customer_id]);
      await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'opportunity.reopened','lead',$2,$3)`, [user.id, id, JSON.stringify({ reason: body.reason })]); return { data: { id } }; });
    if ("error" in result) return routeError(reply, result.error); return result;
  });

  app.post("/api/v1/opportunities/:id/transfer", async (request, reply) => {
    const user = actor(request, reply); if (!user) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = transferOpportunitySchema.parse(request.body);
    const result = await transaction(async (client) => { const owned = await ownedOpportunity(client, id, user); if ("error" in owned) return owned;
      const assignee = await client.query(`select id from crm_users where id=$1 and status='active'`, [body.newOwnerUserId]); if (!assignee.rows[0]) return { error: "NOT_FOUND" };
      await client.query(`update leads set owner_user_id=$1,updated_at=now(),version=version+1 where id=$2`, [body.newOwnerUserId, id]);
      await client.query(`update activities set assigned_user_id=$1,updated_at=now(),version=version+1 where lead_id=$2 and status in ('scheduled','overdue')`, [body.newOwnerUserId, id]);
      await client.query(`update audit_appointments set owner_user_id=$1,updated_at=now(),version=version+1 where lead_id=$2 and status='scheduled'`, [body.newOwnerUserId, id]);
      await client.query(`insert into lead_ownership_events(lead_id,previous_owner_user_id,new_owner_user_id,event_type,reason,created_by) values($1,$2,$3,'transferred',$4,$5)`, [id, owned.opportunity.owner_user_id, body.newOwnerUserId, body.reason, user.id]);
      await client.query(`insert into notifications(user_id,type,title,body,entity_type,entity_id) values($1,'opportunity_transfer','Opportunity transferred to you',$2,'lead',$3)`, [body.newOwnerUserId, body.note || body.reason, id]); return { data: { id } }; });
    if ("error" in result) return routeError(reply, result.error); return result;
  });

  app.get("/api/v1/order-handoffs", async (request, reply) => {
    if (!actor(request, reply)) return; const result = await query(`select oh.id,oh.status,oh.sales_confirmation_note as "salesConfirmationNote",oh.shopify_order_id as "shopifyOrderId",oh.shopify_order_url as "shopifyOrderUrl",oh.created_at as "createdAt",l.id as "opportunityId",c.full_name as "customerName",c.primary_phone as phone,u.name as "salesOwner" from order_handoffs oh join leads l on l.id=oh.lead_id join customers c on c.id=oh.customer_id left join crm_users u on u.id=l.owner_user_id order by case oh.status when 'awaiting_shopify_link' then 0 else 1 end,oh.created_at`); return { data: result.rows };
  });

  app.patch("/api/v1/order-handoffs/:id/link", async (request, reply) => {
    const user = admin(request, reply); if (!user) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = z.object({ shopifyOrderId: z.string().min(1), shopifyOrderUrl: z.string().url().optional() }).parse(request.body);
    const result = await query(`update order_handoffs set status='linked',shopify_order_id=$1,shopify_order_url=$2,linked_at=now(),updated_at=now() where id=$3 and status='awaiting_shopify_link' returning id,status`, [body.shopifyOrderId, body.shopifyOrderUrl || null, id]); if (!result.rows[0]) return routeError(reply, "NOT_FOUND"); return { data: result.rows[0] };
  });

  app.post("/api/v1/order-handoffs/:id/void", async (request, reply) => {
    const user = admin(request, reply); if (!user) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = z.object({ reason: z.string().min(2) }).parse(request.body);
    const result = await transaction(async (client) => { const handoff = await client.query<{ lead_id: string }>(`update order_handoffs set status='voided',voided_at=now(),void_reason=$1,updated_at=now() where id=$2 and status='awaiting_shopify_link' returning lead_id`, [body.reason, id]); if (!handoff.rows[0]) return null; await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'order_handoff.voided','lead',$2,$3)`, [user.id, handoff.rows[0].lead_id, JSON.stringify({ handoffId: id, reason: body.reason })]); return { id, opportunityId: handoff.rows[0].lead_id }; });
    return result ? { data: result } : routeError(reply, "NOT_FOUND");
  });

  app.post("/api/v1/integrations/jotform/sync", async (request, reply) => {
    const user = actor(request, reply); if (!user) return;
    const { includeExisting } = z.object({ includeExisting: z.boolean().default(true) }).parse(request.body ?? {});
    const apiKey = process.env.JOTFORM_API_KEY; const formId = process.env.JOTFORM_FORM_ID;
    if (!apiKey || !formId || !process.env.JOTFORM_FIELD_MAP_JSON) return reply.code(503).send({ error: { code: "INTEGRATION_NOT_CONFIGURED", message: "Jotform sync is not configured." } });
    let fieldMap: JotformFieldMap;
    const fieldReference = z.union([z.string(), z.array(z.string()).min(1)]);
    try { fieldMap = z.object({
      fullName: z.string(), phone: z.string(), email: z.string().optional(), city: z.string().optional(), summary: fieldReference.optional(), preferredContactTime: fieldReference.optional(),
      consideringFor: z.string().optional(), safetyConcerns: z.string().optional(), immediateSafetyConcern: z.string().optional(), expressedInterest: z.string().optional(), requestedNextStep: z.string().optional(), preferredContactDay: z.string().optional(), preferredContactPeriod: z.string().optional(),
    }).parse(JSON.parse(process.env.JOTFORM_FIELD_MAP_JSON)); }
    catch { return reply.code(503).send({ error: { code: "INVALID_CONFIGURATION", message: "Jotform field mapping is invalid." } }); }
    const state = await query<{ sync_from: Date; last_success_at: Date | null }>(`insert into integration_sync_state(provider,external_resource_id,sync_from,last_attempt_at) values('jotform',$1,$2,now()) on conflict(provider,external_resource_id) do update set last_attempt_at=now(),updated_at=now() returning sync_from,last_success_at`, [formId, process.env.JOTFORM_SYNC_FROM || new Date().toISOString()]);
    const base = process.env.JOTFORM_API_BASE_URL || "https://api.jotform.com";
    const submissions: JotformSubmission[] = [];
    const seenSubmissionIds = new Set<string>();
    const pageSize = 1_000;
    try {
      for (let offset = 0; ; offset += pageSize) {
        const response = await fetch(`${base}/form/${encodeURIComponent(formId)}/submissions?limit=${pageSize}&offset=${offset}&orderby=created_at`, { headers: { APIKEY: apiKey } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { content?: JotformSubmission[] };
        const page = payload.content || [];
        const fresh = page.filter((submission) => !seenSubmissionIds.has(submission.id));
        fresh.forEach((submission) => seenSubmissionIds.add(submission.id));
        submissions.push(...fresh);
        if (page.length < pageSize || fresh.length === 0) break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      await query(`update integration_sync_state set last_error=$1,updated_at=now() where provider='jotform' and external_resource_id=$2`, [message.slice(0, 1000), formId]);
      return reply.code(502).send({ error: { code: "JOTFORM_UNAVAILABLE", message: "Jotform could not be refreshed. Existing CRM data is unchanged." } });
    }
    const since = state.rows[0].last_success_at || state.rows[0].sync_from; let imported = 0; let repeated = 0; let issues = 0; let skipped = 0;
    for (const submission of submissions) {
      if (!includeExisting && new Date(submission.created_at) < new Date(since.getTime() - 10 * 60_000)) { skipped += 1; continue; }
      const externalId = `${formId}:${submission.id}`; const mapped = mapJotformSubmission(submission, fieldMap);
      let intake: z.infer<typeof websiteIntakeSchema>;
      try { intake = websiteIntakeSchema.parse(mapped); }
      catch (error) { issues += 1; await query(`insert into import_issues(provider,external_id,issue_code,message,payload) values('jotform',$1,'invalid_submission',$2,$3) on conflict(provider,external_id,issue_code) do nothing`, [externalId, error instanceof Error ? error.message : "Invalid submission", JSON.stringify(mapped)]); continue; }
      const outcome = await transaction(async (client) => {
        const prior = await client.query(`select id from website_intake_submissions where idempotency_key=$1`, [`jotform:${externalId}`]); if (prior.rows[0]) return "existing";
        const phone = normalizeIndianPhone(intake.phone);
        const candidates = await client.query<{ id: string; full_name: string; email: string | null; do_not_contact: boolean }>(`select id,full_name,email,do_not_contact from customers where normalized_phone=$1 order by created_at`, [phone]);
        const exact = candidates.rows.filter((candidate) => candidate.full_name.toLowerCase() === intake.fullName.toLowerCase() || (intake.email && candidate.email?.toLowerCase() === intake.email.toLowerCase()));
        if (candidates.rows.length && exact.length !== 1) { await client.query(`insert into import_issues(provider,external_id,issue_code,message,payload) values('jotform',$1,'customer_match_review','A shared phone number needs admin review.',$2) on conflict(provider,external_id,issue_code) do nothing`, [externalId, JSON.stringify(mapped)]); return "issue"; }
        let customerId = exact[0]?.id;
        if (exact[0]?.do_not_contact) { await client.query(`insert into import_issues(provider,external_id,issue_code,message,payload) values('jotform',$1,'do_not_contact_review','A do-not-contact customer submitted a new enquiry.',$2) on conflict(provider,external_id,issue_code) do nothing`, [externalId, JSON.stringify(mapped)]); return "issue"; }
        if (!customerId) { const customer = await client.query<{ id: string }>(`insert into customers(full_name,primary_phone,normalized_phone,email,city,contact_notes) values($1,$2,$3,$4,$5,$6) returning id`, [intake.fullName, intake.phone, phone, intake.email || null, intake.city || null, intake.preferredContactTime ? `Preferred contact time: ${intake.preferredContactTime}` : null]); customerId = customer.rows[0].id; }
        const open = await client.query<{ id: string; owner_user_id: string | null }>(`select id,owner_user_id from leads where customer_id=$1 and status in ('unclaimed','active','snoozed') order by created_at desc limit 1`, [customerId]);
        let opportunityId = open.rows[0]?.id; let result = "repeat_enquiry";
        if (opportunityId) { await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'jotform.repeat_enquiry','lead',$2,$3)`, [user.id, opportunityId, JSON.stringify({ externalId, summary: intake.summary })]); if (open.rows[0].owner_user_id) await client.query(`insert into notifications(user_id,type,title,body,entity_type,entity_id) values($1,'repeat_enquiry','Repeat Jotform enquiry',$2,'lead',$3)`, [open.rows[0].owner_user_id, intake.summary, opportunityId]); }
        else { const created = await client.query<{ id: string }>(`insert into leads(customer_id,stage_id,source_id,priority,enquiry_summary,status,created_by,considering_for,safety_concerns,immediate_safety_concern,expressed_interest,preferred_contact_day,preferred_contact_period,submitted_at)
          select $1,s.id,src.id,$2,$3,'unclaimed',$4,$5,$6,$7,$8,$9,$10,$11 from pipeline_stages s,lead_sources src where s.name='New enquiry' and src.name='Jotform' returning id`,
        [customerId, intake.priority, intake.summary, user.id, intake.consideringFor || [], intake.safetyConcerns || [], intake.immediateSafetyConcern || false, intake.expressedInterest || intake.requestedNextStep || null, intake.preferredContactDay || null, intake.preferredContactPeriod || null, intake.submittedAt || new Date()]); opportunityId = created.rows[0].id; result = "created_opportunity"; }
        await client.query(`insert into website_intake_submissions(idempotency_key,payload,result,customer_id,lead_id) values($1,$2,$3,$4,$5)`, [`jotform:${externalId}`, JSON.stringify(mapped), result, customerId, opportunityId]); return result;
      });
      if (outcome === "created_opportunity") imported += 1; else if (outcome === "repeat_enquiry") repeated += 1; else if (outcome === "issue") issues += 1;
    }
    const completedAt = new Date(); await query(`update integration_sync_state set last_success_at=$1,last_error=null,updated_at=now() where provider='jotform' and external_resource_id=$2`, [completedAt, formId]);
    await query(`insert into audit_events(actor_user_id,action,entity_type,metadata) values($1,'jotform.sync_completed','integration',$2)`, [user.id, JSON.stringify({ formId, includeExisting, scanned: submissions.length, imported, repeated, issues, skipped })]);
    return { data: { includeExisting, scanned: submissions.length, imported, repeated, issues, skipped, lastSyncedAt: completedAt.toISOString() } };
  });
}
