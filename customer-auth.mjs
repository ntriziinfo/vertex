import {randomBytes, scrypt as rawScrypt, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(rawScrypt);
export const enabled=(env=process.env)=>env.VERTEX_STORE_ID==='store-debug'&&env.CUSTOMER_LOGIN_PILOT==='1';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
export function userId(value){
  if(typeof value!=='string'||!/^[-_a-zA-Z0-9]{3,32}$/.test(value))throw fail(400,'ユーザーIDは半角英数字・ハイフン・_の3〜32文字です');
  return value.toLowerCase();
}
export function password(value){
  if(typeof value!=='string'||value.length<8||value.length>128)throw fail(400,'パスワードは8〜128文字です');
  return value;
}
export async function hashPassword(value){
  const salt=randomBytes(16).toString('hex');
  return `scrypt:${salt}:${Buffer.from(await scrypt(password(value),salt,64)).toString('hex')}`;
}
export async function verifyPassword(value,encoded){
  const match=/^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(encoded||'');
  const salt=match?.[1]||'00000000000000000000000000000000';
  const actual=Buffer.from(await scrypt(value,salt,64));
  return timingSafeEqual(actual,Buffer.from(match?.[2]||'00'.repeat(64),'hex'))&&!!match;
}
export function secretMatches(a,b){const x=createHash('sha256').update(String(a||'')).digest(),y=createHash('sha256').update(String(b||'')).digest();return !!b&&timingSafeEqual(x,y);}
export function createCustomerAuth({env=process.env,repo}){
  function check(){if(!enabled(env))throw fail(404,'not found');}
  return {
    async sync(body,secret){
      check();
      if(!secretMatches(secret,env.CUSTOMER_SYNC_SECRET)||String(env.CUSTOMER_SYNC_SECRET||'').length<32)throw fail(403,'登録権限がありません');
      const id=userId(body.userId);
      if(!['有効','停止'].includes(body.status))throw fail(400,'状態は有効または停止にしてください');
      const existing=await repo.find(id);
      if(!existing&&!body.password)throw fail(400,'初回登録にはパスワードが必要です');
      const hash=body.password?await hashPassword(body.password):existing.password_hash;
      await repo.save({user_id:id,password_hash:hash,enabled:body.status==='有効'});
      return {ok:true,userId:id};
    },
    async start(body,ip='unknown'){
      check();
      // Durable counters are shared across serverless instances; no passwords in keys/logs.
      const rawId=String(body.userId||'').toLowerCase().slice(0,128);
      const keys=[['ip',ip,80],['id',rawId,15]];
      for(const [kind,value,limit] of keys){
        const key=createHash('sha256').update(kind+':'+value).digest('hex');
        if(!await repo.consume(key,limit))throw fail(429,'試行回数が多いため、15分後に再度お試しください');
      }
      const id=userId(body.userId),pass=password(body.password);
      if(body.requestedMachineId!=='nova-13')throw fail(400,'台選びから遊技台を選択してください');
      const account=await repo.find(id);
      const valid=await verifyPassword(pass,account?.password_hash);
      if(!valid||!account?.enabled)throw fail(403,'ユーザーIDまたはパスワードを確認してください');
      // Reservation is transactional: same user resumes, another user's seat is never taken.
      return repo.claim({userId:id,machineId:body.requestedMachineId,passwordHash:account.password_hash});
    }
  };
}
