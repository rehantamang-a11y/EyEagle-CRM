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
}

async function tick() {
  const client = await pool.connect(); let reminderId: string | undefined;
  try { await client.query("begin"); reminderId = await claimReminder(client); await client.query("commit"); }
  catch (error) { await client.query("rollback"); console.error(JSON.stringify({ level:"error",workerId,message:"claim failed",error:String(error) })); }
  finally { client.release(); }
  if (reminderId) await processReminder(reminderId);
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
