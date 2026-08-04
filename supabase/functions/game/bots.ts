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

/** Pause between the bot's writes so clients can animate each one — outlasts
 *  the ~700ms die tumble, mirroring the client autopilot's pacing. */
export const BOT_STEP_PAUSE_MS = 900;
/** Safety cap on one call's bot actions (extra turns from 6s/captures chain).
 *  If a turn somehow runs longer, the peers' timers fire again and resume. */
export const BOT_MAX_ACTIONS = 8;
/** Beat before the hidden "opponent" reacts — reads as a human noticing their turn. */
const BOT_TURN_LEAD_MS = 900;
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
      await sleep(BOT_TURN_LEAD_MS);
      await driveBotTurns(admin, gameId, botIds);
    })(),
  );
}

/**
 * Server-side driver for hidden-bot seats: re-read, act, CAS-write, pace,
 * repeat while the turn belongs to a bot. Re-reading every step makes racing
 * drivers harmless — a lost write just re-reads the winner's row and carries
 * on from there. The step cap bounds one isolate's run; the short bot deadline
 * plus the clients' opTimeout path resumes a turn if the isolate is evicted.
 */
async function driveBotTurns(admin: SupabaseClient, gameId: string, botIds: Set<string>): Promise<void> {
  for (let step = 0; step < BOT_MAX_ACTIONS * 3; step++) {
    const { data: game } = await admin.from("games").select("state, state_version").eq("id", gameId).single();
    const cur = game?.state as GameState | undefined;
    if (!cur) return;
    const v = (game!.state_version as number | null) ?? 0;
    if (cur.status !== "active") {
      await admin.from("bot_identities").update({ in_use_game_id: null }).eq("in_use_game_id", gameId);
      return;
    }
    const pid = cur.currentTurnPlayerId;
    const uid = cur.players.find((p) => p.id === pid)?.userId;
    if (!uid || !botIds.has(uid)) return; // a human's turn — stand down

    let next: GameState;
    let logged: Record<string, unknown>;
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
    }
    // CAS loss: loop back, re-read the winner's row and re-decide from there.
    await sleep(BOT_STEP_PAUSE_MS);
  }
}
