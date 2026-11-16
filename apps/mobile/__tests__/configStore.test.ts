/**
 * Remote config: partial server documents must merge over the baked defaults
 * without blanking siblings, and a failed fetch must never leave the app
 * without a usable config.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../src/net/api", () => ({
  getConfig: vi.fn(),
}));

import * as api from "../src/net/api";
import { APP_VERSION } from "../src/lib/appVersion";
import { useConfig, mergeConfig, DEFAULT_CONFIG } from "../src/store/configStore";

afterEach(() => {
  useConfig.setState({
    config: DEFAULT_CONFIG,
    region: null,
    refreshing: false,
    updateRequired: false,
    updateSuggested: false,
    dismissedRecommendation: null,
  });
  vi.clearAllMocks();
});

describe("mergeConfig", () => {
  it("overrides one nested flag without disturbing its siblings", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { ads: { interstitial: { maxPerSession: 8 } } });
    expect(merged.ads.interstitial.maxPerSession).toBe(8);
    expect(merged.ads.interstitial.minSecondsBetween).toBe(DEFAULT_CONFIG.ads.interstitial.minSecondsBetween);
    expect(merged.ads.banner.home).toBe(true);
    expect(merged.economy.quickStake).toBe(100);
  });

  it("ignores unknown keys", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { ads: { somethingNew: true }, bogus: 1 });
    expect(merged).toEqual(DEFAULT_CONFIG);
  });

  it("ignores values of the wrong type rather than corrupting a call site", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { economy: { quickStake: "lots" } });
    expect(merged.economy.quickStake).toBe(100);
  });

  it("returns the base untouched for a null or non-object document", () => {
    expect(mergeConfig(DEFAULT_CONFIG, null)).toEqual(DEFAULT_CONFIG);
    expect(mergeConfig(DEFAULT_CONFIG, [1, 2])).toEqual(DEFAULT_CONFIG);
  });

  it("carries the gems block and stake tiers through a merge (known keys, not dropped)", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      gems: { purchasesEnabled: true, exchangeRate: 12, products: [{ id: "gems.tiny", gems: 5, priceUsd: 0.49 }] },
      economy: { stakeTiers: [50, 500] },
    });
    expect(merged.gems.purchasesEnabled).toBe(true);
    expect(merged.gems.exchangeRate).toBe(12);
    expect(merged.gems.products).toEqual([{ id: "gems.tiny", gems: 5, priceUsd: 0.49 }]);
    expect(merged.gems.enabled).toBe(true); // sibling untouched
    expect(merged.economy.stakeTiers).toEqual([50, 500]);
    expect(merged.economy.quickStake).toBe(100); // sibling untouched
  });

  it("never carries the stub-provider lock in client config", () => {
    // purchasesEnabled is now TRUE (0027): the real store path is live, and it
    // runs client -> RevenueCat -> rc-webhook -> gem_apply without ever
    // touching opGemsBuy. The thing that must never ship live is the STUB,
    // whose lock is gems.allowStubProvider — server-only, seeded false, and
    // deliberately absent from this document. A client that cannot even name
    // the flag cannot flip it.
    expect(DEFAULT_CONFIG.gems.purchasesEnabled).toBe(true);
    expect("allowStubProvider" in DEFAULT_CONFIG.gems).toBe(false);
  });

  it("ignores an allowStubProvider a tampered server row tries to inject", () => {
    // mergeConfig drops unknown keys, so even a malicious config row cannot
    // introduce the stub lock into the client's world.
    const merged = mergeConfig(DEFAULT_CONFIG, { gems: { allowStubProvider: true } });
    expect("allowStubProvider" in merged.gems).toBe(false);
  });
});

describe("config refresh", () => {
  it("applies a server document and records the resolved region", async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      config: { ads: { enabled: false } },
      region: "NP",
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().config.ads.enabled).toBe(false);
    expect(useConfig.getState().config.economy.quickStake).toBe(100);
    expect(useConfig.getState().region).toBe("NP");
  });

  it("keeps the last known config when the network fails", async () => {
    vi.mocked(api.getConfig).mockRejectedValue(new Error("offline"));
    await useConfig.getState().refresh();
    expect(useConfig.getState().config).toEqual(DEFAULT_CONFIG);
    expect(useConfig.getState().refreshing).toBe(false);
  });
});

describe("update floor", () => {
  it("ships with no floor, so nothing is blocked until the owner sets one", () => {
    expect(DEFAULT_CONFIG.update).toEqual({ minVersion: "", recommendedVersion: "" });
    expect(useConfig.getState().updateRequired).toBe(false);
    expect(useConfig.getState().updateSuggested).toBe(false);
  });

  it("blocks only after a successful read puts this build strictly below the floor", async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      config: { update: { minVersion: "99.0.0" } },
      region: "NP",
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(true);
    expect(useConfig.getState().updateSuggested).toBe(false);

    // The same build, at the floor, is still allowed. Equal is not below.
    vi.mocked(api.getConfig).mockResolvedValue({
      config: { update: { minVersion: APP_VERSION } },
      region: "NP",
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(false);
  });

  it("does not block when the floor is older than this build", async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      config: { update: { minVersion: "0.0.1" } },
      region: null,
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(false);
  });

  it("does not block when the floor is missing, the wrong type, or not a version", async () => {
    vi.mocked(api.getConfig).mockResolvedValue({ config: {}, region: null });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(false);

    vi.mocked(api.getConfig).mockResolvedValue({
      config: { update: { minVersion: 2 } },
      region: null,
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().config.update.minVersion).toBe("");
    expect(useConfig.getState().updateRequired).toBe(false);

    vi.mocked(api.getConfig).mockResolvedValue({
      config: { update: { minVersion: "latest" } },
      region: null,
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(false);
  });

  it("does not block when the config fetch fails, even if a cached floor would", async () => {
    useConfig.setState({
      config: mergeConfig(DEFAULT_CONFIG, { update: { minVersion: "99.0.0" } }),
    });
    vi.mocked(api.getConfig).mockRejectedValue(new Error("offline"));
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(false);
    expect(useConfig.getState().updateSuggested).toBe(false);
    // Pacing config is allowed to stay on the last document. The gate is not.
    expect(useConfig.getState().config.update.minVersion).toBe("99.0.0");
  });

  it("keeps a gate that a successful read already raised when a later read fails", async () => {
    vi.mocked(api.getConfig).mockResolvedValueOnce({
      config: { update: { minVersion: "99.0.0" } },
      region: null,
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(true);

    vi.mocked(api.getConfig).mockRejectedValueOnce(new Error("offline"));
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(true);
  });

  it("nudges below the recommended version without blocking, and remembers a dismiss", async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      config: { update: { recommendedVersion: "99.0.0" } },
      region: null,
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(false);
    expect(useConfig.getState().updateSuggested).toBe(true);

    useConfig.getState().dismissUpdateSuggestion();
    expect(useConfig.getState().updateSuggested).toBe(false);

    await useConfig.getState().refresh();
    expect(useConfig.getState().updateSuggested).toBe(false);

    vi.mocked(api.getConfig).mockResolvedValue({
      config: { update: { recommendedVersion: "99.1.0" } },
      region: null,
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateSuggested).toBe(true);
  });

  it("lets a later successful read lower the floor", async () => {
    vi.mocked(api.getConfig).mockResolvedValueOnce({
      config: { update: { minVersion: "99.0.0" } },
      region: null,
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(true);

    vi.mocked(api.getConfig).mockResolvedValueOnce({
      config: { update: { minVersion: "" } },
      region: null,
    });
    await useConfig.getState().refresh();
    expect(useConfig.getState().updateRequired).toBe(false);
  });
});
