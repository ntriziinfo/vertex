begin;
create table if not exists vertex_debug.customer_speed_days(user_id text references vertex_debug.customer_accounts(user_id),business_date date not null,granted_at_ms bigint not null,primary key(user_id,business_date));
alter table vertex_debug.customer_speed_days enable row level security;
revoke all on vertex_debug.customer_speed_days from public,anon,authenticated;
grant all on vertex_debug.customer_speed_days to service_role;
-- Recover existing paid/allowed activity using stable authenticated IDs.
insert into vertex_debug.customer_speed_days
select cs.user_id,((to_timestamp(e.occurred_at_ms/1000.0) at time zone 'Asia/Tokyo')-interval '3 hours')::date,min(e.occurred_at_ms)
from vertex_debug.super_speed_activity e join vertex_debug.customer_sessions cs using(session_id)
where e.event_type in ('allowed','used') group by 1,2 on conflict do nothing;
insert into vertex_debug.customer_speed_days
select cs.user_id,((to_timestamp(s.started_at_ms/1000.0) at time zone 'Asia/Tokyo')-interval '3 hours')::date,s.started_at_ms
from vertex_debug.machine_states m join vertex_debug.sessions s on s.session_id=m.current_session_id join vertex_debug.customer_sessions cs using(session_id)
where m.capabilities->>'superSpeedAllowed'='true' on conflict do nothing;
CREATE OR REPLACE FUNCTION vertex_debug.customer_claim_speed(p_user_id text,p_password_hash text,p_machine_id text,p_session_id text,p_token text,p_reset integer,p_snapshot jsonb,p_start_snapshot jsonb,p_now bigint,p_super_speed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'vertex_debug','pg_temp' AS $$
declare result jsonb; m machine_states%rowtype; day date; allowed boolean; expires bigint;
begin
 result:=customer_claim(p_user_id,p_password_hash,p_machine_id,p_session_id,p_token,p_reset,p_snapshot,p_start_snapshot,p_now);
 if not coalesce((result->>'ok')::boolean,false) then return result; end if;
 day:=((to_timestamp(p_now/1000.0) at time zone 'Asia/Tokyo')-interval '3 hours')::date;
 if coalesce(p_super_speed,false) then insert into customer_speed_days values(p_user_id,day,p_now) on conflict do nothing; end if;
 allowed:=exists(select 1 from customer_speed_days where user_id=p_user_id and business_date=day);
 expires:=(extract(epoch from ((day+1+time '03:00') at time zone 'Asia/Tokyo'))*1000)::bigint;
 update machine_states set capabilities=capabilities||jsonb_build_object('superSpeedAllowed',allowed,'superSpeedAutoStart',allowed,'superSpeedExpiresAt',case when allowed then expires else 0 end)
 where machine_id=p_machine_id and current_session_id=result->'session'->>'session_id' returning * into m;
 return jsonb_set(result,'{machine}',to_jsonb(m));
end $$;
REVOKE ALL ON FUNCTION vertex_debug.customer_claim_speed(text,text,text,text,text,integer,jsonb,jsonb,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION vertex_debug.customer_claim_speed(text,text,text,text,text,integer,jsonb,jsonb,bigint,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
commit;
