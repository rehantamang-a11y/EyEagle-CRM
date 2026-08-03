do $$
begin
  if exists(select 1 from information_schema.columns where table_name='leads' and column_name='requested_next_step')
    and not exists(select 1 from information_schema.columns where table_name='leads' and column_name='expressed_interest') then
    alter table leads rename column requested_next_step to expressed_interest;
  end if;
end $$;

alter index if exists leads_requested_next_step_idx rename to leads_expressed_interest_idx;

alter table leads add column if not exists submitted_at timestamptz;
update leads set submitted_at=created_at where submitted_at is null;

alter table audit_appointments add column if not exists customer_confirmed_at timestamptz;
alter table audit_appointments add column if not exists customer_confirmed_by uuid references crm_users(id);

update audit_appointments
set customer_confirmed_at=coalesce(customer_confirmed_at,created_at),
    customer_confirmed_by=coalesce(customer_confirmed_by,created_by)
where customer_confirmed_at is null or customer_confirmed_by is null;

alter table audit_appointments alter column customer_confirmed_at set not null;
alter table audit_appointments alter column customer_confirmed_by set not null;
