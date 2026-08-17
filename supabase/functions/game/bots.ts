/**
 * Hidden fill-in seats for quick match.
 *
 * A bot is a real auth user with an ordinary profile row — nothing
 * client-readable marks the seat as anything else. Bot-ness lives in
 * `game_bots` / `bot_identities`, which have RLS on and no policies, so only
 * the service role can see them.
 */

// @deno-types="../_shared/engine/index.d.ts"
import {
  applyMove,
  endTurn,
  getValidMoves,
  rollDice,
  type GameState,
} from "../_shared/engine/index.js";
// @deno-types="../_shared/bot/index.d.ts"
import { chooseMove } from "../_shared/bot/index.js";
import { afterResponse, cryptoRng, sleep, TURN_SECONDS, type SupabaseClient } from "./lib.ts";
import { recordFinishStats, settleIfFinished } from "./finish.ts";

/**
 * Pacing.
 *
 * These pauses do NOT protect the animation. The client owns that: every
 * realtime row is held for its own `stateAnimationMs` before the next is
 * applied (onlineStore's enqueueGameRow), so writes arriving faster than the
 * board can draw are queued and played in order rather than collapsed. The
 * server pacing exists for one reason only — a seat that answers instantly,
 * every time, to the millisecond, does not read as a person.
 *
 * That frees the pause to be shorter than the animation it overlaps. The
 * board is then the bottleneck, which is exactly where the bottleneck belongs:
 * the game runs at drawing speed with the queue always a step ahead, instead of
 * at drawing speed PLUS a fixed 900ms of dead air per action.
 *
 * The old constants were a flat 900/900 metronome. A fixed interval is the
 * loudest tell a bot has, so the replacements are ranges sampled per action.
 */
/** Think time between the bot's own writes, before jitter. */
const BOT_STEP_PAUSE_MIN_MS = 320;
const BOT_STEP_PAUSE_MAX_MS = 680;
/** Beat before the hidden "opponent" reacts — reads as a human noticing their
 *  turn. Wider than the step pause: picking up your phone is slower than
 *  playing the next move once you are already looking at the board. */
const BOT_TURN_LEAD_MIN_MS = 500;
const BOT_TURN_LEAD_MAX_MS = 1500;
/** Extra deliberation when the position actually presents a choice. Scaled by
 *  how many legal moves there are, capped so a four-way choice is not a stall. */
const BOT_PER_CHOICE_MS = 110;
const BOT_MAX_CHOICES = 3;

/** Safety cap on one call's bot actions (extra turns from 6s/captures chain).
 *  If a turn somehow runs longer, the peers' timers fire again and resume. */
export const BOT_MAX_ACTIONS = 8;

/** Uniform sample in [min, max]. */
function jitter(min: number, max: number): number {
  return min + cryptoRng() * (max - min);
}

/**
 * How long to wait before the bot's next write. `choices` is the number of
 * legal moves it just chose between — 0 for a roll or a forced pass, which are
 * not decisions and should not look like ones.
 */
export function stepPauseMs(choices: number): number {
  const deliberation = Math.min(choices, BOT_MAX_CHOICES) * BOT_PER_CHOICE_MS;
  return jitter(BOT_STEP_PAUSE_MIN_MS, BOT_STEP_PAUSE_MAX_MS) + deliberation;
}
/** Short deadline while the server drives a bot: if the driving isolate dies,
 *  any client's timeout call resumes the turn after ~12s instead of 30. */
const BOT_TURN_SECONDS = 12;

/** Fill-in identities: everyday first names (some with an initial), mixed with
 *  the app's own guest-handle format so the pool reads like the player base. */
const BOT_NAMES = [
  "Maya", "Arjun K", "Sofia", "Leo M", "Priya", "Daniel", "Amara", "Kenji",
  "Lucas P", "Anika", "Mateo", "Zoe", "Rahul", "Elena V", "Sam T", "Nadia",
  "Omar", "Isla", "Ravi J", "Clara", "Tomas", "Mina K", "Jonas", "Aisha",
  "Nikhil", "Lena", "Marco B", "Tara", "Felix", "Divya", "Noah S", "Ipsita",
];

function pickBotName(rng: () => number, attempt: number): string {
  // A third of the pool presents as app guests; the rest as chosen names.
  if (rng() < 0.34) return `guest${String(Math.floor(rng() * 900000) + 100000)}`;
  const base = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)]!;
  return attempt === 0 ? base : `${base}${Math.floor(rng() * 90) + 10}`;
}

/** Avatar ids mirrored from the client's Avatar.tsx set. */
const BOT_AVATARS = ["leo", "sunny", "coco", "zara", "rex", "nina", "milo", "ivy", "ace", "ruby", "bruno", "kito"];

/** Dice skin ids mirrored from the client's diceSkins.ts set, weighted toward
 *  classic/cheap — the same distribution 0014_dice_skins.sql used to dress
 *  the existing bot pool — so an equipped skin never becomes a bot tell.
 *  Never the gold-and-up prestige tiers: a hidden "opponent" flexing a
 *  75,000-coin skin invites exactly the scrutiny bots are built to avoid. */
function pickBotDiceSkin(rng: () => number): string | null {
  const r = rng();
  if (r < 0.55) return null;
  if (r < 0.7) return "cherry";
  if (r < 0.8) return "mint";
  if (r < 0.88) return "midnight";
  if (r < 0.93) return "bubblegum";
  if (r < 0.97) return "walnut";
  return "neon";
}

/**
 * Reuse a free identity from the pool, or mint one: a real auth user (so the
 * profiles FK holds) with an ordinary profile row — indistinguishable from a
 * human to every client-readable surface.
 */
export async function claimOrCreateBotIdentity(admin: SupabaseClient, gameId: string): Promise<string | null> {
  const { data: claimed } = await admin.rpc("claim_bot_identity", { p_game: gameId });
  if (claimed) return String(claimed);

  const { data: created, error } = await admin.auth.admin.createUser({
    email: `bot-${crypto.randomUUID()}@bots.ludo.internal`,
    email_confirm: true,
  });
  if (error || !created?.user) return null;
  const uid = created.user.id;
  await admin.from("bot_identities").insert({ user_id: uid, in_use_game_id: gameId });

  const avatar = BOT_AVATARS[Math.floor(cryptoRng() * BOT_AVATARS.length)]!;
  const diceSkin = pickBotDiceSkin(cryptoRng);
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = pickBotName(cryptoRng, attempt);
    const { error: profErr } = await admin
      .from("profiles")
      .insert({ user_id: uid, display_name: name, avatar_id: avatar, dice_skin: diceSkin });
    if (!profErr) return uid;
    if (!/unique|duplicate/i.test(profErr.message)) break;
  }
  // Names exhausted (or another failure): a timestamp guest handle is unique enough.
  await admin
    .from("profiles")
    .insert({ user_id: uid, display_name: `guest${String(Date.now()).slice(-6)}`, avatar_id: avatar, dice_skin: diceSkin })
    .then(undefined, () => {});
  return uid;
}

/**
 * Seat bots into every still-empty chair, from `seated.length` up to `size`.
 *
 * Shared by quick match (hidden fill-in when nobody shows up) and friend rooms
 * (the host explicitly asked to fill). `visible` is the only difference: it
 * sets players.is_bot, which the client turns into a BOT tag. Quick match must
 * pass false or the camouflage is gone (0035).
 *
 * Returns how many were seated. A pool that can't produce an identity stops the
 * loop rather than failing the call — the caller decides whether what it got is
 * enough to play with.
 */
export async function seatBots(
  admin: SupabaseClient,
  gameId: string,
  fromSeat: number,
  size: number,
  colors: readonly string[],
  visible: boolean,
): Promise<number> {
  let added = 0;
  for (let seat = fromSeat; seat < size; seat++) {
    const botUserId = await claimOrCreateBotIdentity(admin, gameId);
    if (!botUserId) break;
    const { error: seatErr } = await admin
      .from("players")
      .insert({ game_id: gameId, user_id: botUserId, color: colors[seat], seat, is_bot: visible });
    if (seatErr) {
      // A human took the seat between our read and the insert — release the
      // identity; the human fills that chair instead.
      afterResponse(
        admin.from("bot_identities").update({ in_use_game_id: null }).eq("user_id", botUserId).eq("in_use_game_id", gameId),
      );
      continue;
    }
    // Awaited: the insert's trigger is what sets games.has_bots (0022), and the
    // caller's startGameNow reads that flag to decide whether to drive a bot.
    await admin.from("game_bots").insert({ game_id: gameId, user_id: botUserId });
    added++;
  }
  return added;
}

/**
 * Post-write hook for rooms with a hidden seat: on finish, release the bots'
 * identities back to the pool; while active, if the turn just landed on a bot,
 * drive it after a human-feeling pause. Runs via waitUntil — never on the
 * response path. Every write inside is version-guarded, so a duplicate driver
 * (racing calls, an opTimeout fallback) loses cleanly instead of double-acting.
 *
 * `hasBots` is the games row's own flag (0022), maintained by trigger. It
 * replaces an unconditional game_bots lookup on every single write — the vast
 * majority of which were quick games between two humans, asking a question
 * whose answer was already sitting on the row the caller had just fetched.
 */
export function afterGameWrite(admin: SupabaseClient, gameId: string, hasBots: boolean, next: GameState): void {
  if (!hasBots) return;
  afterResponse(
    (async () => {
      const { data } = await admin.from("game_bots").select("user_id").eq("game_id", gameId);
      const botIds = new Set((data ?? []).map((r) => String(r.user_id)));
      if (botIds.size === 0) return;

      if (next.status === "finished") {
        await admin.from("bot_identities").update({ in_use_game_id: null }).eq("in_use_game_id", gameId);
        return;
      }
      if (next.status !== "active") return;

      // A rematch re-deals the same room — re-mark the identities as in use
      // (best-effort; purely advisory bookkeeping for the reuse pool).
      if (next.lastAction?.type === "createGame") {
        await admin
          .from("bot_identities")
          .update({ in_use_game_id: gameId })
          .in("user_id", [...botIds])
          .is("in_use_game_id", null);
      }

      const uid = next.players.find((p) => p.id === next.currentTurnPlayerId)?.userId;
      if (!uid || !botIds.has(uid)) return;
      await sleep(jitter(BOT_TURN_LEAD_MIN_MS, BOT_TURN_LEAD_MAX_MS));
      await driveBotTurns(admin, gameId, botIds);
    })(),
  );
}

/**
 * Server-side driver for hidden-bot seats: act, CAS-write, pace, repeat while
 * the turn belongs to a bot. The step cap bounds one isolate's run; the short
 * bot deadline plus the clients' opTimeout path resumes a turn if the isolate
 * is evicted.
 *
 * State is carried forward between steps rather than re-read. The loop used to
 * open every iteration with a SELECT, including the overwhelmingly common case
 * where the previous iteration had just written that exact row and won the CAS
 * — a full round trip per bot action to fetch something already in hand. On a
 * chained turn (six, capture, six) that was three wasted round trips before the
 * player saw anything move.
 *
 * Racing drivers stay harmless because the CAS is what actually decides. A lost
 * write drops `cur` and the next iteration re-reads the winner's row, which is
 * the old behaviour on exactly the path that needs it.
 */
async function driveBotTurns(admin: SupabaseClient, gameId: string, botIds: Set<string>): Promise<void> {
  let cur: GameState | null = null;
  let v = 0;

  for (let step = 0; step < BOT_MAX_ACTIONS * 3; step++) {
    if (!cur) {
      const { data: game } = await admin.from("games").select("state, state_version").eq("id", gameId).single();
      const fetched = game?.state as GameState | undefined;
      if (!fetched) return;
      cur = fetched;
      v = (game!.state_version as number | null) ?? 0;
    }

    if (cur.status !== "active") {
      await admin.from("bot_identities").update({ in_use_game_id: null }).eq("in_use_game_id", gameId);
      return;
    }
    const pid = cur.currentTurnPlayerId;
    const uid = cur.players.find((p) => p.id === pid)?.userId;
    if (!uid || !botIds.has(uid)) return; // a human's turn — stand down

    let next: GameState;
    let logged: Record<string, unknown>;
    // Number of options the bot weighed, for pacing: a real player pauses over
    // a choice and plays a forced move straight away.
    let choices = 0;
    if (cur.phase === "awaiting-roll") {
      const roll = rollDice(cur, cryptoRng);
      next = roll.newState;
      logged = { action: "bot-roll", dice: roll.diceValue };
    } else {
      const moves = getValidMoves(cur, pid);
      if (moves.length === 0) {
        next = endTurn(cur);
        logged = { action: "bot-pass", dice: cur.diceValue };
      } else {
        const move = chooseMove(cur, pid, moves);
        next = applyMove(cur, { tokenId: move.tokenId });
        logged = { action: "bot-move", tokenId: move.tokenId, dice: cur.diceValue };
        choices = moves.length;
      }
    }

    const nextUid = next.players.find((p) => p.id === next.currentTurnPlayerId)?.userId;
    const nextIsBot = !!nextUid && botIds.has(nextUid);
    const deadlineSecs = nextIsBot ? BOT_TURN_SECONDS : TURN_SECONDS;
    const { data: updated, error } = await admin
      .from("games")
      .update({
        state: next,
        status: next.status,
        current_turn_player_id: next.currentTurnPlayerId,
        turn_deadline: next.status === "active" ? new Date(Date.now() + deadlineSecs * 1000).toISOString() : null,
        state_version: v + 1,
      })
      .eq("id", gameId)
      .eq("state_version", v)
      .select("id")
      .maybeSingle();
    if (error) return;

    if (updated) {
      afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: pid, action: logged }));
      if (next.status !== "active") {
        await settleIfFinished(admin, gameId, next);
        recordFinishStats(admin, gameId, next);
        await admin.from("bot_identities").update({ in_use_game_id: null }).eq("in_use_game_id", gameId);
        return;
      }
      if (!nextIsBot) return;
      // We own the row: carry it forward instead of re-reading it next step.
      cur = next;
      v = v + 1;
    } else {
      // CAS loss: someone else wrote first. Drop our copy and re-read theirs.
      cur = null;
    }
    await sleep(stepPauseMs(choices));
  }
}
