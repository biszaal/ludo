/**
 * Server-authoritative game function (Supabase Edge / Deno).
 *
 * All state mutations go through here so clients cannot cheat: the dice is
 * generated with crypto on the server, and every move is re-validated with the
 * shared engine before the new GameState is written. The function uses the
 * service-role key (auto-injected) to write past RLS, but authorizes each call
 * against the caller's JWT.
 *
 * Body: { op: "create" | "join" | "start" | "roll" | "move" | "pass" | "timeout" | "rematch"
 *             | "rematchClose" | "leave" | "quickMatch" | "quickBotFill", ... }
 * Turn ops also take an optional `actionId`: the client's idempotency key for
 * one tap, reused across its retries so a dropped request can be re-sent safely.
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
 *   room         create / join / start / leave / rematch vote
 *   turn         roll / move / pass, and the stall bot
 *   tick         cron heartbeat for abandoned games (secret-authed, no JWT)
 *   quick        matchmaking
 *   economy      wallet, daily bonus, rewarded ads, shop, gems, config
 *   social       friend discovery, account deletion
 */

import { adminClient, authUserId, json, safeError } from "./lib.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { opCreate, opJoin, opLeave, opRematchClose, opRematchVote, opStart } from "./room.ts";
import { opPrepareRoll, opTimeout, opTurn } from "./turn.ts";
import { opQuickBotFill, opQuickMatch } from "./quick.ts";
import { opTick } from "./tick.ts";
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
  opFriendSearch,
  opRoomInvite,
  opFriendRequest,
  opFriendsRecent,
  opPresenceOnline,
} from "./social.ts";
import { opChat } from "./chat.ts";

/**
 * The caller's idempotency key for one turn action, if their build sends one.
 *
 * Bounded and stringly-typed on purpose: it lands in a unique index, so an
 * unbounded value from the wire is a free way to bloat it. Anything that isn't
 * a usable string reads as "no key" and takes the pre-idempotency path rather
 * than failing the action — a retry that cannot dedupe is still better for the
 * player than a turn that will not go through at all.
 */
function actionId(body: { actionId?: unknown }): string | undefined {
  const raw = body.actionId;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = adminClient();
    const body = await req.json();

    // The one op with no user behind it: pg_cron's heartbeat for games every
    // player has walked away from. It authenticates with a shared secret inside
    // opTick (fail-closed) instead of a JWT — everything below still requires
    // a signed-in caller.
    if (body.op === "tick") return await opTick(admin, req);

    // Which build is speaking. Absent from every client shipped before the
    // handshake existed, and null is the honest record of that — the fold gate
    // downstream must read "unknown" as "cannot fold", never as "current".
    const appVersion = typeof body.appVersion === "string" ? body.appVersion : null;

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const userId = await authUserId(admin, token);
    if (!userId) return json({ error: "Not authenticated." });

    switch (body.op) {
      case "create":
        return await opCreate(admin, userId, body.stake == null ? null : Number(body.stake), appVersion);
      case "join":
        return await opJoin(admin, userId, String(body.code ?? ""), appVersion);
      case "start":
        return await opStart(admin, userId, String(body.gameId), body.fill === true);
      case "prepareRoll":
        return await opPrepareRoll(admin, userId, String(body.gameId));
      case "roll":
        return await opTurn(admin, userId, String(body.gameId), "roll", undefined, actionId(body));
      case "move":
        return await opTurn(admin, userId, String(body.gameId), "move", String(body.tokenId), actionId(body));
      case "pass":
        return await opTurn(admin, userId, String(body.gameId), "pass", undefined, actionId(body));
      case "timeout":
        return await opTimeout(admin, userId, String(body.gameId));
      // A vote, not a restart. `vote` is absent on builds from before the
      // rematch needed everyone's say — see opRematchVote for why those read
      // as a yes rather than being refused.
      case "rematch":
        return await opRematchVote(admin, userId, String(body.gameId), body.vote === "no" ? "no" : "yes");
      case "rematchClose":
        return await opRematchClose(admin, userId, String(body.gameId));
      case "leave":
        return await opLeave(admin, userId, String(body.gameId));
      case "quickMatch":
        return await opQuickMatch(
          admin,
          userId,
          Number(body.size ?? 2),
          body.stake == null ? null : Number(body.stake),
          appVersion,
        );
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
      case "friendSearch":
        return await opFriendSearch(admin, userId, String(body.name ?? ""));
      case "friendRequest":
        return await opFriendRequest(admin, userId, String(body.toUserId ?? ""));
      case "roomInvite":
        return await opRoomInvite(
          admin,
          userId,
          String(body.toUserId ?? ""),
          String(body.roomCode ?? ""),
          Number(body.stake ?? 0),
        );
      case "chat":
        return await opChat(admin, userId, { gameId: body.gameId, kind: body.kind, value: body.value });
      case "friendsRecent":
        return await opFriendsRecent(admin, userId);
      case "presenceOnline":
        return await opPresenceOnline(admin, userId);
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
