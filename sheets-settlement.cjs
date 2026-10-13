// NEBULA's customer site and debug admin share store-debug seats.
// Keep this scoped by store as well as type: NOVA at another store is excluded.
function sheetsSettlement(record){
  if(!record || !["store-debug", "store-nebula"].includes(record.storeId) || record.machineType !== "nova") return record;
  const rawPlayerProfit = Number(record.playerProfit);
  if(!Number.isFinite(rawPlayerProfit) || rawPlayerProfit <= 0) return record;
  const playerProfit = Math.floor(rawPlayerProfit * 9 / 10);
  // Only the outbound billing field changes. Saved results and play statistics
  // remain gross of the exchange gap, including totalFee/totalPaid and profit.
  return {...record, playerProfit, rawPlayerProfit, exchangeGapRate:0.10, exchangeGapPt:rawPlayerProfit - playerProfit};
}

module.exports = {sheetsSettlement};
