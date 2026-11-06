export async function customerPlayerNames(machines,read){
 const ids=[...new Set(machines.map(m=>m.currentSessionId).filter(Boolean))];
 if(!ids.length)return machines;
 const filter=values=>'in.('+values.map(value=>JSON.stringify(String(value))).join(',')+')';
 const links=await read('customer_sessions?session_id='+encodeURIComponent(filter(ids))+'&select=session_id,user_id');
 const userIds=[...new Set(links.map(row=>row.user_id).filter(Boolean))];
 if(!userIds.length)return machines;
 const accounts=await read('customer_accounts?user_id='+encodeURIComponent(filter(userIds))+'&select=user_id,display_name');
 const names=new Map(accounts.map(row=>[row.user_id,String(row.display_name||'').trim()||row.user_id]));
 const sessions=new Map(links.map(row=>[row.session_id,names.get(row.user_id)||row.user_id]));
 return machines.map(machine=>sessions.has(machine.currentSessionId)?{...machine,currentPlayerName:sessions.get(machine.currentSessionId)}:machine);
}
