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
import {
  afterResponse,
  AWAY_TURN_SECONDS,
  cryptoRng,
  deriveDie,
  isAwaySeat,
  rngForDie,
  sleep,
  TURN_SECONDS,
  type SupabaseClient,
} from "./lib.ts";
import { recordFinishStats, settleIfFinished } from "./finish.ts";
import { relayChat } from "./chat.ts";
import {
  classifyEvent,
  composeMessage,
  personalityFor,
  REACT_DELAY_MAX_MS,
  REACT_DELAY_MIN_MS,
  shouldSpeak,
  type ClassifyOpts,
} from "./botChat.ts";

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

/**
 * How a name or a face reads: feminine, masculine, or neither.
 *
 * "Neither" is not a hedge — six of the twelve avatars wear a cap, beanie,
 * headphones, crown, afro or cat ears, which cover the hairline and leave
 * nothing to read. Those go with any name at all.
 */
type Presents = "f" | "m" | "n";

/** Fill-in identities: everyday first names (some with an initial), mixed with
 *  the app's own guest-handle format so the pool reads like the player base.
 *  Tagged so the face can be chosen to match — an unmatched pair (Sofia in the
 *  beard, Daniel in the pigtails) is the kind of detail a player notices even
 *  when they can't say why the seat felt off. */
const BOT_NAMES: readonly (readonly [string, Presents])[] = [
  ["Maya", "f"], ["Arjun K", "m"], ["Sofia", "f"], ["Leo M", "m"],
  ["Priya", "f"], ["Daniel", "m"], ["Amara", "f"], ["Kenji", "m"],
  ["Lucas P", "m"], ["Anika", "f"], ["Mateo", "m"], ["Zoe", "f"],
  ["Rahul", "m"], ["Elena V", "f"], ["Sam T", "n"], ["Nadia", "f"],
  ["Omar", "m"], ["Isla", "f"], ["Ravi J", "m"], ["Clara", "f"],
  ["Tomas", "m"], ["Mina K", "f"], ["Jonas", "m"], ["Aisha", "f"],
  ["Nikhil", "m"], ["Lena", "f"], ["Marco B", "m"], ["Tara", "f"],
  ["Felix", "m"], ["Divya", "f"], ["Noah S", "m"], ["Ipsita", "f"],
];

/** A chosen name, and what it implies about the face that should wear it. */
function pickBotName(rng: () => number, attempt: number): { name: string; presents: Presents } {
  // A third of the pool presents as app guests; the rest as chosen names. A
  // guest handle says nothing about its owner, so any avatar suits it.
  if (rng() < 0.34) {
    return { name: `guest${String(Math.floor(rng() * 900000) + 100000)}`, presents: "n" };
  }
  const [base, presents] = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)]!;
  return { name: attempt === 0 ? base : `${base}${Math.floor(rng() * 90) + 10}`, presents };
}

/** Avatar ids mirrored from the client's render/avatars.ts set, tagged by how
 *  the drawn style reads (see Avatar.tsx buildOps): hair-forward faces present,
 *  hat-and-ears faces don't. Keep in sync if the avatar set grows. */
const BOT_AVATARS: readonly (readonly [string, Presents])[] = [
  ["zara", "f"], ["nina", "f"], ["ruby", "f"],       // bun, pigtails, bow
  ["sunny", "m"], ["milo", "m"], ["bruno", "m"],     // spiky, side part, beard
  ["leo", "n"], ["coco", "n"], ["rex", "n"],         // crown, afro, cap
  ["ivy", "n"], ["ace", "n"], ["kito", "n"],         // beanie, headphones, cat
];

/** A face that suits the name: same presentation, or one of the neutral ones. */
function pickBotAvatar(rng: () => number, presents: Presents): string {
  const fits = BOT_AVATARS.filter(([, p]) => p === presents || p === "n");
  return fits[Math.floor(rng() * fits.length)]![0];
}

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

  const diceSkin = pickBotDiceSkin(cryptoRng);
  // Name first, face second. The other order (which is what this used to do)
  // picks the avatar once, outside the retry loop, and leaves it to chance
  // whether the two agree — which is how the pool filled up with mismatches.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { name, presents } = pickBotName(cryptoRng, attempt);
    const { error: profErr } = await admin
      .from("profiles")
      .insert({ user_id: uid, display_name: name, avatar_id: pickBotAvatar(cryptoRng, presents), dice_skin: diceSkin });
    if (!profErr) return uid;
    if (!/unique|duplicate/i.test(profErr.message)) break;
  }
  // Names exhausted (or another failure): a timestamp guest handle is unique
  // enough, and implies nothing, so any face suits it.
  await admin
    .from("profiles")
    .insert({
      user_id: uid,
      display_name: `guest${String(Date.now()).slice(-6)}`,
      avatar_id: pickBotAvatar(cryptoRng, "n"),
      dice_skin: diceSkin,
    })
    .then(undefined, () => {});
  return uid;
}

/**
 * Seat bots into the given chairs.
 *
 * Shared by quick match (hidden fill-in when nobody shows up) and friend rooms
 * (the host explicitly asked to fill). `visible` is the only difference: it
 * sets players.is_bot, which the client turns into a BOT tag. Quick match must
 * pass false or the camouflage is gone (0035).
 *
 * The chairs are a list rather than a range because a friend room does not
 * always fill left to right: two humans at a four-handed table take the
 * diagonal, which leaves the bots seats 1 and 3 (room.ts).
 *
 * Returns how many were seated. A pool that can't produce an identity stops the
 * loop rather than failing the call — the caller decides whether what it got is
 * enough to play with.
 */
export async function seatBots(
  admin: SupabaseClient,
  gameId: string,
  seats: readonly number[],
  colors: readonly string[],
  visible: boolean,
): Promise<number> {
  let added = 0;
  for (const seat of seats) {
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

/** A bot seat's chat budget in one game, straight off its game_bots row. */
interface BotChatMeta {
  chatCount: number;
  lastChatAtMs: number | null;
}
type BotSeats = Map<string, BotChatMeta>;

/** Read the game's bot seats and their chat budgets in one go. This select
 *  already ran on every write; the two extra columns ride along for free. */
async function loadBotSeats(admin: SupabaseClient, gameId: string): Promise<BotSeats> {
  const { data } = await admin.from("game_bots").select("user_id, chat_count, last_chat_at").eq("game_id", gameId);
  const seats: BotSeats = new Map();
  for (const row of data ?? []) {
    const lastAt = row.last_chat_at as string | null;
    seats.set(String(row.user_id), {
      chatCount: (row.chat_count as number | null) ?? 0,
      lastChatAtMs: lastAt ? Date.parse(lastAt) : null,
    });
  }
  return seats;
}

/**
 * Post-write hook for rooms with a hidden seat: on finish, release the bots'
 * identities back to the pool; while active, react to what just happened and,
 * if the turn just landed on a bot, drive it after a human-feeling pause. Runs
 * via waitUntil — never on the response path. Every write inside is
 * version-guarded, so a duplicate driver (racing calls, an opTimeout fallback)
 * loses cleanly instead of double-acting.
 *
 * `hasBots` is the games row's own flag (0022), maintained by trigger. It
 * replaces an unconditional game_bots lookup on every single write — the vast
 * majority of which were quick games between two humans, asking a question
 * whose answer was already sitting on the row the caller had just fetched.
 *
 * `prev` is the state this write moved on FROM. Optional because not every
 * caller has one (a freshly dealt game has no predecessor); the only thing that
 * needs it is attributing a busted three-six roll, which has no token to read
 * the actor off and has already handed the turn on by the time we see `next`.
 */
export function afterGameWrite(
  admin: SupabaseClient,
  gameId: string,
  hasBots: boolean,
  next: GameState,
  prev?: GameState | null,
  opts: ClassifyOpts = {},
): void {
  if (!hasBots) return;
  afterResponse(
    (async () => {
      const seats = await loadBotSeats(admin, gameId);
      if (seats.size === 0) return;

      // Concurrent, not sequential: a reaction waits out its own beat, and the
      // next bot's move must not queue behind it. Both are awaited together so
      // this task — and the isolate waitUntil is keeping alive for it —
      // outlives whichever of the two finishes last. Registering a second
      // waitUntil from in here would be racing the runtime for that window.
      await Promise.all([
        maybeBotChat(admin, gameId, seats, prev ?? null, next, opts).catch(() => {}),
        releaseAndDrive(admin, gameId, seats, next),
      ]);
    })(),
  );
}

/** The identity bookkeeping and turn driving half of afterGameWrite. */
async function releaseAndDrive(
  admin: SupabaseClient,
  gameId: string,
  seats: BotSeats,
  next: GameState,
): Promise<void> {
  const botIds = new Set(seats.keys());
  if (next.status === "finished") {
    await admin.from("bot_identities").update({ in_use_game_id: null }).eq("in_use_game_id", gameId);
    return;
  }
  if (next.status !== "active") return;

  // A rematch re-deals the same room — re-mark the identities as in use
  // (best-effort; purely advisory bookkeeping for the reuse pool). The chat
  // budget resets with it: a rematch reuses the same game_id, so without
  // this the second game inherits a spent allowance and plays out silent.
  if (next.lastAction?.type === "createGame") {
    await admin
      .from("bot_identities")
      .update({ in_use_game_id: gameId })
      .in("user_id", [...botIds])
      .is("in_use_game_id", null);
    await admin.from("game_bots").update({ chat_count: 0, last_chat_at: null }).eq("game_id", gameId);
    for (const meta of seats.values()) {
      meta.chatCount = 0;
      meta.lastChatAtMs = null;
    }
  }

  const uid = next.players.find((p) => p.id === next.currentTurnPlayerId)?.userId;
  if (!uid || !botIds.has(uid)) return;
  await sleep(jitter(BOT_TURN_LEAD_MIN_MS, BOT_TURN_LEAD_MAX_MS));
  await driveBotTurns(admin, gameId, seats);
}

/**
 * Decide whether a bot reacts to this write, and if so, send it.
 *
 * One speaker per moment, never a chorus: three bots independently rolling
 * their own dice would make a four-handed table erupt every time anything
 * happened. When a moment belongs to nobody in particular (a game start, two
 * humans colliding) the speaker is drawn from the seats still holding budget.
 *
 * Failure is silence. Chat is decoration on top of a game that has to keep
 * working, so every path here swallows rather than throws.
 */
async function maybeBotChat(
  admin: SupabaseClient,
  gameId: string,
  seats: BotSeats,
  prev: GameState | null,
  next: GameState,
  opts: ClassifyOpts,
): Promise<void> {
  const moment = classifyEvent(prev, next, new Set(seats.keys()), opts);
  if (!moment) return;

  const candidates = moment.speakerUserId
    ? [moment.speakerUserId].filter((id) => seats.has(id))
    : [...seats.keys()];
  if (candidates.length === 0) return;
  const speaker = candidates[Math.floor(cryptoRng() * candidates.length)]!;

  const meta = seats.get(speaker)!;
  const now = Date.now();
  if (!shouldSpeak(personalityFor(speaker), moment.event, meta.chatCount, meta.lastChatAtMs, now, cryptoRng)) {
    return;
  }

  // Spend the budget BEFORE the beat, not after. `seats` is a snapshot the
  // caller holds for a whole driven chain, and this function sleeps in the
  // middle — without reserving up front, every reaction in that chain would
  // read the same stale count and the cap would mean nothing. Mutating the
  // entry is what the map is for; the row write below is the durable copy.
  const spent = { chatCount: meta.chatCount, lastChatAtMs: meta.lastChatAtMs };
  meta.chatCount += 1;
  meta.lastChatAtMs = now;

  const { kind, value } = composeMessage(moment.event, cryptoRng);
  await sleep(jitter(REACT_DELAY_MIN_MS, REACT_DELAY_MAX_MS));
  if (!(await relayChat(gameId, speaker, kind, value))) {
    // Nothing reached the room, so nothing was spent.
    meta.chatCount = spent.chatCount;
    meta.lastChatAtMs = spent.lastChatAtMs;
    return;
  }
  await admin
    .from("game_bots")
    .update({ chat_count: meta.chatCount, last_chat_at: new Date(now).toISOString() })
    .eq("game_id", gameId)
    .eq("user_id", speaker);
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
 *
 * These writes bypass afterGameWrite, so the chat hook is called here too —
 * without it a bot could never react to its OWN capture or win, which is most
 * of what there is to react to.
 */
async function driveBotTurns(admin: SupabaseClient, gameId: string, seats: BotSeats): Promise<void> {
  // A reaction sleeps out its own beat, so it must not be awaited inside the
  // loop — that would pace the bot's moves to the speed of its chat. They are
  // collected instead and settled before this task ends, which is what keeps
  // the isolate alive long enough for the last one to send.
  const reactions: Promise<unknown>[] = [];
  try {
    await driveLoop(admin, gameId, seats, reactions);
  } finally {
    await Promise.allSettled(reactions);
  }
}

async function driveLoop(
  admin: SupabaseClient,
  gameId: string,
  seats: BotSeats,
  reactions: Promise<unknown>[],
): Promise<void> {
  const botIds = new Set(seats.keys());
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
      // Derived like every other roll (see turn.ts rollRng). A hidden bot's seat
      // is never one a client may call prepareRoll for, so nothing is revealed
      // here — this is uniformity, so there is exactly one way a die is made.
      const die = await deriveDie(gameId, v, pid);
      const roll = rollDice(cur, die === null ? cryptoRng : rngForDie(die));
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
    // Handing back to a human the server already knows is away gets the short
    // clock, so the room doesn't sit through a full 30 seconds of an empty seat
    // before a client's timeout call plays it. Only asked at the end of a bot's
    // run, never between its own steps.
    const deadlineSecs = nextIsBot
      ? BOT_TURN_SECONDS
      : nextUid && next.status === "active" && (await isAwaySeat(admin, gameId, nextUid))
        ? AWAY_TURN_SECONDS
        : TURN_SECONDS;
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
      // Our own write, so `cur` is exactly the state it moved on from.
      reactions.push(maybeBotChat(admin, gameId, seats, cur, next, {}).catch(() => {}));
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
