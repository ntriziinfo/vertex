begin;
CREATE OR REPLACE FUNCTION vertex_debug.customer_claim(p_user_id text, p_password_hash text, p_machine_id text, p_session_id text, p_token text, p_reset integer, p_snapshot jsonb, p_start_snapshot jsonb, p_now bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'vertex_debug', 'pg_temp'
AS $function$
declare a customer_accounts%rowtype; m machine_states%rowtype; s sessions%rowtype;
begin
 select * into a from customer_accounts where user_id=p_user_id for update;
 if not found or not a.enabled or a.password_hash<>p_password_hash then return jsonb_build_object('error','credentials'); end if;
 select * into m from machine_states where machine_id=p_machine_id and store_id='store-debug' for update;
 if not found or p_machine_id !~ '^nova-(0[1-9]|1[0-3])$' then return jsonb_build_object('error','machine'); end if;
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
end $function$
;
NOTIFY pgrst, 'reload schema';
commit;
