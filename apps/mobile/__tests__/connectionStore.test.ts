/**
 * Connection store: the app's sense of its own link.
 *
 * `waitForOnline` carries the most weight here — it is what turns the turn
 * retry ladder from "burn four attempts into a void on a fixed cadence" into
 * "fire the moment the radio comes back". Its budget behaviour is the part that
 * must not regress: a retry that waits forever is worse than one that gives up.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLOW_RTT_MS } from "../src/lib/netQuality";
import { useConnection } from "../src/store/connectionStore";

beforeEach(() => {
  vi.useFakeTimers();
  useConnection.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("link state", () => {
  it("assumes online until told otherwise", () => {
    expect(useConnection.getState().link).toBe("online");
  });

  it("goes offline when the radio does", () => {
    useConnection.getState().setReachable(false);
    expect(useConnection.getState().link).toBe("offline");
  });

  it("comes back online when the radio returns", () => {
    const c = useConnection.getState();
    c.setReachable(false);
    c.setReachable(true);
    expect(useConnection.getState().link).toBe("online");
  });

  it("reads a sustained slow link as slow", () => {
    const c = useConnection.getState();
    for (let i = 0; i < 3; i++) c.observeCall(SLOW_RTT_MS + 500);
    expect(useConnection.getState().link).toBe("slow");
  });

  it("does not let an unanswered call masquerade as a slow round trip", () => {
    // An unanswered call is not a measurement — there is no round trip to
    // record. Pushing the timeout in as an RTT would poison the median and
    // leave the app reading "slow" long after the link recovered.
    const c = useConnection.getState();
    for (let i = 0; i < 5; i++) c.observeCall(null);
    expect(useConnection.getState().rtt).toHaveLength(0);
    expect(useConnection.getState().link).toBe("online");
  });
});

describe("waitForOnline", () => {
  it("returns immediately when already online", async () => {
    await expect(useConnection.getState().waitForOnline(5000)).resolves.toBe(true);
  });

  it("resolves as soon as the radio returns, without waiting out the budget", async () => {
    useConnection.getState().setReachable(false);
    const waiting = useConnection.getState().waitForOnline(10_000);

    await vi.advanceTimersByTimeAsync(200);
    useConnection.getState().setReachable(true);

    await expect(waiting).resolves.toBe(true);
  });

  it("gives up when the budget expires", async () => {
    useConnection.getState().setReachable(false);
    const waiting = useConnection.getState().waitForOnline(1000);

    await vi.advanceTimersByTimeAsync(1001);

    await expect(waiting).resolves.toBe(false);
  });

  it("stops waiting for a link that never returns", async () => {
    // Two callers, one outage: neither may hang past its own budget.
    useConnection.getState().setReachable(false);
    const a = useConnection.getState().waitForOnline(500);
    const b = useConnection.getState().waitForOnline(1500);

    await vi.advanceTimersByTimeAsync(1501);

    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);
  });
});
