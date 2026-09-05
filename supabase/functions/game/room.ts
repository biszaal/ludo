/**
 * Room lifecycle: opening a room, joining by code, starting, leaving, and the
 * rematch. Turn actions live in turn.ts; matchmaking in quick.ts.
 */

// @deno-types="../_shared/engine/index.d.ts"
import {
  createGame as engineCreateGame,
  leaveGame as engineLeaveGame,
  type GameState,
} from "../_shared/engine/index.js";
import {
  afterResponse,
  freshState,
  COLOR_ORDER,
  insertGameWithCode,
  json,
  LIMITS,
  rateLimited,
  rateOk,
  safeError,
  seatColor,
  seatColors,
  serverConfig,
  STAKE_TIERS,
  turnDeadline,
  type Json,
  type SupabaseClient,
  WRITE_FAILED,
} from "./lib.ts";
import { afterGameWrite, seatBots } from "./bots.ts";
import { startGameNow } from "./deal.ts";
import { endIfNoHumansLeft, recordFinishStats, settleIfFinished } from "./finish.ts";
import { walletApply } from "./wallet.ts";

/**
 * Validate a host-chosen room stake against the server's tier list.
 *
 * 0 is always allowed — a friendly game is the default and must never depend
 * on config. Anything else has to be a tier the server published, for the same
 * reason quick match checks (quick.ts): a modified client must not be able to
 * invent a pool, least of all one it can talk friends into joining.
 */
async function validRoomStake(admin: SupabaseClient, raw: number | null): Promise<number | null> {
  if (raw == null || raw === 0) return 0;
  if (!Number.isFinite(raw) || raw < 0) return null;
  const cfg = await serverConfig(admin);
  const economy = (cfg.economy ?? {}) as Json;
  const tiers =
    Array.isArray(economy.stakeTiers) && economy.stakeTiers.every((t) => typeof t === "number")
      ? (economy.stakeTiers as number[])
      : STAKE_TIERS;
  return tiers.includes(raw) ? raw : null;
}

export async function opCreate(
  admin: SupabaseClient,
  userId: string,
  rawStake: number | null,
  appVersion: string | null,
): Promise<Response> {
  if (!(await rateOk(admin, userId, "roomCreate", LIMITS.roomCreate))) return rateLimited();

  const stake = await validRoomStake(admin, rawStake);
  if (stake === null) return json({ error: "That entry isn't available." });

  // No debit here. Unlike quick match (which debits on seat, because the seat
  // IS the queue), a room can sit unstarted for as long as the host likes —
  // charging at creation would strand coins in a lobby nobody ever begins.
  // deal.ts collects from every seat at start instead.
  const game = await insertGameWithCode(
    admin,
    { host_user_id: userId, status: "waiting", stake },
    "room.create",
  );
  if ("error" in game) return json({ error: game.error });

  // Not always red: the color a seat draws is rotated per game (lib.seatColor),
  // so opening a room does not hand the host the same pawns every time. The
  // deal re-reads every seat through seatColors, and the lobby previews the
  // same rotation, so this and the dealt color agree.
  const { data: player, error: pErr } = await admin
    .from("players")
    .insert({ game_id: game.id, user_id: userId, color: seatColor(0, game.id), seat: 0, is_host: true, app_version: appVersion })
    .select("id")
    .single();
  if (pErr || !player) return safeError("room.seatHost", pErr, "Could not seat host.");

  return json({ gameId: game.id, roomCode: game.roomCode, playerId: player.id, stake });
}

export async function opJoin(
  admin: SupabaseClient,
  userId: string,
  rawCode: string,
  appVersion: string | null,
): Promise<Response> {
  if (!(await rateOk(admin, userId, "roomJoin", LIMITS.roomJoin))) return rateLimited();
  const roomCode = rawCode.trim().toUpperCase();

  /**
   * One refusal for every way a code can fail to admit you.
   *
   * These used to be three messages — "No game found with that code", "That
   * game has already started", "That game is full" — which made the endpoint an
   * oracle: a script sweeping the ~1M code space could tell an empty code from
   * a live room it merely arrived at too late, and map who was playing. The
   * distinction was never actionable for the person typing a code in either
   * way; they retype it or ask for a new one regardless.
   */
  const noRoom = json({ error: "That code isn't open. Check it and try again." });

  const { data: game } = await admin
    .from("games")
    .select("id, status, stake")
    .eq("room_code", roomCode)
    .maybeSingle();
  if (!game) return noRoom;
  if (game.status !== "waiting") return noRoom;
  const stake = (game.stake as number | null) ?? 0;

  const { data: existing } = await admin.from("players").select("id, user_id, seat").eq("game_id", game.id).order("seat");
  const mine = existing?.find((p) => p.user_id === userId);
  if (mine) return json({ gameId: game.id, roomCode, playerId: mine.id, stake });
  if ((existing?.length ?? 0) >= 4) return noRoom;

  const seat = existing?.length ?? 0;
  const { data: player, error } = await admin
    .from("players")
    .insert({ game_id: game.id, user_id: userId, color: seatColor(seat, String(game.id)), seat, app_version: appVersion })
    .select("id")
    .single();
  if (error || !player) return json({ error: error?.message ?? "Could not join." });

  return json({ gameId: game.id, roomCode, playerId: player.id, stake });
}

/**
 * Which chairs the bots take when the host fills a friend room — and, when it
 * matters, moving a human out of the way first.
 *
 * Seats i and i+2 face each other across the board (lib.seatColors). Filling
 * left to right therefore sat two friends side by side and put the two bots on
 * the other pair of adjacent corners, so the humans never played across the
 * diagonal from each other — the seating the game uses for every 2-player table
 * precisely because it is the one that reads as "you two, facing off".
 *
 * So with exactly two humans the second one moves to seat 2 and the bots take 1
 * and 3. Any other count has no diagonal to preserve (three humans always
 * include an adjacent pair) and simply fills the remaining chairs in order.
 *
 * Returns the seats the bots should take.
 */
async function fillSeats(
  admin: SupabaseClient,
  seated: { id: string }[],
  colors: readonly string[],
): Promise<number[]> {
  if (seated.length === 2) {
    // The color moves with the seat: players carries unique (game_id, color),
    // so leaving the guest holding seat 1's color would make the bot's insert
    // into that chair collide and quietly leave the table a player short.
    const { error } = await admin
      .from("players")
      .update({ seat: 2, color: colors[2] })
      .eq("id", seated[1]!.id);
    if (!error) return [1, 3];
  }
  return [0, 1, 2, 3].slice(seated.length);
}

/**
 * Host starts the room. With `fill`, the empty chairs are seated with bots
 * first, so three friends can play a full four-handed game instead of waiting
 * on a fourth who isn't coming.
 *
 * Unlike quick match these bots are LABELLED (players.is_bot, 0035). In a
 * private room everyone knows who was invited, so an unexplained extra name
 * would read as a stranger walking in.
 *
 * FRIENDLY ROOMS ONLY. The pot is stake × every seat and the house stands the
 * bot seats' share (finish.ts), which is fine when nobody chose to be matched
 * with a bot — but a host who can summon them on demand could open a
 * max-stake room, fill it with three bots, and farm the house at better than
 * even odds. Staked rooms need real opponents; the client hides the toggle,
 * and this is the rule that actually enforces it.
 */
export async function opStart(
  admin: SupabaseClient,
  userId: string,
  gameId: string,
  fill: boolean,
): Promise<Response> {
  const { data: game } = await admin
    .from("games")
    .select("id, host_user_id, status, stake")
    .eq("id", gameId)
    .single();
  if (!game) return json({ error: "Game not found." });
  if (game.host_user_id !== userId) return json({ error: "Only the host can start." });
  if (game.status !== "waiting") return json({ error: "Game already started." });

  if (fill) {
    if (((game.stake as number | null) ?? 0) > 0) {
      return json({ error: "Bots can only fill a friendly room. Coin games need real players." });
    }
    const { data: seated } = await admin.from("players").select("id").eq("game_id", gameId).order("seat");
    const taken = seated?.length ?? 0;
    // A lone host filling up gets a full table; otherwise top up to four.
    if (taken < COLOR_ORDER.length) {
      const colors = seatColors(COLOR_ORDER.length, gameId);
      await seatBots(admin, gameId, await fillSeats(admin, seated ?? [], colors), colors, true);
    }
  }

  const started = await startGameNow(admin, gameId);
  return json(started);
}

/**
 * Hand a waiting quick-match room's entry fees back.
 *
 * The ext_id is what makes this safe to call from a fire-and-forget leave: the
 * client sends `leave` without awaiting it and the reaper may sweep the same
 * room later, so the refund has to be idempotent per (game, player) rather than
 * merely rare. wallet_txns_ext_id_uidx (0013) is the backstop.
 */
async function refundSeats(
  admin: SupabaseClient,
  gameId: string,
  stake: number,
  userIds: string[],
): Promise<void> {
  for (const uid of new Set(userIds)) {
    await walletApply(admin, uid, stake, "stake-refund", gameId, "earned", `leave-refund:${gameId}:${uid}`);
  }
}

/**
 * A player quits the room for good. Active game: the engine removes their
 * tokens and skips their turns from now on (2-player: the opponent wins) — the
 * stake is forfeited, which the client warns about before calling this.
 * Waiting lobby: the seat is freed and any quick-match entry is refunded.
 * Idempotent and safe to call as a fire-and-forget on the way out.
 */
export async function opLeave(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin
    .from("games")
    .select("id, host_user_id, status, state, state_version, is_quick, has_bots, stake")
    .eq("id", gameId)
    .single();
  if (!game) return json({ error: "Game not found." });
  const v = (game.state_version as number | null) ?? 0;

  if (game.status === "waiting") {
    if (game.is_quick && game.host_user_id === userId) {
      // Cancel matchmaking: tear the queue room down so another searcher
      // can't claim a seat opposite someone who already walked away.
      //
      // Read the seats BEFORE the delete — `players` cascades from `games`, so
      // afterwards there is nothing left to tell us who to pay back. Every
      // seated player was debited by quick_match_claim, not just the host, so
      // cancelling a part-filled 4-player room has to refund all of them.
      const { data: seated } = await admin.from("players").select("user_id").eq("game_id", gameId);
      // The status guard no-ops if a claim+start won the race (no refund then —
      // the game is live and the stake rides on it).
      const { data: deleted } = await admin
        .from("games")
        .delete()
        .eq("id", gameId)
        .eq("status", "waiting")
        .select("stake");
      const stake = (deleted?.[0]?.stake as number | null) ?? 0;
      if (stake > 0) await refundSeats(admin, gameId, stake, (seated ?? []).map((p) => String(p.user_id)));
      return json({ ok: true });
    }
    // Free the seat so someone else can take it. The host's seat stays (the
    // room is theirs); their absence just leaves the lobby idle.
    if (game.host_user_id !== userId) {
      const { data: removed } = await admin
        .from("players")
        .delete()
        .eq("game_id", gameId)
        .eq("user_id", userId)
        .select("id");
      // Nothing was seated (already left, or never here) — nothing to refund.
      if (!removed?.length) return json({ ok: true });

      // Quick match debits on seat claim (quick.ts), so a guest walking out of
      // the queue is owed their entry back. Friend rooms don't debit until the
      // host starts (deal.ts), so there is nothing to return there.
      const stake = (game.stake as number | null) ?? 0;
      if (game.is_quick && stake > 0) {
        // Re-read the status: a claim+start could have filled the table between
        // our read and this delete, and once the game is live the stake rides
        // on it — refunding then would hand a seated player their entry back.
        const { data: after } = await admin.from("games").select("status").eq("id", gameId).maybeSingle();
        if (after?.status === "waiting") await refundSeats(admin, gameId, stake, [userId]);
      }
    }
    return json({ ok: true });
  }

  const state = game.state as GameState | null;
  if (!state) return json({ error: "Game not found." });
  const me = state.players.find((p) => p.userId === userId);
  if (!me) return json({ error: "You are not in this game." });

  afterResponse(admin.from("players").update({ is_connected: false }).eq("game_id", gameId).eq("user_id", userId));
  if (game.status !== "active" || me.hasLeft) return json({ state, v });

  // If this was the last human, the table has nobody left to play for — end it
  // here rather than leaving bots to play each other under the cron tick.
  const left = engineLeaveGame(state, me.id, { now: Date.now() });
  const next = (game.has_bots ? await endIfNoHumansLeft(admin, gameId, left) : null) ?? left;
  const { data: updated, error } = await admin
    .from("games")
    .update({ state: next, status: next.status, current_turn_player_id: next.currentTurnPlayerId, turn_deadline: turnDeadline(next), state_version: v + 1 })
    .eq("id", gameId)
    .eq("state_version", v)
    .select("id")
    .maybeSingle();
  if (error) return safeError("room.write", error, WRITE_FAILED);
  if (!updated) return await freshState(admin, gameId, state);

  afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: me.id, action: { action: "leave" } }));
  await settleIfFinished(admin, gameId, next);
  recordFinishStats(admin, gameId, next);
  afterGameWrite(admin, gameId, !!game.has_bots, next, state);
  return json({ state: next, v: v + 1 });
}

// --- Rematch -----------------------------------------------------------------
// A rematch used to be the host's alone: they tapped, the finished game reset,
// and everybody else found themselves on a fresh board without being asked. Now
// it is a proposal. Anyone still seated can open one, everyone still seated
// answers, and the new deal seats whoever said yes.
//
// The votes live on `players.rematch_vote` (0043) so they ride the realtime
// path clients already listen to for that table, and so the games row — which
// is the state-sync channel, matched on state_version — stays untouched until
// there is an actual new state to send.

/** How long a proposal stands before it lapses. */
const REMATCH_SECONDS = 30;
/** Slack past the deadline before a client's close call is honoured, so devices
 *  with a slightly fast clock can't retire a proposal early. */
const REMATCH_GRACE_MS = 1500;
/** Past this much slack, a lapsed proposal is swept rather than settled — see
 *  opRematchClose. */
const REMATCH_STALE_MS = 5 * 60 * 1000;

/** The players-row shape the rematch path reads. */
interface VoteRow {
  user_id: string;
  rematch_vote: "yes" | "no" | null;
  rematch_voted_at: string | null;
}

/** Clear every vote in the room — a proposal has resolved, one way or another.
 *  Nulling both columns together is what makes "no vote" unambiguous: a null
 *  vote can only ever mean "hasn't answered the CURRENT proposal". */
function clearVotes(admin: SupabaseClient, gameId: string): PromiseLike<unknown> {
  return admin
    .from("players")
    .update({ rematch_vote: null, rematch_voted_at: null })
    .eq("game_id", gameId)
    .not("rematch_vote", "is", null);
}

/**
 * When the most recent proposal was opened, live or not.
 *
 * Derived from the earliest vote rather than stored: the first vote IS the
 * proposal, so there is no second fact to keep in step with it.
 */
function proposedAtMs(rows: VoteRow[]): number | null {
  let earliest: number | null = null;
  for (const r of rows) {
    if (!r.rematch_vote || !r.rematch_voted_at) continue;
    const at = Date.parse(r.rematch_voted_at);
    if (!Number.isFinite(at)) continue;
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest;
}

/** True while a proposal is still standing. Votes past the window are stale
 *  rows nobody has cleaned up yet, not an open question — the next proposal
 *  clears them before it opens. */
function voteIsOpen(rows: VoteRow[]): boolean {
  const at = proposedAtMs(rows);
  return at !== null && Date.now() < at + REMATCH_SECONDS * 1000;
}

/**
 * Deal the accepted seats into a fresh game on the same row.
 *
 * The seats keep their player ids and colors, so every client's own myPlayerId
 * still points at their chair and the board doesn't reshuffle under them.
 * Anyone who didn't accept is dropped from the room outright — their players
 * row goes, the same way opLeave frees a seat — because they are not in the
 * state that is about to be written and a row for a seat that doesn't exist is
 * just a lie the lobby would keep repeating.
 */
async function startRematch(
  admin: SupabaseClient,
  gameId: string,
  game: { state_version: number | null; has_bots: boolean | null },
  prev: GameState,
  accepted: Set<string>,
): Promise<Response> {
  const v = (game.state_version as number | null) ?? 0;
  const seats = prev.players.filter((p) => !p.hasLeft && accepted.has(p.userId));
  if (seats.length < 2) {
    afterResponse(clearVotes(admin, gameId));
    return json({ error: "Not enough players for a rematch." });
  }

  const players = seats.map((p) => ({ id: p.id, userId: p.userId, color: p.color }));
  const next = engineCreateGame(players, { gameId });

  const { data: updated, error } = await admin
    .from("games")
    // Rematches play for fun: the previous pot is already paid out, and
    // silently re-debiting seated guests would be a hidden charge — so the
    // stake resets along with the payout latch.
    .update({ state: next, status: "active", current_turn_player_id: next.currentTurnPlayerId, turn_deadline: turnDeadline(next), state_version: v + 1, stake: 0, payout_done: false })
    .eq("id", gameId)
    .eq("state_version", v)
    .select("id")
    .maybeSingle();
  if (error) return safeError("room.rematch", error, WRITE_FAILED);
  // Someone else's write won the race. Leave the votes alone: either their
  // write was the same rematch (in which case they cleared them) or the game
  // moved on and the next read will see the window lapsed.
  if (!updated) return await freshState(admin, gameId, prev);

  const seatedUsers = seats.map((p) => p.userId);
  afterResponse(
    admin
      .from("players")
      .update({ missed_turns: 0, is_connected: true, rematch_vote: null, rematch_voted_at: null })
      .eq("game_id", gameId)
      .in("user_id", seatedUsers),
  );
  // Everyone who didn't accept leaves with the old game.
  afterResponse(admin.from("players").delete().eq("game_id", gameId).not("user_id", "in", `(${seatedUsers.join(",")})`));
  afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: null, action: { action: "rematch", seats: seats.length } }));
  afterGameWrite(admin, gameId, !!game.has_bots, next, prev);

  return json({ state: next, v: v + 1, rematchStarted: true });
}

/**
 * Decide what a proposal's current tally means, and act on it.
 *
 * Called after every vote and from the deadline sweep, so "all four answered"
 * and "the clock ran out" resolve through identical code — the rule about what
 * a proposal is worth belongs in one place, not two.
 *
 * `due` is true only when the window has actually expired; while it stands, an
 * undecided seat is a seat still thinking, not a no.
 */
async function resolveRematch(
  admin: SupabaseClient,
  gameId: string,
  game: { state_version: number | null; has_bots: boolean | null },
  prev: GameState,
  rows: VoteRow[],
  due: boolean,
): Promise<Response | null> {
  // Counted over the SEATS, not over the rows: the game state decides who has
  // a say, and a seat with no players row (or none we managed to read) is an
  // unanswered question, not an absent one. Tallying rows instead would let a
  // missing row close a proposal early on everyone else's behalf.
  const voteOf = new Map(rows.map((r) => [r.user_id, r.rematch_vote]));
  const eligible = prev.players.filter((p) => !p.hasLeft).map((p) => p.userId);
  const yes = new Set(eligible.filter((u) => voteOf.get(u) === "yes"));
  const undecided = eligible.filter((u) => voteOf.get(u) == null);

  // Still someone to hear from, and time on the clock to hear from them. An
  // undecided seat is never assumed: it is the one vote that could still turn
  // a lone accepter into a game.
  if (undecided.length > 0 && !due) return null;

  if (yes.size >= 2) return await startRematch(admin, gameId, game, prev, yes);

  // Nobody to play with. Clear the board of votes so the results screen goes
  // back to offering a rematch rather than showing a proposal that can never
  // pass.
  afterResponse(clearVotes(admin, gameId));
  return null;
}

/**
 * Hidden seats answer a proposal too — a table that never rematches would out
 * them as surely as one that always does.
 *
 * Deferred and jittered rather than written inline: a vote stamped the same
 * millisecond as the proposal is not something a human hand produces, and
 * `rematch_voted_at` is a column every client can read. The delay is why this
 * re-resolves afterwards — the tally it lands on may be the one that closes
 * the proposal.
 *
 * Reads `game_bots`, which is service-role only, so bot-ness never leaves the
 * server (0009). Friend-room bots are flagged openly on the players row and are
 * covered by the same read.
 */
function voteBotsSoon(admin: SupabaseClient, gameId: string): void {
  afterResponse(
    (async () => {
      // game_bots holds every server-driven seat, hidden (quick match) and
      // labelled (friend room) alike — seatBots writes a row for both.
      const { data: bots } = await admin.from("game_bots").select("user_id").eq("game_id", gameId);
      const ids = [...new Set((bots ?? []).map((r) => String(r.user_id)))];
      if (ids.length === 0) return;

      await new Promise((r) => setTimeout(r, 1200 + Math.random() * 2600));

      // Only if the proposal is still the one we were asked about: a bot must
      // not vote into a window that has since lapsed or been replaced.
      const { data: game } = await admin
        .from("games")
        .select("id, status, state, state_version, has_bots")
        .eq("id", gameId)
        .maybeSingle();
      if (!game?.state || game.status !== "finished") return;
      const { data: rows } = await admin
        .from("players")
        .select("user_id, rematch_vote, rematch_voted_at")
        .eq("game_id", gameId);
      if (!voteIsOpen((rows ?? []) as VoteRow[])) return;

      await admin
        .from("players")
        .update({ rematch_vote: "yes", rematch_voted_at: new Date().toISOString() })
        .eq("game_id", gameId)
        .in("user_id", ids)
        .is("rematch_vote", null);

      const { data: after } = await admin
        .from("players")
        .select("user_id, rematch_vote, rematch_voted_at")
        .eq("game_id", gameId);
      await resolveRematch(
        admin,
        gameId,
        game as { state_version: number | null; has_bots: boolean | null },
        game.state as GameState,
        (after ?? []) as VoteRow[],
        false,
      );
    })(),
  );
}

/** The finished game plus its votes, or a refusal. Shared by vote and close. */
async function loadRematch(
  admin: SupabaseClient,
  userId: string,
  gameId: string,
): Promise<
  | { error: Response }
  | {
      game: { state_version: number | null; has_bots: boolean | null };
      prev: GameState;
      rows: VoteRow[];
    }
> {
  const { data: game } = await admin
    .from("games")
    .select("id, status, state, state_version, has_bots")
    .eq("id", gameId)
    .maybeSingle();
  if (!game || !game.state) return { error: json({ error: "Game not found." }) };
  if (game.status !== "finished") return { error: json({ error: "The game is still in progress." }) };

  const prev = game.state as GameState;
  const me = prev.players.find((p) => p.userId === userId);
  if (!me || me.hasLeft) return { error: json({ error: "You are not in this game." }) };

  const { data: rows } = await admin
    .from("players")
    .select("user_id, rematch_vote, rematch_voted_at")
    .eq("game_id", gameId);

  return {
    game: game as { state_version: number | null; has_bots: boolean | null },
    prev,
    rows: (rows ?? []) as VoteRow[],
  };
}

/**
 * Answer the standing rematch proposal — or, if there isn't one, open it.
 *
 * `vote` is absent on builds from before the vote existed, where this op meant
 * "host, start the rematch now". Reading that as a yes keeps those clients
 * working: their tap opens a proposal instead of restarting the table, which is
 * the whole point of this change, and the newer clients at the table can accept
 * it. Their own accept UI simply isn't there, so a proposal from someone else
 * lapses for them — an old build's rematch degrades, it doesn't break.
 */
export async function opRematchVote(
  admin: SupabaseClient,
  userId: string,
  gameId: string,
  vote: "yes" | "no",
): Promise<Response> {
  const loaded = await loadRematch(admin, userId, gameId);
  if ("error" in loaded) return loaded.error;
  const { game, prev, rows } = loaded;

  const standing = voteIsOpen(rows);

  // Declining a proposal that isn't running is a no-op, not an error: it is
  // what a stale results screen sends when its proposal lapsed a moment ago.
  if (!standing && vote === "no") return json({ state: prev, v: game.state_version ?? null });

  let votes = rows;
  if (!standing) {
    // Lapsed votes from an earlier proposal would otherwise be counted into
    // this one — and would date it, since proposedAtMs reads the earliest stamp.
    if (rows.some((r) => r.rematch_vote != null)) await clearVotes(admin, gameId);
    votes = rows.map((r) => ({ ...r, rematch_vote: null, rematch_voted_at: null }));
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("players")
    .update({ rematch_vote: vote, rematch_voted_at: now })
    .eq("game_id", gameId)
    .eq("user_id", userId);
  if (error) return safeError("room.rematchVote", error, WRITE_FAILED);
  votes = votes.map((r) => (r.user_id === userId ? { ...r, rematch_vote: vote, rematch_voted_at: now } : r));

  // Open the hidden seats' answers on the way out (deferred), but only for a
  // proposal this call actually started.
  if (!standing && game.has_bots) voteBotsSoon(admin, gameId);

  const resolved = await resolveRematch(admin, gameId, game, prev, votes, false);
  return resolved ?? json({ state: prev, v: game.state_version ?? null });
}

/**
 * The proposal's clock ran out — settle it.
 *
 * Client-driven for the same reason the turn clock is (opTimeout): the players
 * watching the screen are the ones who notice, and the server re-checks the
 * real deadline off the rows rather than trusting the caller's opinion of the
 * time. Any participant may call it; whoever gets there first does the work and
 * the rest find nothing left to settle.
 */
export async function opRematchClose(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const loaded = await loadRematch(admin, userId, gameId);
  if ("error" in loaded) return loaded.error;
  const { game, prev, rows } = loaded;

  const still = json({ state: prev, v: game.state_version ?? null });
  const opened = proposedAtMs(rows);
  if (opened === null) return still; // nothing was ever proposed

  // Not out of time yet. The grace is judged against the server's clock, so a
  // device running fast can't retire a proposal out from under a slower one.
  const ranOutAt = opened + REMATCH_SECONDS * 1000;
  if (Date.now() < ranOutAt + REMATCH_GRACE_MS) return still;

  // Long dead. These are votes from a table everybody walked away from before
  // anyone's clock fired — reviving a game off them would restart a board the
  // accepters stopped looking at minutes ago. Sweep them instead.
  if (Date.now() > ranOutAt + REMATCH_STALE_MS) {
    afterResponse(clearVotes(admin, gameId));
    return still;
  }

  const resolved = await resolveRematch(admin, gameId, game, prev, rows, true);
  return resolved ?? still;
}
