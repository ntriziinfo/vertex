/* Compare displayed machine data, ignoring heartbeat timestamps only. */
globalThis.NovaListPerformance=Object.freeze({
 same(previous,next){
  if(!Array.isArray(previous)||!Array.isArray(next))return false;
  const display=rows=>rows.map(({updatedAt,...machine})=>machine);
  return JSON.stringify(display(previous))===JSON.stringify(display(next));
 }
});
