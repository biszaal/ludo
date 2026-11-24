/**
 * The spin store: one claim in flight, retries that cannot pay twice, and the
 * server's refusals handled as state, not as errors.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/net/api", () => ({
  getSpinState: vi.fn(),
  claimSpin: vi.fn(),
}));

import * as api from "../src/net/api";
import { useSpin } from "../src/store/spinStore";
import { useWallet } from "../src/store/walletStore";
import type { SpinState } from "../src/lib/spin";

const getSpinState = vi.mocked(api.getSpinState);
const claimSpin = vi.mocked(api.claimSpin);

const READY: SpinState = {
  enabled: true,
  owed: { first: "locked", daily: true, match: 0 },
  matchMax: 3,
  tier: "bronze",
  next: { source: "daily", wheel: "bronze", segments: [{ coins: 25, w: 1000 }] },
  resetsAt: "2026-11-23T00:00:00Z",
};
const AFTER: SpinState = { ...READY, owed: { first: "locked", daily: false, match: 0 }, next: null };
const PAID = { ok: true as const, wheel: "bronze", segments: [{ coins: 25, w: 1000 }], segment: 0, prize: { coins: 25 }, balance: 525, gems: 7, status: AFTER };

beforeEach(() => {
  vi.resetAllMocks();
  useSpin.setState({ state: null, claiming: false, pending: {} });
});

describe("spin store", () => {
  it("hides the tile when the state can't be read", async () => {
    useSpin.setState({ state: READY });
    getSpinState.mockRejectedValue(new Error("offline"));
    await useSpin.getState().refresh();
    expect(useSpin.getState().state).toBeNull();
  });

  it("stores the state it reads", async () => {
    getSpinState.mockResolvedValue(READY);
    await useSpin.getState().refresh();
    expect(useSpin.getState().state).toEqual(READY);
  });

  it("sends one claim for a double tap", async () => {
    let resolve: (v: typeof PAID) => void = () => {};
    claimSpin.mockReturnValue(new Promise((r) => (resolve = r)));
    const first = useSpin.getState().claim("daily");
    const second = await useSpin.getState().claim("daily");
    expect(second).toBeNull();
    resolve(PAID);
    await first;
    expect(claimSpin).toHaveBeenCalledTimes(1);
  });

  it("retries a failed claim with the same request id", async () => {
    claimSpin.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(PAID);
    await expect(useSpin.getState().claim("daily")).rejects.toThrow("timeout");
    await useSpin.getState().claim("daily");
    expect(claimSpin.mock.calls[0][1]).toBe(claimSpin.mock.calls[1][1]);
    expect(claimSpin.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses a new request id once the server has answered", async () => {
    claimSpin.mockResolvedValue(PAID);
    await useSpin.getState().claim("match");
    await useSpin.getState().claim("match");
    expect(claimSpin.mock.calls[0][1]).not.toBe(claimSpin.mock.calls[1][1]);
  });

  it("refreshes instead of failing when the spin is no longer owed", async () => {
    claimSpin.mockResolvedValue({ ok: false, reason: "not_owed" });
    getSpinState.mockResolvedValue(AFTER);
    expect(await useSpin.getState().claim("daily")).toEqual({ ok: false, reason: "not_owed" });
    expect(getSpinState).toHaveBeenCalledTimes(1);
    expect(useSpin.getState().state).toEqual(AFTER);
  });

  it("switches the feature off when the server says it is off", async () => {
    useSpin.setState({ state: READY });
    claimSpin.mockResolvedValue({ ok: false, reason: "disabled" });
    await useSpin.getState().claim("daily");
    expect(useSpin.getState().state).toEqual({ enabled: false });
  });

  it("updates the state and the wallet after a paid spin", async () => {
    claimSpin.mockResolvedValue(PAID);
    expect(await useSpin.getState().claim("daily")).toEqual(PAID);
    expect(useSpin.getState().state).toEqual(AFTER);
    expect(useWallet.getState().balance).toBe(525);
    expect(useWallet.getState().gems).toBe(7);
    expect(useSpin.getState().claiming).toBe(false);
  });
});

describe("spin store across refreshes and accounts", () => {
  it("shares one read between overlapping refreshes", async () => {
    let resolve: (v: SpinState) => void = () => {};
    getSpinState.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = useSpin.getState().refresh();
    const b = useSpin.getState().refresh();
    resolve(READY);
    await Promise.all([a, b]);
    expect(getSpinState).toHaveBeenCalledTimes(1);
    expect(useSpin.getState().state).toEqual(READY);
  });

  it("reset forgets the state and any request id waiting to be retried", async () => {
    claimSpin.mockRejectedValueOnce(new Error("timeout"));
    await expect(useSpin.getState().claim("daily")).rejects.toThrow();
    useSpin.setState({ state: READY });
    useSpin.getState().reset();
    expect(useSpin.getState().state).toBeNull();
    expect(useSpin.getState().pending).toEqual({});
  });

  it("ignores a claim that lands after the account changed", async () => {
    useWallet.setState({ balance: 100, gems: 1 });
    let resolve: (v: typeof PAID) => void = () => {};
    claimSpin.mockReturnValue(new Promise((r) => (resolve = r)));
    const pending = useSpin.getState().claim("daily");
    useSpin.getState().reset();
    resolve(PAID);
    await pending;
    expect(useSpin.getState().state).toBeNull();
    expect(useWallet.getState().balance).toBe(100);
    expect(useSpin.getState().claiming).toBe(false);
  });
});

describe("spin store against stale answers", () => {
  it("a read that started before a paid spin can't bring the spent spin back", async () => {
    let resolve: (v: SpinState) => void = () => {};
    getSpinState.mockReturnValue(new Promise((r) => (resolve = r)));
    const read = useSpin.getState().refresh();
    claimSpin.mockResolvedValue(PAID);
    await useSpin.getState().claim("daily");
    resolve(READY);
    await read;
    expect(useSpin.getState().state).toEqual(AFTER);
  });

  it("a retry id does not outlive the day it was made for", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-22T23:00:00Z"));
      useSpin.setState({ state: READY }); // resets 2026-11-23T00:00:00Z
      claimSpin.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(PAID);
      await expect(useSpin.getState().claim("daily")).rejects.toThrow();
      vi.setSystemTime(new Date("2026-11-23T00:30:00Z"));
      await useSpin.getState().claim("daily");
      expect(claimSpin.mock.calls[0][1]).not.toBe(claimSpin.mock.calls[1][1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
