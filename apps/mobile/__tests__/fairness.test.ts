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
  it("exposes only the approved placements", () => {
    // 'coins' and 'free-entry' buy entry; 'double-pot' is a house-funded bonus
    // paid AFTER the result is decided; 'gemGrant' pays the premium currency,
    // which only ever buys cosmetics. None can change who wins.
    expect(Object.keys(DEFAULT_CONFIG.ads.rewarded).sort()).toEqual(
      ["coinGrant", "doublePot", "freeEntry", "gemGrant", "hintLocalOnly"].sort(),
    );
  });

  it("keeps the gem drip bounded", () => {
    // HISTORY: this rule used to be "a day's drip stays under a quarter of the
    // cheapest pack", which held while the drip was 1 gem/day. It was retired
    // deliberately in 0048, not quietly relaxed to make a change pass: the ad
    // path is now the PRIMARY way a free player gets gems (25/day, ~750/mo,
    // against a 750-gem $9.99 pack), and packs are positioned as a shortcut for
    // players who don't want to watch video. The pack sizes in `products` are
    // known to be mispriced against that and want revisiting.
    //
    // What still has to hold is that the drip is bounded and paced. An
    // unbounded or per-view-huge grant would make gems free rather than cheap,
    // and a currency nobody can run out of is one nobody values.
    const { adGrant, products } = DEFAULT_CONFIG.gems;
    const smallestPack = Math.min(...products.map((p) => p.gems));

    // One view is never a pack — the ad is a drip, however fast it drips.
    expect(adGrant.amount).toBeLessThan(smallestPack);
    // The day's allowance is finite and small enough to stay a session ritual
    // rather than a grind anyone could farm indefinitely.
    expect(adGrant.dailyCap).toBeGreaterThan(0);
    expect(adGrant.dailyCap).toBeLessThanOrEqual(10);
    // Whole positive numbers: the server floors these, and a fractional or
    // negative config value would silently mint or zero out grants.
    expect(Number.isInteger(adGrant.amount)).toBe(true);
    expect(Number.isInteger(adGrant.dailyCap)).toBe(true);
    expect(adGrant.amount).toBeGreaterThan(0);
  });

  it("a month of watching cannot out-earn the largest pack", () => {
    // The fuse. Ads are the revenue engine for a young game, so the drip has to
    // stay generous enough to be worth watching — but a free month must not
    // deliver more than the biggest thing on sale, or the pack is a joke and
    // the currency is worth nothing.
    //
    // The failure this pins is not hypothetical: 0048 set 5 x 5/day = 750/month
    // against a 750-gem top pack, which is exactly the boundary this forbids.
    //
    // Note the two dials are independent. dailyCap sets how many ads get
    // WATCHED (the revenue); amount sets how fast the catalog drains (the
    // fuse). This constrains the second without touching the first.
    const { adGrant, products } = DEFAULT_CONFIG.gems;
    const largestPack = Math.max(...products.map((p) => p.gems));
    const monthlyFree = adGrant.amount * adGrant.dailyCap * 30;

    expect(monthlyFree).toBeLessThan(largestPack);
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
