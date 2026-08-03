-- Flow hardening: enforce the follow-up chain, bound reminder retries, and give
-- the compliance-critical flags a real provenance trail.

-- 1. Reminder delivery -------------------------------------------------------
-- Retries were unbounded: a permanently failing reminder cleared next_attempt_at,
-- the claim query fell back to reminder_at (always in the past), and the row was
-- re-claimed forever. Bound attempts explicitly and exclude exhausted rows.
alter table activity_reminders
  add column max_attempts integer not null default 5 check (max_attempts > 0),
  add column processing_started_at timestamptz;

drop index if exists reminders_due_idx;
create index reminders_due_idx
  on activity_reminders (coalesce(next_attempt_at, reminder_at))
  where status in ('pending', 'failed');

-- Lets the reaper find reminders orphaned by a worker crash mid-delivery.
create index reminders_stuck_idx
  on activity_reminders (processing_started_at)
  where status = 'processing';

-- Every reminder previously fanned out to in-app *and* email with no way to opt
-- out, which trains operators to filter the mail.
alter table crm_users
  add column reminder_channels text[] not null default '{in_app,email}'
    check (reminder_channels <@ array['in_app', 'email']);

-- 2. Structured activity outcomes -------------------------------------------
-- Free text made "no answer" / "No Answer" / "NA" indistinguishable, which blocks
-- connect-rate reporting and any outcome-driven stage automation.
create type activity_outcome as enum (
  'connected', 'no_answer', 'busy', 'wrong_number', 'unreachable',
  'interested', 'not_interested', 'callback_requested',
  'visit_scheduled', 'audit_completed', 'proposal_shared', 'payment_received',
  'rescheduled_by_customer', 'other'
);

alter table activities
  alter column outcome type activity_outcome
  using (
    case
      when outcome is null or outcome = '' then null::activity_outcome
      when outcome = any (enum_range(null::activity_outcome)::text[]) then outcome::activity_outcome
      else 'other'::activity_outcome
    end
  );

-- 3. Lead close taxonomy -----------------------------------------------------
create type lead_close_reason as enum (
  'won_installed', 'won_paid',
  'lost_price', 'lost_no_response', 'lost_competitor',
  'lost_not_ready', 'lost_not_qualified', 'lost_other',
  'duplicate'
);

alter table leads
  alter column close_reason type lead_close_reason
  using (
    case
      when close_reason is null or close_reason = '' then null::lead_close_reason
      when close_reason = any (enum_range(null::lead_close_reason)::text[]) then close_reason::lead_close_reason
      else 'lost_other'::lead_close_reason
    end
  );

-- 4. The follow-up chain -----------------------------------------------------
-- Completing an activity used to leave next_activity_at null silently. Breaking
-- the chain is now an explicit, attributable decision.
alter table leads
  add column first_contacted_at timestamptz,
  add column no_next_action_reason text,
  add column no_next_action_at timestamptz,
  add column no_next_action_by uuid references crm_users(id),
  add constraint leads_no_next_action_attributed check (
    (no_next_action_reason is null and no_next_action_at is null and no_next_action_by is null)
    or (no_next_action_reason is not null and no_next_action_at is not null and no_next_action_by is not null)
  );

-- Closed leads must say why; open leads must not claim to be closed.
alter table leads
  add constraint leads_closed_has_reason check (
    (status in ('won', 'lost') and closed_at is not null and close_reason is not null)
    or (status not in ('won', 'lost') and closed_at is null and close_reason is null)
  );

create index leads_unclaimed_age_idx on leads (created_at) where status = 'unclaimed';

-- 5. Do-not-contact provenance ----------------------------------------------
-- The flag blocked scheduling but no route could set it and nothing recorded who
-- did or why. Under DPDP that trail is not optional.
alter table customers
  add column do_not_contact_reason text,
  add column do_not_contact_at timestamptz,
  add column do_not_contact_by uuid references crm_users(id);

-- 6. Session hardening -------------------------------------------------------
-- The cookie value was the crm_sessions primary key in plaintext, so anyone with
-- read access to the table or a backup could impersonate any user for 30 days.
-- The cookie now carries a random token and only its SHA-256 digest is stored.
alter table crm_sessions
  add column token_hash text unique;

drop index if exists sessions_active_idx;
create index sessions_active_idx
  on crm_sessions (token_hash, expires_at)
  where revoked_at is null;

-- Existing rows predate hashing and cannot be matched by any incoming cookie.
update crm_sessions set revoked_at = now() where token_hash is null and revoked_at is null;

-- 7. Organization settings ---------------------------------------------------
alter table organization_settings
  add column unclaimed_escalation_minutes integer not null default 120
    check (unclaimed_escalation_minutes > 0),
  add column enforce_calling_windows boolean not null default true;
