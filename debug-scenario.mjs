export const AT_FORCE_RESULTS=Object.freeze(["MISS","ONE_COIN","REPLAY","BELL","BELL15","WEAK_SUICA","WEAK_NOVA","STRONG_NOVA","SUPER_NOVA","URA_CHALLENGE","SORTIE_AIM_WIN_RED","ZONE_sosuke","ZONE_toto","ZONE_urapi","ZONE_giru","ZONE_sora","ZONE_ouma","ZONE_ura_giru","ZONE_ura_sora","ZONE_ura_ouma"]);
export function scenarioCommand(input,{storeId,machine,uuid,sortieG}){
 if(storeId!=='store-debug'||!/^nova-(0[1-9]|1[0-2])$/.test(machine?.machineId||''))throw new Error('対象はデバッグ店舗の1〜12番台です');
 if(!machine.currentSessionId)throw new Error('着席中の台を指定してください');
 const base={type:input.type,id:uuid,machineId:machine.machineId,sessionId:machine.currentSessionId};
 if(input.type==='cancelDebugScenario'||input.type==='cancelDebugAtForce')return base;
 if(input.type==='reserveDebugAtForce'){
  if(!AT_FORCE_RESULTS.includes(input.result))throw new Error('AT強制フラグが不正です');
  return {...base,result:input.result};
 }
 if(input.type!=='reserveDebugScenario'||!Number.isInteger(input.zoneG)||input.zoneG<100||input.zoneG>800||input.zoneG%100)throw new Error('指定Gが不正です');
 return {...base,zoneG:input.zoneG,at:input.at===true,upper:input.upper===true,sortie:input.sortie===true,sortieG};
}
