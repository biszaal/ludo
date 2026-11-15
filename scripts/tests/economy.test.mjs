import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { economySchema } from './helpers/economySchema.mjs';

// Focused PostgreSQL contract tests using real wallet/stats migrations, not
// mocked balances. Supabase extensions and concurrent sessions need staging.
let db;
const sql = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const game = uid(100);
let state;
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const balances = () => query('select balance, purchased_balance from wallets order by user_id');
const flags = async () => (await query('select status, payout_done, stats_done from games where id=$1', [game]))[0];
const deal = async (snapshot = state) => (await query('select deal_staked_room($1, 0, $2, now(), false) result', [game, JSON.stringify(snapshot)]))[0].result;
const finish = async () => {
  state = { ...state, status: 'finished', finishedOrder: state.players.map(p => p.id), winnerPlayerId: state.players[0].id };
  await query("update games set status='finished', state=$2 where id=$1", [game, JSON.stringify(state)]);
};
const settle = () => query('select settle_finished_game($1)', [game]);

before(async () => {
  db = await PGlite.create();
  await db.exec(await economySchema());
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate quick_match_requests, quick_entries, games, players, moves, game_bots, wallets, wallet_txns, player_stats, auth.users cascade;');
  state = { gameId: game, status: 'active', players: [1, 2, 3, 4].map(n => ({ id: uid(n+10), userId: uid(n) })), currentTurnPlayerId: uid(11) };
  await query("insert into games(id,room_code,host_user_id,stake) values($1,'TEST',$2,100)", [game, uid(1)]);
  for (let n=1; n<=4; n++) {
    await query('insert into auth.users values($1)', [uid(n)]);
    await query('insert into wallets(user_id,balance,purchased_balance) values($1,1000,950)', [uid(n)]);
    await query('insert into players(id,game_id,user_id,color,seat) values($1,$2,$3,$4,$5)', [uid(n+10),game,uid(n),['red','green','yellow','blue'][n-1],n-1]);
  }
});

test('failed starts roll back balances, purchased funds and ledger across retries', async () => {
  await query('update wallets set balance=0,purchased_balance=0 where user_id=$1', [uid(4)]);
  const original = await balances();
  for (let i=0;i<3;i++) {
    assert.match((await deal()).error, /enough coins/);
    assert.deepEqual(await balances(), original);
    assert.deepEqual(await query('select * from wallet_txns'), []);
    assert.equal((await flags()).status, 'waiting');
  }
  await query('update wallets set balance=1000 where user_id=$1', [uid(4)]);
  assert.equal((await deal()).started, true);
  assert.equal((await deal()).started, false);
  assert.deepEqual((await balances()).map(w=>w.balance), [900,900,900,900]);
  assert.equal((await query('select * from wallet_txns')).length, 4);
});

test('changed roster and legacy ambiguous attempts cannot charge wallets', async () => {
  assert.match((await deal({...state,players:state.players.slice(0,2)})).error, /seats changed/);
  await query("insert into wallet_txns(user_id,delta,reason,game_id,ext_id) values($1,-100,'stake',$2,$3)", [uid(1),game,`room-stake:${game}:${uid(1)}`]);
  assert.match((await deal()).error, /Reopen/);
  assert.deepEqual((await balances()).map(w=>w.balance), [1000,1000,1000,1000]);
});

test('a delayed seat insertion is rejected after start', async () => {
  await deal();
  await assert.rejects(query("insert into players(game_id,user_id,color,seat) values($1,$2,'red',5)",[game,uid(9)]), /no longer open/);
});

test('settlement rolls back all credits and flags on ledger failure, then retries once', async () => {
  await deal(); await finish();
  await db.exec(`create function test_reject_credit() returns trigger language plpgsql as $$
    begin if new.reason='win' and new.user_id='${uid(2)}' then raise exception 'injected credit failure'; end if; return new; end $$;
    create trigger test_reject before insert on wallet_txns for each row execute function test_reject_credit();`);
  try {
    await assert.rejects(settle(), /injected credit failure/);
    assert.deepEqual((await balances()).map(w=>w.balance), [900,900,900,900]);
    assert.deepEqual(await flags(), {status:'finished',payout_done:false,stats_done:false});
  } finally { await db.exec('drop trigger test_reject on wallet_txns; drop function test_reject_credit();'); }
  await settle(); await settle();
  assert.deepEqual((await balances()).map(w=>w.balance), [1150,1000,950,900]);
  assert.deepEqual((await query('select games_played from player_stats')).map(r=>r.games_played), [1,1,1,1]);
  assert.deepEqual(await flags(), {status:'finished',payout_done:true,stats_done:true});
});

test('stats failure rolls back credits; a retry records both', async () => {
  await deal(); await finish();
  await db.exec('alter table player_stats add constraint test_fail check(games_played < 1);');
  try {
    await assert.rejects(settle(), /test_fail/);
    assert.deepEqual((await balances()).map(w=>w.balance), [900,900,900,900]);
    assert.equal((await flags()).payout_done, false);
  } finally { await db.exec('alter table player_stats drop constraint test_fail;'); }
  await settle();
  assert.equal((await flags()).stats_done, true);
});

test('existing partial payout keys prevent duplicate rewards during recovery', async () => {
  await deal(); await finish();
  await query("select wallet_apply($1,250,'win',$2,'earned',$3)", [uid(1),game,`win:${game}:0`]);
  await settle();
  assert.deepEqual((await balances()).map(w=>w.balance), [1150,1000,950,900]);
});

test('free-game statistics recover without issuing coins', async () => {
  await query('update games set stake=0 where id=$1',[game]); await finish(); await settle(); await settle();
  assert.deepEqual(await query('select * from wallet_txns'), []);
  assert.equal((await flags()).stats_done, true);
  assert.equal((await query('select games_won from player_stats where user_id=$1',[uid(1)]))[0].games_won,1);
});

test('bots are funded by the house and never receive a payout', async () => {
  await query('insert into game_bots values($1,$2)',[game,uid(1)]);
  await deal(); await finish(); await settle();
  assert.deepEqual((await balances()).map(w=>w.balance), [1000,1000,950,900]);
});

test('money-changing RPCs are restricted to the service role', async () => {
  for (const role of ['anon','authenticated','service_role']) {
    for (const signature of ['deal_staked_room(uuid,bigint,jsonb,timestamptz,boolean)','settle_finished_game(uuid)']) {
      assert.equal((await query("select has_function_privilege($1,$2,'execute') allowed",[role,signature]))[0].allowed,role==='service_role');
    }
  }
});

test('a failed game-state write rolls back every collected stake', async () => {
  await db.exec("alter table games add constraint test_no_start check(status <> 'active');");
  try {
    await assert.rejects(deal(), /test_no_start/);
    assert.deepEqual((await balances()).map(w=>w.balance),[1000,1000,1000,1000]);
    assert.deepEqual(await query('select * from wallet_txns'),[]);
    assert.equal((await flags()).status,'waiting');
  } finally { await db.exec('alter table games drop constraint test_no_start;'); }
});

test('two- and three-player pots distribute rounding remainder to first place', async () => {
  for (const [count, expected] of [[2,[2]],[3,[2,1]]]) {
    await db.exec('truncate player_stats, wallet_txns;');
    await query('update wallets set balance=1000,purchased_balance=0');
    state = {...state,players:state.players.slice(0,count),status:'finished',finishedOrder:state.players.slice(0,count).map(p=>p.id)};
    await query("update games set state=$2,status='finished',stake=1,payout_done=false,stats_done=false where id=$1",[game,JSON.stringify(state)]);
    await settle();
    assert.deepEqual((await query("select delta from wallet_txns where reason='win' order by user_id")).map(r=>r.delta),expected);
    // Rebuild the roster for the next table size.
    state.players=[1,2,3,4].map(n=>({id:uid(n+10),userId:uid(n)}));
  }
});

test('retention preserves unfinished rewards and removes only settled old results', async () => {
  await finish();
  const ageResult = () => db.exec(`alter table games disable trigger games_touch_updated_at;
    update games set updated_at=now()-interval '10 days';
    alter table games enable trigger games_touch_updated_at;`);
  await ageResult(); await db.exec('select reap_stale_games();');
  assert.equal((await query('select id from games')).length,1);
  await settle(); await ageResult(); await db.exec('select reap_stale_games();');
  assert.equal((await query('select id from games')).length,0);
});

test('cron wakes for free-game statistics and preserves the gateway Authorization header', async () => {
  // Stub only HTTP dispatch: the real cron function and its SQL predicate run.
  await db.exec(`create schema net;
    create table net.requests(headers jsonb, body jsonb);
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int)
      returns bigint language plpgsql as $$ begin
        insert into net.requests values(headers,body); return 1; end $$;
    create table internal_config(key text primary key,value text);
    insert into internal_config values('tick_url','https://example.invalid'),('tick_secret','test-secret'),('tick_auth_key','test-key');`);
  try {
    await finish(); await query('update games set stake=0,payout_done=true where id=$1',[game]);
    await db.exec('select tick_games();');
    const requests=await query('select * from net.requests');
    assert.equal(requests.length,1);
    assert.equal(requests[0].headers.Authorization,'Bearer test-key');
    assert.equal(requests[0].body.op,'tick');
    await settle(); await db.exec('select tick_games();');
    assert.equal((await query('select * from net.requests')).length,1);
  } finally { await db.exec('drop schema net cascade; drop table internal_config;'); }
});

const enter = async (user=1, key='request-one', size=4, mode='classic') => (await query(
  'select quick_match_enter($1,$2,100,$3,$4,$5) result',[uid(user),size,mode,'1.4.0',key]))[0].result;
const cancel = async (room,user) => (await query('select cancel_quick_match($1,$2) result',[room,uid(user)]))[0].result;
const dealQuick = async room => {
  const g=(await query('select * from games where id=$1',[room]))[0];
  const seats=await query('select id,user_id from players where game_id=$1 order by seat',[room]);
  const snapshot={gameId:room,status:'active',players:seats.map(p=>({id:p.id,userId:p.user_id})),currentTurnPlayerId:seats[0].id};
  return (await query('select deal_quick_room($1,$2,$3,now(),false) result',[room,g.state_version,JSON.stringify(snapshot)]))[0].result;
};
test('quick entry creates a funded seat and version in one transaction; retries never debit twice',async()=>{
  const a=await enter();const replay=await enter();const tap=await enter(1,'another-tap');
  assert.equal(a.gameId,replay.gameId);assert.equal(a.playerId,tap.playerId);
  assert.equal((await balances())[0].balance,900);
  assert.equal((await query('select * from quick_entries')).length,1);
  const seat=(await query('select app_version from players where id=$1',[a.playerId]))[0];
  assert.equal(seat.app_version,'1.4.0');assert.equal(a.v,1);
});
test('insufficient quick-entry funds leave no game, seat, request or ledger write',async()=>{
  await query('update wallets set balance=0,purchased_balance=0 where user_id=$1',[uid(1)]);
  for(let i=0;i<2;i++) await assert.rejects(enter(), /Not enough coins/);
  assert.equal((await query('select * from games where is_quick')).length,0);
  assert.equal((await query('select * from quick_entries')).length,0);
  assert.equal((await query('select * from quick_match_requests')).length,0);
  assert.equal((await query('select * from wallet_txns')).length,0);
});
test('a rejected funded-seat record rolls back the charge and newly created room',async()=>{
  await db.exec('alter table quick_entries add constraint test_reject_entry check(amount < 1);');
  try { await assert.rejects(enter(),/test_reject_entry/); }
  finally { await db.exec('alter table quick_entries drop constraint test_reject_entry;'); }
  assert.deepEqual((await balances()).map(w=>w.balance),[1000,1000,1000,1000]);
  assert.equal((await query('select * from games where is_quick')).length,0);
});
test('host cancellation refunds all funded seats once and restores purchased balances',async()=>{
  const a=await enter();const b=await enter(2);assert.equal(b.gameId,a.gameId);
  await cancel(a.gameId,1);await cancel(a.gameId,1);
  assert.deepEqual(await balances(),Array(4).fill({balance:1000,purchased_balance:950}));
  assert.match((await enter()).error,/search has ended/);
  assert.equal((await query('select * from games where is_quick')).length,0);
});
test('guest cancellation leaves a reusable hole; a fresh request can rejoin and refund again',async()=>{
  const a=await enter();const b=await enter(2);await enter(3);
  await cancel(a.gameId,2);
  const rejoined=await enter(2,'fresh-request');
  assert.notEqual(rejoined.playerId,b.playerId);
  assert.equal((await query('select seat from players where id=$1',[rejoined.playerId]))[0].seat,1);
  await cancel(a.gameId,2);
  assert.equal((await balances())[1].balance,1000);
  assert.match((await enter(2)).error,/search has ended/);
});
test('a refund failure preserves the room and all debits until a successful retry',async()=>{
  const a=await enter();await enter(2);
  await db.exec(`create function test_refund_error() returns trigger language plpgsql as $$ begin
    if new.reason='stake-refund' and new.user_id='${uid(2)}' then raise exception 'refund failure'; end if; return new; end $$;
    create trigger reject_refund before insert on wallet_txns for each row execute function test_refund_error();`);
  try {
    await assert.rejects(cancel(a.gameId,1),/refund failure/);
    assert.deepEqual((await balances()).map(w=>w.balance),[900,900,1000,1000]);
    assert.equal((await query('select * from players where game_id=$1',[a.gameId])).length,2);
    assert.equal((await query('select * from quick_entries where refunded')).length,0);
  } finally {await db.exec('drop trigger reject_refund on wallet_txns; drop function test_refund_error();');}
  await cancel(a.gameId,1);assert.equal((await balances())[0].balance,1000);
});
test('quick deal verifies funding and cancellation after start cannot refund the stake',async()=>{
  const a=await enter(1,'request-one',2);await enter(2,'request-two',2);
  assert.equal((await dealQuick(a.gameId)).started,true);
  assert.equal((await cancel(a.gameId,1)).cancelled,false);
  assert.equal((await balances())[0].balance,900);
  assert.equal((await enter()).gameId,a.gameId);
  assert.equal((await query('select * from quick_entries')).length,2);
});
test('unfunded seats cannot enter an active quick match',async()=>{
  const a=await enter(1,'request-one',2);
  await query("insert into players(game_id,user_id,color,seat) values($1,$2,'yellow',1)",[a.gameId,uid(2)]);
  await assert.rejects(dealQuick(a.gameId),/unfunded seat/);
  assert.equal((await query('select status from games where id=$1',[a.gameId]))[0].status,'waiting');
});
test('labelled bot insertion registers a mute bot atomically and permits a funded game to start',async()=>{
  const a=await enter(1,'request-one',2);
  await query("insert into players(game_id,user_id,color,seat,is_bot) values($1,$2,'yellow',1,true)",[a.gameId,uid(2)]);
  assert.equal((await query('select can_chat from game_bots where game_id=$1',[a.gameId]))[0].can_chat,false);
  assert.equal((await dealQuick(a.gameId)).started,true);
  assert.equal((await balances())[1].balance,1000);
});
test('queue expiry uses funded entry refunds and replay stays closed after deletion',async()=>{
  const a=await enter();await enter(2);
  await query("update games set created_at=now()-interval '20 minutes' where id=$1",[a.gameId]);
  await db.exec('select reap_stale_games();');
  assert.deepEqual(await balances(),Array(4).fill({balance:1000,purchased_balance:950}));
  assert.match((await enter()).error,/search has ended/);
});
test('new pools exclude legacy rooms and split by mode and table size',async()=>{
  await query("update games set is_quick=true where id=$1",[game]);
  // Existing fixture seats belong to the legacy room; remove them for this case.
  await query('delete from players where game_id=$1',[game]);
  const a=await enter(1,'request-one',2);const b=await enter(2,'request-two',4);const c=await enter(3,'request-three',2,'blitz');
  assert.notEqual(a.gameId,game);assert.notEqual(a.gameId,b.gameId);assert.notEqual(a.gameId,c.gameId);
});
test('quick entry, cancellation and deal reject client roles; refund helper is internal only',async()=>{
  for(const signature of ['quick_match_enter(uuid,int,int,text,text,text)','cancel_quick_match(uuid,uuid)','deal_quick_room(uuid,bigint,jsonb,timestamptz,boolean)']) {
    for(const role of ['anon','authenticated','service_role']) {
      assert.equal((await query("select has_function_privilege($1,$2,'execute') allowed",[role,signature]))[0].allowed,role==='service_role');
    }
  }
  assert.equal((await query("select has_function_privilege('authenticated','refund_quick_entries(uuid,uuid)','execute') allowed"))[0].allowed,false);
});

test('retention cannot refund the old paid entry after an abandoned free rematch',async()=>{
  const a=await enter(1,'request-one',2);await enter(2,'request-two',2);await dealQuick(a.gameId);
  const g=(await query('select state from games where id=$1',[a.gameId]))[0];
  const over={...g.state,status:'finished',finishedOrder:g.state.players.map(p=>p.id)};
  await query("update games set status='finished',state=$2 where id=$1",[a.gameId,JSON.stringify(over)]);
  await query('select settle_finished_game($1)',[a.gameId]);
  const paid=await balances();
  await query("update games set status='active',stake=0,payout_done=false,stats_done=false,state=$2 where id=$1",[a.gameId,JSON.stringify(g.state)]);
  await db.exec('alter table games disable trigger games_touch_updated_at;');
  await query("update games set updated_at=now()-interval '25 hours' where id=$1",[a.gameId]);
  await db.exec('alter table games enable trigger games_touch_updated_at; select reap_stale_games();');
  assert.deepEqual(await balances(),paid);
  assert.equal((await query('select * from games where id=$1',[a.gameId])).length,0);
});

test('a stale prepared quick deal cannot start after a guest cancellation',async()=>{
  const a=await enter(1,'request-one',2);await enter(2,'request-two',2);
  const g=(await query('select * from games where id=$1',[a.gameId]))[0];
  const seats=await query('select id,user_id from players where game_id=$1 order by seat',[a.gameId]);
  const snapshot={gameId:a.gameId,status:'active',players:seats.map(p=>({id:p.id,userId:p.user_id})),currentTurnPlayerId:seats[0].id};
  await cancel(a.gameId,2);
  const result=(await query('select deal_quick_room($1,$2,$3,now(),false) result',[a.gameId,g.state_version,JSON.stringify(snapshot)]))[0].result;
  assert.match(result.error,/seats changed/);
  assert.equal((await query('select status from games where id=$1',[a.gameId]))[0].status,'waiting');
  assert.equal((await balances())[1].balance,1000);
});
