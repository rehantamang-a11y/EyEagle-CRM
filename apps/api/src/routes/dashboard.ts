import type { FastifyInstance } from "fastify";
import { CRM_TIMEZONE } from "@eyeagle/crm-shared";
import { requireActor, requireAdmin } from "../auth.js";
import { query } from "../db.js";
import { uuidParam } from "../http.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/dashboard/today", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;

    /*
     * `scheduled_start::date` casts using the database server's TimeZone, which is
     * UTC on every managed Postgres — so anything between midnight and 05:30 IST
     * landed on the wrong day. The cast is now explicitly in the CRM timezone.
     */
    const activities = await query(
      `select a.id, a.title, a.type, a.status,
              a.scheduled_start as "scheduledStart", a.scheduled_end as "scheduledEnd",
              c.full_name as "customerName", c.primary_phone as phone,
              l.id as "leadId", s.name as stage
         from activities a
         join leads l on l.id = a.lead_id
         join customers c on c.id = a.customer_id
         join pipeline_stages s on s.id = l.stage_id
        where a.assigned_user_id = $1
          and a.status in ('scheduled', 'overdue')
          and (
            (a.scheduled_start at time zone $2)::date = (now() at time zone $2)::date
            or a.scheduled_end < now()
          )
        order by a.scheduled_start`,
      [actor.id, CRM_TIMEZONE],
    );

    const counts = await query(
      `select
         count(*) filter (where status = 'unclaimed')::int as unclaimed,
         count(*) filter (
           where owner_user_id = $1 and status = 'active'
             and next_activity_at is null and no_next_action_reason is null
         )::int as "noNextAction",
         count(*) filter (
           where owner_user_id = $1 and status = 'active'
             and next_activity_at is null and no_next_action_reason is not null
         )::int as "noNextActionJustified"
       from leads`,
      [actor.id],
    );

    return { data: { activities: activities.rows, counts: counts.rows[0] } };
  });

  app.get("/api/v1/dashboard/team", async (request, reply) => {
    const actor = requireAdmin(request, reply);
    if (!actor) return;

    // The team screen displayed overdue, due-today and average first response as
    // hardcoded strings; all three are computed here instead.
    const members = await query(
      `select u.id, u.name, u.role, u.max_active_leads as "maxActiveLeads",
              count(l.id) filter (where l.status = 'active')::int as "activeLeads",
              count(l.id) filter (
                where l.status = 'active' and l.next_activity_at is null and l.no_next_action_reason is null
              )::int as "noNextAction",
              (select count(*) from activities a
                where a.assigned_user_id = u.id and a.status = 'overdue')::int as overdue,
              (select count(*) from activities a
                where a.assigned_user_id = u.id and a.status = 'scheduled'
                  and (a.scheduled_start at time zone $1)::date = (now() at time zone $1)::date)::int as "dueToday"
         from crm_users u
         left join leads l on l.owner_user_id = u.id
        where u.status = 'active'
        group by u.id
        order by u.name`,
      [CRM_TIMEZONE],
    );

    const responseTime = await query<{ medianMinutes: number | null; averageMinutes: number | null }>(
      `select
         percentile_cont(0.5) within group (
           order by extract(epoch from (first_contacted_at - created_at)) / 60
         )::int as "medianMinutes",
         avg(extract(epoch from (first_contacted_at - created_at)) / 60)::int as "averageMinutes"
       from leads
      where first_contacted_at is not null and created_at > now() - interval '7 days'`,
    );

    const backlog = await query<{ unclaimed: number; oldestUnclaimedMinutes: number | null }>(
      `select count(*)::int as unclaimed,
              (extract(epoch from (now() - min(created_at))) / 60)::int as "oldestUnclaimedMinutes"
         from leads where status = 'unclaimed'`,
    );

    return {
      data: {
        members: members.rows,
        firstResponse: responseTime.rows[0],
        backlog: backlog.rows[0],
      },
    };
  });

  app.get("/api/v1/pipeline", async (request, reply) => {
    if (!requireActor(request, reply)) return;
    const result = await query<{ leads: unknown[] | null }>(
      `select s.id, s.name, s.order_index as "order", s.category,
              json_agg(
                json_build_object(
                  'id', l.id, 'customerName', c.full_name, 'ownerName', u.name,
                  'priority', l.priority, 'nextActivityAt', l.next_activity_at,
                  'noNextActionReason', l.no_next_action_reason, 'status', l.status
                ) order by l.updated_at desc
              ) filter (where l.id is not null) as leads
         from pipeline_stages s
         left join leads l on l.stage_id = s.id and l.status in ('unclaimed', 'active')
         left join customers c on c.id = l.customer_id
         left join crm_users u on u.id = l.owner_user_id
        where s.is_active
        group by s.id
        order by s.order_index`,
    );
    return { data: result.rows.map((row) => ({ ...row, leads: row.leads ?? [] })) };
  });

  app.get("/api/v1/notifications", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const result = await query(
      `select id, type, title, body, entity_type as "entityType", entity_id as "entityId",
              status, created_at as "createdAt", read_at as "readAt"
         from notifications where user_id = $1
        order by created_at desc limit 100`,
      [actor.id],
    );
    const unread = await query<{ count: number }>(
      "select count(*)::int as count from notifications where user_id = $1 and status = 'unread'",
      [actor.id],
    );
    return { data: result.rows, unreadCount: unread.rows[0].count };
  });

  app.patch("/api/v1/notifications/:id/read", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const { id } = uuidParam.parse(request.params);
    await query(
      "update notifications set status = 'read', read_at = now() where id = $1 and user_id = $2",
      [id, actor.id],
    );
    return reply.code(204).send();
  });

  app.post("/api/v1/notifications/read-all", async (request, reply) => {
    const actor = requireActor(request, reply);
    if (!actor) return;
    const result = await query(
      "update notifications set status = 'read', read_at = now() where user_id = $1 and status = 'unread'",
      [actor.id],
    );
    return { data: { updated: result.rowCount ?? 0 } };
  });

  app.get("/api/v1/pipeline-stages", async (request, reply) => {
    if (!requireActor(request, reply)) return;
    const result = await query(
      `select id, name, order_index as "order", category
         from pipeline_stages where is_active order by order_index`,
    );
    return { data: result.rows };
  });

  app.get("/api/v1/team", async (request, reply) => {
    if (!requireActor(request, reply)) return;
    const result = await query(
      "select id, name, email, role from crm_users where status = 'active' order by name",
    );
    return { data: result.rows };
  });
}
