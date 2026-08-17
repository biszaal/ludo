/**
 * Quick match: pair the caller into the oldest open queue game (atomic SQL
 * claim) or open a new one. If nobody shows up, the client calls "quickBotFill"
 * and the server seats a hidden bot — a real auth user with an ordinary
 * profile, driven server-side from turn 1. Nothing client-readable marks the
 * seat as a bot.
 */

// @deno-types="../_shared/engine/index.d.ts"
import type { GameState } from "../_shared/engine/index.js";
import {
  insertGameWithCode,
  json,
  LIMITS,
  QUICK_STAKE,
  rateLimited,
  rateOk,
  seatColors,
  serverConfig,
  STAKE_TIERS,
  type Json,
  type SupabaseClient,
} from "./lib.ts";
import { seatBots } from "./bots.ts";
import { startGameNow } from "./deal.ts";
import { walletApply } from "./wallet.ts";

/**
 * Pair the caller into the oldest open quick game of their chosen size (1v1 or
 * 4-player), or open a new one. The SQL claim is atomic (row lock + seat insert
 * in one transaction), so simultaneous searchers can't both end up hosting
 * empty rooms. A room starts the moment its last seat fills; part-filled rooms
 * keep waiting (each seated client's fill timer bot-fills the rest).
 */
export async function opQuickMatch(
  admin: SupabaseClient,
  userId: string,
  rawSize: number,
  rawStake: number | null,
): Promise<Response> {
  if (!(await rateOk(admin, userId, "quickMatch", LIMITS.quickMatch))) return rateLimited();
  const size = rawSize === 4 ? 4 : 2;

  // Tier must be on the server's list — a hacked client can't invent a pool.
  // Old clients send no stake and get the default tier, unchanged behavior.
  let stake = QUICK_STAKE;
  if (rawStake != null) {
    const cfg = await serverConfig(admin);
    const economy = (cfg.economy ?? {}) as Json;
    const tiers =
      Array.isArray(economy.stakeTiers) && economy.stakeTiers.every((t) => typeof t === "number")
        ? (economy.stakeTiers as number[])
        : STAKE_TIERS;
    if (!tiers.includes(rawStake)) return json({ error: "That entry isn't available." });
    stake = rawStake;
  }

  // Re-tap while already searching: hand back the same waiting room (whatever
  // size it was opened for — one search at a time).
  const { data: mine } = await admin
    .from("players")
    .select("id, game_id, games!inner(status, is_quick, quick_size, stake)")
    .eq("user_id", userId)
    .eq("games.status", "waiting")
    .eq("games.is_quick", true)
    .limit(1)
    .maybeSingle();
  if (mine) {
    const g = mine.games as unknown as { quick_size: number | null; stake: number | null };
    return json({ gameId: mine.game_id, playerId: mine.id, waiting: true, size: g?.quick_size ?? 2, stake: g?.stake ?? QUICK_STAKE });
  }

  const { data: claimed, error: claimErr } = await admin.rpc("quick_match_claim", {
    p_user: userId,
    p_size: size,
    p_stake: stake,
  });
  if (claimErr) return json({ error: claimErr.message });
  if (claimed) {
    const gameId = String(claimed.game_id);
    const playerId = String(claimed.player_id);
    const seated = Number(claimed.seated ?? size);
    // Seat first, stake second: an overdraw hands the seat straight back.
    const debited = await walletApply(admin, userId, -stake, "stake", gameId);
    if (debited === null) {
      await admin.from("players").delete().eq("id", playerId);
      return json({ error: `Not enough coins — you need ${stake} to play.` });
    }
    if (seated < size) {
      // Joined a part-filled 4-player room — keep waiting for the rest.
      return json({ gameId, playerId, waiting: true, size, stake });
    }
    const started = await startGameNow(admin, gameId);
    if ("error" in started) return json({ error: started.error });
    return json({ gameId, playerId, state: started.state, v: started.v, size, stake });
  }

  const debited = await walletApply(admin, userId, -stake, "stake", null);
  if (debited === null) return json({ error: `Not enough coins — you need ${stake} to play.` });

  const game = await insertGameWithCode(
    admin,
    { host_user_id: userId, status: "waiting", is_quick: true, quick_size: size, stake },
    "quick.create",
  );
  if ("error" in game) {
    await walletApply(admin, userId, stake, "stake-refund", null);
    return json({ error: game.error });
  }

  const { data: player, error: pErr } = await admin
    .from("players")
    .insert({ game_id: game.id, user_id: userId, color: "red", seat: 0, is_host: true })
    .select("id")
    .single();
  if (pErr || !player) {
    await walletApply(admin, userId, stake, "stake-refund", game.id);
    return json({ error: pErr?.message ?? "Could not start matchmaking." });
  }

  return json({ gameId: game.id, playerId: player.id, waiting: true, size, stake });
}

/**
 * Nobody joined the caller's quick game in time — seat a hidden bot and start.
 * If a human slipped in while the client's timer ran, this just starts the
 * game with them instead (all the races collapse into "start with whoever is
 * seated"; the version guard dedups racing starts).
 */
export async function opQuickBotFill(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, status, is_quick, quick_size, state, state_version").eq("id", gameId).single();
  if (!game || !game.is_quick) return json({ error: "Game not found." });
  if (game.status !== "waiting") {
    return game.state
      ? json({ state: game.state as GameState, v: (game.state_version as number | null) ?? 0 })
      : json({ error: "Game not found." });
  }
  const size = (game.quick_size as number | null) ?? 2;

  const { data: seated } = await admin.from("players").select("id, user_id, seat").eq("game_id", gameId).order("seat");
  if (!seated?.some((p) => p.user_id === userId)) return json({ error: "You are not in this game." });

  // Seat bots into every still-empty chair. Colors follow the room size
  // (1v1 diagonal red/yellow, 4-player clockwise) — mirrors the SQL claim.
  // `visible: false` is load-bearing: a quick-match bot must be indistinguishable
  // from a human, so the seat carries no marker (0035).
  const colors = seatColors(size);
  await seatBots(admin, gameId, seated.length, size, colors, false);

  const { count } = await admin
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId);
  if ((count ?? 0) < 2) return json({ error: "Could not find an opponent. Try again." });

  const started = await startGameNow(admin, gameId);
  return json(started);
}
