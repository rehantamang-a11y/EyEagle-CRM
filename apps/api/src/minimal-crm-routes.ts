import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { mapJotformSubmission, type JotformFieldMap, type JotformSubmission } from "@eyeagle/crm-shared";
import { query, transaction } from "./db.js";

type Actor = { id: string; role: "team_member" | "admin" };
type OpportunityRow = {
  id: string; status: "new" | "open" | "won" | "lost"; ownerUserId: string | null; ownerName: string | null;
  fullName: string; phone: string; email: string | null; location: string | null; interest: string | null;
  summary: string | null; formContext: Record<string, unknown>; submittedAt: string; nextActionAt: string | null;
  nextActionLabel: string | null; lastActionAt: string | null; lastNote: string | null; closedAt: string | null; lostReason: string | null;
};

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("follow_up"), note: z.string().trim().min(2), nextActionAt: z.string().datetime(), lostReason: z.never().optional() }),
  z.object({ type: z.literal("sold"), note: z.string().trim().min(2), nextActionAt: z.never().optional(), lostReason: z.never().optional() }),
  z.object({ type: z.literal("not_proceeding"), note: z.string().trim().min(2), nextActionAt: z.never().optional(), lostReason: z.string().trim().min(2) }),
]);
const formRecordSchema = z.object({
  fullName: z.string().trim().min(2), phone: z.string().trim().min(6), email: z.string().trim().email().optional().or(z.literal("")),
  city: z.string().trim().optional(), expressedInterest: z.string().trim().optional(), summary: z.string().trim().optional(),
}).passthrough();

function actorFor(request: FastifyRequest, reply: FastifyReply): Actor | undefined {
  const actor = request.actor as Actor | undefined;
  if (!actor) { void reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }); return; }
  return actor;
}
function notFound(reply: FastifyReply) { return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Opportunity not found." } }); }
function asOpportunity(row: OpportunityRow) { return row; }
function parseFieldMap(): JotformFieldMap {
  const raw = process.env.JOTFORM_FIELD_MAP_JSON;
  if (!raw) throw new Error("JOTFORM_FIELD_MAP_JSON is required for Jotform sync");
  return z.object({ fullName: z.string(), phone: z.string() }).passthrough().parse(JSON.parse(raw));
}

function answerValue(value: unknown): string | string[] {
  if (Array.isArray(value)) return value.map(answerValue).flatMap((item) => Array.isArray(item) ? item : [item]).filter(Boolean);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(answerValue).flatMap((item) => Array.isArray(item) ? item : [item]).filter(Boolean);
  return value == null ? "" : String(value).trim();
}

function completeFormContext(submission: JotformSubmission, mapped: Record<string, unknown>): Record<string, unknown> {
  const answers = Object.values(submission.answers ?? {}).reduce<Record<string, string | string[]>>((all, answer) => {
    const item = answer as { text?: string; name?: string; prettyFormat?: string; answer?: unknown };
    const label = item.text?.trim() || item.name?.trim();
    const rawValue = answerValue(item.answer);
    const value = Array.isArray(rawValue) && rawValue.length > 1 ? rawValue : item.prettyFormat?.trim() || (Array.isArray(rawValue) ? rawValue[0] : rawValue);
    if (label && (Array.isArray(value) ? value.length : value)) all[label] = value;
    return all;
  }, {});
  return { ...mapped, formAnswers: answers };
}

export function registerMinimalCrmRoutes(app: FastifyInstance) {
  app.post("/api/v1/crm/jotform/sync", async (request, reply) => {
    if (!actorFor(request, reply)) return;
    const apiKey = process.env.JOTFORM_API_KEY; const formId = process.env.JOTFORM_FORM_ID;
    if (!apiKey || !formId) return reply.code(503).send({ error: { code: "JOTFORM_NOT_CONFIGURED", message: "Jotform credentials are not configured." } });
    const fieldMap = parseFieldMap(); const submissions: JotformSubmission[] = []; let offset = 0;
    while (true) {
      const url = new URL(`https://api.jotform.com/form/${formId}/submissions`);
      url.searchParams.set("apiKey", apiKey); url.searchParams.set("limit", "1000"); url.searchParams.set("offset", String(offset));
      const response = await fetch(url); if (!response.ok) throw new Error(`Jotform returned ${response.status}`);
      const payload = await response.json() as { content?: JotformSubmission[]; responseCode?: number };
      const page = payload.content ?? []; submissions.push(...page);
      if (page.length < 1000) break; offset += page.length;
    }
    let imported = 0; let skipped = 0; let issues = 0;
    for (const submission of submissions) {
      const submissionId = String(submission.id ?? "");
      if (!submissionId) { issues += 1; continue; }
      const rawContext = completeFormContext(submission, mapJotformSubmission(submission, fieldMap) as Record<string, unknown>);
      const result = await transaction(async (client) => {
        const recorded = await client.query<{ submission_id: string }>(`insert into crm_jotform_submissions(form_id,submission_id) values($1,$2) on conflict do nothing returning submission_id`, [formId, submissionId]);
        if (!recorded.rowCount) return "skipped" as const;
        const parsed = formRecordSchema.safeParse(rawContext);
        if (!parsed.success) {
          await client.query(`insert into crm_import_issues(form_id,submission_id,issue_code,message,form_context) values($1,$2,'INVALID_SUBMISSION',$3,$4) on conflict do nothing`, [formId, submissionId, "Name and phone are required to create an enquiry.", JSON.stringify(rawContext)]);
          return "issue" as const;
        }
        const value = parsed.data;
        const created = await client.query<{ id: string }>(`insert into crm_opportunities(form_id,submission_id,full_name,phone,email,location,interest,summary,form_context,submitted_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [formId, submissionId, value.fullName, value.phone, value.email || null, value.city || null, value.expressedInterest || null, value.summary || null, JSON.stringify(rawContext), rawContext.submittedAt ?? submission.created_at]);
        await client.query("update crm_jotform_submissions set opportunity_id=$1 where form_id=$2 and submission_id=$3", [created.rows[0].id, formId, submissionId]);
        await client.query(`insert into crm_history(opportunity_id,event_type,note) values($1,'imported',$2)`, [created.rows[0].id, "Imported from Jotform"]);
        return "imported" as const;
      });
      if (result === "imported") imported += 1; else if (result === "issue") issues += 1; else skipped += 1;
    }
    return { data: { scanned: submissions.length, imported, skipped, issues } };
  });

  app.get("/api/v1/crm/opportunities", async (request, reply) => {
    const actor = actorFor(request, reply); if (!actor) return;
    const { view, scope } = z.object({ view: z.enum(["new", "due", "upcoming", "closed"]).default("new"), scope: z.enum(["mine", "all"]).default("mine") }).parse(request.query);
    const ownerClause = scope === "mine" ? " and o.owner_user_id=$1" : "";
    const clause = view === "new" ? "o.status='new' and o.owner_user_id is null" : view === "due" ? `o.status='open' and o.next_action_at <= now()${ownerClause}` : view === "upcoming" ? `o.status='open' and o.next_action_at > now()${ownerClause}` : `o.status in ('won','lost')${ownerClause}`;
    const params = view !== "new" && scope === "mine" ? [actor.id] : [];
    const rows = await query<OpportunityRow>(`select o.id,o.status,o.owner_user_id as "ownerUserId",u.name as "ownerName",o.full_name as "fullName",o.phone,o.email,o.location,o.interest,o.summary,o.form_context as "formContext",o.submitted_at as "submittedAt",o.next_action_at as "nextActionAt",o.next_action_label as "nextActionLabel",o.last_action_at as "lastActionAt",o.last_note as "lastNote",o.closed_at as "closedAt",o.lost_reason as "lostReason" from crm_opportunities o left join crm_users u on u.id=o.owner_user_id where ${clause} order by ${view === "new" ? "o.submitted_at asc" : view === "closed" ? "o.closed_at desc" : "o.next_action_at asc"} limit 250`, params);
    return { data: rows.rows.map(asOpportunity) };
  });

  app.get("/api/v1/crm/opportunities/:id", async (request, reply) => {
    const actor = actorFor(request, reply); if (!actor) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const record = await query<OpportunityRow>(`select id,status,owner_user_id as "ownerUserId",full_name as "fullName",phone,email,location,interest,summary,form_context as "formContext",submitted_at as "submittedAt",next_action_at as "nextActionAt",next_action_label as "nextActionLabel",last_action_at as "lastActionAt",last_note as "lastNote",closed_at as "closedAt",lost_reason as "lostReason" from crm_opportunities where id=$1`, [id]);
    if (!record.rows[0]) return notFound(reply);
    const history = await query(`select id,event_type as type,note,lost_reason as "lostReason",next_action_at as "nextActionAt",actor_user_id as "actorUserId",created_at as at from crm_history where opportunity_id=$1 order by created_at desc`, [id]);
    return { data: { ...asOpportunity(record.rows[0]), history: history.rows } };
  });

  app.post("/api/v1/crm/opportunities/:id/claim", async (request, reply) => {
    const actor = actorFor(request, reply); if (!actor) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const outcome = await transaction(async (client) => {
      const updated = await client.query<{ id: string }>(`update crm_opportunities set owner_user_id=$1,status='open',next_action_at=now(),next_action_label='Call customer',last_action_at=now(),updated_at=now() where id=$2 and status='new' and owner_user_id is null returning id`, [actor.id, id]);
      if (!updated.rowCount) return false;
      await client.query(`insert into crm_history(opportunity_id,actor_user_id,event_type,note,next_action_at) values($1,$2,'claimed','Ownership taken. Call customer. ',now())`, [id, actor.id]);
      return true;
    });
    if (!outcome) return reply.code(409).send({ error: { code: "ALREADY_CLAIMED", message: "This enquiry was taken by another team member." } });
    return { data: { id } };
  });

  app.post("/api/v1/crm/opportunities/:id/action", async (request, reply) => {
    const actor = actorFor(request, reply); if (!actor) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = actionSchema.parse(request.body);
    if (body.type === "follow_up" && new Date(body.nextActionAt).getTime() <= Date.now()) return reply.code(422).send({ error: { code: "VALIDATION_ERROR", message: "Follow-up time must be in the future." } });
    const result = await transaction(async (client) => {
      const existing = await client.query<{ owner_user_id: string | null; status: string }>("select owner_user_id,status from crm_opportunities where id=$1 for update", [id]);
      if (!existing.rows[0]) return "missing" as const;
      if (existing.rows[0].owner_user_id !== actor.id || existing.rows[0].status !== "open") return "forbidden" as const;
      if (body.type === "follow_up") {
        await client.query(`update crm_opportunities set next_action_at=$1,next_action_label='Follow up',last_action_at=now(),last_note=$2,updated_at=now() where id=$3`, [body.nextActionAt, body.note, id]);
        await client.query(`insert into crm_history(opportunity_id,actor_user_id,event_type,note,next_action_at) values($1,$2,'follow_up',$3,$4)`, [id, actor.id, body.note, body.nextActionAt]);
      } else if (body.type === "sold") {
        await client.query(`update crm_opportunities set status='won',next_action_at=null,next_action_label=null,last_action_at=now(),last_note=$1,closed_at=now(),updated_at=now() where id=$2`, [body.note, id]);
        await client.query(`insert into crm_history(opportunity_id,actor_user_id,event_type,note) values($1,$2,'sold',$3)`, [id, actor.id, body.note]);
      } else {
        await client.query(`update crm_opportunities set status='lost',next_action_at=null,next_action_label=null,last_action_at=now(),last_note=$1,lost_reason=$2,closed_at=now(),updated_at=now() where id=$3`, [body.note, body.lostReason, id]);
        await client.query(`insert into crm_history(opportunity_id,actor_user_id,event_type,note,lost_reason) values($1,$2,'not_proceeding',$3,$4)`, [id, actor.id, body.note, body.lostReason]);
      }
      return "ok" as const;
    });
    if (result === "missing") return notFound(reply);
    if (result === "forbidden") return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Only the owner can update an open opportunity." } });
    return { data: { id, type: body.type } };
  });
}
