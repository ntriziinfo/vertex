export function scenarioCommand(input,{storeId,machine,uuid,sortieG}){
 if(storeId!=='store-debug'||!/^nova-(0[1-9]|1[0-2])$/.test(machine?.machineId||''))throw new Error('対象はデバッグ店舗の1〜12番台です');
 if(!machine.currentSessionId)throw new Error('着席中の台を指定してください');
 const base={type:input.type,id:uuid,machineId:machine.machineId,sessionId:machine.currentSessionId};
 if(input.type==='cancelDebugScenario')return base;
 if(input.type!=='reserveDebugScenario'||!Number.isInteger(input.zoneG)||input.zoneG<100||input.zoneG>800||input.zoneG%100)throw new Error('指定Gが不正です');
 return {...base,zoneG:input.zoneG,at:input.at===true,upper:input.upper===true,sortie:input.sortie===true,sortieG};
}
