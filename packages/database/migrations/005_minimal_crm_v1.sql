-- Minimal sales desk. Platform user IDs are intentionally stored directly so
-- the CRM can reuse the existing Eyeagle identity system.
create type crm_opportunity_status_v1 as enum ('new', 'open', 'won', 'lost');

create table crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  form_id text not null,
  submission_id text not null,
  owner_user_id uuid,
  status crm_opportunity_status_v1 not null default 'new',
  full_name text not null,
  phone text not null,
  email text,
  location text,
  interest text,
  summary text,
  form_context jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null,
  next_action_at timestamptz,
  next_action_label text,
  last_action_at timestamptz,
  last_note text,
  closed_at timestamptz,
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crm_opportunities_new_queue_idx on crm_opportunities (submitted_at asc) where status = 'new' and owner_user_id is null;
create index crm_opportunities_owner_work_idx on crm_opportunities (owner_user_id, next_action_at asc) where status = 'open';
create index crm_opportunities_owner_closed_idx on crm_opportunities (owner_user_id, closed_at desc) where status in ('won', 'lost');

create table crm_jotform_submissions (
  form_id text not null,
  submission_id text not null,
  opportunity_id uuid references crm_opportunities(id),
  imported_at timestamptz not null default now(),
  primary key (form_id, submission_id)
);

create table crm_history (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references crm_opportunities(id),
  actor_user_id uuid,
  event_type text not null check (event_type in ('imported', 'claimed', 'follow_up', 'sold', 'not_proceeding')),
  note text,
  lost_reason text,
  next_action_at timestamptz,
  created_at timestamptz not null default now()
);

create index crm_history_opportunity_idx on crm_history (opportunity_id, created_at desc);

create table crm_import_issues (
  id uuid primary key default gen_random_uuid(),
  form_id text not null,
  submission_id text not null,
  issue_code text not null,
  message text not null,
  form_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (form_id, submission_id, issue_code)
);
