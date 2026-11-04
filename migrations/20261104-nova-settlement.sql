begin;
create table if not exists vertex_debug.settlement_outbox (
 session_id text primary key references vertex_debug.sessions(session_id),
 record jsonb not null, status text not null default 'pending' check(status in ('pending','sending','sent')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 lease_token text, lease_until timestamptz, last_error text, delivered_at timestamptz
);
alter table vertex_debug.settlement_outbox enable row level security;
revoke all on vertex_debug.settlement_outbox from anon,authenticated;
grant all on vertex_debug.settlement_outbox to service_role;

create or replace function vertex_debug.nova_finalize_session(p_session_id text,p_record jsonb,p_snapshot jsonb,p_machine_total jsonb)
returns jsonb language plpgsql security definer set search_path=vertex_debug,pg_temp as $$
declare s sessions%rowtype; m machine_states%rowtype; ended bigint; delivery jsonb;
begin
 select * into s from sessions where session_id=p_session_id for update;
 if not found then raise exception 'SESSION_NOT_FOUND'; end if;
 if s.status='ended' then return jsonb_build_object('ok',true,'alreadyEnded',true,'record',s.result_record,'sheets',s.sheets); end if;
 select * into m from machine_states where machine_id=s.machine_id for update;
 if not found or s.status is distinct from 'active' or m.current_session_id is distinct from s.session_id or m.reset_serial is distinct from s.reset_serial_at_start then raise exception 'STALE_SESSION'; end if;
 if p_record->>'sessionId' is distinct from s.session_id or p_record->>'machineId' is distinct from s.machine_id or p_snapshot->>'playSessionId' is distinct from s.session_id then raise exception 'RECORD_OWNER_MISMATCH'; end if;
 if m.last_snapshot->>'playSessionId'=s.session_id and coalesce((p_snapshot->>'capturedAt')::numeric,0)<coalesce((m.last_snapshot->>'capturedAt')::numeric,0) then raise exception 'NEWER_SNAPSHOT_EXISTS'; end if;
 ended=(extract(epoch from clock_timestamp())*1000)::bigint;
 delivery=jsonb_build_object('ok',false,'pending',true,'status','pending');
 insert into session_results(ended_at_ms,machine_id,record) values((p_record->>'endedAtMs')::bigint,s.machine_id,p_record);
 insert into settlement_outbox(session_id,record) values(s.session_id,p_record);
 update sessions set status='ended',ended_at_ms=ended,result_record=p_record,sheets=delivery where session_id=s.session_id;
 update issued_passwords set status='ended' where session_id=s.session_id and status in ('issued','used');
 update machine_states set locked=false,current_session_id='',current_player_name='',last_snapshot=p_snapshot,
 last_ended_session=jsonb_build_object('sessionId',s.session_id,'playerName',s.player_name,'endedAt',ended,'record',p_record,'sheets',delivery,'machineTotal',p_machine_total),updated_at_ms=ended
 where machine_id=s.machine_id;
 return jsonb_build_object('ok',true,'record',p_record,'sheets',delivery);
end $$;

create or replace function vertex_debug.nova_claim_settlement(p_token text,p_session_id text default null)
returns setof vertex_debug.settlement_outbox language plpgsql security definer set search_path=vertex_debug,pg_temp as $$
declare target text;
begin
 select session_id into target from settlement_outbox where status<>'sent' and next_attempt_at<=now()
 and (lease_until is null or lease_until<now()) and (p_session_id is null or session_id=p_session_id)
 order by next_attempt_at for update skip locked limit 1;
 if target is null then return; end if;
 return query update settlement_outbox set status='sending',attempts=attempts+1,lease_token=p_token,lease_until=now()+interval '90 seconds' where session_id=target returning *;
end $$;

create or replace function vertex_debug.nova_ack_settlement(p_session_id text,p_token text,p_ok boolean,p_error text default '')
returns boolean language plpgsql security definer set search_path=vertex_debug,pg_temp as $$
declare job settlement_outbox%rowtype; summary jsonb;
begin
 select * into job from settlement_outbox where session_id=p_session_id and lease_token=p_token and status='sending' for update;
 if not found then return false; end if;
 summary=jsonb_build_object('ok',p_ok,'pending',not p_ok,'status',case when p_ok then 'sent' else 'pending' end,'attempts',job.attempts,'error',left(p_error,200));
 update settlement_outbox set status=case when p_ok then 'sent' else 'pending' end,lease_token=null,lease_until=null,
 next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(job.attempts,7)))::integer),last_error=left(p_error,200),delivered_at=case when p_ok then now() else null end where session_id=p_session_id;
 update sessions set sheets=summary where session_id=p_session_id;
 update machine_states set last_ended_session=jsonb_set(last_ended_session,'{sheets}',summary) where last_ended_session->>'sessionId'=p_session_id;
 return true;
end $$;

create or replace function vertex_debug.nova_save_snapshot(p_machine_id text,p_session_id text,p_reset_serial integer,p_snapshot jsonb)
returns boolean language plpgsql security definer set search_path=vertex_debug,pg_temp as $$
declare m machine_states%rowtype;
begin
 select * into m from machine_states where machine_id=p_machine_id for update;
 if not found or m.current_session_id is distinct from p_session_id or m.reset_serial is distinct from p_reset_serial or p_snapshot->>'playSessionId' is distinct from p_session_id then return false; end if;
 if m.last_snapshot->>'playSessionId'=p_session_id then
  if coalesce((p_snapshot->>'capturedAt')::numeric,0)<=coalesce((m.last_snapshot->>'capturedAt')::numeric,0) then return false; end if;
 end if;
 update machine_states set last_snapshot=p_snapshot,updated_at_ms=(extract(epoch from clock_timestamp())*1000)::bigint where machine_id=p_machine_id;
 return true;
end $$;

revoke all on function vertex_debug.nova_finalize_session(text,jsonb,jsonb,jsonb),vertex_debug.nova_claim_settlement(text,text),vertex_debug.nova_ack_settlement(text,text,boolean,text),vertex_debug.nova_save_snapshot(text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function vertex_debug.nova_finalize_session(text,jsonb,jsonb,jsonb),vertex_debug.nova_claim_settlement(text,text),vertex_debug.nova_ack_settlement(text,text,boolean,text),vertex_debug.nova_save_snapshot(text,text,integer,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
