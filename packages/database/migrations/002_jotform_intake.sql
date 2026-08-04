-- Jotform intake (system-guide.md §1): a manual "Refresh Jotform" pull, not a
-- webhook. Idempotency is the safety net (jotform_submission_id is unique), so
-- refreshing repeatedly never creates the same opportunity twice. Invalid
-- submissions (missing name or phone) are held for admin review instead of
-- blocking the rest of the batch.

insert into lead_sources (name) values ('Jotform')
  on conflict (name) do nothing;

create table jotform_submissions (
  id uuid primary key default gen_random_uuid(),
  jotform_submission_id text not null unique,
  submitted_at timestamptz not null,
  payload jsonb not null,
  status text not null check (
    status in ('created_opportunity', 'existing_open_lead', 'suppressed_do_not_contact', 'held_for_review')
  ),
  unmapped_fields text[] not null default '{}',
  customer_id uuid references customers(id),
  lead_id uuid references leads(id),
  received_at timestamptz not null default now()
);
create index jotform_submissions_submitted_idx on jotform_submissions (submitted_at);
create index jotform_submissions_held_idx on jotform_submissions (status) where status = 'held_for_review';

create table jotform_sync_state (
  form_id text primary key,
  last_synced_submitted_at timestamptz,
  last_synced_at timestamptz,
  last_synced_by uuid references crm_users(id),
  last_run_created integer not null default 0,
  last_run_skipped integer not null default 0,
  last_run_held integer not null default 0,
  last_run_error text
);
