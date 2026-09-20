/**
 * Deno tests for set bundles.
 *
 * A set is the only sku in the catalog that is not a thing you equip. It exists
 * so a board and its matching dice can be bought together for less than the two
 * apart, which means the purchase has to leave behind the two PARTS — not the
 * set — or the client would have to learn what a set is in order to know what
 * the player owns. It already decides that by looking for `theme.x` and
 * `dice.x`, and it keeps doing exactly that.
 *
 * Catalog parity (every set has a board and dice behind it, priced under the
 * two apart) is checked in apps/mobile/__tests__/setBundles.test.ts, which
 * already has the migration parsing and the filesystem access for it.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { setParts } from "./economy.ts";

Deno.test("a set names its own parts", () => {
  assertEquals(setParts("set.amber"), ["theme.amber", "dice.amber"]);
  // Keys carry hyphens, and slicing the prefix must not disturb them.
  assertEquals(setParts("set.obsidian-king"), ["theme.obsidian-king", "dice.obsidian-king"]);
});
