const ROLE_STAT_KEYS = ["normalRoleGames", "normalRoleSuikaCount", "normalRoleWeakNovaCount", "normalRoleStrongNovaCount", "normalRoleReplayCount", "normalRoleBellCount", "normalRoleNaviBellCount"];
const DATA_STAT_KEYS = ["dataNormalGames", "dataAtGames", "dataHitSeq"];
const STAT_KEYS = ["totalSpins", "bigCount", "midCount", "atFirstCount", "totalFee", "totalPaid", ...ROLE_STAT_KEYS, ...DATA_STAT_KEYS];

function num(value){
  return Number(value) || 0;
}

function stat(stats, key){
  return num(stats && stats[key]);
}

function statsProfit(stats){
  return num(stats && (stats.profit ?? (stat(stats, "totalPaid") - stat(stats, "totalFee"))));
}

function normalizeHistory(points){
  const normalized = (Array.isArray(points) ? points : [])
    .map(point=>({spin:Math.max(0, num(point && point.spin)), profit:num(point && point.profit)}))
    .sort((a,b)=>a.spin-b.spin);
  const deduped = [];
  for(const point of normalized){
    const last = deduped[deduped.length - 1];
    if(last && last.spin === point.spin) deduped[deduped.length - 1] = point;
    else deduped.push(point);
  }
  if(!deduped.length || deduped[0].spin !== 0) deduped.unshift({spin:0, profit:0});
  return deduped;
}

function appendPoint(points, point){
  const next = {spin:Math.max(0, num(point.spin)), profit:num(point.profit)};
  const last = points[points.length - 1];
  if(last && last.spin === next.spin) points[points.length - 1] = next;
  else if(!last || last.spin < next.spin) points.push(next);
}

function playerHistory(endStats, startStats, playerStats){
  const startSpin = Math.max(0, stat(startStats, "totalSpins"));
  const startProfit = statsProfit(startStats);
  const endSpin = Math.max(0, stat(playerStats, "totalSpins"));
  const endProfit = statsProfit(playerStats);
  const points = [{spin:0, profit:0}];
  for(const point of normalizeHistory(endStats && endStats.slumpHistory)){
    if(point.spin < startSpin) continue;
    appendPoint(points, {spin:point.spin - startSpin, profit:point.profit - startProfit});
  }
  appendPoint(points, {spin:endSpin, profit:endProfit});
  return points;
}

function playerView(endStats={}, startStats={}, explicit={}){
  const countersReset = stat(endStats, "totalSpins") < stat(startStats, "totalSpins")
    || stat(endStats, "totalFee") < stat(startStats, "totalFee")
    || stat(endStats, "totalPaid") < stat(startStats, "totalPaid");
  const baselineStats = countersReset ? {} : startStats;
  const stats = {};
  for(const key of STAT_KEYS) stats[key] = Math.max(0, stat(endStats, key) - stat(baselineStats, key));
  // This is the current phase's interval, not a per-player cumulative counter.
  if(['normal','art'].includes(endStats.dataInterval?.phase)) stats.dataInterval={phase:endStats.dataInterval.phase,games:Math.max(0,num(endStats.dataInterval.games))};
  stats.dataHits=(Array.isArray(endStats.dataHits)?endStats.dataHits:[])
    .filter(hit=>num(hit.seq)>stat(baselineStats,'dataHitSeq')&&['BIG','AT','ZONE'].includes(hit.kind))
    .slice(-20).map(hit=>({seq:num(hit.seq)-stat(baselineStats,'dataHitSeq'),spin:Math.max(0,num(hit.spin)-stat(baselineStats,'totalSpins')),kind:hit.kind,zone:String(hit.zone||''),games:Math.max(0,num(hit.games)),...(['normal','art'].includes(hit.phase)?{phase:hit.phase}:{})}));
  const explicitMap = {
    totalSpins:"playerSpins",
    bigCount:"playerBigCount",
    midCount:"playerRegCount",
    totalFee:"playerTotalFee",
    totalPaid:"playerTotalPaid"
  };
  for(const [key, explicitKey] of Object.entries(explicitMap)){
    if(explicit[explicitKey] !== undefined && explicit[explicitKey] !== null){
      stats[key] = Math.max(0, num(explicit[explicitKey]));
    }
  }
  stats.atFirstCountPartial = endStats.atFirstCount == null || !!endStats.atFirstCountPartial;
  stats.profit = explicit.playerProfit !== undefined && explicit.playerProfit !== null
    ? num(explicit.playerProfit)
    : statsProfit(endStats) - statsProfit(baselineStats);
  if(stats.totalSpins === 0 && stats.totalFee === 0 && stats.totalPaid === 0) stats.profit = 0;
  const history = playerHistory(endStats, baselineStats, stats);
  stats.slumpHistory = history;
  return {stats, history};
}

function playerViewForResult(record){
  const endStats = record.stats || {
    totalSpins:record.totalSpins,
    bigCount:record.bigCount,
    atFirstCount:record.atFirstCount,
    atFirstCountPartial:record.atFirstCountPartial,
    midCount:record.regCount,
    totalFee:record.totalFee,
    totalPaid:record.totalPaid,
    profit:record.profit,
    slumpHistory:record.slumpHistory
  };
  return playerView(endStats, record.startStats || {}, record);
}

function emptyTotal(){
  const stats = {...Object.fromEntries(STAT_KEYS.map(key=>[key,0])), dataHits:[], atFirstCountPartial:false, profit:0};
  const history = [{spin:0, profit:0}];
  stats.slumpHistory = history;
  return {stats, history};
}

function appendPlayerView(aggregate, view){
  const baseSpin = stat(aggregate.stats, "totalSpins");
  const baseProfit = statsProfit(aggregate.stats);
  const baseHitSeq=stat(aggregate.stats,'dataHitSeq');
  for(const hit of view.stats.dataHits||[]){
    const spin=baseSpin+num(hit.spin),previous=aggregate.stats.dataHits.at(-1);
    aggregate.stats.dataHits.push({...hit,seq:baseHitSeq+num(hit.seq),spin,games:hit.phase?num(hit.games):previous?Math.max(0,spin-previous.spin):num(hit.games)});
  }
  aggregate.stats.dataHits=aggregate.stats.dataHits.slice(-20);
  for(const key of STAT_KEYS) aggregate.stats[key] = stat(aggregate.stats, key) + stat(view.stats, key);
  if(view.stats.dataInterval) aggregate.stats.dataInterval={...view.stats.dataInterval};
  aggregate.stats.atFirstCountPartial ||= !!view.stats.atFirstCountPartial;
  aggregate.stats.profit = baseProfit + statsProfit(view.stats);
  appendPoint(aggregate.history, {spin:baseSpin, profit:baseProfit});
  for(const point of normalizeHistory(view.history)){
    appendPoint(aggregate.history, {spin:baseSpin + point.spin, profit:baseProfit + point.profit});
  }
  appendPoint(aggregate.history, {spin:stat(aggregate.stats, "totalSpins"), profit:aggregate.stats.profit});
  aggregate.stats.slumpHistory = aggregate.history;
}

function hasResetSerial(record){
  return record && record.resetSerial !== undefined && record.resetSerial !== null && record.resetSerial !== "";
}

function recordsForMachine(machine, records){
  const serial = num(machine.resetSerial);
  const unique = new Map();
  const addRecord = (record, trustCurrentCycle=false)=>{
    if(!record || String(record.machineId) !== String(machine.machineId)) return;
    const hasSerial = hasResetSerial(record);
    if(!trustCurrentCycle && (!hasSerial || num(record.resetSerial) !== serial)) return;
    if(trustCurrentCycle && hasSerial && num(record.resetSerial) !== serial) return;
    const key = String(record.sessionId || `${record.endedAtMs || record.endedAt}-${record.playerName || ""}`);
    if(!unique.has(key)) unique.set(key, record);
  };
  for(const record of records) addRecord(record);
  addRecord(machine.lastEndedSession && machine.lastEndedSession.record, true);
  return [...unique.values()].sort((a,b)=>{
    const aTime = num(a.endedAtMs) || Date.parse(a.endedAt) || 0;
    const bTime = num(b.endedAtMs) || Date.parse(b.endedAt) || 0;
    return aTime - bTime;
  });
}

function currentPlayerView(machine){
  if(!machine.currentSessionId) return null;
  const snapshot = machine.lastSnapshot || {};
  if(String(snapshot.playSessionId || "") !== String(machine.currentSessionId)) return emptyTotal();
  return playerView(snapshot.stats || {}, snapshot.playSessionStartStats || {});
}

function compactHistory(points, maxPoints=720){
  const normalized = normalizeHistory(points);
  if(normalized.length <= maxPoints) return normalized;
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  const firstSpin = num(first.spin);
  const lastSpin = num(last.spin);
  const spinRange = lastSpin - firstSpin;
  if(spinRange <= 0) return normalized.slice(-maxPoints);

  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const buckets = Array.from({length:bucketCount}, ()=>({min:null, max:null}));
  for(let index=1;index<normalized.length - 1;index++){
    const point = normalized[index];
    const bucketIndex = Math.min(bucketCount - 1, Math.max(0,
      Math.floor(((num(point.spin) - firstSpin) / spinRange) * bucketCount)
    ));
    const entry = {index, point};
    const bucket = buckets[bucketIndex];
    if(!bucket.min || point.profit < bucket.min.point.profit) bucket.min = entry;
    if(!bucket.max || point.profit > bucket.max.point.profit) bucket.max = entry;
  }

  const output = [first];
  for(const bucket of buckets){
    const candidates = [bucket.min, bucket.max].filter(Boolean).sort((a,b)=>a.index-b.index);
    for(const candidate of candidates){
      if(output[output.length - 1] !== candidate.point) appendPoint(output, candidate.point);
    }
  }
  appendPoint(output, last);
  return output.slice(0, maxPoints);
}

function machineTotalFor(machine, records=[]){
  const aggregate = emptyTotal();
  const saved = machine.lastEndedSession?.machineTotal;
  const hasSaved = saved && saved.sessionId === machine.lastEndedSession.sessionId
    && num(saved.resetSerial) === num(machine.resetSerial) && saved.stats && Array.isArray(saved.history);
  if(hasSaved){
    appendPlayerView(aggregate, saved);
    // Checkpoints created before interval aggregation can recover from their matching final snapshot.
    const snapshot=machine.lastSnapshot;
    if(!aggregate.stats.dataInterval&&snapshot?.playSessionId===saved.sessionId&&['normal','art'].includes(snapshot.stats?.dataInterval?.phase)){
      aggregate.stats.dataInterval={phase:snapshot.stats.dataInterval.phase,games:Math.max(0,num(snapshot.stats.dataInterval.games))};
    }
  }
  const completed = hasSaved ? [] : recordsForMachine(machine, records);
  for(const record of completed) appendPlayerView(aggregate, playerViewForResult(record));
  const current = currentPlayerView(machine);
  if(current) appendPlayerView(aggregate, current);
  if(!hasSaved && !completed.length && !current && machine.lastSnapshot && machine.lastSnapshot.stats){
    appendPlayerView(aggregate, playerView(machine.lastSnapshot.stats));
  }
  aggregate.history = compactHistory(aggregate.history);
  aggregate.stats.slumpHistory = aggregate.history;
  return aggregate;
}

function completedMachineTotal(machine, record, records=[]){
  const total=machineTotalFor({...machine,currentSessionId:record.sessionId,lastSnapshot:{
    playSessionId:record.sessionId,stats:record.stats||{},playSessionStartStats:record.startStats||{}
  }},records.filter(item=>item.sessionId!==record.sessionId));
  return {...total,resetSerial:num(machine.resetSerial),sessionId:record.sessionId};
}

function machineDisplayBaseline(machine, records=[]){
  const {stats,history}=machineTotalFor({...machine,currentSessionId:'',lastSnapshot:null},records);
  return {...Object.fromEntries([...ROLE_STAT_KEYS,...DATA_STAT_KEYS].map(key=>[key,stat(stats,key)])),...(stats.dataInterval?{dataInterval:{...stats.dataInterval}}:{}),dataHits:stats.dataHits,slumpHistory:compactHistory(history,40),profit:stats.profit,totalSpins:stats.totalSpins,bigCount:stats.bigCount,atFirstCount:stats.atFirstCount,
    atFirstCountPartial:stats.atFirstCountPartial,sinceBonus:num(machine.lastSnapshot?.machineDisplayStats?.sinceBonus ?? machine.lastSnapshot?.normalState?.sinceBonus)};
}

module.exports = {machineTotalFor,completedMachineTotal,machineDisplayBaseline};
