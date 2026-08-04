/**
 * Server-authoritative game function (Supabase Edge / Deno).
 *
 * All state mutations go through here so clients cannot cheat: the dice is
 * generated with crypto on the server, and every move is re-validated with the
 * shared engine before the new GameState is written. The function uses the
 * service-role key (auto-injected) to write past RLS, but authorizes each call
 * against the caller's JWT.
 *
 * Body: { op: "create" | "join" | "start" | "roll" | "move" | "pass" | "timeout" | "rematch" | "leave"
 *             | "quickMatch" | "quickBotFill", ... }
 * Always responds 200 with either a payload or `{ error }`.
 *
 * This file is the router only. The ops live in modules beside it, layered so
 * the imports stay acyclic:
 *
 *   lib          auth, responses, deferred work, turn clock, remote config
 *   wallet       coin/gem RPC wrappers
 *   finish       payout + stats, once per finished game
 *   bots         hidden quick-match seats and their server-side driver
 *   deal         dealing a room into a live game
 *   room         create / join / start / leave / rematch
 *   turn         roll / move / pass, and the stall bot
 *   quick        matchmaking
 *   economy      wallet, daily bonus, rewarded ads, shop, gems, config
 *   social       friend discovery, account deletion
 */

import { adminClient, authUserId, json, safeError } from "./lib.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { opCreate, opJoin, opLeave, opRematch, opStart } from "./room.ts";
import { opTimeout, opTurn } from "./turn.ts";
import { opQuickBotFill, opQuickMatch } from "./quick.ts";
import {
  opAdRewardIntent,
  opAdRewardStatus,
  opConfig,
  opDailyBonus,
  opEntitlementsGet,
  opGemsBuy,
  opGemsExchange,
  opShopBuy,
  opWalletGet,
  opWalletState,
  opWalletTopup,
} from "./economy.ts";
import {
  opDeleteAccount,
  opFriendCode,
  opFriendLookup,
  opFriendRequest,
  opFriendsRecent,
} from "./social.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = adminClient();

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const userId = await authUserId(admin, token);
    if (!userId) return json({ error: "Not authenticated." });

    const body = await req.json();
    switch (body.op) {
      case "create":
        return await opCreate(admin, userId);
      case "join":
        return await opJoin(admin, userId, String(body.code ?? ""));
      case "start":
        return await opStart(admin, userId, String(body.gameId));
      case "roll":
        return await opTurn(admin, userId, String(body.gameId), "roll");
      case "move":
        return await opTurn(admin, userId, String(body.gameId), "move", String(body.tokenId));
      case "pass":
        return await opTurn(admin, userId, String(body.gameId), "pass");
      case "timeout":
        return await opTimeout(admin, userId, String(body.gameId));
      case "rematch":
        return await opRematch(admin, userId, String(body.gameId));
      case "leave":
        return await opLeave(admin, userId, String(body.gameId));
      case "quickMatch":
        return await opQuickMatch(admin, userId, Number(body.size ?? 2), body.stake == null ? null : Number(body.stake));
      case "quickBotFill":
        return await opQuickBotFill(admin, userId, String(body.gameId));
      case "config":
        return await opConfig(admin, req, body.region ? String(body.region) : null);
      case "walletGet":
        return await opWalletGet(admin, userId);
      case "walletState":
        return await opWalletState(admin, userId);
      case "walletTopup":
        return await opWalletTopup(admin, userId);
      case "dailyBonus":
        return await opDailyBonus(admin, userId);
      case "adRewardIntent":
        return await opAdRewardIntent(
          admin,
          userId,
          String(body.placement ?? ""),
          body.gameId ? String(body.gameId) : null,
        );
      case "adRewardStatus":
        return await opAdRewardStatus(admin, userId, String(body.nonce ?? ""));
      case "entitlementsGet":
        return await opEntitlementsGet(admin, userId);
      case "shopBuy":
        return await opShopBuy(admin, userId, String(body.sku ?? ""));
      case "gemsBuy":
        return await opGemsBuy(admin, userId, String(body.productId ?? ""));
      case "gemsExchange":
        return await opGemsExchange(admin, userId, Number(body.gems ?? 0), body.key ? String(body.key) : null);
      case "friendCode":
        return await opFriendCode(admin, userId);
      case "friendLookup":
        return await opFriendLookup(admin, userId, String(body.code ?? ""));
      case "friendRequest":
        return await opFriendRequest(admin, userId, String(body.toUserId ?? ""));
      case "friendsRecent":
        return await opFriendsRecent(admin, userId);
      case "deleteAccount":
        return await opDeleteAccount(admin, userId);
      default:
        return json({ error: "Unknown op." });
    }
  } catch (e) {
    // Last resort: an op threw rather than returning. Whatever it says is
    // internal (a Postgres message, a parse failure on a hand-crafted body) and
    // reaches any signed-in caller, so it goes to the logs, not the response.
    return safeError("router", e);
  }
});
