import test from 'node:test';
import assert from 'node:assert/strict';
import {customerPlayerNames} from '../customer-player-names.mjs';
test('admin names use optional registered name, fall back to user ID, and preserve session identity',async()=>{
 const rows=[{currentSessionId:'s1',currentPlayerName:'id1'},{currentSessionId:'s2',currentPlayerName:'id2'},{currentSessionId:'',currentPlayerName:''}];
 const read=async path=>path.startsWith('customer_sessions?')?[{session_id:'s1',user_id:'id1'},{session_id:'s2',user_id:'id2'}]:[{user_id:'id1',display_name:'  宗介  '},{user_id:'id2',display_name:' '}];
 const named=await customerPlayerNames(rows,read);
 assert.equal(named[0].currentPlayerName,'宗介');assert.equal(named[1].currentPlayerName,'id2');assert.equal(named[2].currentPlayerName,'');assert.equal(rows[0].currentPlayerName,'id1');assert.equal(named[0].currentSessionId,'s1');
});
test('empty floor needs no customer lookups',async()=>{assert.deepEqual(await customerPlayerNames([],()=>{throw Error('unexpected query')}),[]);});
