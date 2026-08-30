/**
 * Word filtering for the one place players type free text at each other.
 *
 * Scope, honestly stated: this is a word filter, not a moderation system. It
 * catches the lazy case — someone typing a slur into a 80-character box during
 * a game — and it will not catch a determined author, because no list can.
 * The other two halves of the job live elsewhere and matter more: a report path
 * that a human reads (`player_reports`, 0056) and a block that takes effect
 * immediately for the person who pressed it (opReportPlayer + the client's mute
 * filter). Store policy asks for all three, and so does anyone playing.
 *
 * Masking, not rejecting. A refusal tells the sender exactly which word tripped
 * the filter, which is a free oracle for probing it, and it punishes the
 * innocent collision ("Scunthorpe") with a message that never sends. Masking
 * degrades: the sentence still arrives, the word does not.
 */

/**
 * Terms we mask. Deliberately short and general — slurs plus the strongest
 * profanity, not a list that tries to police tone.
 *
 * Entries are matched against the NORMALISED form of a token (see `normalise`),
 * so they must be written lowercase and letters-only.
 */
const BLOCKED = new Set([
  "fuck", "fucker", "fucking", "motherfucker", "shit", "bullshit", "bitch",
  "cunt", "whore", "slut", "wanker", "bastard", "asshole", "arsehole",
  "dickhead", "prick", "twat", "pussy",
  // Slurs. The reason this list exists at all.
  "nigger", "nigga", "faggot", "fag", "retard", "retarded", "tranny",
  "chink", "spic", "kike", "paki", "wetback", "coon",
  "rape", "rapist",
]);

/** Common character substitutions, so `sh1t` and `fu(k` normalise like the word. */
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t",
  "8": "b", "9": "g", "@": "a", "$": "s", "!": "i", "|": "i", "(": "c", "*": "",
};

/**
 * Reduce one token to the form the list is written in.
 *
 * Three steps, each closing an obvious dodge: substitute leet characters, drop
 * everything that is not a letter (so `f.u.c.k` and `f u c k`'s glued form
 * collapse), then squeeze runs of the same letter to one (`fuuuuck`).
 *
 * The squeeze is why the list holds no doubled letters. It also means a word
 * that legitimately doubles a letter must be written singly here.
 */
export function normalise(token: string): string {
  const substituted = [...token.toLowerCase()].map((c) => LEET[c] ?? c).join("");
  const letters = substituted.replace(/[^a-z]/g, "");
  return letters.replace(/(.)\1+/g, "$1");
}

/** Is this one token a blocked term? Exported for the test, and for the client
 *  if it ever wants to grey the send button rather than mask after the fact. */
export function isBlockedWord(token: string): boolean {
  const n = normalise(token);
  if (n.length < 3) return false; // too short to be anything but a false positive
  return BLOCKED.has(n);
}

/**
 * Mask blocked terms in a message, preserving everything else exactly.
 *
 * Tokenised on runs of non-space so punctuation travels with its word — that is
 * what lets `f.u.c.k` and `fuck!` both normalise to the same thing. The mask is
 * as long as the token it replaced, so the line does not visibly change shape.
 */
export function maskProfanity(text: string): string {
  return text.replace(/\S+/g, (token) => (isBlockedWord(token) ? "*".repeat(token.length) : token));
}
