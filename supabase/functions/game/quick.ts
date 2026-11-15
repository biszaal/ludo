/** Quick-match entry, funding and replay are committed together in PostgreSQL. */

// @deno-types="../_shared/engine/index.d.ts"
import type { GameState } from "../_shared/engine/index.js";
import {
  json,
  LIMITS,
  QUICK_STAKE,
  rateLimited,
  rateOk,
  seatColors,
  serverConfig,
  STAKE_TIERS,
  safeError,
  WRITE_FAILED,
  type Json,
  type SupabaseClient,
} from "./lib.ts";
import { MODE_UNAVAILABLE, modeOpen, parseMode } from "./modes.ts";
import { seatBots } from "./bots.ts";
import { startGameNow } from "./deal.ts";

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
  appVersion: string | null,
  rawMode: unknown = null,
  requestId?: string,
): Promise<Response> {
  if (!(await rateOk(admin, userId, "quickMatch", LIMITS.quickMatch))) return rateLimited();
  const size = rawSize === 4 ? 4 : 2;

  const mode = parseMode(rawMode);
  if (mode === null || !(await modeOpen(admin, mode))) return json({ error: MODE_UNAVAILABLE });

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

  // No key at all is an installed app from before request keys (up to 1.2.3),
  // and it enters through the same funded transaction as everyone else: the
  // "already seated" resume inside quick_match_enter is what stops its retries
  // charging twice (0080). A key that IS present but malformed is a bug in a
  // current client, and is refused rather than silently treated as keyless.
  if (requestId !== undefined && (requestId.length < 8 || requestId.length > 128)) {
    return json({ error: "Update the app to start quick match safely." });
  }
  const { data: entry, error } = await admin.rpc("quick_match_enter", {
    p_user: userId, p_size: size, p_stake: stake, p_mode: mode,
    p_app_version: appVersion, p_request: requestId ?? null,
  });
  if (error) {
    if (error.code === "LD002") return json({ error: "Not enough coins for this match." });
    return safeError("quick.enter", error, WRITE_FAILED);
  }
  if (!entry) return json({ error: WRITE_FAILED });
  if (entry.error) return json({ error: String(entry.error) });
  if (entry.waiting && Number(entry.seated) >= Number(entry.size)) {
    const started = await startGameNow(admin, String(entry.gameId));
    if ("error" in started) return json({ error: started.error });
    return json({ ...entry, ...started, waiting: false });
  }
  return json(entry);
}

/**
 * Nobody joined the caller's quick game in time — seat a labelled computer opponent and start.
 * If a human slipped in while the client's timer ran, this just starts the
 * game with them instead (all the races collapse into "start with whoever is
 * seated"; the version guard dedups racing starts).
 */
export async function opQuickBotFill(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, status, is_quick, quick_size, state, state_version").eq("id", gameId).single();
  if (!game || !game.is_quick) return json({ error: "Game not found." });
  const { data: seated } = await admin.from("players").select("id, user_id, seat").eq("game_id", gameId).order("seat");
  if (!seated?.some((p) => p.user_id === userId)) return json({ error: "You are not in this game." });

  if (game.status !== "waiting") {
    return game.state
      ? json({ state: game.state as GameState, v: (game.state_version as number | null) ?? 0 })
      : json({ error: "Game not found." });
  }
  const size = (game.quick_size as number | null) ?? 2;


  // Preserve unrotated lobby colors; the deal rotates all seats together.
  // Computer opponents use visible identities and never impersonate chatters.
  const colors = seatColors(size);
  const chairs = Array.from({ length: size }, (_, i) => i).filter((seat) => !seated.some((p) => p.seat === seat));
  await seatBots(admin, gameId, chairs, colors, true);

  const { count } = await admin
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId);
  if ((count ?? 0) < 2) return json({ error: "Could not find an opponent. Try again." });

  const started = await startGameNow(admin, gameId);
  return json(started);
}
