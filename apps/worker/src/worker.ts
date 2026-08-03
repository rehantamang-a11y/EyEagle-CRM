import os from "node:os";
import pg, { type PoolClient } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const workerId = `${os.hostname()}:${process.pid}`;
let stopping = false;

async function sendEmail(to: string, subject: string, body: string) {
  if (!process.env.EMAIL_PROVIDER_URL || !process.env.EMAIL_PROVIDER_API_KEY) throw new Error("Email provider is not configured");
  const response = await fetch(process.env.EMAIL_PROVIDER_URL, { method: "POST", headers: { authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text: body }) });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}

async function claimReminder(client: PoolClient) {
  const result = await client.query(`with due as (
    select r.id from activity_reminders r join activities a on a.id=r.activity_id
    where r.status in ('pending','failed') and coalesce(r.next_attempt_at,r.reminder_at)<=now() and a.status in ('scheduled','overdue')
    order by coalesce(r.next_attempt_at,r.reminder_at) for update skip locked limit 1
  ) update activity_reminders r set status='processing',attempts=attempts+1 from due where r.id=due.id returning r.id`);
  return result.rows[0]?.id as string | undefined;
}

async function claimJob(client: PoolClient) {
  const result = await client.query<{ id: string }>(`with due as (
    select id from jobs where type in ('calendar.audit.upsert','calendar.audit.cancel') and status in ('pending','failed') and run_at<=now()
    order by run_at,created_at for update skip locked limit 1
  ) update jobs j set status='processing',attempts=attempts+1,locked_at=now(),locked_by=$1 from due where j.id=due.id returning j.id`, [workerId]);
  return result.rows[0]?.id;
}

async function googleAccessToken() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google Calendar integration is not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!response.ok) throw new Error(`Google OAuth returned ${response.status}`);
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Google OAuth response did not contain an access token");
  return payload.access_token;
}

async function googleRequest(path: string, token: string, init?: RequestInit) {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers } });
}

async function processCalendarJob(id: string) {
  const jobResult = await pool.query<{ type: string; payload: { auditId?: string }; attempts: number; max_attempts: number }>(`select type,payload,attempts,max_attempts from jobs where id=$1`, [id]);
  const job = jobResult.rows[0]; const auditId = job?.payload.auditId;
  if (!job || !auditId) return;
  try {
    const appointmentResult = await pool.query(`select aa.*,c.full_name,c.primary_phone,c.email,u.name owner_name,u.email owner_email
      from audit_appointments aa join customers c on c.id=aa.customer_id join crm_users u on u.id=aa.owner_user_id where aa.id=$1`, [auditId]);
    const appointment = appointmentResult.rows[0];
    if (!appointment) throw new Error("Audit appointment was not found");
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID is not configured");
    const token = await googleAccessToken(); const encodedCalendar = encodeURIComponent(calendarId); const encodedEvent = encodeURIComponent(appointment.google_event_id);
    if (job.type === "calendar.audit.cancel") {
      const response = await googleRequest(`/calendars/${encodedCalendar}/events/${encodedEvent}?sendUpdates=all`, token, { method: "DELETE" });
      if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`Google Calendar delete returned ${response.status}`);
      await pool.query(`update audit_appointments set calendar_sync_status='cancelled',calendar_error=null,updated_at=now(),version=version+1 where id=$1`, [auditId]);
    } else {
      const attendeeEmails = (process.env.GOOGLE_CALENDAR_OPERATIONS_ATTENDEES || "").split(",").map((email) => email.trim()).filter(Boolean);
      const event = {
        summary: `Bathroom audit — ${appointment.full_name}`,
        description: [`Customer: ${appointment.full_name}`, `Phone: ${appointment.primary_phone}`, `Sales owner: ${appointment.owner_name}`, appointment.context ? `Context: ${appointment.context}` : ""].filter(Boolean).join("\n"),
        location: appointment.address,
        start: { dateTime: new Date(appointment.scheduled_start).toISOString(), timeZone: "Asia/Kolkata" },
        end: { dateTime: new Date(appointment.scheduled_end).toISOString(), timeZone: "Asia/Kolkata" },
        attendees: attendeeEmails.map((email) => ({ email })),
        extendedProperties: { private: { eyeagleAuditId: auditId, eyeagleOpportunityId: appointment.lead_id } },
      };
      let response = await googleRequest(`/calendars/${encodedCalendar}/events/${encodedEvent}`, token);
      if (response.status === 404) response = await googleRequest(`/calendars/${encodedCalendar}/events?sendUpdates=all`, token, { method: "POST", body: JSON.stringify({ id: appointment.google_event_id, ...event }) });
      else if (response.ok) response = await googleRequest(`/calendars/${encodedCalendar}/events/${encodedEvent}?sendUpdates=all`, token, { method: "PATCH", body: JSON.stringify(event) });
      if (!response.ok) throw new Error(`Google Calendar upsert returned ${response.status}`);
      const googleEvent = await response.json() as { htmlLink?: string };
      await pool.query(`update audit_appointments set calendar_sync_status='synced',google_event_url=$1,calendar_error=null,updated_at=now(),version=version+1 where id=$2`, [googleEvent.htmlLink || null, auditId]);
    }
    await pool.query(`update jobs set status='completed',completed_at=now(),last_error=null where id=$1`, [id]);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    await pool.query(`update jobs set status='failed',run_at=case when attempts>=max_attempts then now()+interval '100 years' else now()+(power(2,attempts)*interval '1 minute') end,last_error=$2 where id=$1`, [id, message]);
    await pool.query(`update audit_appointments set calendar_sync_status='failed',calendar_error=$1,updated_at=now(),version=version+1 where id=$2`, [message, auditId]);
  }
}

async function processReminder(id: string) {
  const item = await pool.query(`select r.*,a.title,a.scheduled_start,c.full_name,c.primary_phone,u.email,u.id user_id,l.id lead_id
    from activity_reminders r join activities a on a.id=r.activity_id join customers c on c.id=a.customer_id join crm_users u on u.id=a.assigned_user_id join leads l on l.id=a.lead_id where r.id=$1`, [id]);
  const reminder = item.rows[0]; if (!reminder) return;
  try {
    const body = `${reminder.title} with ${reminder.full_name} at ${new Date(reminder.scheduled_start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. Phone: ${reminder.primary_phone}`;
    if (reminder.channel === "email") await sendEmail(reminder.email, `Follow-up: ${reminder.full_name}`, body);
    else await pool.query(`insert into notifications(user_id,type,title,body,entity_type,entity_id,sent_at) values($1,'activity_reminder',$2,$3,'lead',$4,now())`, [reminder.user_id, reminder.title, body, reminder.lead_id]);
    await pool.query("update activity_reminders set status='sent',sent_at=now(),failure_reason=null where id=$1", [id]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(`update activity_reminders set status=case when attempts>=5 then 'failed' else 'failed' end,next_attempt_at=case when attempts>=5 then null else now()+(power(2,attempts)*interval '1 minute') end,failure_reason=$2 where id=$1`, [id, message.slice(0, 1000)]);
  }
}

async function maintenance() {
  await pool.query(`update activities set status='overdue',updated_at=now(),version=version+1 where status='scheduled' and scheduled_end<now()`);
  await pool.query(`insert into notifications(user_id,type,title,body,entity_type,entity_id)
    select distinct a.assigned_user_id,'overdue_escalation','Follow-up overdue',a.title||' is overdue.','lead',a.lead_id
    from activities a where a.status='overdue' and a.scheduled_end between now()-interval '20 minutes' and now()-interval '15 minutes'
    and not exists(select 1 from notifications n where n.user_id=a.assigned_user_id and n.type='overdue_escalation' and n.entity_id=a.lead_id and n.created_at>a.scheduled_end)`);
  await pool.query(`insert into notifications(user_id,type,title,body,entity_type,entity_id)
    select u.id,'lead_inactivity','Lead needs attention',c.full_name||' still has no first action.','lead',l.id
    from leads l join customers c on c.id=l.customer_id cross join crm_users u
    where l.status='active' and l.first_action_due_at<now() and l.next_activity_at is null and u.role='admin' and u.status='active'
    and not exists(select 1 from notifications n where n.user_id=u.id and n.type='lead_inactivity' and n.entity_id=l.id and n.created_at>now()-interval '24 hours')`);
  await pool.query(`insert into notifications(user_id,type,title,body,entity_type,entity_id)
    select admins.id,'team_overdue_escalation','Follow-up overdue for 24 hours',customers.full_name||' remains assigned to '||owners.name||'.','lead',leads.id
    from activities join leads on leads.id=activities.lead_id join customers on customers.id=leads.customer_id join crm_users owners on owners.id=leads.owner_user_id cross join crm_users admins
    where activities.status='overdue' and activities.scheduled_end<now()-interval '24 hours' and admins.role='admin' and admins.status='active'
    and not exists(select 1 from notifications n where n.user_id=admins.id and n.type='team_overdue_escalation' and n.entity_id=leads.id and n.created_at>now()-interval '24 hours')`);
}

async function tick() {
  const client = await pool.connect(); let reminderId: string | undefined; let jobId: string | undefined;
  try { await client.query("begin"); reminderId = await claimReminder(client); jobId = await claimJob(client); await client.query("commit"); }
  catch (error) { await client.query("rollback"); console.error(JSON.stringify({ level:"error",workerId,message:"claim failed",error:String(error) })); }
  finally { client.release(); }
  if (reminderId) await processReminder(reminderId);
  if (jobId) await processCalendarJob(jobId);
}

console.info(JSON.stringify({ level:"info",workerId,message:"worker started" }));
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
await maintenance();
let maintenanceCounter = 0;
while (!stopping) {
  await tick(); maintenanceCounter += 1;
  if (maintenanceCounter >= 12) { await maintenance(); maintenanceCounter = 0; }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
await pool.end();
