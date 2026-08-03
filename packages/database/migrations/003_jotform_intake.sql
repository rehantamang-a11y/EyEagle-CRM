-- Manual-trigger Jotform sync: an admin clicks "Sync now" and the API pages
-- through Jotform's submissions API. Idempotency is the safety net (not the
-- cursor in jotform_sync_state, which is only an optimisation), so a submission
-- can never create two leads even if a sync run overlaps or re-fetches.

insert into lead_sources (name) values ('Jotform')
  on conflict (name) do nothing;

create table jotform_submissions (
  id uuid primary key default gen_random_uuid(),
  jotform_submission_id text not null unique,
  submitted_at timestamptz not null,
  payload jsonb not null,
  result text not null,
  unmapped_fields text[] not null default '{}',
  customer_id uuid references customers(id),
  lead_id uuid references leads(id),
  received_at timestamptz not null default now()
);
create index jotform_submissions_submitted_idx on jotform_submissions (submitted_at);

create table jotform_sync_state (
  form_id text primary key,
  last_synced_submitted_at timestamptz,
  last_synced_at timestamptz,
  last_synced_by uuid references crm_users(id),
  last_run_created integer not null default 0,
  last_run_skipped integer not null default 0,
  last_run_error text
);
