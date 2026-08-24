/**
 * Every call to the game function announces which build made it.
 *
 * The app has no OTA channel: `expo-updates` is not a dependency, so every
 * client in the wild is a store binary that can only be replaced by the user
 * updating. That makes any change to the realtime write protocol unshippable
 * until the server can tell an old client from a new one — fold a write away
 * and a 1.0.1 opponent silently loses the die it was going to animate.
 *
 * This is the handshake that unblocks it. Nothing consumes the version yet;
 * it has to reach the store BEFORE the feature that depends on it, which is
 * why it ships on its own.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Bodies passed to `functions.invoke`, in order. */
const bodies: Record<string, unknown>[] = [];

vi.mock("../src/lib/supabase", () => ({
  getSupabase: () => ({
    functions: {
      invoke(_name: string, opts: { body: Record<string, unknown> }) {
        bodies.push(opts.body);
        return Promise.resolve({ data: {}, error: null });
      },
    },
  }),
}));
vi.mock("../src/lib/identityClient", () => ({
  getIdentity: () => ({ ensureSignedIn: vi.fn().mockResolvedValue("me") }),
}));

import * as api from "../src/net/api";
import { APP_VERSION } from "../src/lib/appVersion";

beforeEach(() => {
  bodies.length = 0;
});

describe("APP_VERSION", () => {
  it("is the version the store build was published under", () => {
    // app.json is the single source of truth for what a binary calls itself.
    const fromConfig = require("../app.json").expo.version;
    expect(APP_VERSION).toBe(fromConfig);
  });

  it("is a dotted version string, never empty", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+/);
  });
});

describe("callGame", () => {
  it("carries the app version on an op that takes no payload", async () => {
    await api.getWallet();

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.appVersion).toBe(APP_VERSION);
  });

  it("carries the app version alongside an op's own payload", async () => {
    await api.createGame(50);

    expect(bodies[0]?.op).toBe("create");
    expect(bodies[0]?.stake).toBe(50);
    expect(bodies[0]?.appVersion).toBe(APP_VERSION);
  });

  it("does not let a payload field overwrite the version", async () => {
    // A caller passing its own appVersion must not be able to misreport the
    // build — the server's fold gate would then trust a lie.
    await api.adRewardStatus("nonce-1");

    expect(bodies[0]?.appVersion).toBe(APP_VERSION);
  });
});
