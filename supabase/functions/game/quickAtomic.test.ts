import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { opQuickMatch, opQuickBotFill } from "./quick.ts";
import { opLeave, opJoin } from "./room.ts";
import { WRITE_FAILED, type SupabaseClient } from "./lib.ts";
const GAME="11111111-1111-4111-8111-111111111111";
const USER="22222222-2222-4222-8222-222222222222";
const BOT="33333333-3333-4333-8333-333333333333";
const body=async(r:Response)=>await r.json();
Deno.test('entry errors never fall back to separate debits or expose database detail',async()=>{
  const calls:string[]=[];
  const admin={rpc:(name:string)=>{calls.push(name);return Promise.resolve(name==='rate_limit_hit'?{data:true,error:null}:{data:null,error:{message:'secret constraint detail'}});}} as unknown as SupabaseClient;
  assertEquals((await body(await opQuickMatch(admin,USER,2,null,'1.4.0','classic','request-one'))).error,WRITE_FAILED);
  assertEquals(calls,['rate_limit_hit','quick_match_enter']);
});
Deno.test('an overdraw is readable without exposing SQL errors',async()=>{
  const admin={rpc:(name:string)=>Promise.resolve(name==='rate_limit_hit'?{data:true,error:null}:{data:null,error:{code:'LD002',message:'internal'}})} as unknown as SupabaseClient;
  assertEquals((await body(await opQuickMatch(admin,USER,2,null,'1.4.0','classic','request-one'))).error,'Not enough coins for this match.');
});
function leaveFake(status:string|null, cancelled:boolean) {
  const calls:string[]=[];
  const admin={
    from:()=>({select:()=>({eq:()=>({single:()=>Promise.resolve({data:status?{id:GAME,status,atomic_quick:true,is_quick:true,state:{status,players:[{userId:USER}]},state_version:2}:null})})})}),
    rpc:(name:string)=>{calls.push(name);return Promise.resolve({data:{cancelled,state:{status:'active'},v:3},error:null});},
  } as unknown as SupabaseClient;
  return {admin,calls};
}
Deno.test('waiting cancellation uses the transaction and returns a lost start race',async()=>{
  const f=leaveFake('waiting',false);
  assertEquals((await body(await opLeave(f.admin,USER,GAME,true))).cancelled,false);
  assertEquals(f.calls,['cancel_quick_match']);
});
Deno.test('a waiting-only leave never forfeits an already active match',async()=>{
  const f=leaveFake('active',false);
  assertEquals((await body(await opLeave(f.admin,USER,GAME,true))).cancelled,false);
  assertEquals(f.calls,[]);
});
Deno.test('replaying cancellation after room deletion succeeds',async()=>{
  const f=leaveFake(null,true);
  assertEquals((await body(await opLeave(f.admin,USER,GAME,true))).cancelled,true);
});
Deno.test('quick fill seats a HIDDEN bot in the actual empty seat, registered before it sits',async()=>{
  // Quick-match fill-ins are hidden by design: an identity from the hidden pool
  // (it has a profile, so it renders with a name and face), no BOT tag, and it
  // may chat. The game_bots row goes in BEFORE the seat: the atomic deal (0077)
  // exempts a seat from funding only if that row exists, so a bot must never be
  // seated without it.
  const seats=[{id:'host',user_id:USER,seat:0},{id:'other',user_id:'other',seat:2},{id:'third',user_id:'third',seat:3}];
  const claims:string[]=[];const writes:Array<{table:string;row:Record<string,unknown>}>=[];
  const game={id:GAME,is_quick:true,quick_size:4,status:'waiting',state:{gameId:GAME,status:'active'},state_version:1};
  // deno-lint-ignore no-explicit-any
  const chain=(read:()=>unknown):any=>{const n:any={eq:()=>n,order:()=>Promise.resolve(read()),single:()=>Promise.resolve(read()),maybeSingle:()=>Promise.resolve(read()),select:()=>n,then:(resolve:any,reject:any)=>Promise.resolve(read()).then(resolve,reject)};return n;};
  const admin={rpc:(name:string)=>{claims.push(name);return Promise.resolve({data:BOT,error:null});},from:(table:string)=>{
    if(table==='games')return {select:()=>chain(()=>({data:game}))};
    if(table==='players')return {select:()=>chain(()=>({data:seats,count:seats.length})),insert:(row:Record<string,unknown>)=>{
      writes.push({table,row});seats.push({id:'bot',user_id:BOT,seat:Number(row.seat)});game.status='active';return Promise.resolve({error:null});}};
    if(table==='game_bots')return {insert:(row:Record<string,unknown>)=>{writes.push({table,row});return Promise.resolve({error:null});}};
    throw new Error(`Unexpected write to ${table}`);
  }} as unknown as SupabaseClient;
  await opQuickBotFill(admin,USER,GAME);
  assertEquals(claims,['claim_bot_identity']);
  assertEquals(writes.map(w=>w.table),['game_bots','players']);
  assertEquals(writes[0].row.can_chat,true);
  assertEquals(writes[1].row.is_bot,false);assertEquals(writes[1].row.seat,1);
});
Deno.test('a hidden bot that cannot be registered is not seated at all',async()=>{
  const seats=[{id:'host',user_id:USER,seat:0}];
  let seated=0;
  const game={id:GAME,is_quick:true,quick_size:2,status:'waiting',state:null,state_version:1};
  // deno-lint-ignore no-explicit-any
  const chain=(read:()=>unknown):any=>{const n:any={eq:()=>n,order:()=>Promise.resolve(read()),single:()=>Promise.resolve(read()),maybeSingle:()=>Promise.resolve(read()),select:()=>n,then:(resolve:any,reject:any)=>Promise.resolve(read()).then(resolve,reject)};return n;};
  const admin={rpc:()=>Promise.resolve({data:BOT,error:null}),from:(table:string)=>{
    if(table==='games')return {select:()=>chain(()=>({data:game}))};
    if(table==='players')return {select:()=>chain(()=>({data:seats,count:seats.length})),insert:()=>{seated++;return Promise.resolve({error:null});}};
    if(table==='game_bots')return {insert:()=>Promise.resolve({error:{message:'insert failed'}})};
    // deno-lint-ignore no-explicit-any
    if(table==='bot_identities'){const n:any={update:()=>n,eq:()=>n,then:(r:any)=>Promise.resolve({error:null}).then(r)};return n;}
    throw new Error(`Unexpected write to ${table}`);
  }} as unknown as SupabaseClient;
  const res=await body(await opQuickBotFill(admin,USER,GAME));
  assertEquals(seated,0);
  assertEquals(res.error,'Could not find an opponent. Try again.');
});
Deno.test('a nonparticipant cannot use bot fill to read an active match',async()=>{
  // deno-lint-ignore no-explicit-any
  const node=(data:unknown):any=>{const n:any={select:()=>n,eq:()=>n,single:()=>Promise.resolve({data}),maybeSingle:()=>Promise.resolve({data}),order:()=>Promise.resolve({data})};return n;};
  const admin={from:(table:string)=>node(table==='games'?{id:GAME,is_quick:true,status:'active',state:{secret:true}}:[])} as unknown as SupabaseClient;
  assertEquals((await body(await opQuickBotFill(admin,USER,GAME))).error,'You are not in this game.');
});

Deno.test('room codes cannot bypass funded quick-match entry',async()=>{
  let inserts=0;
  // deno-lint-ignore no-explicit-any
  const node:any={select:()=>node,eq:()=>node,maybeSingle:()=>Promise.resolve({data:{id:GAME,status:'waiting',is_quick:true}}),insert:()=>{inserts++;return node;}};
  const admin={rpc:()=>Promise.resolve({data:true,error:null}),from:()=>node} as unknown as SupabaseClient;
  assertEquals((await body(await opJoin(admin,USER,'ABCD','1.4.0'))).error,"That code isn't open. Check it and try again.");
  assertEquals(inserts,0);
});
Deno.test('waiting-only cancellation does not disclose an active match to a nonparticipant',async()=>{
  const f=leaveFake('active',false);
  assertEquals((await body(await opLeave(f.admin,BOT,GAME,true))).error,'You are not in this game.');
  assertEquals(f.calls,[]);
});

// Installed apps up to 1.2.3 send quickMatch with no request key (0080).
function enterFake(entry: unknown) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve(name === 'rate_limit_hit' ? { data: true, error: null } : { data: entry, error: null });
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}
Deno.test('an old app with no request key still enters through the funded transaction', async () => {
  const f = enterFake({ gameId: GAME, playerId: 'p1', waiting: true, seated: 1, size: 2, stake: 100 });
  const res = await body(await opQuickMatch(f.admin, USER, 2, null, '1.2.3', null, undefined));
  assertEquals(res.error, undefined);
  assertEquals(res.gameId, GAME);
  const enter = f.calls.find((c) => c.name === 'quick_match_enter');
  assertEquals(enter?.args.p_request, null);
});
Deno.test('a request key that is present but malformed is still refused', async () => {
  const f = enterFake(null);
  const res = await body(await opQuickMatch(f.admin, USER, 2, null, '1.4.0', 'classic', 'short'));
  assertEquals(typeof res.error, 'string');
  assertEquals(f.calls.some((c) => c.name === 'quick_match_enter'), false);
});
