/**
 * The turn path: a player's own roll/move/pass, and the stall bot that plays a
 * turn whose owner has gone quiet.
 */

// @deno-types="../_shared/engine/index.d.ts"
import {
  applyMove,
  endTurn,
  getValidMoves,
  leaveGame as engineLeaveGame,
  rollDice,
  validateMove,
  type GameState,
} from "../_shared/engine/index.js";
// @deno-types="../_shared/bot/index.d.ts"
import { chooseMove } from "../_shared/bot/index.js";
import {
  afterResponse,
  cryptoRng,
  freshState,
  json,
  safeError,
  sleep,
  turnDeadline,
  type SupabaseClient,
  WRITE_FAILED,
} from "./lib.ts";
import { afterGameWrite, BOT_MAX_ACTIONS, stepPauseMs } from "./bots.ts";
import { endIfNoHumansLeft, recordFinishStats, settleIfFinished } from "./finish.ts";

/**
 * Consecutive whole turns a player may idle through (bot-played) before the
 * server removes them from the game. A briefly-minimized app resets the count
 * the moment it comes back (resync / next action); a closed app never does.
 */
const MISSED_TURNS_TO_LEAVE = 3;

export async function opTurn(
  admin: SupabaseClient,
  userId: string,
  gameId: string,
  action: "roll" | "move" | "pass",
  tokenId?: string,
): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, state, state_version, has_bots").eq("id", gameId).single();
  if (!game || !game.state) return json({ error: "Game not found." });

  const state = game.state as GameState;
  const v = (game.state_version as number | null) ?? 0;
  if (state.status !== "active") return json({ error: "Game is not active." });

  const me = state.players.find((p) => p.userId === userId);
  if (!me) return json({ error: "You are not in this game." });
  if (me.id !== state.currentTurnPlayerId) return json({ error: "Not your turn." });

  let next: GameState;
  if (action === "roll") {
    if (state.phase !== "awaiting-roll") return json({ error: "You already rolled." });
    next = rollDice(state, cryptoRng).newState;
  } else if (action === "pass") {
    if (state.phase !== "awaiting-move") return json({ error: "Roll first." });
    if (getValidMoves(state, me.id).length > 0) return json({ error: "You still have a move." });
    next = endTurn(state);
  } else {
    if (state.phase !== "awaiting-move") return json({ error: "Roll first." });
    const check = validateMove(state, { tokenId: tokenId ?? "" });
    if (!check.valid) return json({ error: check.reason ?? "Illegal move." });
    next = applyMove(state, { tokenId: tokenId ?? "" });
  }

  // Version-guarded write: a racing write (stall bot, duplicate tap) loses
  // cleanly instead of silently clobbering, and the counter gives clients a
  // cheap dedup/ordering key for every realtime row.
  const { data: updated, error } = await admin
    .from("games")
    .update({
      state: next,
      status: next.status,
      current_turn_player_id: next.currentTurnPlayerId,
      turn_deadline: turnDeadline(next),
      state_version: v + 1,
    })
    .eq("id", gameId)
    .eq("state_version", v)
    .select("id")
    .maybeSingle();
  if (error) return safeError("turn.write", error, WRITE_FAILED);
  if (!updated) return await freshState(admin, gameId, state);

  afterResponse(
    admin.from("moves").insert({ game_id: gameId, player_id: me.id, action: { action, tokenId: tokenId ?? null, dice: next.diceValue } }),
  );
  // Acting proves the player is present — clear the idle strike counter. Only
  // write when something changes: every players write fans out a realtime
  // event that makes each client refetch the lobby.
  afterResponse(
    admin
      .from("players")
      .update({ missed_turns: 0, is_connected: true })
      .eq("game_id", gameId)
      .eq("user_id", userId)
      .or("missed_turns.neq.0,is_connected.eq.false"),
  );
  await settleIfFinished(admin, gameId, next);
  recordFinishStats(admin, gameId, next);
  afterGameWrite(admin, gameId, !!game.has_bots, next);

  return json({ state: next, v: v + 1 });
}

/** One bot decision for a stalled seat: the state it produces and its log row. */
function decideStalledStep(cur: GameState, awayPlayerId: string): { next: GameState; logged: Record<string, unknown> } {
  if (cur.phase === "awaiting-roll") {
    const roll = rollDice(cur, cryptoRng);
    return { next: roll.newState, logged: { action: "bot-roll", dice: roll.diceValue } };
  }
  const moves = getValidMoves(cur, awayPlayerId);
  if (moves.length === 0) {
    return { next: endTurn(cur), logged: { action: "bot-pass", dice: cur.diceValue } };
  }
  const move = chooseMove(cur, awayPlayerId, moves);
  return {
    next: applyMove(cur, { tokenId: move.tokenId }),
    logged: { action: "bot-move", tokenId: move.tokenId, dice: cur.diceValue },
  };
}

interface StepOutcome {
  state: GameState;
  v: number;
  guard: string | null;
}

/** Play one action for the stalled seat and CAS-write it. Null means someone
 *  else wrote first (racing caller, or the player came back) — the caller
 *  stands down rather than re-deciding on a state that is no longer current. */
async function writeStalledStep(
  admin: SupabaseClient,
  gameId: string,
  awayPlayerId: string,
  cur: GameState,
  v: number,
  guard: string | null,
): Promise<StepOutcome | null> {
  const { next, logged } = decideStalledStep(cur, awayPlayerId);
  const nextDeadline = turnDeadline(next);
  const { data: updated, error } = await admin
    .from("games")
    .update({ state: next, status: next.status, current_turn_player_id: next.currentTurnPlayerId, turn_deadline: nextDeadline, state_version: v + 1 })
    .eq("id", gameId)
    .eq("turn_deadline", guard!)
    .eq("state_version", v)
    .select("id")
    .maybeSingle();
  if (error || !updated) return null;

  afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: awayPlayerId, action: logged }));
  return { state: next, v: v + 1, guard: nextDeadline };
}

/** Does the stalled seat still owe another action (extra turn from a 6 or a capture)? */
function stillStalled(step: StepOutcome, awayPlayerId: string): boolean {
  return step.state.status === "active" && step.state.currentTurnPlayerId === awayPlayerId && !!step.guard;
}

/** Everything that has to happen once the stalled turn is over. */
async function finishStalledTurn(admin: SupabaseClient, gameId: string, hasBots: boolean, state: GameState): Promise<void> {
  await settleIfFinished(admin, gameId, state);
  recordFinishStats(admin, gameId, state);
  afterGameWrite(admin, gameId, hasBots, state);
}

/**
 * The rest of a stalled turn, paced so clients can animate each write.
 *
 * Deferred, never on the response path: this loop sleeps ~900ms between
 * actions, and a turn that chains extra rolls used to hold the caller's request
 * open for up to seven seconds against a 20s client budget — paying edge
 * wall-clock to pace an animation the client already paces itself (the row
 * queue in onlineStore holds each state for its own animation length).
 */
function continueStalledTurn(
  admin: SupabaseClient,
  gameId: string,
  awayPlayerId: string,
  hasBots: boolean,
  from: StepOutcome,
): void {
  afterResponse((async () => {
    let cur = from;
    for (let step = 1; step < BOT_MAX_ACTIONS; step++) {
      // 0 choices: this is an absent human's seat being played out, not a
      // hidden opponent to make convincing — pace it for readability, not feel.
      await sleep(stepPauseMs(0));
      const nextStep = await writeStalledStep(admin, gameId, awayPlayerId, cur.state, cur.v, cur.guard);
      if (!nextStep) return; // someone else owns the turn now — they'll settle it
      cur = nextStep;
      if (!stillStalled(cur, awayPlayerId)) break;
    }
    await finishStalledTurn(admin, gameId, hasBots, cur.state);
  })());
}

/** The games-row columns the stall driver needs. */
export interface StalledGameRow {
  id: string;
  state: GameState;
  turn_deadline: string | null;
  state_version: number | null;
  is_quick: boolean | null;
  has_bots: boolean | null;
}

/**
 * Outcome of driving a stalled turn.
 * - `advanced`: we wrote an action; `state`/`v` are authoritative.
 * - `not-due`: the clock has not actually expired (or already advanced).
 * - `raced`: someone else wrote first — their write stands, and whoever won
 *   owns settling the turn.
 */
export type StalledOutcome =
  | { kind: "advanced"; state: GameState; v: number }
  | { kind: "not-due" }
  | { kind: "raced" };

/**
 * Play the idle seat's turn with the server's bot policy: roll, then the
 * policy's move (or a forced pass), including any extra turns it earns.
 *
 * Shared by opTimeout (a participant's device noticed the clock ran out) and
 * the cron tick (nobody's device is watching at all). Keeping one body means
 * the unattended path can't drift from the attended one — the auto-leave rule,
 * the hidden-bot camouflage and the deadline guards are the same code.
 *
 * Every write is guarded on the turn_deadline it read. The deadline refreshes
 * on every write, so racing drivers and a returning player can never double-act
 * a turn: the loser's CAS simply misses.
 *
 * Only the first action is awaited; extra turns stream in over realtime as the
 * deferred loop writes them.
 */
export async function advanceStalledGame(admin: SupabaseClient, game: StalledGameRow): Promise<StalledOutcome> {
  const state = game.state;
  const v = game.state_version ?? 0;
  const hasBots = !!game.has_bots;
  const gameId = game.id;
  if (state.status !== "active") return { kind: "not-due" };

  // The clock is checked here, not at the call site: the source of truth is the
  // row we just read, never the caller's opinion of the time.
  const deadline = game.turn_deadline ? Date.parse(game.turn_deadline) : NaN;
  if (!Number.isFinite(deadline) || Date.now() < deadline) return { kind: "not-due" };

  // Before driving anything: is there still a human this table is being played
  // for? A bot-only table is checked once a minute here rather than only at the
  // moment the last human leaves, so a game that reached this state by any
  // other route — or before the leave-time check existed — still terminates.
  const abandoned = hasBots ? await endIfNoHumansLeft(admin, gameId, state) : null;
  if (abandoned) {
    const { data: ended } = await admin
      .from("games")
      .update({ state: abandoned, status: abandoned.status, current_turn_player_id: abandoned.currentTurnPlayerId, turn_deadline: null, state_version: v + 1 })
      .eq("id", gameId)
      .eq("turn_deadline", game.turn_deadline!)
      .eq("state_version", v)
      .select("id")
      .maybeSingle();
    if (!ended) return { kind: "raced" };
    afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: state.currentTurnPlayerId, action: { action: "abandoned" } }));
    await finishStalledTurn(admin, gameId, hasBots, abandoned);
    return { kind: "advanced", state: abandoned, v: v + 1 };
  }

  const awayPlayerId = state.currentTurnPlayerId;
  const awayUserId = state.players.find((p) => p.id === awayPlayerId)?.userId;

  // Hidden-bot seat whose driver isolate died: no Away badge, no idle strikes
  // (either would out the bot). The steps below simply play the turn.
  let stalledBot = false;
  if (game.is_quick && awayUserId) {
    const { data: botRow } = await admin
      .from("game_bots")
      .select("user_id")
      .eq("game_id", gameId)
      .eq("user_id", awayUserId)
      .maybeSingle();
    stalledBot = !!botRow;
  }

  // They idled through the whole clock — show the room an Away badge and count
  // the strike. Their own device clears both on foreground/resync (or their
  // next action); a closed app never comes back, so the strikes accumulate.
  if (awayUserId && !stalledBot) {
    const { data: row } = await admin
      .from("players")
      .select("missed_turns")
      .eq("game_id", gameId)
      .eq("user_id", awayUserId)
      .maybeSingle();
    const missed = (row?.missed_turns ?? 0) + 1;
    await admin
      .from("players")
      .update({ is_connected: false, missed_turns: missed })
      .eq("game_id", gameId)
      .eq("user_id", awayUserId);

    if (missed >= MISSED_TURNS_TO_LEAVE) {
      // Gone for good — remove them from the game instead of bot-playing
      // another turn. Guard on the deadline we read so a racing caller (or
      // the player suddenly returning) can't double-apply.
      const left = engineLeaveGame(state, awayPlayerId, { now: Date.now() });
      // Their departure may have left a table of nothing but bots.
      const next = (await endIfNoHumansLeft(admin, gameId, left)) ?? left;
      const { data: updated } = await admin
        .from("games")
        .update({ state: next, status: next.status, current_turn_player_id: next.currentTurnPlayerId, turn_deadline: turnDeadline(next), state_version: v + 1 })
        .eq("id", gameId)
        .eq("turn_deadline", game.turn_deadline!)
        .eq("state_version", v)
        .select("id")
        .maybeSingle();
      if (!updated) return { kind: "raced" };
      afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: awayPlayerId, action: { action: "auto-leave", missed } }));
      await finishStalledTurn(admin, gameId, hasBots, next);
      return { kind: "advanced", state: next, v: v + 1 };
    }
  }

  const first = await writeStalledStep(admin, gameId, awayPlayerId, state, v, game.turn_deadline);
  if (!first) return { kind: "raced" };

  if (stillStalled(first, awayPlayerId)) {
    continueStalledTurn(admin, gameId, awayPlayerId, hasBots, first);
  } else {
    await finishStalledTurn(admin, gameId, hasBots, first.state);
  }

  return { kind: "advanced", state: first.state, v: first.v };
}

/**
 * The current turn idled past its deadline — the player's app is closed or
 * asleep, so nothing local can act for them. Any participant may call this (the
 * idle player rarely will); the server re-checks the clock, so a client can't
 * trigger it early.
 *
 * The response carries the first action only; any extra turns it earns stream
 * in over realtime as they are written.
 */
export async function opTimeout(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin
    .from("games")
    .select("id, state, turn_deadline, state_version, is_quick, has_bots")
    .eq("id", gameId)
    .single();
  if (!game || !game.state) return json({ error: "Game not found." });
  const v = (game.state_version as number | null) ?? 0;

  const state = game.state as GameState;
  if (state.status !== "active") return json({ error: "Game is not active." });

  // Only participants can drive the room's clock.
  if (!state.players.some((p) => p.userId === userId)) return json({ error: "You are not in this game." });

  const outcome = await advanceStalledGame(admin, { ...(game as unknown as StalledGameRow), state });
  if (outcome.kind === "advanced") return json({ state: outcome.state, v: outcome.v });
  if (outcome.kind === "raced") return await freshState(admin, gameId, state);
  return json({ state, v }); // not actually expired (or already advanced) — no-op
}
