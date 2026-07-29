/**
 * Guards the product's core monetization invariant:
 *
 *   Money and ads may buy ACCESS (match entry, attempts) and APPEARANCE
 *   (themes, avatars). They may NEVER buy OUTCOME — better moves, rerolls,
 *   undo, extra turn time, or weaker opponents.
 *
 * This is what keeps a coin-staked player-vs-player game defensible once coins
 * become real-money purchasable. These tests are deliberately structural: they
 * fail if someone later adds an advantage-shaped placement, which is exactly
 * the pressure a monetization roadmap tends to apply.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

vi.mock("../src/net/api", () => ({ getConfig: vi.fn() }));

import { DEFAULT_CONFIG } from "../src/store/configStore";

const SRC = join(__dirname, "..", "src");

function readAll(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...readAll(p));
    else if (/\.tsx?$/.test(entry.name)) out.push({ file: p, text: readFileSync(p, "utf8") });
  }
  return out;
}

describe("rewarded placements grant access or payout, never advantage", () => {
  it("exposes only the three approved placements", () => {
    // 'coins' and 'free-entry' buy entry; 'double-pot' is a house-funded bonus
    // paid AFTER the result is decided. None can change who wins.
    expect(Object.keys(DEFAULT_CONFIG.ads.rewarded).sort()).toEqual(
      ["coinGrant", "doublePot", "freeEntry", "hintLocalOnly"].sort(),
    );
  });

  it("has no advantage-shaped placement flags", () => {
    const banned = ["reroll", "undo", "extraTime", "extraTurn", "skipTurn", "boost", "shield", "revive"];
    const keys = Object.keys(DEFAULT_CONFIG.ads.rewarded).map((k) => k.toLowerCase());
    for (const bad of banned) {
      expect(keys.some((k) => k.includes(bad.toLowerCase()))).toBe(false);
    }
  });
});

describe("no purchasable gameplay mechanics exist in the source", () => {
  const files = readAll(SRC);

  it("never calls the reward API with an advantage placement", () => {
    // The server's REWARD_COINS map is the other half of this guard.
    const offenders = files.filter(({ text }) =>
      /watchForReward\(\s*["'](reroll|undo|extra-time|extra-turn|shield|revive|boost)["']/.test(text),
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });

  it("keeps the ad layer out of the game engine and rules", () => {
    // An engine that imports the ad layer is how "watch to re-roll" starts.
    const engineish = files.filter(({ file }) => /\/(store\/gameStore|lib\/moveTiming|lib\/seating)\.ts$/.test(file));
    expect(engineish.length).toBeGreaterThan(0);
    for (const { file, text } of engineish) {
      expect({ file, imports: /from ["']\.\.\/lib\/ads/.test(text) }).toEqual({ file, imports: false });
    }
  });
});

describe("cosmetics stay cosmetic", () => {
  it("board themes carry no gameplay-affecting fields", () => {
    // Themes are pure render config. A non-visual key here would mean a
    // purchasable SKU could change how the game behaves.
    const text = readFileSync(join(SRC, "render", "boardThemes.ts"), "utf8");
    const banned = /\b(speed|advantage|bonus|multiplier|extraRoll|luck|odds|weight)\b/i;
    expect(banned.test(text)).toBe(false);
  });
});
