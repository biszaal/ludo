/** Real multi-session checks in a disposable, socket-only PostgreSQL cluster.
 * Never accepts a database URL and cannot target production. Requires PostgreSQL
 * binaries on PATH, or PG_BIN pointing at their directory. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { economySchema } from './tests/helpers/economySchema.mjs';
const exec = promisify(execFile);
const binary = name => process.env.PG_BIN ? join(process.env.PG_BIN,name) : name;
const dir = await mkdtemp(join(tmpdir(),'ludo-pg-'));
const data = join(dir,'data'); const socket = join(dir,'socket');
await mkdir(socket,{mode:0o700});
const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',socket,'-p','55439','-U','ludo_test','-d','postgres'];
const sql=async text => (await exec(binary('psql'),[...args,'-c',text],{maxBuffer:4*1024*1024})).stdout.trim();
const literal = s => "'"+String(s).replaceAll("'","''")+"'";
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const enter=(n,key,size=4)=>sql(`select quick_match_enter('${uid(n)}',${size},100,'classic','1.4.0',${literal(key)})`).then(JSON.parse);
// Installed apps up to 1.2.3 send no request key (0080).
const legacyEnter=(n,size=4)=>sql(`select quick_match_enter('${uid(n)}',${size},100,'classic','1.2.3',null)`).then(JSON.parse);
async function reset() {
 await sql('truncate quick_match_requests,quick_entries,games,players,moves,game_bots,wallets,wallet_txns,player_stats,auth.users cascade');
 for(let n=1;n<=4;n++) await sql(`insert into auth.users values('${uid(n)}');insert into wallets(user_id,balance,purchased_balance) values('${uid(n)}',1000,950)`);
}
let started=false;
try {
 await exec(binary('initdb'),['-D',data,'-A','trust','-U','ludo_test','--no-locale']);
 await exec(binary('pg_ctl'),['-D',data,'-l',join(dir,'server.log'),'-o',`-k ${socket} -h '' -p 55439`,'-w','start']);
 started=true;
 await sql(await economySchema());
 for(let round=0;round<10;round++) {
  await reset();
  const duplicate=await Promise.all(Array.from({length:8},(_,i)=>enter(1,`retry-${round}-${i}`)));
  assert.equal(new Set(duplicate.map(r=>r.playerId)).size,1);
  assert.equal(await sql('select balance from wallets where user_id='+literal(uid(1))),'900');
  assert.equal(await sql('select count(*) from quick_entries'),'1');
  await reset();
  const entrants=await Promise.all([1,2,3,4].map(n=>enter(n,`pool-${round}-${n}`)));
  assert.equal(new Set(entrants.map(r=>r.gameId)).size,1);
  assert.equal(await sql('select count(distinct seat) from players'),'4');
  assert.equal(await sql('select sum(balance) from wallets'),'3600');
  await reset();
  const [a]=await Promise.all([enter(1,`race-${round}-a`,2),enter(2,`race-${round}-b`,2)]);
  const snapshot=JSON.parse(await sql(`select json_build_object('gameId',g.id,'status','active','currentTurnPlayerId',(select id from players where game_id=g.id order by seat limit 1),'players',(select json_agg(json_build_object('id',id,'userId',user_id) order by seat) from players where game_id=g.id),'version',g.state_version) from games g where id='${a.gameId}'`));
  await Promise.all([
   sql(`select deal_quick_room('${a.gameId}',${snapshot.version},${literal(JSON.stringify(snapshot))}::jsonb,now(),false)`),
   sql(`select cancel_quick_match('${a.gameId}','${uid(1)}')`),
  ]);
  const active=await sql(`select count(*) from games where id='${a.gameId}' and status='active'`);
  const total=await sql('select sum(balance) from wallets');
  // Either entrant may become host: guest cancellation refunds one seat,
  // while host cancellation closes/refunds the room. Both conserve funding.
  if(active==='1') assert.equal(total,'3800');
  else assert.ok(['3900','4000'].includes(total));
  assert.equal(await sql('select (select sum(balance) from wallets) + coalesce((select sum(amount) from quick_entries where not refunded),0)'), '4000');
  if(active==='1') assert.equal(await sql('select count(*) from quick_entries where refunded'),'0');
  // An old app's automatic retries, all in flight at once: one seat, one debit.
  await reset();
  const legacy=await Promise.all(Array.from({length:8},()=>legacyEnter(1)));
  assert.equal(new Set(legacy.map(r=>r.playerId)).size,1);
  assert.equal(await sql('select balance from wallets where user_id='+literal(uid(1))),'900');
  assert.equal(await sql('select count(*) from quick_entries'),'1');
  assert.equal(await sql('select count(*) from quick_match_requests'),'1');
  // Old and new apps arriving together land in one room, each funded once.
  await reset();
  const mixed=await Promise.all([legacyEnter(1),enter(2,`mixed-${round}-2`),legacyEnter(3),enter(4,`mixed-${round}-4`)]);
  assert.equal(new Set(mixed.map(r=>r.gameId)).size,1);
  assert.equal(await sql('select count(distinct seat) from players'),'4');
  assert.equal(await sql('select sum(balance) from wallets'),'3600');
 }
 console.log('PASS: 50 real concurrent scenarios (duplicate entry, shared pool entry, cancellation vs deal, keyless retries, mixed old/new entry).');
 console.log('Focused schema fixture only; full Supabase migration/RLS/integration replay remains separate.');
} finally {
 if(started) await exec(binary('pg_ctl'),['-D',data,'-m','immediate','-w','stop']);
 await rm(dir,{recursive:true,force:true});
}
