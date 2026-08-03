import type { PoolClient } from "pg";
import type { FastifyInstance } from "fastify";
import {
  type ActivityType, activityEnd, bufferMinutesFor, type CallingWindow,
  cancelActivitySchema, completeActivitySchema, rescheduleActivitySchema,
  scheduleActivitySchema, withinCallingWindow, withinCustomerPreference,
} from "@eyeagle/crm-shared";
import { requireActor } from "../auth.js";
import { query, transaction } from "../db.js";
import { fail, failFromTable, hasCode, recordAudit, requestId, uuidParam } from "../http.js";

type ScheduleInput = {
  leadId: string;
  type: ActivityType;
  title: string;
  scheduledStart: string;
  durationMinutes: number;
  reminderMinutes: number[];
  notes?: string;
  overrideConflictReason?: string;
  overrideWindowReason?: string;
};

type ScheduleFailure =
  | { code: "NOT_FOUND" }
  | { code: "DO_NOT_CONTACT" }
  | { code: "FORBIDDEN" }
  | { code: "LEAD_CLOSED" }
  | { code: "SCHEDULE_CONFLICT"; conflict: unknown }
  | { code: "OUTSIDE_CALLING_WINDOW"; detail: string };

type ScheduleSuccess = { activityId: string; warnings: string[] };

async function organizationSettings(client: PoolClient) {
  const result = await client.query<{
    calling_windows: CallingWindow[];
    enforce_calling_windows: boolean;
    timezone: string;
  }>("select calling_windows, enforce_calling_windows, timezone from organization_settings limit 1");
  return result.rows[0] ?? { calling_windows: [], enforce_calling_windows: false, timezone: "Asia/Kolkata" };
}

/**
 * Shared by POST /activities and by the follow-up branch of the completion fork,
 * so both paths get identical conflict, consent and calling-window handling.
 */
async function scheduleActivity(
  client: PoolClient,
  actor: { id: string; role: string },
  input: ScheduleInput,
  requestIdentifier: string,
): Promise<ScheduleFailure | ScheduleSuccess> {
  const end = activityEnd(input.scheduledStart, input.durationMinutes);

  const lead = await client.query<{
    customer_id: string; owner_user_id: string | null; status: string;
    do_not_contact: boolean;
    preferred_contact_start_time: string | null;
    preferred_contact_end_time: string | null;
    preferred_contact_days: number[] | null;
  }>(
    `select l.customer_id, l.owner_user_id, l.status, c.do_not_contact,
            c.preferred_contact_start_time, c.preferred_contact_end_time, c.preferred_contact_days
       from leads l
       join customers c on c.id = l.customer_id
      where l.id = $1
      for update of l`,
    [input.leadId],
  );
  if (!lead.rows[0]) return { code: "NOT_FOUND" };
  if (lead.rows[0].do_not_contact) return { code: "DO_NOT_CONTACT" };
  if (!["unclaimed", "active"].includes(lead.rows[0].status)) return { code: "LEAD_CLOSED" };
  if (lead.rows[0].owner_user_id !== actor.id && actor.role !== "admin") return { code: "FORBIDDEN" };

  const assignee = lead.rows[0].owner_user_id ?? actor.id;
  const buffer = bufferMinutesFor(input.type);

  // The buffer now follows the activity type instead of being hardcoded to five
  // minutes, so visits and audits get their travel time.
  const conflict = await client.query(
    `select id, title, scheduled_start, scheduled_end
       from activities
      where assigned_user_id = $1
        and status in ('scheduled', 'overdue')
        and scheduled_start < $3::timestamptz + ($4 || ' minutes')::interval
        and scheduled_end + ($4 || ' minutes')::interval > $2::timestamptz`,
    [assignee, input.scheduledStart, end.toISOString(), String(buffer)],
  );
  if (conflict.rows.length && !(actor.role === "admin" && input.overrideConflictReason)) {
    return { code: "SCHEDULE_CONFLICT", conflict: conflict.rows[0] };
  }

  /*
   * Calling windows and the customer's stated preferred hours were collected in
   * the schema and shown in the UI, but nothing ever checked them. They are soft
   * constraints: the operator can proceed with a recorded reason.
   */
  const warnings: string[] = [];
  const settings = await organizationSettings(client);
  const start = new Date(input.scheduledStart);
  const outsideOrgWindow = settings.enforce_calling_windows
    && !withinCallingWindow(start, settings.calling_windows, settings.timezone);
  const outsideCustomerPreference = !withinCustomerPreference(start, {
    startTime: lead.rows[0].preferred_contact_start_time,
    endTime: lead.rows[0].preferred_contact_end_time,
    days: lead.rows[0].preferred_contact_days,
  }, settings.timezone);

  if (outsideOrgWindow || outsideCustomerPreference) {
    const detail = [
      outsideOrgWindow ? "outside the organisation's calling windows" : null,
      outsideCustomerPreference ? "outside this customer's preferred contact times" : null,
    ].filter(Boolean).join(" and ");
    if (!input.overrideWindowReason) return { code: "OUTSIDE_CALLING_WINDOW", detail };
    warnings.push(`Scheduled ${detail}.`);
  }

  const activity = await client.query<{ id: string }>(
    `insert into activities
       (lead_id, customer_id, assigned_user_id, type, title, scheduled_start, scheduled_end,
        duration_minutes, notes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning id`,
    [
      input.leadId, lead.rows[0].customer_id, assignee, input.type, input.title,
      input.scheduledStart, end.toISOString(), input.durationMinutes, input.notes || null, actor.id,
    ],
  );

  // Reminder fan-out now honours the assignee's channel preferences instead of
  // always sending both in-app and email.
  const channels = await client.query<{ reminder_channels: string[] }>(
    "select reminder_channels from crm_users where id = $1",
    [assignee],
  );
  for (const minutes of input.reminderMinutes) {
    for (const channel of channels.rows[0]?.reminder_channels ?? ["in_app"]) {
      await client.query(
        `insert into activity_reminders (activity_id, reminder_at, channel)
         values ($1, $2::timestamptz - ($3 || ' minutes')::interval, $4)
         on conflict do nothing`,
        [activity.rows[0].id, input.scheduledStart, String(minutes), channel],
      );
    }
  }

  await client.query(
    `update leads
        set next_activity_at = least(coalesce(next_activity_at, $1::timestamptz), $1::timestamptz),
            no_next_action_reason = null, no_next_action_at = null, no_next_action_by = null,
            updated_at = now(), version = version + 1
      where id = $2`,
    [input.scheduledStart, input.leadId],
  );

  await recordAudit(client, {
    actorUserId: actor.id,
    action: "activity.scheduled",
    entityType: "lead",
    entityId: input.leadId,
    metadata: {
      activityId: activity.rows[0].id,
      type: input.type,
      overrodeConflict: Boolean(input.overrideConflictReason),
      // Admin conflict overrides were previously accepted and silently discarded.
      overrideConflictReason: input.overrideConflictReason ?? null,
      overrideWindowReason: input.overrideWindowReason ?? null,
    },
    requestId: requestIdentifier,
  });

  return { activityId: activity.rows[0].id, warnings };
}

function scheduleFailureResponse(failure: ScheduleFailure): [number, string, string, object] {
  switch (failure.code) {
    case "NOT_FOUND":
      return [404, failure.code, "Lead not found.", {}];
    case "DO_NOT_CONTACT":
      return [403, failure.code, "Outreach is blocked for this customer.", {}];
    case "FORBIDDEN":
      return [403, failure.code, "This action is not allowed.", {}];
    case "LEAD_CLOSED":
      return [409, failure.code, "This lead is closed. Reopen it before scheduling.", {}];
    case "SCHEDULE_CONFLICT":
      return [409, failure.code, "This time overlaps another activity.", { conflict: failure.conflict }];
    case "OUTSIDE_CALLING_WINDOW":
      return [
        422,
        failure.code,
        `This time is ${failure.detail}. Provide overrideWindowReason to schedule anyway.`,
        {},
      ];
  }
}

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/activities", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const body = scheduleActivitySchema.parse(request.body);

    const result = await transaction((client) =>
      scheduleActivity(client, actor, body, requestId(request)));

    if ("code" in result) {
      const [status, code, message, extra] = scheduleFailureResponse(result);
      return fail(reply, status, code, message, extra);
    }
    return reply.code(201).send({ data: { id: result.activityId }, warnings: result.warnings });
  });

  /**
   * Completion is the moment the follow-up chain is kept or broken, so the caller
   * must choose: schedule the next action, close the lead, or record why there is
   * no next action. The previous version accepted nextStageId and
   * noNextActionReason and ignored both, which is how leads silently ended up in
   * the "no next action" pile.
   */
  app.post("/api/v1/activities/:id/complete", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = completeActivitySchema.parse(request.body);

    const result = await transaction(async (client) => {
      const activity = await client.query<{ lead_id: string; assigned_user_id: string; status: string }>(
        "select lead_id, assigned_user_id, status from activities where id = $1 for update",
        [id],
      );
      if (!activity.rows[0]) return { code: "NOT_FOUND" as const };
      if (activity.rows[0].assigned_user_id !== actor.id && actor.role !== "admin") {
        return { code: "FORBIDDEN" as const };
      }
      if (!["scheduled", "overdue"].includes(activity.rows[0].status)) {
        return { code: "ALREADY_RESOLVED" as const };
      }
      const leadId = activity.rows[0].lead_id;

      await client.query(
        `update activities
            set status = 'completed', outcome = $1::activity_outcome, notes = $2,
                completed_at = now(), updated_at = now(), version = version + 1
          where id = $3`,
        [body.outcome, body.notes, id],
      );
      await client.query(
        "update activity_reminders set status = 'cancelled' where activity_id = $1 and status in ('pending', 'failed')",
        [id],
      );

      // first_contacted_at makes real first-response time computable; the previous
      // "2.8h average" on the team screen was a hardcoded string.
      const contactMade = ["connected", "interested", "not_interested", "callback_requested", "audit_completed"]
        .includes(body.outcome);
      await client.query(
        `update leads
            set last_contacted_at = now(),
                first_contacted_at = case when $2 then coalesce(first_contacted_at, now()) else first_contacted_at end,
                next_activity_at = (
                  select min(scheduled_start) from activities
                   where lead_id = $1 and status = 'scheduled' and scheduled_start > now()
                ),
                updated_at = now(), version = version + 1
          where id = $1`,
        [leadId, contactMade],
      );

      if (body.nextStageId) {
        const stage = await client.query<{ id: string }>(
          "select id from pipeline_stages where id = $1 and is_active and category = 'open'",
          [body.nextStageId],
        );
        if (!stage.rows[0]) return { code: "INVALID_STAGE" as const };
        await client.query(
          "update leads set stage_id = $1, updated_at = now(), version = version + 1 where id = $2",
          [body.nextStageId, leadId],
        );
      }

      let warnings: string[] = [];

      if (body.next === "schedule") {
        const scheduled = await scheduleActivity(
          client,
          actor,
          { ...body.followUp, leadId },
          requestId(request),
        );
        if ("code" in scheduled) return { code: "FOLLOW_UP_FAILED" as const, failure: scheduled };
        warnings = scheduled.warnings;
      }

      if (body.next === "close") {
        await client.query(
          `update leads
              set status = $1::lead_status, close_reason = $2::lead_close_reason, closed_at = now(),
                  stage_id = (select id from pipeline_stages where name = $3),
                  next_activity_at = null, updated_at = now(), version = version + 1
            where id = $4`,
          [body.closeStatus, body.closeReason, body.closeStatus === "won" ? "Won" : "Lost", leadId],
        );
        await client.query(
          `update activities set status = 'cancelled', cancelled_at = now(),
                  cancellation_reason = 'Lead closed', updated_at = now(), version = version + 1
            where lead_id = $1 and status in ('scheduled', 'overdue')`,
          [leadId],
        );
      }

      if (body.next === "none") {
        await client.query(
          `update leads
              set no_next_action_reason = $2, no_next_action_at = now(), no_next_action_by = $3,
                  updated_at = now(), version = version + 1
            where id = $1`,
          [leadId, body.noNextActionReason, actor.id],
        );
      }

      await recordAudit(client, {
        actorUserId: actor.id,
        action: "activity.completed",
        entityType: "lead",
        entityId: leadId,
        metadata: { activityId: id, outcome: body.outcome, next: body.next },
        requestId: requestId(request),
      });

      return { data: { id, leadId, next: body.next }, warnings };
    });

    if (hasCode(result)) {
      if (result.code === "FOLLOW_UP_FAILED") {
        const [status, code, message, extra] = scheduleFailureResponse(result.failure);
        return fail(reply, status, code, `Follow-up could not be scheduled: ${message}`, extra);
      }
      return failFromTable(reply, result.code, {
        NOT_FOUND: [404, "Activity not found."],
        FORBIDDEN: [403, "This activity cannot be completed by you."],
        ALREADY_RESOLVED: [409, "This activity is already completed or cancelled."],
        INVALID_STAGE: [422, "That pipeline stage is not available."],
      });
    }
    return result;
  });

  /** Rescheduling creates a linked record rather than rewriting schedule history. */
  app.post("/api/v1/activities/:id/reschedule", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = rescheduleActivitySchema.parse(request.body);

    const result = await transaction(async (client) => {
      const activity = await client.query<{
        lead_id: string; assigned_user_id: string; status: string;
        type: ActivityType; title: string; notes: string | null;
      }>(
        "select lead_id, assigned_user_id, status, type, title, notes from activities where id = $1 for update",
        [id],
      );
      if (!activity.rows[0]) return { code: "NOT_FOUND" as const };
      if (activity.rows[0].assigned_user_id !== actor.id && actor.role !== "admin") {
        return { code: "FORBIDDEN" as const };
      }
      if (!["scheduled", "overdue"].includes(activity.rows[0].status)) {
        return { code: "ALREADY_RESOLVED" as const };
      }

      const existingReminders = await client.query<{ minutes: number }>(
        `select round(extract(epoch from (a.scheduled_start - r.reminder_at)) / 60)::int as minutes
           from activity_reminders r join activities a on a.id = r.activity_id
          where r.activity_id = $1
          group by 1`,
        [id],
      );

      await client.query(
        `update activities set status = 'cancelled', cancelled_at = now(),
                cancellation_reason = $2, updated_at = now(), version = version + 1
          where id = $1`,
        [id, body.reason],
      );
      await client.query(
        "update activity_reminders set status = 'cancelled' where activity_id = $1 and status in ('pending', 'failed')",
        [id],
      );

      const scheduled = await scheduleActivity(client, actor, {
        leadId: activity.rows[0].lead_id,
        type: activity.rows[0].type,
        title: activity.rows[0].title,
        scheduledStart: body.scheduledStart,
        durationMinutes: body.durationMinutes,
        reminderMinutes: body.reminderMinutes ?? existingReminders.rows.map((row) => row.minutes),
        notes: activity.rows[0].notes ?? undefined,
        overrideConflictReason: body.overrideConflictReason,
        overrideWindowReason: body.reason,
      }, requestId(request));
      if ("code" in scheduled) return { code: "RESCHEDULE_FAILED" as const, failure: scheduled };

      await client.query(
        "update activities set rescheduled_from_activity_id = $1 where id = $2",
        [id, scheduled.activityId],
      );
      return { data: { id: scheduled.activityId, rescheduledFrom: id }, warnings: scheduled.warnings };
    });

    if (hasCode(result)) {
      if (result.code === "RESCHEDULE_FAILED") {
        const [status, code, message, extra] = scheduleFailureResponse(result.failure);
        return fail(reply, status, code, message, extra);
      }
      return failFromTable(reply, result.code, {
        NOT_FOUND: [404, "Activity not found."],
        FORBIDDEN: [403, "This activity cannot be rescheduled by you."],
        ALREADY_RESOLVED: [409, "This activity is already completed or cancelled."],
      });
    }
    return result;
  });

  app.post("/api/v1/activities/:id/cancel", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const body = cancelActivitySchema.parse(request.body);

    const result = await transaction(async (client) => {
      const activity = await client.query<{ lead_id: string; assigned_user_id: string; status: string }>(
        "select lead_id, assigned_user_id, status from activities where id = $1 for update",
        [id],
      );
      if (!activity.rows[0]) return { code: "NOT_FOUND" as const };
      if (activity.rows[0].assigned_user_id !== actor.id && actor.role !== "admin") {
        return { code: "FORBIDDEN" as const };
      }
      if (!["scheduled", "overdue"].includes(activity.rows[0].status)) {
        return { code: "ALREADY_RESOLVED" as const };
      }

      await client.query(
        `update activities set status = 'cancelled', cancelled_at = now(),
                cancellation_reason = $2, updated_at = now(), version = version + 1
          where id = $1`,
        [id, body.reason],
      );
      await client.query(
        "update activity_reminders set status = 'cancelled' where activity_id = $1 and status in ('pending', 'failed')",
        [id],
      );
      await client.query(
        `update leads
            set next_activity_at = (
                  select min(scheduled_start) from activities
                   where lead_id = $1 and status = 'scheduled' and scheduled_start > now()
                ),
                updated_at = now(), version = version + 1
          where id = $1`,
        [activity.rows[0].lead_id],
      );
      await recordAudit(client, {
        actorUserId: actor.id,
        action: "activity.cancelled",
        entityType: "lead",
        entityId: activity.rows[0].lead_id,
        metadata: { activityId: id, reason: body.reason },
        requestId: requestId(request),
      });
      return { data: { id } };
    });

    if (hasCode(result)) {
      return failFromTable(reply, result.code, {
        NOT_FOUND: [404, "Activity not found."],
        FORBIDDEN: [403, "This activity cannot be cancelled by you."],
        ALREADY_RESOLVED: [409, "This activity is already completed or cancelled."],
      });
    }
    return result;
  });

  app.get("/api/v1/leads/:id/activities", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    const result = await query(
      `select id, type, title, status, outcome, scheduled_start as "scheduledStart",
              scheduled_end as "scheduledEnd", completed_at as "completedAt", notes,
              rescheduled_from_activity_id as "rescheduledFrom"
         from activities where lead_id = $1
        order by scheduled_start desc
        limit 200`,
      [id],
    );
    return { data: result.rows };
  });
}
