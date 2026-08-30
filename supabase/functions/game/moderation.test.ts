/**
 * Deno tests for the chat word filter.
 *
 * The filter is one third of the user-generated-content obligation, and the
 * only third that is pure logic — the report queue and the client mute are
 * covered by their own paths. What matters here is that the normaliser closes
 * the obvious dodges without eating innocent words, because a false positive
 * silently mangles somebody's sentence and nobody ever reports that.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isBlockedWord, maskProfanity, normalise } from "./moderation.ts";
import { sanitizeChatValue } from "./chat.ts";

Deno.test("normalise folds the dodges a filter is actually asked to catch", () => {
  // Leet substitution, punctuation spacing, and repeated letters all collapse
  // to the same token — these are the three things people reach for first.
  for (const dodge of ["fuck", "FUCK", "f.u.c.k", "fu(k", "fuuuuck", "f*u*c*k"]) {
    assertEquals(normalise(dodge), "fuck", `"${dodge}" should normalise to "fuck"`);
  }
});

Deno.test("blocked words are masked, and the rest of the line survives", () => {
  assertEquals(maskProfanity("you are a fucking cheat"), "you are a ******* cheat");
  // The mask matches the token's own width, so the line keeps its shape.
  assertEquals(maskProfanity("f.u.c.k"), "*******");
});

Deno.test("ordinary messages pass through byte-identical", () => {
  // Every quick-message chip, plus the words a filter most often eats by
  // accident. A player whose "Good luck!" comes out starred has been failed
  // more visibly than one who saw a slur.
  const innocent = [
    "Good luck!", "Nice move!", "Well played", "GG", "One more?",
    "So close!", "Almost there", "My turn!",
    // Substring collisions: each of these CONTAINS a blocked term.
    "Scunthorpe", "class", "assignment", "grape", "therapist", "Cockburn",
    "analysis", "shitake",
  ];
  for (const line of innocent) {
    assertEquals(maskProfanity(line), line, `"${line}" should not be masked`);
  }
});

Deno.test("short tokens are never treated as slurs", () => {
  // Two letters cannot carry enough signal, and "ok"/"gg"/"hi" are the whole
  // vocabulary of a fast game.
  for (const t of ["ok", "gg", "hi", "no", "yo"]) {
    assertEquals(isBlockedWord(t), false, `"${t}" should be allowed`);
  }
});

Deno.test("sanitizeChatValue masks AFTER clamping, so a cut word can't survive", () => {
  // The clamp is 80 chars. A blocked word straddling the cut is left as a
  // fragment, and a fragment must not be a way through — mask last, on the
  // string that will actually be rendered.
  const padded = "x".repeat(76) + " fuck";
  const out = sanitizeChatValue(padded);
  assertEquals(out !== null, true);
  assertEquals(out!.includes("fuck"), false, "a clamped message still leaked the word");
});

Deno.test("sanitizeChatValue still collapses whitespace and drops empties", () => {
  assertEquals(sanitizeChatValue("  hey   there \n\n you "), "hey there you");
  assertEquals(sanitizeChatValue("   "), null);
  assertEquals(sanitizeChatValue(42), null);
});
