-- Trial only. Apply ONLY to the debug database after release approval.
begin;
create table if not exists vertex_debug.customer_accounts (
 user_id text primary key, password_hash text not null, enabled boolean not null default false,
 updated_at timestamptz not null default now(),
 check(user_id ~ '^[-_a-z0-9]{3,32}$')
);
create table if not exists vertex_debug.customer_sessions (
 session_id text primary key references vertex_debug.sessions(session_id),
 user_id text not null references vertex_debug.customer_accounts(user_id)
);
create index if not exists customer_sessions_user on vertex_debug.customer_sessions(user_id);
create table if not exists vertex_debug.customer_login_limits (
 key text primary key, started_at timestamptz not null, attempts integer not null
);
alter table vertex_debug.customer_accounts enable row level security;
alter table vertex_debug.customer_sessions enable row level security;
alter table vertex_debug.customer_login_limits enable row level security;
revoke all on vertex_debug.customer_accounts,vertex_debug.customer_sessions,vertex_debug.customer_login_limits from public,anon,authenticated;
grant all on vertex_debug.customer_accounts,vertex_debug.customer_sessions,vertex_debug.customer_login_limits to service_role;

create or replace function vertex_debug.customer_login_attempt(p_key text,p_limit integer)
returns boolean language plpgsql security definer set search_path=vertex_debug,pg_temp as $$
declare n integer;
begin
 delete from customer_login_limits where started_at<now()-interval '1 day';
 insert into customer_login_limits(key,started_at,attempts) values(p_key,now(),1)
 on conflict(key) do update set
  attempts=case when customer_login_limits.started_at<now()-interval '15 minutes' then 1 else customer_login_limits.attempts+1 end,
  started_at=case when customer_login_limits.started_at<now()-interval '15 minutes' then now() else customer_login_limits.started_at end
 returning attempts into n;
 return n<=p_limit;
end $$;

create or replace function vertex_debug.customer_claim(
 p_user_id text,p_password_hash text,p_machine_id text,p_session_id text,p_token text,
 p_reset integer,p_snapshot jsonb,p_start_snapshot jsonb,p_now bigint)
returns jsonb language plpgsql security definer set search_path=vertex_debug,pg_temp as $$
declare a customer_accounts%rowtype; m machine_states%rowtype; s sessions%rowtype;
begin
 select * into a from customer_accounts where user_id=p_user_id for update;
 if not found or not a.enabled or a.password_hash<>p_password_hash then return jsonb_build_object('error','credentials'); end if;
 select * into m from machine_states where machine_id=p_machine_id and store_id='store-debug' for update;
 if not found or p_machine_id <> 'nova-13' then return jsonb_build_object('error','machine'); end if;
 -- One account cannot play multiple machines concurrently.
 select ss.* into s from customer_sessions cs join sessions ss using(session_id)
 join machine_states mm on mm.machine_id=ss.machine_id and mm.current_session_id=ss.session_id
 where cs.user_id=p_user_id and ss.status='active' and mm.reset_serial=ss.reset_serial_at_start limit 1;
 if found then
  if s.machine_id<>p_machine_id then return jsonb_build_object('error','other-seat'); end if;
  update sessions set token=p_token where session_id=s.session_id returning * into s;
  return jsonb_build_object('ok',true,'resumed',true,'session',to_jsonb(s),'machine',to_jsonb(m));
 end if;
 if m.current_session_id<>'' or m.locked then return jsonb_build_object('error','busy'); end if;
 if exists(select 1 from issued_passwords where machine_id=p_machine_id and status in ('issued','used')) then
  return jsonb_build_object('error','legacy-reservation');
 end if;
 if m.reset_serial<>p_reset or m.last_snapshot is distinct from p_snapshot then return jsonb_build_object('error','changed'); end if;
 insert into sessions(session_id,token,password,machine_id,player_name,status,started_at_ms,reset_serial_at_start,start_snapshot)
 values(p_session_id,p_token,'',p_machine_id,p_user_id,'active',p_now,m.reset_serial,p_start_snapshot) returning * into s;
 insert into customer_sessions(session_id,user_id) values(s.session_id,p_user_id);
 update machine_states set locked=true,current_session_id=s.session_id,current_player_name=p_user_id,
  capabilities=capabilities||'{"superSpeedAllowed":false}'::jsonb where machine_id=p_machine_id returning * into m;
 return jsonb_build_object('ok',true,'resumed',false,'session',to_jsonb(s),'machine',to_jsonb(m));
end $$;
revoke all on function vertex_debug.customer_login_attempt(text,integer) from public,anon,authenticated;
revoke all on function vertex_debug.customer_claim(text,text,text,text,text,integer,jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function vertex_debug.customer_login_attempt(text,integer) to service_role;
grant execute on function vertex_debug.customer_claim(text,text,text,text,text,integer,jsonb,jsonb,bigint) to service_role;
commit;
