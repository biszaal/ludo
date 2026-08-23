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
  type Rng,
} from "../_shared/engine/index.js";
// @deno-types="../_shared/bot/index.d.ts"
import { chooseMove } from "../_shared/bot/index.js";
import {
  afterResponse,
  AWAY_TURN_SECONDS,
  cryptoRng,
  deriveDie,
  freshState,
  isAwaySeat,
  json,
  rngForDie,
  safeError,
  sleep,
  turnDeadline,
  turnHolder,
  type SupabaseClient,
  UNIQUE_VIOLATION,
  WRITE_FAILED,
} from "./lib.ts";
import { afterGameWrite, BOT_MAX_ACTIONS, stepPauseMs } from "./bots.ts";
import { broadcastToRoom } from "./chat.ts";
import { endIfNoHumansLeft, recordFinishStats, settleIfFinished } from "./finish.ts";

/**
 * Consecutive whole turns a player may idle through (bot-played) before the
 * server removes them from the game. A briefly-minimized app resets the count
 * the moment it comes back (resync / next action); a closed app never does.
 *
 * Five, not three, because the strikes now cost the room far less than they
 * used to: only the FIRST one is worth a full 30-second clock (the player is
 * still presumed present, and deserves it). Every strike after that resolves in
 * about AWAY_TURN_SECONDS, so the table keeps moving while the absent seat is
 * given a genuinely long time — a couple of minutes at a four-handed table — to
 * come back before it forfeits the game and its stake.
 */
const MISSED_TURNS_TO_LEAVE = 5;

/**
 * Beat before the server plays a seat it already knows nobody is behind.
 *
 * Long enough that the table sees whose turn it is and reads the takeover as a
 * turn being played rather than skipped, and long enough for a player whose app
 * is coming back to clear their own away flag first. Short enough that the room
 * is not, once again, watching a countdown.
 */
const AWAY_TAKEOVER_MS = 1200;

/**
 * The randomness one roll uses: the derived die where a key is configured, a
 * fresh crypto draw where it isn't.
 *
 * EVERY roll goes through here, including the ones played for a seat by a bot,
 * and that uniformity is a fairness requirement rather than tidiness. Handing a
 * player their die before they commit to rolling (opPrepareRoll) means a bad one
 * is knowable in advance — so if declining to roll got the seat played by a bot
 * drawing from cryptoRng, stalling would buy a genuine re-roll for the price of
 * one missed turn, and buying an outcome is the one thing the game must never
 * sell. Derived on both paths, the die you walked away from is the die the bot
 * rolls for you: the stall path re-derives at the same state_version, with the
 * same seat, and gets the same number.
 */
async function rollRng(gameId: string, v: number, playerId: string): Promise<Rng> {
  const die = await deriveDie(gameId, v, playerId);
  return die === null ? cryptoRng : rngForDie(die);
}

/**
 * A player's own roll/move/pass.
 *
 * `actionId` is the client's idempotency key for this ONE tap, reused verbatim
 * across every retry of it. Turn ops used to be the only calls the client would
 * never retry — replaying a lost roll would have rolled twice — so a request a
 * congested network dropped was simply lost, and the client's resync snapped
 * the board back to before it. To the player that reads as the game cancelling
 * their roll, or walking their pawn back, with a turn clock running.
 *
 * The id makes the replay detectable, which is what makes the retry safe. See
 * claimAction below for the invariant the whole scheme rests on. Omitted by
 * older app builds, which then take exactly the path they always did.
 */
export async function opTurn(
  admin: SupabaseClient,
  userId: string,
  gameId: string,
  action: "roll" | "move" | "pass",
  tokenId?: string,
  actionId?: string,
): Promise<Response> {
  const { data: game } = await admin
    .from("games")
    .select("id, state, state_version, has_bots, fold_writes")
    .eq("id", gameId)
    .single();
  if (!game || !game.state) return json({ error: "Game not found." });

  const state = game.state as GameState;
  const v = (game.state_version as number | null) ?? 0;

  /**
   * Refuse the action — unless it is a retry of one that already went through.
   *
   * Every check below describes the world AFTER a successful action just as
   * well as it describes an illegal one: "You already rolled" is exactly what a
   * landed roll looks like to the retry chasing its lost response, and once the
   * turn has moved on it becomes "Not your turn". Reporting either would take
   * the player's real result away from them and put an error in its place.
   *
   * The claim lookup costs a read, so it happens only here — on the paths that
   * were going to fail anyway, never on the ordinary one.
   */
  const reject = async (message: string): Promise<Response> =>
    actionId && (await actionApplied(admin, gameId, actionId))
      ? await duplicateState(admin, gameId, state)
      : json({ error: message });

  if (state.status !== "active") return await reject("Game is not active.");

  const me = state.players.find((p) => p.userId === userId);
  if (!me) return await reject("You are not in this game.");
  if (me.id !== state.currentTurnPlayerId) return await reject("Not your turn.");

  /**
   * A folding table's roll writes nothing at all.
   *
   * The die is derived from (gameId, v, playerId), so the move op recomputes
   * this exact value at this exact version — the write was never carrying
   * information the server needed, only information other players needed to
   * SEE. That goes out as ~60 bytes of broadcast instead of a 2.2KB state
   * document re-authorized against RLS once per subscriber.
   *
   * Deliberately ahead of claimAction: with no write to replay there is
   * nothing to make idempotent, and claiming an id here would answer the
   * retry of a dropped roll with "already applied" plus a state that still
   * says awaiting-roll — taking the player's die away to protect a write that
   * never happened. Re-deriving at an unchanged v is idempotent by
   * construction.
   */
  if (action === "roll" && game.fold_writes) {
    if (state.phase !== "awaiting-roll") return await reject("You already rolled.");
    // Derivability is a PRECONDITION of folding, not an optimisation. With
    // DICE_SECRET unset deriveDie returns null and rolls fall back to
    // cryptoRng — genuinely random per call — so the move op would re-derive a
    // DIFFERENT die than the one just shown, and the pawn would move by a
    // number the player never saw. Fall through to the writing path instead:
    // slower, and correct.
    const die = await deriveDie(gameId, v, me.id);
    if (die !== null) {
      const rolled = rollDice(state, rngForDie(die)).newState;
      // Fire-and-forget: a lost broadcast costs one spectator one die
      // animation, and the state push that follows is still authoritative.
      afterResponse(broadcastToRoom(gameId, "roll", { die, playerId: me.id, v }));
      return json({ state: rolled, v });
    }
  }

  let next: GameState;
  if (action === "roll") {
    if (state.phase !== "awaiting-roll") return await reject("You already rolled.");
    next = rollDice(state, await rollRng(gameId, v, me.id)).newState;
  } else if (action === "pass") {
    if (state.phase !== "awaiting-move") return await reject("Roll first.");
    if (getValidMoves(state, me.id).length > 0) return await reject("You still have a move.");
    next = endTurn(state);
  } else {
    if (state.phase !== "awaiting-move") return await reject("Roll first.");
    const check = validateMove(state, { tokenId: tokenId ?? "" });
    if (!check.valid) return await reject(check.reason ?? "Illegal move.");
    next = applyMove(state, { tokenId: tokenId ?? "" });
  }

  const logged = {
    game_id: gameId,
    player_id: me.id,
    action: { action, tokenId: tokenId ?? null, dice: next.diceValue },
    ...(actionId ? { client_action_id: actionId } : {}),
  };

  // Claim the id before touching the game. A replay stops here and is told so,
  // rather than rolling a second die for a player who already has one.
  if (actionId) {
    const claim = await claimAction(admin, logged);
    if (claim === "duplicate") return await duplicateState(admin, gameId, state);
    if (claim === "failed") return json({ error: WRITE_FAILED });
  }

  // Did this hand the turn to somebody the server already knows is away? Then
  // the room gets the short clock instead of another full 30 seconds of nothing
  // (and, below, a takeover that doesn't wait for even that). The lookup is
  // skipped whenever the turn stays with the player who just acted — they are
  // present by definition, which is the overwhelmingly common case.
  const handoff = turnHolder(next);
  const away = !!handoff && handoff !== userId && (await isAwaySeat(admin, gameId, handoff));

  // Version-guarded write: a racing write (stall bot, duplicate tap) loses
  // cleanly instead of silently clobbering, and the counter gives clients a
  // cheap dedup/ordering key for every realtime row.
  const { data: updated, error } = await admin
    .from("games")
    .update({
      state: next,
      status: next.status,
      current_turn_player_id: next.currentTurnPlayerId,
      turn_deadline: away ? turnDeadline(next, AWAY_TURN_SECONDS) : turnDeadline(next),
      state_version: v + 1,
    })
    .eq("id", gameId)
    .eq("state_version", v)
    .select("id")
    .maybeSingle();
  // The action did not happen, so its id must not stay spent — otherwise the
  // client's retry is answered "already done" forever and the roll it is still
  // waiting on never lands.
  if (error || !updated) {
    if (actionId) await releaseAction(admin, gameId, actionId);
    if (error) return safeError("turn.write", error, WRITE_FAILED);
    return await freshState(admin, gameId, state);
  }

  // Already inserted above when there was an id to claim.
  if (!actionId) afterResponse(admin.from("moves").insert(logged));
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
  afterGameWrite(admin, gameId, !!game.has_bots, next, state);
  if (away) driveAwaySeatSoon(admin, gameId);

  // This action earned the same player another roll (a six, or a bonus from a
  // capture or a finish). We already know the version it will roll at, so send
  // the die with the answer rather than making the client come back for it —
  // a chained roll is exactly the one that has no gap to prefetch in.
  const chained =
    next.status === "active" && next.phase === "awaiting-roll" && next.currentTurnPlayerId === me.id
      ? await deriveDie(gameId, v + 1, me.id)
      : null;

  return json({ state: next, v: v + 1, ...(chained === null ? {} : { nextRoll: { v: v + 1, dice: chained } }) });
}

/**
 * Hand the caller the die their next roll will produce, before they roll it.
 *
 * This is what removes the wait from the online die. The value is fixed the
 * moment the state is (see deriveDie), so telling the player early changes
 * nothing about what they get — it just means the tumble has something to land
 * on the instant they tap, instead of after a round trip. Clients fire this as
 * the turn arrives, during the previous player's animation.
 *
 * Read-only: no write, no `moves` row, no version bump. That is what keeps it
 * safe to answer more than once, and what keeps the answer stable — asking
 * again cannot move `state_version`, so it cannot fish for a different die.
 *
 * Gated to the seat whose turn it is. The derivation includes the seat, so an
 * opponent could not compute it anyway, but there is no reason to answer at
 * all: a die is only ever anyone's business on their own turn.
 *
 * `{ available: false }` is a normal answer, not an error — no key configured,
 * not your turn, already rolled. The client simply takes the slow path it
 * always took, tumbling until the roll comes back.
 *
 * No rateOk guard, on the same reasoning the turn ops use: the op is bounded by
 * the game rather than by a counter. It answers only the one seat whose turn it
 * is, costs a single primary-key read and an HMAC, writes nothing, and returns
 * the same value however many times it is asked — so hammering it buys the
 * caller nothing they do not already have. A limiter would also be a second
 * round trip on the one call whose whole purpose is to arrive before the
 * player's thumb does.
 */
export async function opPrepareRoll(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const unavailable = json({ available: false });
  const { data: game } = await admin.from("games").select("state, state_version").eq("id", gameId).single();
  const state = game?.state as GameState | undefined;
  if (!state || state.status !== "active" || state.phase !== "awaiting-roll") return unavailable;
  const me = state.players.find((p) => p.userId === userId);
  if (!me || me.id !== state.currentTurnPlayerId) return unavailable;
  const v = (game!.state_version as number | null) ?? 0;
  const dice = await deriveDie(gameId, v, me.id);
  return dice === null ? unavailable : json({ available: true, v, dice });
}

/**
 * The turn just landed on a seat the server already knows is away: play it now,
 * rather than making everyone else sit out a clock first.
 *
 * This is the difference between "the bot takes over" and "every single turn
 * pauses for the absent player". The strike still counts (advanceStalledGame
 * records it), so an app that never comes back still walks itself out of the
 * game — it just does so without holding the table hostage on the way.
 *
 * Deferred, and deliberately re-checking everything after the beat: the player
 * may have come back inside it, in which case the seat and its full clock are
 * theirs again. Anything this writes is CAS-guarded on the deadline and version
 * it read, so a returning player's own action always wins the race.
 */
function driveAwaySeatSoon(admin: SupabaseClient, gameId: string): void {
  afterResponse((async () => {
    await sleep(AWAY_TAKEOVER_MS);
    const { data: game } = await admin
      .from("games")
      .select("id, state, turn_deadline, state_version, is_quick, has_bots")
      .eq("id", gameId)
      .maybeSingle();
    const state = game?.state as GameState | undefined;
    if (!state || state.status !== "active") return;
    const uid = turnHolder(state);
    if (!uid || !(await isAwaySeat(admin, gameId, uid))) return;
    await advanceStalledGame(admin, { ...(game as unknown as StalledGameRow), state }, { force: true });
  })());
}

/**
 * Record this action id, using the `moves` unique index as the mutex.
 *
 * The invariant every retry leans on, in both directions:
 *
 *     a moves row with this client_action_id exists  <=>  the action applied
 *
 * Left-to-right is what stops a retry double-acting a turn. Right-to-left is
 * why the claim is released whenever the state write does not land — a claim
 * that outlives a write that never happened would wedge the retry against an id
 * that can never be honoured, cancelling the player's roll just as surely as
 * before, only silently.
 *
 * The one gap is an isolate that dies between the claim and the write. The
 * retry is then told "duplicate", stops, and waits for a state that is not
 * coming — which the client's resync corrects the same way it always has. That
 * is the old behaviour for a vanishingly rarer event, not a new failure.
 */
async function claimAction(
  admin: SupabaseClient,
  logged: Record<string, unknown>,
): Promise<"claimed" | "duplicate" | "failed"> {
  const { error } = await admin.from("moves").insert(logged);
  if (!error) return "claimed";
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) return "duplicate";
  console.error("[turn.claim]", error.message);
  return "failed";
}

/** Has this id already been honoured? Only ever asked on a path that is about
 *  to fail, so the happy path pays nothing for it. */
async function actionApplied(admin: SupabaseClient, gameId: string, actionId: string): Promise<boolean> {
  const { data } = await admin
    .from("moves")
    .select("id")
    .eq("game_id", gameId)
    .eq("client_action_id", actionId)
    .maybeSingle();
  return !!data;
}

/** Hand the id back after a write that never landed. */
async function releaseAction(admin: SupabaseClient, gameId: string, actionId: string): Promise<void> {
  await admin.from("moves").delete().eq("game_id", gameId).eq("client_action_id", actionId);
}

/**
 * Answer a replay: the authoritative state, flagged as already-applied.
 *
 * The flag is load-bearing, and not just informative. A retry can overlap its
 * own first attempt, so this row may still be the pre-action one — the winner's
 * write is in flight a few milliseconds away. Applied as an ordinary result it
 * would snap the board back to exactly what the retry existed to prevent. The
 * flag tells the client to hold its prediction and let the real state arrive.
 */
async function duplicateState(admin: SupabaseClient, gameId: string, fallback: GameState): Promise<Response> {
  const { data } = await admin.from("games").select("state, state_version").eq("id", gameId).single();
  return json({ state: (data?.state as GameState) ?? fallback, v: data?.state_version ?? null, duplicate: true });
}

/**
 * One bot decision for a stalled seat: the state it produces and its log row.
 *
 * The roll derives from the seat's own coordinates at this exact
 * `state_version` — the same inputs the absent player's own roll would have
 * used, so playing for them cannot draw a different number than they would
 * have. See rollRng for why that matters.
 */
async function decideStalledStep(
  gameId: string,
  v: number,
  cur: GameState,
  awayPlayerId: string,
): Promise<{ next: GameState; logged: Record<string, unknown> }> {
  if (cur.phase === "awaiting-roll") {
    const roll = rollDice(cur, await rollRng(gameId, v, cur.currentTurnPlayerId));
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
  const { next, logged } = await decideStalledStep(gameId, v, cur, awayPlayerId);
  // The seat we are playing for is away, so as long as the turn stays with it
  // the clock stays short; handing off asks about the seat receiving it.
  const stays = next.currentTurnPlayerId === awayPlayerId;
  const handoff = stays ? null : turnHolder(next);
  const short = stays || (!!handoff && (await isAwaySeat(admin, gameId, handoff)));
  const nextDeadline = short ? turnDeadline(next, AWAY_TURN_SECONDS) : turnDeadline(next);
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
  // Reaching here means the deadline passed and the seat had to be played for
  // its owner — the one moment we know for certain somebody kept the table
  // waiting, and the only honest cue for a "Hurry up!".
  afterGameWrite(admin, gameId, hasBots, state, null, { stalled: true });
  // The turn may have landed on another absent seat. Two people leaving at once
  // is exactly when a room can least afford to wait out a clock per seat, per
  // round; each of them still collects their own strikes on the way out.
  const holder = turnHolder(state);
  if (holder && (await isAwaySeat(admin, gameId, holder))) driveAwaySeatSoon(admin, gameId);
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
export async function advanceStalledGame(
  admin: SupabaseClient,
  game: StalledGameRow,
  opts: { force?: boolean } = {},
): Promise<StalledOutcome> {
  const state = game.state;
  const v = game.state_version ?? 0;
  const hasBots = !!game.has_bots;
  const gameId = game.id;
  if (state.status !== "active") return { kind: "not-due" };

  // The clock is checked here, not at the call site: the source of truth is the
  // row we just read, never the caller's opinion of the time.
  //
  // `force` is the one caller that legitimately doesn't need the clock: the seat
  // has ALREADY missed a whole one and hasn't come back, so there is nothing
  // left to wait for (driveAwaySeatSoon, which re-checks that just before it
  // calls in). A deadline must still exist — every write below CASes on it.
  const deadline = game.turn_deadline ? Date.parse(game.turn_deadline) : NaN;
  if (!Number.isFinite(deadline)) return { kind: "not-due" };
  if (!opts.force && Date.now() < deadline) return { kind: "not-due" };

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

  // A bot seat whose driver isolate died: no Away badge, no idle strikes. For a
  // hidden quick-match seat either would out it; for a labelled friend-room bot
  // they would be nonsense — a bot cannot be away, and letting one accumulate
  // strikes ended with the room told that a bot had left the game.
  let stalledBot = false;
  if ((game.is_quick || game.has_bots) && awayUserId) {
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
