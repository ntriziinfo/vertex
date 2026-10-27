import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const code=readFileSync(new URL('../customer-sheet.gs',import.meta.url),'utf8');
function fixture(){
 const rows=[[],[],[],['名前（任意）','ユーザーID','登録・変更パスワード','状態','登録結果','更新日時','登録済みID'],['トーマス','first','','有効','登録済み','','first'],['とーます','second','test-password','有効','','','']];
 let calls=0,alerts=0,locked=false; const props=new Map();
 const sheet={getName:()=> '顧客登録',getSheetId:()=>1,getLastRow:()=>rows.length,getRange(r,c,n=1,w=1){return {getDisplayValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>String(rows[r+i-1]?.[c+j-1]??''))),getDisplayValue:()=>String(rows[r-1]?.[c-1]??''),setValue(v){rows[r-1][c-1]=v;},setValues(v){v.forEach((a,i)=>a.forEach((x,j)=>rows[r+i-1][c+j-1]=x));}};}};
 const ui={ButtonSet:{OK:1},alert(){assert.equal(locked,false);alerts++;}};
 const ctx=vm.createContext({SpreadsheetApp:{flush(){},getUi:()=>ui},PropertiesService:{getDocumentProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)}),getScriptProperties:()=>({getProperty:k=>k==='CUSTOMER_API_ORIGIN'?'https://vertex-debug.vercel.app':'x'.repeat(32)})},LockService:{getDocumentLock:()=>({waitLock(){locked=true;},releaseLock(){locked=false;}})},UrlFetchApp:{fetch(){calls++;return {getContentText:()=>'{"ok":true}',getResponseCode:()=>200};}}});
 vm.runInContext(code,ctx);
 const edit=(col,value,oldValue)=>{rows[5][col-1]=value;ctx.customerRegistrationEdited({range:{getSheet:()=>sheet,getColumn:()=>col,getRow:()=>6,getLastRow:()=>6,getNumRows:()=>1,getNumColumns:()=>1},value,oldValue});};
 return {ctx,sheet,rows,edit,get calls(){return calls;},get alerts(){return alerts;}};
}
test('normalization and one edit for names of at least three characters',()=>{const {ctx}=fixture();for(const [a,b] of [['トーマス','とーます'],['ＡＢＣ','abc'],['ﾄｰﾏｽ','トー マス'],['エスターク','エスタク'],['トーマス','トーマズ']])assert.ok(ctx.similarCustomerNames_(a,b));for(const [a,b] of [['',''],['あい','あう'],['abc','xyz'],['トーマス','ウェスカー']])assert.equal(ctx.similarCustomerNames_(a,b),false);});
test('new duplicate is held with popup and no sync; explicit approval persists',()=>{const f=fixture();f.edit(4,'有効','');assert.equal(f.rows[5][3],'保留');assert.equal(f.calls,0);assert.equal(f.alerts,1);f.edit(4,'有効','保留');assert.equal(f.calls,1);assert.equal(f.rows[5][4],'登録済み');f.ctx.registerCustomerRow_(f.sheet,6);assert.equal(f.calls,2);});
test('held remains held during password changes',()=>{const f=fixture();f.edit(4,'有効','');f.edit(3,'changed','test-password');assert.equal(f.calls,0);assert.equal(f.rows[5][3],'保留');});
test('approval never bypasses duplicate user ID',()=>{const f=fixture();f.rows[5][1]='first';f.edit(4,'有効','');f.edit(4,'有効','保留');assert.equal(f.calls,0);assert.match(f.rows[5][4],/ユーザーIDが重複/);});
test('blank optional name and different names register normally',()=>{for(const name of ['','ウェスカー']){const f=fixture();f.rows[5][0]=name;f.ctx.registerCustomerRow_(f.sheet,6);assert.equal(f.calls,1);}});
test('existing customers are not retroactively held, but renamed customers are reviewed',()=>{const f=fixture();f.rows[5][6]='second';f.ctx.registerCustomerRow_(f.sheet,6);assert.equal(f.calls,1);f.edit(1,'トーマズ','とーます');assert.equal(f.rows[5][3],'保留');assert.equal(f.calls,1);});
test('stopped users remain stoppable; new name can be held before ID entry',()=>{const f=fixture();f.rows[5][3]='停止';f.ctx.registerCustomerRow_(f.sheet,6);assert.equal(f.calls,1);const g=fixture();g.rows[5][1]='';g.edit(1,'トーマス','');assert.equal(g.rows[5][3],'保留');assert.equal(g.alerts,1);assert.equal(g.calls,0);});
