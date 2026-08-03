create extension if not exists pgcrypto;

create type crm_role as enum ('team_member', 'admin');
create type user_status as enum ('active', 'inactive');
create type lead_status as enum ('unclaimed', 'active', 'won', 'lost', 'do_not_contact', 'archived');
create type lead_priority as enum ('urgent', 'high', 'normal', 'low');
create type stage_category as enum ('open', 'won', 'lost', 'restricted');
create type activity_status as enum ('scheduled', 'completed', 'missed', 'cancelled', 'overdue');
create type reminder_status as enum ('pending', 'processing', 'sent', 'read', 'dismissed', 'failed', 'cancelled');
create type notification_status as enum ('unread', 'read', 'dismissed');
create type job_status as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');

create table crm_users (
  id uuid primary key default gen_random_uuid(),
  external_user_id text not null unique,
  name text not null,
  email text not null unique,
  role crm_role not null default 'team_member',
  status user_status not null default 'active',
  timezone text not null default 'Asia/Kolkata',
  max_active_leads integer not null default 25 check (max_active_leads > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  order_index integer not null unique,
  category stage_category not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table lead_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  external_customer_id text unique,
  full_name text not null,
  primary_phone text not null,
  normalized_phone text not null,
  alternate_phone text,
  email text,
  city text,
  state text,
  address text,
  preferred_contact_method text,
  preferred_contact_start_time time,
  preferred_contact_end_time time,
  preferred_contact_days smallint[] not null default '{}',
  contact_notes text,
  do_not_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index customers_normalized_phone_idx on customers(normalized_phone);
create index customers_search_idx on customers using gin(to_tsvector('simple', coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(city,'')));

create table leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  owner_user_id uuid references crm_users(id),
  stage_id uuid not null references pipeline_stages(id),
  source_id uuid references lead_sources(id),
  priority lead_priority not null default 'normal',
  enquiry_summary text not null,
  status lead_status not null default 'unclaimed',
  claimed_at timestamptz,
  first_action_due_at timestamptz,
  last_contacted_at timestamptz,
  next_activity_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  created_by uuid references crm_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check ((status = 'unclaimed' and owner_user_id is null) or status <> 'unclaimed')
);
create index leads_queue_idx on leads(priority, created_at) where status = 'unclaimed';
create index leads_owner_status_idx on leads(owner_user_id, status);
create index leads_stage_idx on leads(stage_id);
create index leads_next_activity_idx on leads(next_activity_at) where status = 'active';

create table activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  customer_id uuid not null references customers(id),
  assigned_user_id uuid not null references crm_users(id),
  type text not null,
  title text not null,
  status activity_status not null default 'scheduled',
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  outcome text,
  notes text,
  rescheduled_from_activity_id uuid references activities(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid not null references crm_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (scheduled_end > scheduled_start)
);
create index activities_assignee_schedule_idx on activities(assigned_user_id, scheduled_start, scheduled_end) where status in ('scheduled','overdue');
create index activities_lead_idx on activities(lead_id, created_at desc);

create table activity_reminders (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id),
  reminder_at timestamptz not null,
  channel text not null check (channel in ('in_app','email')),
  status reminder_status not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique(activity_id, reminder_at, channel)
);
create index reminders_due_idx on activity_reminders(coalesce(next_attempt_at, reminder_at)) where status in ('pending','failed');

create table notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  customer_id uuid not null references customers(id),
  author_user_id uuid not null references crm_users(id),
  content text not null,
  note_type text not null default 'general',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lead_ownership_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  previous_owner_user_id uuid references crm_users(id),
  new_owner_user_id uuid references crm_users(id),
  event_type text not null check (event_type in ('claimed','released','transferred','auto_released','admin_override')),
  reason text,
  created_by uuid not null references crm_users(id),
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references crm_users(id),
  type text not null,
  title text not null,
  body text not null,
  entity_type text,
  entity_id uuid,
  status notification_status not null default 'unread',
  scheduled_at timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on notifications(user_id, created_at desc) where status = 'unread';

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references crm_users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_entity_idx on audit_events(entity_type, entity_id, created_at desc);

create table website_intake_submissions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  payload jsonb not null,
  result text not null,
  customer_id uuid references customers(id),
  lead_id uuid references leads(id),
  received_at timestamptz not null default now()
);

create table crm_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references crm_users(id),
  upstream_access_token_ciphertext text not null,
  upstream_refresh_token_ciphertext text,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index sessions_active_idx on crm_sessions(id, expires_at) where revoked_at is null;

create table organization_settings (
  id uuid primary key default gen_random_uuid(),
  timezone text not null default 'Asia/Kolkata',
  calling_windows jsonb not null default '[{"start":"10:00","end":"13:00"},{"start":"14:00","end":"18:30"}]',
  buffer_minutes jsonb not null default '{"call":5,"meeting":15,"home_visit":15,"bathroom_audit":15}',
  reminder_defaults jsonb not null default '{"call":[1440,30],"whatsapp":[1440,30],"meeting":[1440,120,30],"bathroom_audit":[1440,120,30]}',
  inactivity_warning_minutes integer not null default 120,
  updated_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  status job_status not null default 'pending',
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index jobs_claim_idx on jobs(run_at, created_at) where status in ('pending','failed');

create table outbox_events (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  payload jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index outbox_unpublished_idx on outbox_events(created_at) where published_at is null;

insert into pipeline_stages(name, order_index, category) values
 ('New Enquiry',1,'open'),('Picked Up',2,'open'),('Contact Attempted',3,'open'),('Connected',4,'open'),
 ('Interested',5,'open'),('Audit Scheduled',6,'open'),('Audit Completed',7,'open'),('Proposal Shared',8,'open'),
 ('Decision Pending',9,'open'),('Won',10,'won'),('Lost',11,'lost'),('Do Not Contact',12,'restricted');
insert into lead_sources(name) values ('Website'),('Referral'),('Phone'),('Event'),('Bathroom Audit Form'),('Instagram'),('Facebook'),('Manual Entry');
insert into organization_settings default values;

create or replace function prevent_audit_mutation() returns trigger language plpgsql as $$ begin
  raise exception 'audit_events are immutable';
end $$;
create trigger audit_events_immutable before update or delete on audit_events for each row execute function prevent_audit_mutation();
