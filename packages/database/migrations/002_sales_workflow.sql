alter type lead_status add value if not exists 'snoozed';

update pipeline_stages set name='New enquiry' where name='New Enquiry';
update pipeline_stages set name='Contacting' where name='Picked Up';
update pipeline_stages set name='Audit scheduled' where name='Audit Scheduled';
update pipeline_stages set name='Awaiting purchase' where name='Decision Pending';
update pipeline_stages set name='Converted' where name='Won';
update pipeline_stages set name='Not proceeding' where name='Lost';
update pipeline_stages set name='Do not contact' where name='Do Not Contact';
update pipeline_stages set is_active=false where name in ('Contact Attempted','Connected','Interested','Audit Completed','Proposal Shared');
insert into pipeline_stages(name,order_index,category)
values('Snoozed',13,'open') on conflict(name) do nothing;

alter table leads add column if not exists last_interaction_at timestamptz;
alter table leads add column if not exists unsuccessful_attempts integer not null default 0;
alter table leads add column if not exists snoozed_until timestamptz;

create table interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  customer_id uuid not null references customers(id),
  actor_user_id uuid not null references crm_users(id),
  channel text not null check(channel in ('call','whatsapp','email','meeting','note')),
  outcome text not null check(outcome in ('no_answer','connected','follow_up','audit_required','ready_to_purchase','not_now','not_interested','wrong_number','do_not_contact','sold')),
  notes text not null,
  created_at timestamptz not null default now()
);
create index interactions_lead_timeline_idx on interactions(lead_id,created_at desc);

create type calendar_sync_status as enum ('pending','synced','failed','cancelled');
create type audit_appointment_status as enum ('scheduled','cancelled');
create table audit_appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  customer_id uuid not null references customers(id),
  owner_user_id uuid not null references crm_users(id),
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  address text not null,
  context text,
  status audit_appointment_status not null default 'scheduled',
  calendar_sync_status calendar_sync_status not null default 'pending',
  google_event_id text not null unique,
  google_event_url text,
  calendar_error text,
  post_audit_activity_id uuid references activities(id),
  created_by uuid not null references crm_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check(scheduled_end>scheduled_start)
);
create index audit_appointments_lead_idx on audit_appointments(lead_id,scheduled_start desc);

create table purchase_links (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  url text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references crm_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table opportunity_purchase_links (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  purchase_link_id uuid not null references purchase_links(id),
  sent_by uuid not null references crm_users(id),
  channel text not null check(channel in ('whatsapp','email','sms','other')),
  sent_at timestamptz not null default now(),
  review_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);
create index opportunity_purchase_links_lead_idx on opportunity_purchase_links(lead_id,created_at desc);

create type order_handoff_status as enum ('awaiting_shopify_link','linked','voided');
create table order_handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references leads(id),
  customer_id uuid not null references customers(id),
  status order_handoff_status not null default 'awaiting_shopify_link',
  sales_confirmation_note text not null,
  shopify_order_id text,
  shopify_order_url text,
  linked_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by uuid not null references crm_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_handoffs_status_idx on order_handoffs(status,created_at);

create table integration_sync_state (
  provider text not null,
  external_resource_id text not null,
  sync_from timestamptz not null,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key(provider,external_resource_id)
);

create table import_issues (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  issue_code text not null,
  message text not null,
  payload jsonb not null default '{}',
  status text not null default 'open' check(status in ('open','resolved','ignored')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(provider,external_id,issue_code)
);
create index import_issues_open_idx on import_issues(created_at desc) where status='open';

create unique index jobs_calendar_dedupe_idx on jobs(type,((payload->>'auditId'))) where type in ('calendar.audit.upsert','calendar.audit.cancel') and status in ('pending','processing','failed');

insert into lead_sources(name) values('Jotform') on conflict(name) do nothing;
