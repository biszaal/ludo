/**
 * The canned chat lines: what goes on the wire, and what a reader sees.
 *
 * THESE ARE NOT THE SAME THING, and that is the whole point of this file.
 *
 * A tapped phrase is sent as its ENGLISH text, because that text is a
 * cross-player protocol in two directions at once:
 *
 *   - It reaches other players, who may be reading in another language. If a
 *     Hindi player's tap arrived at a Spanish player's screen as Hindi, the
 *     canned lines would be less useful than silence — the entire reason they
 *     exist is that they need no shared language.
 *   - It is mirrored server-side in botChat.ts, where a hidden bot only ever
 *     says something a human could have tapped. Translate the wire and a bot
 *     talking English at a Hindi table becomes a way to spot it, which is
 *     exactly the tell the hidden-bot design spends so much effort avoiding.
 *
 * So the wire stays English and fixed, and every client renders it in its own
 * language on the way in. A phrase that is not in the table — free text
 * somebody typed — passes through untouched, which is the correct answer for
 * it as well: we cannot translate that and must not try.
 */

import { t, type StringKey } from "../i18n";

/**
 * Tap-to-send lines, one per moment a game actually produces (opening, a
 * capture either way, a near miss, the finish).
 *
 * The KEY of each entry is the wire format. Mirrored in
 * supabase/functions/game/botChat.ts — keep the two lists in step.
 */
const PHRASE_KEYS: Record<string, StringKey> = {
  "Good luck!": "chat.q.goodLuck",
  "Nice move!": "chat.q.niceMove",
  "Well played": "chat.q.wellPlayed",
  "Hurry up!": "chat.q.hurryUp",
  "Ouch!": "chat.q.ouch",
  Nooo: "chat.q.nooo",
  "So close!": "chat.q.soClose",
  "Wow!": "chat.q.wow",
  "Lucky!": "chat.q.lucky",
  "Almost there": "chat.q.almostThere",
  "My turn!": "chat.q.myTurn",
  "Sorry!": "chat.q.sorry",
  "One more?": "chat.q.oneMore",
};

/**
 * The wire values, in tap order.
 *
 * "GG" is in the list a player taps but NOT in the table above: it is already
 * the same in every language this app ships, being an abbreviation gamers use
 * untranslated everywhere. Giving it a catalog entry would invite somebody to
 * "translate" it into something no player says.
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

/**
 * How a chat line should READ here — translated when it is one of ours, and
 * returned exactly as it came when it is not.
 *
 * Free text is the common case for the second branch and must pass through
 * untouched. So is a canned line from an app version whose list has since
 * changed, which is the reason this is a lookup rather than an index.
 */
export function displayPhrase(text: string): string {
  const key = PHRASE_KEYS[text];
  return key ? t(key) : text;
}
