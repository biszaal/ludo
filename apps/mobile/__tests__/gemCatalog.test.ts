/**
 * Gem-tier seed parity: every gem-priced SKU in 0018_gems.sql exists in the
 * client registries (so the shop can render it) and every registry item
 * marked gems appears in the migration (so the client can't show an
 * unpurchasable phantom). Prices are display-only client-side — the catalog
 * table is the authority — but they must not drift.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATARS } from "../src/render/avatars";
import { BOARD_THEMES } from "../src/render/boardThemes";
import { DICE_SKINS } from "../src/render/diceSkins";

const sql = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/0018_gems.sql", import.meta.url)),
  "utf8",
);

/** All gem-priced catalog rows in 0018: kind.sku -> price. */
function gemSeeds(): Map<string, { kind: string; price: number }> {
  const out = new Map<string, { kind: string; price: number }>();
  const re = /\(\s*'([a-z]+)\.([a-z0-9-]+)'\s*,\s*'([a-z]+)'\s*,\s*(\d+)\s*,\s*'gems'\s*,\s*true\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.set(`${m[1]}.${m[2]}`, { kind: m[3]!, price: Number(m[4]) });
  return out;
}

describe("gem catalog seed parity (0018_gems.sql)", () => {
  const seeds = gemSeeds();

  it("seeds at least the showcase set", () => {
    expect(seeds.size).toBeGreaterThanOrEqual(4);
  });

  it("every seeded gem SKU resolves to a client registry item", () => {
    for (const [sku, { kind }] of seeds) {
      const id = sku.split(".")[1]!;
      if (kind === "dice") {
        expect(Object.values(DICE_SKINS).some((s) => s.id === id), sku).toBe(true);
      } else if (kind === "theme") {
        expect(Object.keys(BOARD_THEMES)).toContain(id);
      } else if (kind === "avatar") {
        expect(AVATARS.some((a) => a.id === id), sku).toBe(true);
      } else {
        throw new Error(`unexpected gem kind: ${kind}`);
      }
    }
  });

  it("every registry item marked gems is seeded with a matching price", () => {
    for (const skin of Object.values(DICE_SKINS)) {
      if (skin.currency !== "gems") continue;
      expect(seeds.get(`dice.${skin.id}`)?.price, skin.id).toBe(skin.price);
    }
  });

  it("keeps the config seed's stub-purchase locks off", () => {
    // The stub provider must never ship enabled: purchasesEnabled false AND
    // allowStubProvider false in the seeded default config.
    expect(sql).toMatch(/'purchasesEnabled',\s*false/);
    expect(sql).toMatch(/'allowStubProvider',\s*false/);
  });
});
