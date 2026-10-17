-- Apply within each configured store schema. No existing records are rewritten.
alter table public.issued_passwords add column if not exists super_speed_allowed boolean;
create table if not exists public.super_speed_activity (
  id text primary key,
  activity_date date not null,
  issuance_key text not null,
  machine_id text not null,
  player_name text not null,
  event_type text not null check(event_type in ('allowed','used')),
  occurred_at_ms bigint not null,
  session_id text not null default ''
);
create index if not exists super_speed_activity_date_idx on public.super_speed_activity(activity_date,occurred_at_ms);
alter table public.super_speed_activity enable row level security;
revoke all on public.super_speed_activity from public,anon,authenticated;
grant all on public.super_speed_activity to service_role;

-- Password, selected permission and permission audit are committed together.
-- The existing password PK elects one administrator when requests overlap.
create or replace function public.issue_password_with_speed(p_issued jsonb,p_event jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into public.issued_passwords(password,machine_id,player_name,status,issued_at_ms,used_at_ms,session_id,super_speed_allowed)
  values(p_issued->>'password',p_issued->>'machine_id',p_issued->>'player_name','issued',(p_issued->>'issued_at_ms')::bigint,0,'',(p_issued->>'super_speed_allowed')::boolean);
  insert into public.machine_states(machine_id,capabilities)
  values(p_issued->>'machine_id',jsonb_build_object('superSpeedAllowed',(p_issued->>'super_speed_allowed')::boolean))
  on conflict(machine_id) do update set capabilities=jsonb_set(coalesce(machine_states.capabilities,'{}'::jsonb),'{superSpeedAllowed}',excluded.capabilities->'superSpeedAllowed');
  if p_event is not null then
    insert into public.super_speed_activity select * from jsonb_populate_record(null::public.super_speed_activity,p_event)
    on conflict(id) do nothing;
  end if;
end; $$;
revoke all on function public.issue_password_with_speed(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.issue_password_with_speed(jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
