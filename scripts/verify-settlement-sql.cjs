const fs=require('node:fs');
const {api}=require('../../supabase-ops/inspect-account.cjs');
async function main(){
 const schema='nova_reliability_qa';
 const migration=fs.readFileSync('migrations/20261104-nova-settlement.sql','utf8').replace(/^begin;\s*/,'').replace(/notify pgrst,'reload schema';\s*commit;\s*$/,'').replaceAll('vertex_debug',schema);
 const query=`begin;
 create schema ${schema};
 create table ${schema}.sessions as table vertex_debug.sessions with no data;
 alter table ${schema}.sessions add primary key(session_id);
 create table ${schema}.machine_states as table vertex_debug.machine_states with no data;
 create table ${schema}.issued_passwords as table vertex_debug.issued_passwords with no data;
 create table ${schema}.session_results as table vertex_debug.session_results with no data;
 ${migration}
 insert into ${schema}.sessions(session_id,machine_id,status,reset_serial_at_start,player_name) values('qa-s','qa-m','active',1,'QA');
 insert into ${schema}.machine_states(machine_id,current_session_id,reset_serial,last_snapshot) values('qa-m','qa-s',1,'{"playSessionId":"qa-s","capturedAt":1}');
 do $$ declare r jsonb; c integer; begin
 if not ${schema}.nova_save_snapshot('qa-m','qa-s',1,'{"playSessionId":"qa-s","capturedAt":5}') then raise exception 'save failed'; end if;
 if ${schema}.nova_save_snapshot('qa-m','qa-s',1,'{"playSessionId":"qa-s","capturedAt":4}') then raise exception 'stale save accepted'; end if;
 if ${schema}.nova_save_snapshot('qa-m','qa-s',0,'{"playSessionId":"qa-s","capturedAt":6}') then raise exception 'reset epoch bypass'; end if;
 begin perform ${schema}.nova_finalize_session('qa-s','{"sessionId":"qa-s","machineId":"qa-m","endedAtMs":10}','{"playSessionId":"qa-s","capturedAt":3}','{}');raise exception 'stale end accepted';exception when others then if sqlerrm not like '%NEWER_SNAPSHOT_EXISTS%' then raise;end if;end;
 r=${schema}.nova_finalize_session('qa-s','{"sessionId":"qa-s","machineId":"qa-m","endedAtMs":10}','{"playSessionId":"qa-s","capturedAt":5}','{}');
 r=${schema}.nova_finalize_session('qa-s','{}','{}','{}');
 if not (r->>'alreadyEnded')::boolean then raise exception 'end not idempotent'; end if;
 select count(*) into c from ${schema}.session_results;if c<>1 then raise exception 'duplicate result';end if;
 if ${schema}.nova_save_snapshot('qa-m','qa-s',1,'{"playSessionId":"qa-s","capturedAt":6}') then raise exception 'ended session wrote snapshot'; end if;
 perform ${schema}.nova_claim_settlement('lease1');
 select count(*) into c from ${schema}.nova_claim_settlement('lease2');if c<>0 then raise exception 'double lease';end if;
 if ${schema}.nova_ack_settlement('qa-s','wrong',true) then raise exception 'wrong lease accepted';end if;
 perform ${schema}.nova_ack_settlement('qa-s','lease1',false,'offline');
 select count(*) into c from ${schema}.nova_claim_settlement('lease2');if c<>0 then raise exception 'backoff missing';end if;
 update ${schema}.settlement_outbox set next_attempt_at=now()-interval '1 second';
 perform ${schema}.nova_claim_settlement('lease2');perform ${schema}.nova_ack_settlement('qa-s','lease2',true);
 select count(*) into c from ${schema}.nova_claim_settlement('lease3');if c<>0 then raise exception 'sent job reclaimed';end if;
 if has_function_privilege('anon','${schema}.nova_finalize_session(text,jsonb,jsonb,jsonb)','execute') then raise exception 'public finalize';end if;
 end $$;
 select 'transaction, stale write, duplicate end, lease, backoff, receipt and permissions passed' as verification;
 rollback;`;
 console.log(JSON.stringify(await api('/v1/projects/kruhmbpzshunbvniuccz/database/query',{query})));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
