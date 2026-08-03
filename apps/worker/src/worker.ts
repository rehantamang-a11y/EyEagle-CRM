import os from "node:os";
import pg, { type PoolClient } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX || 5),
  ssl: process.env.NODE_ENV === "production" && process.env.DATABASE_SSL !== "false"
    ? { rejectUnauthorized: true }
    : undefined,
});

const workerId = `${os.hostname()}:${process.pid}`;
const TICK_MS = Number(process.env.WORKER_TICK_MS || 5000);
/** One reminder per five-second tick capped delivery at twelve per minute. */
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE || 25);
const MAINTENANCE_EVERY_TICKS = Number(process.env.WORKER_MAINTENANCE_TICKS || 12);
/** A reminder still 'processing' after this long belongs to a worker that died. */
const STUCK_MINUTES = Number(process.env.WORKER_STUCK_MINUTES || 10);

let stopping = false;

const log = (level: "info" | "warn" | "error", message: string, extra: object = {}) =>
  console[level === "error" ? "error" : "info"](JSON.stringify({ level, workerId, message, ...extra }));

async function sendEmail(to: string, subject: string, body: string) {
  if (!process.env.EMAIL_PROVIDER_URL || !process.env.EMAIL_PROVIDER_API_KEY) {
    throw new Error("Email provider is not configured");
  }
  const response = await fetch(process.env.EMAIL_PROVIDER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text: body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}

/**
 * Recovers reminders orphaned by a worker that crashed between claiming and
 * delivering. Without this they stayed 'processing' forever and were never sent —
 * a silent miss in a product whose whole promise is that follow-ups do not slip.
 */
async function recoverStuckReminders() {
  const result = await pool.query(
    `update activity_reminders
        set status = 'pending', processing_started_at = null
      where status = 'processing'
        and processing_started_at < now() - ($1 || ' minutes')::interval
     returning id`,
    [String(STUCK_MINUTES)],
  );
  if (result.rowCount) log("warn", "recovered stuck reminders", { count: result.rowCount });
}

/**
 * Claims a batch. `attempts < max_attempts` is what stops a permanently failing
 * reminder from being re-claimed forever: exhausted rows keep status 'failed' but
 * fall out of this query for good.
 */
async function claimReminders(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `with due as (
       select r.id
         from activity_reminders r
         join activities a on a.id = r.activity_id
        where r.status in ('pending', 'failed')
          and r.attempts < r.max_attempts
          and coalesce(r.next_attempt_at, r.reminder_at) <= now()
          and a.status in ('scheduled', 'overdue')
        order by coalesce(r.next_attempt_at, r.reminder_at)
        for update of r skip locked
        limit $1
     )
     update activity_reminders r
        set status = 'processing', attempts = r.attempts + 1, processing_started_at = now()
       from due
      where r.id = due.id
     returning r.id`,
    [BATCH_SIZE],
  );
  return result.rows.map((row) => row.id);
}

async function processReminder(id: string) {
  const item = await pool.query<{
    channel: string; title: string; scheduled_start: string; attempts: number; max_attempts: number;
    full_name: string; primary_phone: string; email: string; user_id: string; lead_id: string;
  }>(
    `select r.channel, r.attempts, r.max_attempts, a.title, a.scheduled_start,
            c.full_name, c.primary_phone, u.email, u.id as user_id, l.id as lead_id
       from activity_reminders r
       join activities a on a.id = r.activity_id
       join customers c on c.id = a.customer_id
       join crm_users u on u.id = a.assigned_user_id
       join leads l on l.id = a.lead_id
      where r.id = $1`,
    [id],
  );
  const reminder = item.rows[0];
  if (!reminder) return;

  try {
    const when = new Date(reminder.scheduled_start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const body = `${reminder.title} with ${reminder.full_name} at ${when}. Phone: ${reminder.primary_phone}`;

    if (reminder.channel === "email") {
      await sendEmail(reminder.email, `Follow-up: ${reminder.full_name}`, body);
    } else {
      await pool.query(
        `insert into notifications (user_id, type, title, body, entity_type, entity_id, sent_at)
         values ($1, 'activity_reminder', $2, $3, 'lead', $4, now())`,
        [reminder.user_id, reminder.title, body, reminder.lead_id],
      );
    }

    await pool.query(
      `update activity_reminders
          set status = 'sent', sent_at = now(), failure_reason = null, processing_started_at = null
        where id = $1`,
      [id],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = reminder.attempts >= reminder.max_attempts;

    await pool.query(
      `update activity_reminders
          set status = 'failed',
              next_attempt_at = case when $3 then null else now() + (power(2, attempts) * interval '1 minute') end,
              failure_reason = $2,
              processing_started_at = null
        where id = $1`,
      [id, message.slice(0, 1000), exhausted],
    );

    if (exhausted) {
      // Give up quietly and nobody ever learns the customer was not contacted.
      log("error", "reminder exhausted retries", { reminderId: id, error: message });
      await pool.query(
        `insert into notifications (user_id, type, title, body, entity_type, entity_id)
         select u.id, 'reminder_delivery_failed', 'A follow-up reminder could not be delivered',
                $1, 'lead', $2
           from crm_users u where u.role = 'admin' and u.status = 'active'`,
        [`${reminder.title} for ${reminder.full_name}: ${message}`, reminder.lead_id],
      ).catch(() => undefined);
    } else {
      log("warn", "reminder delivery failed, will retry", { reminderId: id, error: message });
    }
  }
}

async function maintenance() {
  await pool.query(
    `update activities set status = 'overdue', updated_at = now(), version = version + 1
      where status = 'scheduled' and scheduled_end < now()`,
  );

  /*
   * Escalation used to be a five-minute time window: if the worker was down while
   * an activity passed 15 minutes overdue, the escalation was lost permanently.
   * This is state-based instead — overdue and not yet escalated.
   */
  await pool.query(
    `insert into notifications (user_id, type, title, body, entity_type, entity_id)
     select distinct a.assigned_user_id, 'overdue_escalation', 'Follow-up overdue',
            a.title || ' is overdue.', 'lead', a.lead_id
       from activities a
      where a.status = 'overdue'
        and a.scheduled_end < now() - interval '15 minutes'
        and not exists (
          select 1 from notifications n
           where n.user_id = a.assigned_user_id
             and n.type = 'overdue_escalation'
             and n.entity_id = a.lead_id
             and n.created_at > a.scheduled_end
        )`,
  );

  /*
   * Unclaimed leads had no aging escalation at all: first_action_due_at is only
   * set on claim, so a lead nobody picked up could sit in the queue indefinitely
   * with no one notified. Low-priority leads sank and were never seen again.
   */
  await pool.query(
    `insert into notifications (user_id, type, title, body, entity_type, entity_id)
     select u.id, 'unclaimed_aging', 'Lead waiting in the queue',
            c.full_name || ' has been unclaimed for over ' || s.unclaimed_escalation_minutes || ' minutes.',
            'lead', l.id
       from leads l
       join customers c on c.id = l.customer_id
       cross join organization_settings s
       cross join crm_users u
      where l.status = 'unclaimed'
        and l.created_at < now() - (s.unclaimed_escalation_minutes || ' minutes')::interval
        and u.role = 'admin' and u.status = 'active'
        and not exists (
          select 1 from notifications n
           where n.user_id = u.id and n.type = 'unclaimed_aging'
             and n.entity_id = l.id and n.created_at > now() - interval '24 hours'
        )`,
  );

  await pool.query(
    `insert into notifications (user_id, type, title, body, entity_type, entity_id)
     select u.id, 'lead_inactivity', 'Lead needs attention',
            c.full_name || ' still has no first action.', 'lead', l.id
       from leads l
       join customers c on c.id = l.customer_id
       cross join crm_users u
      where l.status = 'active'
        and l.first_action_due_at < now()
        and l.next_activity_at is null
        -- An operator who justified having no next action should not be nagged.
        and l.no_next_action_reason is null
        and u.role = 'admin' and u.status = 'active'
        and not exists (
          select 1 from notifications n
           where n.user_id = u.id and n.type = 'lead_inactivity'
             and n.entity_id = l.id and n.created_at > now() - interval '24 hours'
        )`,
  );

  // Expired and revoked sessions are never read again; do not keep them forever.
  await pool.query(
    "delete from crm_sessions where expires_at < now() - interval '30 days' or revoked_at < now() - interval '30 days'",
  );
}

async function tick() {
  const client = await pool.connect();
  let reminderIds: string[] = [];
  try {
    await client.query("begin");
    reminderIds = await claimReminders(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    log("error", "claim failed", { error: String(error) });
  } finally {
    client.release();
  }

  // Deliveries are independent, so a slow email provider does not stall the batch.
  await Promise.allSettled(reminderIds.map((id) => processReminder(id)));
}

log("info", "worker started", { tickMs: TICK_MS, batchSize: BATCH_SIZE });
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log("info", "shutdown requested", { signal });
    stopping = true;
  });
}

await recoverStuckReminders();
await maintenance();

let maintenanceCounter = 0;
while (!stopping) {
  try {
    await tick();
    maintenanceCounter += 1;
    if (maintenanceCounter >= MAINTENANCE_EVERY_TICKS) {
      await recoverStuckReminders();
      await maintenance();
      maintenanceCounter = 0;
    }
  } catch (error) {
    // A failed tick must never take the loop down; the next one retries.
    log("error", "tick failed", { error: String(error) });
  }
  if (stopping) break;
  await new Promise((resolve) => setTimeout(resolve, TICK_MS));
}

log("info", "worker stopped");
await pool.end();
