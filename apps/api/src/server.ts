import crypto from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rawBody from "fastify-raw-body";
import {
  activityEnd, completeActivitySchema, createLeadSchema, normalizeIndianPhone,
  scheduleActivitySchema, websiteIntakeSchema,
} from "@eyeagle/crm-shared";
import { z } from "zod";
import { pool, query, transaction } from "./db.js";
import { encryptSecret, validWebhookSignature } from "./security.js";
import { registerWorkflowRoutes } from "./workflow-routes.js";
import { registerMinimalCrmRoutes } from "./minimal-crm-routes.js";

type Actor = { id: string; externalUserId: string; name: string; email: string; role: "team_member" | "admin" };
declare module "fastify" { interface FastifyRequest { actor?: Actor } }

const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.headers.cookie", "body.password"] } });
await app.register(cookie, { secret: process.env.SESSION_SECRET });
await app.register(cors, { origin: process.env.WEB_ORIGIN?.split(",") ?? [], credentials: true });
await app.register(rawBody, { field: "rawBody", global: false, encoding: "utf8", runFirst: true });

app.addHook("onRequest", async (request) => {
  if (!request.url.startsWith("/api/v1") || request.url.includes("/auth/") || request.url.includes("/intake/website") || request.url.endsWith("/health")) return;
  const sessionId = request.cookies.crm_session;
  if (!sessionId) return;
  const result = await query<Actor & { status: string }>(`
    select u.id, u.external_user_id as "externalUserId", u.name, u.email, u.role, u.status
    from crm_sessions s join crm_users u on u.id=s.user_id
    where s.id=$1 and s.revoked_at is null and s.expires_at > now()`, [sessionId]);
  if (result.rows[0]?.status === "active") request.actor = result.rows[0];
});

function requireActor(request: FastifyRequest, reply: FastifyReply): Actor | undefined {
  if (!request.actor) { void reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }); return; }
  return request.actor;
}
function requireAdmin(request: FastifyRequest, reply: FastifyReply): Actor | undefined {
  const actor = requireActor(request, reply);
  if (actor && actor.role !== "admin") { void reply.code(403).send({ error: { code: "FORBIDDEN", message: "Admin access is required." } }); return; }
  return actor;
}
function setSessionCookie(reply: FastifyReply, id: string) {
  reply.setCookie("crm_session", id, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", signed: false, maxAge: 60 * 60 * 24 * 30 });
}

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "request failed");
  if (error instanceof z.ZodError) return reply.code(422).send({ error: { code: "VALIDATION_ERROR", message: "Some fields need attention.", fields: error.flatten().fieldErrors } });
  if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: { code: "CONFLICT", message: "That record already exists." } });
  return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } });
});

app.get("/api/v1/health", async () => ({ status: "ok", service: "eyeagle-crm-api", now: new Date().toISOString() }));

app.post("/api/v1/auth/login", async (request, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(request.body);
  let identity: { id: string; name: string; email: string; role?: string }; let accessToken: string; let refreshToken = "";
  if (process.env.ALLOW_DEMO_AUTH === "true" && body.email.endsWith("@eyeagle.in")) {
    identity = { id: `demo:${body.email}`, name: body.email.startsWith("admin") ? "Rey Tamang" : "Asha Mehta", email: body.email, role: body.email.startsWith("admin") ? "admin" : "team_member" };
    accessToken = `demo-${crypto.randomUUID()}`;
  } else {
    const response = await fetch(`${process.env.EYEAGLE_AUTH_BASE_URL}${process.env.EYEAGLE_AUTH_LOGIN_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Email or password was not accepted." } });
    const payload = await response.json() as Record<string, any>;
    const session = payload.data?.session ?? payload.session ?? payload.data ?? payload;
    identity = session.user ?? session.operator ?? payload.user;
    accessToken = session.accessToken ?? session.access_token ?? session.token;
    refreshToken = session.refreshToken ?? session.refresh_token ?? "";
    if (!identity?.id || !accessToken) throw new Error("Identity response is missing user or access token");
  }
  const session = await transaction(async (client) => {
    const user = await client.query<Actor>(`insert into crm_users(external_user_id,name,email,role) values($1,$2,$3,$4)
      on conflict(external_user_id) do update set name=excluded.name,email=excluded.email,updated_at=now(),version=crm_users.version+1
      returning id,external_user_id as "externalUserId",name,email,role`, [identity.id, identity.name, identity.email.toLowerCase(), identity.role === "admin" ? "admin" : "team_member"]);
    const created = await client.query<{ id: string }>(`insert into crm_sessions(user_id,upstream_access_token_ciphertext,upstream_refresh_token_ciphertext,expires_at)
      values($1,$2,$3,now()+interval '30 days') returning id`, [user.rows[0].id, encryptSecret(accessToken), refreshToken ? encryptSecret(refreshToken) : null]);
    return { user: user.rows[0], id: created.rows[0].id };
  });
  setSessionCookie(reply, session.id);
  return { user: session.user };
});

app.post("/api/v1/auth/verify", async (_request, reply) => reply.code(501).send({ error: { code: "AUTH_CONTRACT_PENDING", message: "Configure the Eyeagle verification contract before production." } }));
app.get("/api/v1/auth/session", async (request, reply) => request.actor ? { user: request.actor } : reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "No active session." } }));
app.post("/api/v1/auth/logout", async (request, reply) => { if (request.cookies.crm_session) await query("update crm_sessions set revoked_at=now() where id=$1", [request.cookies.crm_session]); reply.clearCookie("crm_session", { path: "/" }); return reply.code(204).send(); });

app.get("/api/v1/leads", async (request, reply) => {
  const actor = requireActor(request, reply); if (!actor) return;
  const filters = z.object({ scope: z.enum(["unclaimed","mine","all"]).default("all"), q: z.string().optional(), stage: z.string().optional() }).parse(request.query);
  const values: unknown[] = []; const where: string[] = [];
  if (filters.scope === "unclaimed") where.push("l.status='unclaimed'");
  if (filters.scope === "mine") { values.push(actor.id); where.push(`l.owner_user_id=$${values.length}`); }
  if (filters.q) { values.push(`%${filters.q}%`); where.push(`(c.full_name ilike $${values.length} or c.normalized_phone like $${values.length} or c.email ilike $${values.length} or c.city ilike $${values.length})`); }
  if (filters.stage) { values.push(filters.stage); where.push(`s.name=$${values.length}`); }
  const result = await query(`select l.id,l.priority,l.status,l.enquiry_summary as "summary",l.created_at as "createdAt",l.next_activity_at as "nextActivityAt",l.last_contacted_at as "lastContactedAt",l.version,
    c.id as "customerId",c.full_name as "customerName",c.primary_phone as phone,c.city,c.email,c.do_not_contact as "doNotContact",
    s.id as "stageId",s.name as stage,u.id as "ownerId",u.name as "ownerName",coalesce(src.name,'Manual Entry') as source
    from leads l join customers c on c.id=l.customer_id join pipeline_stages s on s.id=l.stage_id left join crm_users u on u.id=l.owner_user_id left join lead_sources src on src.id=l.source_id
    ${where.length ? `where ${where.join(" and ")}` : ""}
    order by case l.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,l.created_at asc limit 250`, values);
  return { data: result.rows };
});

registerWorkflowRoutes(app);
registerMinimalCrmRoutes(app);

app.post("/api/v1/leads", async (request, reply) => {
  const actor = requireActor(request, reply); if (!actor) return;
  const body = createLeadSchema.parse(request.body); const phone = normalizeIndianPhone(body.phone);
  const duplicate = await query(`select c.id,c.full_name,l.id as lead_id,u.name as owner_name,s.name as stage from customers c left join leads l on l.customer_id=c.id and l.status in ('unclaimed','active') left join crm_users u on u.id=l.owner_user_id left join pipeline_stages s on s.id=l.stage_id where c.normalized_phone=$1 limit 1`, [phone]);
  if (duplicate.rows.length) return reply.code(409).send({ error: { code: "DUPLICATE_PHONE", message: "An existing customer uses this phone number.", existing: duplicate.rows[0] } });
  const created = await transaction(async (client) => {
    const customer = await client.query<{id:string}>(`insert into customers(full_name,primary_phone,normalized_phone,email,city) values($1,$2,$3,$4,$5) returning id`, [body.fullName, body.phone, phone, body.email || null, body.city || null]);
    const lead = await client.query(`insert into leads(customer_id,owner_user_id,stage_id,source_id,priority,enquiry_summary,status,claimed_at,first_action_due_at,created_by)
      select $1,$2,s.id,src.id,$3,$4,$5,case when $2::uuid is null then null else now() end,case when $2::uuid is null then null else now()+interval '2 hours' end,$6 from pipeline_stages s,lead_sources src where s.name=$7 and src.name='Manual Entry' returning id`, [customer.rows[0].id, body.assignToSelf ? actor.id : null, body.priority, body.summary, body.assignToSelf ? "active" : "unclaimed", actor.id, body.assignToSelf ? "Contacting" : "New enquiry"]);
    await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'lead.created','lead',$2,$3)`, [actor.id, lead.rows[0].id, JSON.stringify({ source: "manual" })]);
    return lead.rows[0];
  });
  return reply.code(201).send({ data: created });
});

app.get("/api/v1/leads/:id", async (request, reply) => {
  const actor = requireActor(request, reply); if (!actor) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const lead = await query(`select l.*,c.full_name,c.primary_phone,c.email,c.city,c.address,c.preferred_contact_method,c.contact_notes,c.do_not_contact,s.name as stage,u.name as owner_name from leads l join customers c on c.id=l.customer_id join pipeline_stages s on s.id=l.stage_id left join crm_users u on u.id=l.owner_user_id where l.id=$1`, [id]);
  if (!lead.rows[0]) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Lead not found." } });
  const timeline = await query(`select * from (
    select 'activity' as kind,id,created_at,title as label,status::text as detail from activities where lead_id=$1
    union all select 'note',id,created_at,'Note',content from notes where lead_id=$1
    union all select 'ownership',id,created_at,event_type,coalesce(reason,'') from lead_ownership_events where lead_id=$1
    union all select 'audit',id,created_at,action,metadata::text from audit_events where entity_type='lead' and entity_id=$1
  ) t order by created_at desc`, [id]);
  return { data: { ...lead.rows[0], timeline: timeline.rows } };
});

app.post("/api/v1/leads/:id/claim", async (request, reply) => {
  const actor = requireActor(request, reply); if (!actor) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const result = await transaction(async (client) => {
    const capacity = await client.query<{max_active_leads:number;active_count:string}>(`select u.max_active_leads,count(l.id) as active_count from crm_users u left join leads l on l.owner_user_id=u.id and l.status='active' where u.id=$1 group by u.id`, [actor.id]);
    if (!capacity.rows[0] || Number(capacity.rows[0].active_count) >= capacity.rows[0].max_active_leads) return { code: "LEAD_LIMIT" };
    const updated = await client.query(`update leads set owner_user_id=$1,status='active',claimed_at=now(),first_action_due_at=now()+interval '2 hours',updated_at=now(),version=version+1,stage_id=(select id from pipeline_stages where name='Contacting') where id=$2 and status='unclaimed' and owner_user_id is null returning id`, [actor.id, id]);
    if (!updated.rowCount) return { code: "ALREADY_CLAIMED" };
    await client.query(`insert into lead_ownership_events(lead_id,new_owner_user_id,event_type,created_by) values($1,$2,'claimed',$2)`, [id, actor.id]);
    await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id) values($1,'lead.claimed','lead',$2)`, [actor.id,id]);
    return { data: updated.rows[0] };
  });
  if ("code" in result) return reply.code(409).send({ error: { code: result.code, message: result.code === "LEAD_LIMIT" ? "Your active lead limit has been reached." : "This lead was picked up by another team member." } });
  return result;
});

app.post("/api/v1/leads/:id/release", async (request, reply) => {
  const actor = requireActor(request, reply); if (!actor) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const { reason } = z.object({ reason: z.string().min(3) }).parse(request.body);
  const result = await transaction(async (client) => {
    const lead = await client.query<{owner_user_id:string}>("select owner_user_id from leads where id=$1 for update",[id]);
    if (!lead.rows[0] || (lead.rows[0].owner_user_id !== actor.id && actor.role !== "admin")) return null;
    await client.query(`update leads set owner_user_id=null,status='unclaimed',claimed_at=null,first_action_due_at=null,next_activity_at=null,stage_id=(select id from pipeline_stages where name='New enquiry'),version=version+1,updated_at=now() where id=$1`,[id]);
    await client.query(`insert into lead_ownership_events(lead_id,previous_owner_user_id,event_type,reason,created_by) values($1,$2,'released',$3,$4)`,[id,lead.rows[0].owner_user_id,reason,actor.id]); return { id };
  });
  return result ? { data: result } : reply.code(403).send({ error: { code: "FORBIDDEN", message: "Only the owner or an admin can release this lead." } });
});

app.post("/api/v1/leads/:id/transfer", async (request, reply) => {
  const actor = requireActor(request, reply); if (!actor) return; const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = z.object({ newOwnerUserId: z.string().uuid(), reason: z.string().min(3), note: z.string().optional() }).parse(request.body);
  const result = await transaction(async (client) => { const lead = await client.query<{owner_user_id:string}>("select owner_user_id from leads where id=$1 for update",[id]); if (!lead.rows[0] || (lead.rows[0].owner_user_id !== actor.id && actor.role !== "admin")) return null; await client.query("update leads set owner_user_id=$1,version=version+1,updated_at=now() where id=$2",[body.newOwnerUserId,id]); await client.query(`insert into lead_ownership_events(lead_id,previous_owner_user_id,new_owner_user_id,event_type,reason,created_by) values($1,$2,$3,'transferred',$4,$5)`,[id,lead.rows[0].owner_user_id,body.newOwnerUserId,body.reason,actor.id]); await client.query(`insert into notifications(user_id,type,title,body,entity_type,entity_id) values($1,'lead_transfer','Lead transferred to you',$2,'lead',$3)`,[body.newOwnerUserId,body.note || body.reason,id]); return { id }; });
  return result ? { data: result } : reply.code(403).send({ error: { code: "FORBIDDEN", message: "Only the owner or an admin can transfer this lead." } });
});

app.post("/api/v1/activities", async (request, reply) => {
  const actor = requireActor(request, reply); if (!actor) return; const body = scheduleActivitySchema.parse(request.body); const end = activityEnd(body.scheduledStart,body.durationMinutes);
  const created = await transaction(async (client) => {
    const lead = await client.query<{customer_id:string;owner_user_id:string;do_not_contact:boolean}>(`select l.customer_id,l.owner_user_id,c.do_not_contact from leads l join customers c on c.id=l.customer_id where l.id=$1 for update`,[body.leadId]);
    if (!lead.rows[0]) return { error: "NOT_FOUND" }; if (lead.rows[0].do_not_contact) return { error: "DO_NOT_CONTACT" }; if (lead.rows[0].owner_user_id !== actor.id && actor.role !== "admin") return { error: "FORBIDDEN" };
    const conflict = await client.query(`select id,title,scheduled_start,scheduled_end from activities where assigned_user_id=$1 and status in ('scheduled','overdue') and scheduled_start < $3::timestamptz + interval '5 minutes' and scheduled_end + interval '5 minutes' > $2`,[lead.rows[0].owner_user_id,body.scheduledStart,end.toISOString()]);
    if (conflict.rows.length && !(actor.role === "admin" && body.overrideConflictReason)) return { error: "SCHEDULE_CONFLICT", conflict: conflict.rows[0] };
    const activity = await client.query<{id:string}>(`insert into activities(lead_id,customer_id,assigned_user_id,type,title,scheduled_start,scheduled_end,duration_minutes,notes,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,[body.leadId,lead.rows[0].customer_id,lead.rows[0].owner_user_id,body.type,body.title,body.scheduledStart,end.toISOString(),body.durationMinutes,body.notes || null,actor.id]);
    for (const minutes of body.reminderMinutes) for (const channel of ["in_app","email"]) await client.query(`insert into activity_reminders(activity_id,reminder_at,channel) values($1,$2::timestamptz-($3||' minutes')::interval,$4) on conflict do nothing`,[activity.rows[0].id,body.scheduledStart,minutes,channel]);
    await client.query("update leads set next_activity_at=$1,updated_at=now(),version=version+1 where id=$2",[body.scheduledStart,body.leadId]);
    await client.query(`insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata) values($1,'activity.scheduled','lead',$2,$3)`,[actor.id,body.leadId,JSON.stringify({ activityId:activity.rows[0].id })]); return { data: activity.rows[0] };
  });
  if ("error" in created) return reply.code(created.error === "NOT_FOUND" ? 404 : created.error === "SCHEDULE_CONFLICT" ? 409 : 403).send({ error: { code: created.error, message: created.error === "SCHEDULE_CONFLICT" ? "This time overlaps another activity." : created.error === "DO_NOT_CONTACT" ? "Outreach is blocked for this customer." : "This action is not allowed.", conflict: created.conflict } });
  return reply.code(201).send(created);
});

app.post("/api/v1/activities/:id/complete", async (request, reply) => {
  const actor = requireActor(request, reply); if (!actor) return; const { id } = z.object({ id:z.string().uuid() }).parse(request.params); const body = completeActivitySchema.parse(request.body);
  const updated = await transaction(async (client) => { const activity = await client.query<{lead_id:string;assigned_user_id:string}>("select lead_id,assigned_user_id from activities where id=$1 for update",[id]); if (!activity.rows[0] || (activity.rows[0].assigned_user_id !== actor.id && actor.role !== "admin")) return null; await client.query("update activities set status='completed',outcome=$1,notes=$2,completed_at=now(),updated_at=now(),version=version+1 where id=$3",[body.outcome,body.notes,id]); await client.query("update activity_reminders set status='cancelled' where activity_id=$1 and status in ('pending','failed')",[id]); await client.query("update leads set last_contacted_at=now(),next_activity_at=(select min(scheduled_start) from activities where lead_id=$1 and status='scheduled' and scheduled_start>now()),updated_at=now(),version=version+1 where id=$1",[activity.rows[0].lead_id]); return { id }; });
  return updated ? { data: updated } : reply.code(403).send({ error: { code:"FORBIDDEN",message:"This activity cannot be completed by you." } });
});

app.get("/api/v1/dashboard/today", async (request, reply) => { const actor=requireActor(request,reply); if(!actor)return; const activities=await query(`select a.id,a.title,a.type,a.status,a.scheduled_start as "scheduledStart",a.scheduled_end as "scheduledEnd",c.full_name as "customerName",c.primary_phone as phone,l.id as "leadId",s.name as stage from activities a join leads l on l.id=a.lead_id join customers c on c.id=a.customer_id join pipeline_stages s on s.id=l.stage_id where a.assigned_user_id=$1 and a.status in ('scheduled','overdue') and (a.scheduled_start::date=(now() at time zone 'Asia/Kolkata')::date or a.scheduled_end<now()) order by a.scheduled_start`,[actor.id]); const counts=await query(`select count(*) filter(where status='unclaimed')::int as unclaimed,count(*) filter(where owner_user_id=$1 and status='active' and next_activity_at is null)::int as "noNextAction" from leads`,[actor.id]); return {data:{activities:activities.rows,counts:counts.rows[0]}}; });
app.get("/api/v1/dashboard/team", async (request, reply) => { const actor=requireAdmin(request,reply);if(!actor)return; const result=await query(`select u.id,u.name,count(l.id) filter(where l.status='active')::int as "activeLeads",count(l.id) filter(where l.status='active' and l.next_activity_at is null)::int as "noNextAction" from crm_users u left join leads l on l.owner_user_id=u.id where u.status='active' group by u.id order by u.name`); return {data:result.rows}; });
app.get("/api/v1/pipeline", async (request,reply)=>{if(!requireActor(request,reply))return;const result=await query(`select s.id,s.name,s.order_index as "order",json_agg(json_build_object('id',l.id,'customerName',c.full_name,'ownerName',u.name,'priority',l.priority,'nextActivityAt',l.next_activity_at,'status',l.status) order by l.updated_at desc) filter(where l.id is not null) as leads from pipeline_stages s left join leads l on l.stage_id=s.id and l.status<>'archived' left join customers c on c.id=l.customer_id left join crm_users u on u.id=l.owner_user_id where s.is_active group by s.id order by s.order_index`);return {data:result.rows.map(r=>({...r,leads:r.leads||[]}))};});
app.get("/api/v1/notifications",async(request,reply)=>{const actor=requireActor(request,reply);if(!actor)return;const result=await query("select * from notifications where user_id=$1 order by created_at desc limit 100",[actor.id]);return {data:result.rows};});
app.patch("/api/v1/notifications/:id/read",async(request,reply)=>{const actor=requireActor(request,reply);if(!actor)return;const {id}=z.object({id:z.string().uuid()}).parse(request.params);await query("update notifications set status='read',read_at=now() where id=$1 and user_id=$2",[id,actor.id]);return reply.code(204).send();});

app.post("/api/v1/intake/website", { config: { rawBody: true } }, async (request, reply) => {
  const exactBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? ""; const timestamp=String(request.headers["x-eyeagle-timestamp"]||""); const signature=String(request.headers["x-eyeagle-signature"]||""); const idempotencyKey=String(request.headers["idempotency-key"]||"");
  if (!idempotencyKey || !validWebhookSignature(exactBody,timestamp,signature)) return reply.code(401).send({error:{code:"INVALID_SIGNATURE",message:"Webhook authentication failed."}});
  const payload=websiteIntakeSchema.parse(request.body); const phone=normalizeIndianPhone(payload.phone);
  const result=await transaction(async(client)=>{const prior=await client.query("select id,result from website_intake_submissions where idempotency_key=$1",[idempotencyKey]);if(prior.rows[0])return {intakeId:prior.rows[0].id,result:prior.rows[0].result,replayed:true};const existing=await client.query<{customer_id:string;lead_id:string;owner_user_id:string}>(`select c.id customer_id,l.id lead_id,l.owner_user_id from customers c left join leads l on l.customer_id=c.id and l.status in ('unclaimed','active','snoozed') where c.normalized_phone=$1 order by l.created_at desc nulls last limit 1`,[phone]);let customerId=existing.rows[0]?.customer_id;let leadId=existing.rows[0]?.lead_id;let outcome="existing_open_lead";if(leadId){await client.query(`insert into audit_events(action,entity_type,entity_id,metadata) values('website.enquiry_received','lead',$1,$2)`,[leadId,JSON.stringify(payload)]);if(existing.rows[0].owner_user_id)await client.query(`insert into notifications(user_id,type,title,body,entity_type,entity_id) values($1,'repeat_enquiry','New enquiry from an existing lead',$2,'lead',$3)`,[existing.rows[0].owner_user_id,payload.summary,leadId]);}else{if(!customerId){const customer=await client.query<{id:string}>("insert into customers(full_name,primary_phone,normalized_phone,email,city) values($1,$2,$3,$4,$5) returning id",[payload.fullName,payload.phone,phone,payload.email||null,payload.city||null]);customerId=customer.rows[0].id;outcome="created_customer_and_lead";}else outcome="created_lead_for_customer";const lead=await client.query<{id:string}>(`insert into leads(customer_id,stage_id,source_id,priority,enquiry_summary,status) select $1,s.id,src.id,$2,$3,'unclaimed' from pipeline_stages s,lead_sources src where s.name='New enquiry' and src.name='Website' returning id`,[customerId,payload.priority,payload.summary]);leadId=lead.rows[0].id;}const intake=await client.query<{id:string}>("insert into website_intake_submissions(idempotency_key,payload,result,customer_id,lead_id) values($1,$2,$3,$4,$5) returning id",[idempotencyKey,JSON.stringify(payload),outcome,customerId,leadId]);return {intakeId:intake.rows[0].id,result:outcome,replayed:false};});return reply.code(result.replayed?200:202).send(result);
});

const port=Number(process.env.PORT||4000); await app.listen({port,host:"0.0.0.0"});
process.on("SIGTERM",async()=>{await app.close();await pool.end();});
