const counters=['totalSpins','totalFee','totalPaid','bigCount','atFirstCount','normalSpins','highSpins'];
export function verifySnapshot(snapshot,{previous=null,now=Date.now()}={}){
 const issues=[];const s=snapshot?.stats;
 if(!s||typeof s!=='object'||Array.isArray(s))return {ok:false,issues:['stats missing']};
 for(const k of counters)if(s[k]!==undefined&&(!Number.isSafeInteger(s[k])||s[k]<0))issues.push(`${k}: nonnegative integer required`);
 for(const k of ['totalSpins','totalFee','totalPaid'])if(s[k]===undefined)issues.push(`${k}: required`);
 if(snapshot.capturedAt!==undefined&&(!Number.isSafeInteger(snapshot.capturedAt)||snapshot.capturedAt<0||snapshot.capturedAt>now+300000))issues.push('capture time invalid');
 // Accounting arithmetic is authoritative; a browser-provided net is not.
 if(s.profit!==undefined&&s.profit!==s.totalPaid-s.totalFee)issues.push('net does not equal payout minus bet');
 if(snapshot.playSessionStartStats){for(const k of ['totalSpins','totalFee','totalPaid']){
  const n=snapshot.playSessionStartStats[k];if(n!==undefined&&(!Number.isSafeInteger(n)||n<0||n>s[k]))issues.push('invalid baseline '+k);
 }}
 const stale=!!previous&&previous.playSessionId===snapshot.playSessionId&&Number(snapshot.capturedAt||0)<Number(previous.capturedAt||0);
 // Bounds are observations, not confiscation. Zero-game zones and old counter
 // epochs make a simple payout-per-spin ceiling unsafe as a hard rejection.
 const alerts=[];
 if(s.totalFee>s.totalSpins*3)alerts.push('bet exceeds counted games');
 if(previous?.playSessionId===snapshot.playSessionId&&!stale){for(const k of ['totalSpins','totalFee','totalPaid'])if(s[k]<previous.stats?.[k])alerts.push('counter regression '+k);}
 return {ok:issues.length===0,issues,alerts,stale};
}
