// Deployed to the existing NOVA revenue spreadsheet only.
// A:Q are settlement fields. R:U contain accounting formulas: never write them.
function doGet(){return ContentService.createTextOutput(JSON.stringify({ok:true,version:'settlement-v2-20261104'})).setMimeType(ContentService.MimeType.JSON);}
function doPost(e) {
  const data=JSON.parse(e.postData.contents);
  if(!data.sessionId || data.storeId!=='store-debug' || !data.endedAt)throw new Error('invalid settlement identity');
  const book=SpreadsheetApp.getActiveSpreadsheet();
  const sheet=book.getSheetByName('results');
  if(!sheet)throw new Error('results sheet missing');
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    const key='store-debug:'+String(data.sessionId);
    const last=Math.max(3,sheet.getLastRow());
    const keys=sheet.getRange(3,22,last-2,1).getValues().flat();
    const found=keys.indexOf(key),duplicate=found>=0,row=duplicate?found+3:last+1;
    // Persist the receipt first so a retry after a crash completes the same row.
    if(!duplicate){sheet.getRange(row,22).setValue(key);SpreadsheetApp.flush();}
    if(!duplicate || !sheet.getRange(row,1).getValue()){
      sheet.getRange(row,1,1,17).setValues([[
        data.endedAt,data.machineId,data.playerName,data.setting,
        data.totalSpins,data.bigCount,data.regCount,data.grapeCount,data.totalFee,
        data.totalPaid,data.profit,data.playerProfit,data.playerTotalFee,data.playerTotalPaid,
        data.playerSpins,data.playerBigCount,data.playerRegCount
      ]]);
      SpreadsheetApp.flush();
    }
    if(data.machineType==='nova' && Array.isArray(data.superSpeedUsage)){
      const cash=book.getSheetByName('超ハイスピード利用料');
      if(!cash)throw new Error('超ハイスピード利用料シートがありません');
      const rows=cash.getRange(5,1,Math.max(1,cash.getLastRow()-4),4).getDisplayValues();
      const seen=new Set(rows.filter(r=>r[0]&&r[1]).map(r=>r[0]+'|'+r[1]));
      let next=4;rows.forEach((r,i)=>{if(r[0]||r[1])next=i+5;});
      for(const usage of data.superSpeedUsage){
        if(!/^\d{4}\/\d{2}\/\d{2}$/.test(usage.businessDate)||!data.playerName)continue;
        const usageKey=usage.businessDate+'|'+data.playerName;if(seen.has(usageKey))continue;
        cash.getRange(++next,1,1,4).setValues([[usage.businessDate,data.playerName,1000000,usage.usedAt||'']]);
        seen.add(usageKey);
      }
    }
    SpreadsheetApp.flush();
    return ContentService.createTextOutput(JSON.stringify({ok:true,sessionId:data.sessionId,duplicate})).setMimeType(ContentService.MimeType.JSON);
  } finally {lock.releaseLock();}
}
