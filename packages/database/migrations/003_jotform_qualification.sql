alter table leads add column if not exists considering_for text[] not null default '{}';
alter table leads add column if not exists safety_concerns text[] not null default '{}';
alter table leads add column if not exists immediate_safety_concern boolean not null default false;
alter table leads add column if not exists requested_next_step text;
alter table leads add column if not exists preferred_contact_day text;
alter table leads add column if not exists preferred_contact_period text;

create index if not exists leads_immediate_concern_idx on leads(created_at desc) where immediate_safety_concern;
create index if not exists leads_requested_next_step_idx on leads(requested_next_step) where requested_next_step is not null;
