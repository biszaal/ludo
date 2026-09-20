/**
 * A set sells a board and its matching dice together, and the two ways that
 * can be wrong both take the player's money.
 *
 * If a set's parts are not themselves in the catalog, the purchase grants two
 * skus the client has never heard of — and `isUnlocked` fails closed on those,
 * so the player owns nothing they can equip. If a set costs more than its parts
 * bought separately it is not a discount, it is a trap.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
  .join("\n");

/** Same literal shape the other catalog parity tests parse. */
const ROW = /\(\s*'([a-z]+)\.([a-z0-9-]+)'\s*,\s*'([a-z]+)'\s*,\s*(\d+)\s*,(?:\s*'(coins|gems)'\s*,)?\s*true\s*\)/g;

const rows = [...sql.matchAll(ROW)].map((m) => ({
  sku: `${m[1]}.${m[2]}`,
  kind: m[3]!,
  key: m[2]!,
  price: Number(m[4]),
  currency: m[5] ?? "coins",
}));
const priced = new Map(rows.map((r) => [r.sku, r]));
const sets = rows.filter((r) => r.kind === "set");

describe("set bundles", () => {
  it("seeds a set for every new material board", () => {
    expect(sets.length).toBe(9);
  });

  it("has a board and dice behind every set", () => {
    for (const s of sets) {
      expect(priced.get(`theme.${s.key}`), `theme.${s.key}`).toBeDefined();
      expect(priced.get(`dice.${s.key}`), `dice.${s.key}`).toBeDefined();
    }
  });

  it("charges the same wallet as its parts", () => {
    // A gem set granting coin-priced parts would be a currency arbitrage, and
    // the debit is taken in the SET's currency.
    for (const s of sets) {
      expect(priced.get(`theme.${s.key}`)!.currency, s.sku).toBe(s.currency);
      expect(priced.get(`dice.${s.key}`)!.currency, s.sku).toBe(s.currency);
    }
  });

  it("prices every set under its parts bought apart", () => {
    for (const s of sets) {
      const apart = priced.get(`theme.${s.key}`)!.price + priced.get(`dice.${s.key}`)!.price;
      expect(s.price, `${s.sku} vs ${apart} apart`).toBeLessThan(apart);
      // And not so far under that the parts stop being worth selling at all.
      expect(s.price, s.sku).toBeGreaterThan(apart * 0.6);
    }
  });
});
