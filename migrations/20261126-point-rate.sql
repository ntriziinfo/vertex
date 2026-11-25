begin;
-- Existing played cabinets retain their historical 2,000 rate until reset.
update vertex_debug.machine_states set capabilities=coalesce(capabilities,'{}')||jsonb_build_object('pointRate',2000,'pointRateResetSerial',reset_serial)
where machine_type='nova' and machine_id ~ '^nova-(0[1-9]|1[0-2])$' and not (coalesce(capabilities,'{}') ? 'pointRate') and
 (coalesce(current_session_id,'')<>'' or coalesce((last_snapshot->'stats'->>'totalSpins')::numeric,0)>0 or last_ended_session is not null);

create or replace function vertex_debug.customer_claim_rate(
 p_user_id text,p_password_hash text,p_machine_id text,p_session_id text,p_token text,
 p_reset integer,p_snapshot jsonb,p_start_snapshot jsonb,p_now bigint,p_super_speed boolean,p_point_rate integer)
returns jsonb language plpgsql security definer set search_path=vertex_debug,pg_temp as $$
declare result jsonb; m machine_states%rowtype; s sessions%rowtype; rate integer; locked boolean;
begin
 if p_point_rate is null or p_point_rate not in (500,1000,2000) then return jsonb_build_object('error','rate-invalid'); end if;
 -- Reuse the authenticated, account -> machine lock order. Both operations
 -- remain inside this transaction, including resume and speed permission.
 result:=customer_claim_speed(p_user_id,p_password_hash,p_machine_id,p_session_id,p_token,p_reset,p_snapshot,p_start_snapshot,p_now,p_super_speed);
 if not coalesce((result->>'ok')::boolean,false) then return result; end if;
 select * into m from machine_states where machine_id=p_machine_id for update;
 select * into s from sessions where session_id=result->'session'->>'session_id';
 locked:=coalesce((m.capabilities->>'pointRateResetSerial')::integer=m.reset_serial,false) and (m.capabilities->>'pointRate')::integer in (500,1000,2000);
 rate:=case when locked then (m.capabilities->>'pointRate')::integer when coalesce((result->>'resumed')::boolean,false) then coalesce((s.start_snapshot->>'pointRate')::integer,2000) else p_point_rate end;
 if p_point_rate<>rate then raise exception 'RATE_LOCKED'; end if;
 update machine_states set capabilities=coalesce(capabilities,'{}')||jsonb_build_object('pointRate',rate,'pointRateResetSerial',m.reset_serial) where machine_id=p_machine_id returning * into m;
 update sessions set start_snapshot=coalesce(start_snapshot,'{}')||jsonb_build_object('pointRate',rate) where session_id=s.session_id returning * into s;
 return result||jsonb_build_object('machine',to_jsonb(m),'session',to_jsonb(s));
exception when raise_exception then
 if sqlerrm='RATE_LOCKED' then return jsonb_build_object('error','rate-locked'); end if;
 raise;
end $$;
revoke all on function vertex_debug.customer_claim_rate(text,text,text,text,text,integer,jsonb,jsonb,bigint,boolean,integer) from public,anon,authenticated;
grant execute on function vertex_debug.customer_claim_rate(text,text,text,text,text,integer,jsonb,jsonb,bigint,boolean,integer) to service_role;
notify pgrst,'reload schema';
commit;
