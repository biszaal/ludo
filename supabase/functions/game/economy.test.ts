import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { startGameNow } from "./deal.ts";
import { settleIfFinished } from "./finish.ts";
import { WRITE_FAILED, type SupabaseClient } from "./lib.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, type GameState } from "../_shared/engine/index.js";
const GAME = "11111111-1111-4111-8111-111111111111";
const players = [1,2].map(n=>({id:`p${n}`,userId:`u${n}`,color:n===1?'red' as const:'yellow' as const}));
const state = createGame(players,{gameId:GAME});
function fake(result: unknown, error: unknown = null) {
  const calls: Array<{name:string;args:Record<string,unknown>}> = [];
  let writes = 0;
  // Deliberately reject separate wallet calls or game writes: paid starts must
  // use the transaction, even if it fails or returns an already-started result.
  const admin = {
    rpc: (name:string,args:Record<string,unknown>) => {
      calls.push({name,args}); return Promise.resolve({data:result,error});
    },
    from: (table:string) => {
      const data = table==='games'
        ? {id:GAME,status:'waiting',state_version:4,is_quick:false,stake:100,mode:'classic',has_bots:false}
        : table==='players' ? players.map((p,i)=>({id:p.id,user_id:p.userId,seat:i,app_version:null})) : [];
      // deno-lint-ignore no-explicit-any
      const node: any = { select:()=>node, eq:()=>node, single:()=>Promise.resolve({data}), order:()=>Promise.resolve({data}) };
      node.update=()=>{ writes++; throw new Error('Unexpected separate write'); };
      return node;
    },
  } as unknown as SupabaseClient;
  return {admin,calls,writes:()=>writes};
}
Deno.test('paid room starts pass the prepared state and version to one transaction',async()=>{
  const f=fake({state,v:5,started:false});
  assertEquals(await startGameNow(f.admin,GAME),{state,v:5});
  assertEquals(f.calls.length,1);
  assertEquals(f.calls[0].name,'deal_staked_room');
  assertEquals(f.calls[0].args.p_version,4);
  assertEquals((f.calls[0].args.p_state as GameState).gameId,GAME);
  assertEquals(f.writes(),0);
});
Deno.test('a failed transaction cannot fall back to debit/refund calls',async()=>{
  const f=fake(null,{message:'database unavailable'});
  assertEquals(await startGameNow(f.admin,GAME),{error:WRITE_FAILED});
  assertEquals(f.calls.map(c=>c.name),['deal_staked_room']);
  assertEquals(f.writes(),0);
});
Deno.test('insufficient stakes return the transaction error without another write',async()=>{
  const f=fake({error:'A player does not have enough coins for this pot.'});
  assertEquals(await startGameNow(f.admin,GAME),{error:'A player does not have enough coins for this pot.'});
  assertEquals(f.writes(),0);
});
Deno.test('settlement failures propagate so the result remains eligible for recovery',async()=>{
  const f=fake(null,{message:'credit failure'});
  await assertRejects(()=>settleIfFinished(f.admin,GAME,{...state,status:'finished'}),Error,'Settlement failed');
  assertEquals(f.calls.map(c=>c.name),['settle_finished_game']);
});
Deno.test('active turns do not request settlement',async()=>{
  const f=fake(true);await settleIfFinished(f.admin,GAME,state);
  assertEquals(f.calls,[]);
});
