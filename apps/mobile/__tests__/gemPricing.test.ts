/**
 * What a gem row is allowed to print where a price goes.
 *
 * The rule these pin: the only currency figure shown to a player is the one
 * the store hands us for THEIR storefront. Apple prices each region itself, so
 * a config USD amount would misquote nearly everyone — and a quoted price that
 * isn't the charged one is an App Review rejection, not just a cosmetic bug.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gemPriceView } from "../src/lib/gemPricing";

const base = { purchasesEnabled: true, storeConfigured: true, pricesLoaded: true, dev: false };

describe("gemPriceView", () => {
  it("shows the store's localized string verbatim", () => {
    expect(gemPriceView({ ...base, storePrice: "₹89.00" })).toEqual({ label: "₹89.00", buyable: true });
    expect(gemPriceView({ ...base, storePrice: "£0.99" }).label).toBe("£0.99");
  });

  it("shows no currency at all while the store is still answering", () => {
    const v = gemPriceView({ ...base, pricesLoaded: false, storePrice: undefined });
    expect(v.label).toBe("…");
    expect(v.buyable).toBe(false); // no price in hand, no charge
  });

  it("admits the pack is unavailable once the fetch came back empty", () => {
    expect(gemPriceView({ ...base, storePrice: undefined })).toEqual({ label: "Unavailable", buyable: false });
  });

  it("stays 'Coming soon' while billing is flagged off", () => {
    expect(gemPriceView({ ...base, purchasesEnabled: false, storePrice: "$0.99" })).toEqual({
      label: "Coming soon",
      buyable: false,
    });
  });

  it("offers the server stub only in a dev build", () => {
    expect(gemPriceView({ ...base, storeConfigured: false, dev: true })).toEqual({
      label: "Test purchase",
      buyable: true,
    });
    // A shipped build with no SDK key has no price and nothing that can
    // succeed — it must not invite the tap, and must not invent a figure.
    expect(gemPriceView({ ...base, storeConfigured: false, dev: false })).toEqual({
      label: "Unavailable",
      buyable: false,
    });
  });

  it("never prints a currency symbol it made up", () => {
    const noPrice = [
      gemPriceView({ ...base, storePrice: undefined }),
      gemPriceView({ ...base, storePrice: undefined, pricesLoaded: false }),
      gemPriceView({ ...base, purchasesEnabled: false }),
      gemPriceView({ ...base, storeConfigured: false, dev: true }),
      gemPriceView({ ...base, storeConfigured: false, dev: false }),
    ];
    for (const v of noPrice) expect(v.label).not.toMatch(/[$£€₹¥]|\d/);
  });
});

/**
 * A guard, not a unit test. The USD fallback this replaced looked harmless in
 * review and in every simulator screenshot taken from a US account — it only
 * misquoted players once the build was in front of other storefronts. Nothing
 * that renders may reach for the config figure again.
 */
describe("no screen renders a config currency amount", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url));

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`],
    );
  }

  const files = walk(SRC).filter((f) => /\.tsx?$/.test(f));

  it("keeps priceUsd out of every component and screen", () => {
    const offenders = files
      .filter((f) => /\.tsx$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("priceUsd"))
      .map((f) => f.slice(SRC.length));
    expect(offenders).toEqual([]);
  });

  it("never reads the value anywhere — configStore only carries it", () => {
    // `.priceUsd` is the read; the field may be declared and defaulted in the
    // config store, but nothing may pull the number back out to show it.
    const readers = files
      .filter((f) => readFileSync(f, "utf8").includes(".priceUsd"))
      .map((f) => f.slice(SRC.length));
    expect(readers).toEqual([]);
  });
});
