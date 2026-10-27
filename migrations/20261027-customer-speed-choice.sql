begin;
CREATE OR REPLACE FUNCTION vertex_debug.customer_claim_speed(p_user_id text,p_password_hash text,p_machine_id text,p_session_id text,p_token text,p_reset integer,p_snapshot jsonb,p_start_snapshot jsonb,p_now bigint,p_super_speed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'vertex_debug','pg_temp' AS $$
declare result jsonb; m machine_states%rowtype;
begin
 result := customer_claim(p_user_id,p_password_hash,p_machine_id,p_session_id,p_token,p_reset,p_snapshot,p_start_snapshot,p_now);
 if coalesce((result->>'ok')::boolean,false) then
  update machine_states set capabilities=capabilities||jsonb_build_object('superSpeedAllowed',coalesce(p_super_speed,false))
   where machine_id=p_machine_id and current_session_id=result->'session'->>'session_id' returning * into m;
  result:=jsonb_set(result,'{machine}',to_jsonb(m));
 end if;
 return result;
end $$;
REVOKE ALL ON FUNCTION vertex_debug.customer_claim_speed(text,text,text,text,text,integer,jsonb,jsonb,bigint,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION vertex_debug.customer_claim_speed(text,text,text,text,text,integer,jsonb,jsonb,bigint,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
commit;
