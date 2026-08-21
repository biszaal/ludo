/**
 * What a hidden seat says, and how often.
 *
 * A seat that plays well and never reacts is a tell. Humans at the table have
 * emoji and quick-message chips; a bot that captures four tokens in silence
 * reads as software. So bots speak — through the same server-stamped broadcast
 * every human message goes through (chat.ts), from the same message set the
 * chips offer. Nothing a bot can say is something a human could not have said.
 *
 * Everything here is pure and rng-injected. The impure half — reading the
 * cooldown, picking a speaker, sending — lives in bots.ts, where the game_bots
 * row is already in hand.
 *
 * Three dials keep it from becoming noise:
 *   - PERSONALITY: fixed per identity, so "the quiet one" is quiet every game.
 *   - PER-EVENT WEIGHT: a six is common and barely worth mentioning; being
 *     captured is not.
 *   - COOLDOWN + CAP: hard stops that no run of luck can talk past.
 */

// @deno-types="../_shared/engine/index.d.ts"
import type { GameState } from "../_shared/engine/index.js";

/** How talkative one identity is. Fixed for that identity, forever. */
export type Personality = "talkative" | "average" | "quiet";

/** A moment worth reacting to. */
export type BotEvent =
  | "gameStart"
  | "botCaptures"
  | "botCaptured"
  | "humansClash"
  | "botFinishedToken"
  | "botSix"
  | "botBusted"
  | "humanStalled"
  | "gameOver";

/**
 * The quick-message chips, mirrored from the app's ChatSheet.tsx.
 *
 * Duplicated rather than imported: the app and the edge function do not share a
 * module graph (only `_shared/{engine,bot}` crosses that line), the same way
 * CHAT_MAX_LEN is mirrored in chat.ts. If the chips change, change this too —
 * a bot saying something with no chip behind it is exactly the tell this file
 * exists to avoid. botChat.test.ts pins every message below to this list.
 */
export const QUICK_MESSAGES = [
  "Good luck!",
  "Nice move!",
  "Well played",
  "Hurry up!",
  "Ouch!",
  "Nooo",
  "So close!",
  "Wow!",
  "Lucky!",
  "Almost there",
  "My turn!",
  "Sorry!",
  "GG",
  "One more?",
] as const;

/** Reaction sprite ids, mirrored from the app's lib/emoji.ts. */
export const EMOJI_IDS = [
  "laugh",
  "cry",
  "tease",
  "angry",
  "shock",
  "cheer",
  "thumbs",
  "gg",
] as const;

/** What a bot may say for each moment, and how much that moment is worth
 *  saying anything about at all (0..1, multiplied by the personality's rate). */
interface EventVoice {
  text: readonly string[];
  emoji: readonly string[];
  /** Scales the personality's base rate. Common moments sit low. */
  weight: number;
}

export const VOICES: Record<BotEvent, EventVoice> = {
  // Openers are charming once and grating four times over, so a table of three
  // bots still usually opens quiet.
  gameStart: { text: ["Good luck!"], emoji: ["thumbs"], weight: 0.5 },
  // Taunting your own capture, the way a person does.
  botCaptures: { text: ["Sorry!", "Lucky!"], emoji: ["tease", "laugh"], weight: 1 },
  botCaptured: { text: ["Ouch!", "Nooo", "So close!"], emoji: ["cry", "shock", "angry"], weight: 1 },
  // Two humans colliding — a bystander noise, so it stays rare.
  humansClash: { text: ["Wow!"], emoji: ["shock", "laugh"], weight: 0.35 },
  botFinishedToken: { text: ["Almost there", "Nice move!"], emoji: ["cheer"], weight: 0.7 },
  // Sixes are frequent. Almost never worth a word.
  botSix: { text: ["My turn!"], emoji: ["thumbs"], weight: 0.2 },
  botBusted: { text: ["Nooo", "Ouch!"], emoji: ["cry", "angry"], weight: 0.8 },
  humanStalled: { text: ["Hurry up!"], emoji: ["tease"], weight: 0.7 },
  gameOver: { text: ["GG", "Well played", "One more?"], emoji: ["gg", "cheer"], weight: 0.6 },
};

/** Base speak-rate and per-game budget for each personality. */
const DIAL: Record<Personality, { rate: number; cap: number }> = {
  talkative: { rate: 0.35, cap: 7 },
  average: { rate: 0.15, cap: 4 },
  quiet: { rate: 0.04, cap: 2 },
};

/** No bot speaks twice inside this window, however eventful the game gets. */
export const CHAT_COOLDOWN_MS = 25_000;

/**
 * Which personality an identity has.
 *
 * Derived from the user id rather than stored: it costs no column and no read,
 * and it is stable for the life of the identity — the same "opponent" is quiet
 * in every game you meet them in, which is the whole point of giving them one.
 * The hash is FNV-1a over the uuid text; the buckets are 25/50/25.
 */
export function personalityFor(userId: string): Personality {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const bucket = h % 100;
  if (bucket < 25) return "quiet";
  if (bucket < 75) return "average";
  return "talkative";
}

/** The colour that owns a token id ("red-2" -> "red"). */
function colorOf(tokenId: string): string {
  return tokenId.slice(0, tokenId.lastIndexOf("-"));
}

/** user_id seated on a colour in this state, or null. */
function userIdForColor(state: GameState, color: string): string | null {
  return state.players.find((p) => p.color === color)?.userId ?? null;
}

/** One classified moment: what happened, and which bot gets to react to it. */
export interface BotMoment {
  event: BotEvent;
  /** The bot this moment belongs to, or null when any bot at the table may
   *  react (a game start, a clash between two humans). */
  speakerUserId: string | null;
}

export interface ClassifyOpts {
  /** The write we are reacting to is a turn the player let time out. */
  stalled?: boolean;
}

/**
 * Read one state transition and decide whether anything happened worth a
 * reaction, and whose reaction it is.
 *
 * The mover is taken from the moved token's COLOUR, not from
 * `currentTurnPlayerId`: by the time we see `next` the turn has usually been
 * handed on, so the current player is the wrong person to attribute a capture
 * to. A busted roll is the one case with no token to read, which is why `prev`
 * is worth passing when the caller has it.
 */
export function classifyEvent(
  prev: GameState | null,
  next: GameState,
  botUserIds: ReadonlySet<string>,
  opts: ClassifyOpts = {},
): BotMoment | null {
  if (botUserIds.size === 0) return null;

  // A finished game outranks whatever move finished it.
  if (next.status === "finished") return { event: "gameOver", speakerUserId: null };
  if (next.status !== "active") return null;

  if (opts.stalled) return { event: "humanStalled", speakerUserId: null };

  const action = next.lastAction;
  if (!action) return null;

  if (action.type === "createGame") return { event: "gameStart", speakerUserId: null };

  if (action.type === "move") {
    const payload = action.payload as { tokenId?: unknown; to?: unknown; captures?: unknown };
    const tokenId = typeof payload.tokenId === "string" ? payload.tokenId : null;
    if (!tokenId) return null;
    const moverUserId = userIdForColor(next, colorOf(tokenId));
    const captures = Array.isArray(payload.captures) ? (payload.captures as string[]) : [];

    if (captures.length > 0) {
      // The victim's dismay beats the captor's gloating: being sent home is the
      // louder moment, and it keeps bots from only ever talking about winning.
      for (const captured of captures) {
        const victimUserId = userIdForColor(next, colorOf(captured));
        if (victimUserId && botUserIds.has(victimUserId)) {
          return { event: "botCaptured", speakerUserId: victimUserId };
        }
      }
      if (moverUserId && botUserIds.has(moverUserId)) {
        return { event: "botCaptures", speakerUserId: moverUserId };
      }
      return { event: "humansClash", speakerUserId: null };
    }

    if (payload.to === "finished" && moverUserId && botUserIds.has(moverUserId)) {
      return { event: "botFinishedToken", speakerUserId: moverUserId };
    }
    return null;
  }

  if (action.type === "roll") {
    const payload = action.payload as { dice?: unknown; busted?: unknown };
    if (payload.busted === true) {
      // Three sixes forfeit the turn, so `next` has already moved on — the
      // roller is only recoverable from the state we came from.
      const rollerId = prev?.currentTurnPlayerId;
      const rollerUserId = prev?.players.find((p) => p.id === rollerId)?.userId ?? null;
      if (rollerUserId && botUserIds.has(rollerUserId)) {
        return { event: "botBusted", speakerUserId: rollerUserId };
      }
      return null;
    }
    if (payload.dice === 6) {
      // A non-busted roll leaves the roller on turn, awaiting their move.
      const rollerUserId = next.players.find((p) => p.id === next.currentTurnPlayerId)?.userId ?? null;
      if (rollerUserId && botUserIds.has(rollerUserId)) {
        return { event: "botSix", speakerUserId: rollerUserId };
      }
    }
    return null;
  }

  return null;
}

/**
 * May this bot speak right now?
 *
 * The cap and the cooldown are checked before the dice: no personality, and no
 * run of luck, talks past them.
 */
export function shouldSpeak(
  personality: Personality,
  event: BotEvent,
  sentCount: number,
  lastAtMs: number | null,
  nowMs: number,
  rng: () => number,
): boolean {
  const { rate, cap } = DIAL[personality];
  if (sentCount >= cap) return false;
  if (lastAtMs !== null && nowMs - lastAtMs < CHAT_COOLDOWN_MS) return false;
  return rng() < rate * VOICES[event].weight;
}

/** One message for this moment: usually a reaction sprite, sometimes words. */
export function composeMessage(
  event: BotEvent,
  rng: () => number,
): { kind: "reaction" | "text"; value: string } {
  const voice = VOICES[event];
  // Leaning on sprites keeps the text from repeating itself: there are far
  // fewer chips than there are moments in a game.
  const wantsText = voice.text.length > 0 && rng() < 0.4;
  const pool = wantsText ? voice.text : voice.emoji;
  const value = pool[Math.floor(rng() * pool.length)] ?? voice.emoji[0]!;
  return { kind: wantsText ? "text" : "reaction", value };
}

/** Beat between the move landing and the reaction arriving. Instant is a tell;
 *  this is roughly how long it takes to notice something and tap. */
export const REACT_DELAY_MIN_MS = 600;
export const REACT_DELAY_MAX_MS = 1800;
