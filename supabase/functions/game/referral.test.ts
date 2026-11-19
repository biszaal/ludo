/**
 * Referral programme, edge side: recording on code lookup, payout after games
 * and on activity, and the read op behind the invite card.
 *
 * Every rule lives in SQL (0082, tested in scripts/tests/referrals.test.mjs);
 * what is pinned here is that the function calls those rules from the right
 * places, never lets them break the call they ride on, and pushes the news.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "./lib.ts";
import { attachReferral, opReferrals, settleReferrals } from "./referral.ts";
import { opFriendLookup } from "./social.ts";

const ME = "11111111-1111-1111-1111-111111111111";
const FRIEND = "22222222-2222-2222-2222-222222222222";

interface Fake {
  admin: SupabaseClient;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
}

function fake(
  rpc: Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: unknown }>,
  tables: Record<string, unknown> = {},
): Fake {
  const self: Fake = { admin: null as unknown as SupabaseClient, rpcs: [] };
  // deno-lint-ignore no-explicit-any
  const chain = (data: unknown): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      select: () => node,
      eq: () => node,
      in: () => node,
      maybeSingle: () => Promise.resolve({ data, error: null }),
      single: () => Promise.resolve({ data, error: null }),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve({ data, error: null }).then(res, rej),
    };
    return node;
  };
  self.admin = {
    from: (table: string) => chain(tables[table] ?? null),
    rpc: (name: string, args: Record<string, unknown>) => {
      self.rpcs.push({ name, args });
      const handler = rpc[name];
      return Promise.resolve(handler ? { error: null, ...handler(args) } : { data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return self;
}

const settled = () => new Promise((r) => setTimeout(r, 0));

Deno.test("attachReferral passes invitee, inviter and source to referral_attach", async () => {
  const f = fake({ referral_attach: () => ({ data: { attached: true, inviteeCoins: 100, gamesRequired: 2 } }) });
  const out = await attachReferral(f.admin, ME, FRIEND, "code");
  assertEquals(out, { attached: true, inviteeCoins: 100, gamesRequired: 2 });
  assertEquals(f.rpcs, [{ name: "referral_attach", args: { p_invitee: ME, p_inviter: FRIEND, p_source: "code" } }]);
});

Deno.test("attachReferral treats an RPC error as not attached", async () => {
  const f = fake({ referral_attach: () => ({ data: null, error: { message: "boom" } }) });
  assertEquals(await attachReferral(f.admin, ME, FRIEND, "room"), { attached: false });
});

Deno.test("settleReferrals settles each distinct user once", async () => {
  const f = fake({ referral_settle: () => ({ data: { paid: false } }) });
  await settleReferrals(f.admin, [ME, FRIEND, ME], async () => {});
  assertEquals(f.rpcs.map((c) => c.args.p_invitee), [ME, FRIEND]);
});

Deno.test("settleReferrals pushes both sides on a payout, and only the invitee when the inviter is capped", async () => {
  for (const inviterPaid of [true, false]) {
    const f = fake(
      {
        referral_settle: () => ({
          data: {
            paid: true, referralId: "r1", inviterUserId: FRIEND, inviteeUserId: ME,
            inviterPaid, inviterCoins: 200, inviteeCoins: 100,
          },
        }),
      },
      { profiles: { display_name: "Ravi" } },
    );
    const pushes: Array<{ to: string[]; title: string; body: string }> = [];
    await settleReferrals(f.admin, [ME], async (_admin, to, message) => {
      pushes.push({ to, title: message.title, body: message.body });
    });
    const expected = [{ to: [ME], title: "You earned 100 coins", body: "Thanks for joining Ravi." }];
    if (inviterPaid) expected.unshift({ to: [FRIEND], title: "You earned 200 coins", body: "Ravi played 2 games." });
    assertEquals(pushes.sort((a, b) => a.to[0]!.localeCompare(b.to[0]!)), expected.sort((a, b) => a.to[0]!.localeCompare(b.to[0]!)));
  }
});

Deno.test("settleReferrals never throws", async () => {
  const f = fake({ referral_settle: () => ({ data: null, error: { message: "down" } }) });
  await settleReferrals(f.admin, [ME], async () => {
    throw new Error("push down");
  });
});

Deno.test("opReferrals returns referral_list for the caller", async () => {
  const listed = { config: { enabled: true, inviterCoins: 200, inviteeCoins: 100, gamesRequired: 2 }, invited: [], invitedBy: null };
  const f = fake({ rate_limit_hit: () => ({ data: true }), referral_list: () => ({ data: listed }) });
  const res = await opReferrals(f.admin, ME);
  assertEquals(await res.json(), listed);
  assertEquals(f.rpcs.find((c) => c.name === "referral_list")?.args, { p_user: ME });
});

Deno.test("opFriendLookup adds referral only when it attached", async () => {
  for (const attached of [true, false]) {
    const f = fake(
      {
        rate_limit_hit: () => ({ data: true }),
        is_blocked: () => ({ data: false }),
        referral_attach: () => ({ data: attached ? { attached: true, inviteeCoins: 100, gamesRequired: 2 } : { attached: false } }),
      },
      {
        friend_codes: { user_id: FRIEND },
        profiles: { user_id: FRIEND, display_name: "Asha", avatar_id: "cap", dice_skin: null },
        player_stats: { games_played: 4, games_won: 2 },
      },
    );
    const body = await (await opFriendLookup(f.admin, ME, "k7pxq2")).json();
    assertEquals(body.user.display_name, "Asha");
    assertEquals(body.referral, attached ? { attached: true, inviteeCoins: 100, gamesRequired: 2 } : undefined);
    await settled();
  }
});
