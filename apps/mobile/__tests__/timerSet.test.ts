/**
 * The teardown guarantee.
 *
 * This class exists for one property: after `clearAll`, nothing fires. On the
 * online screen a timer that survives a leave runs against a game that is gone
 * — a write with a stale game id, or a board reload with nothing behind it —
 * and the old shape of that code protected the property by asking eleven
 * separate clear-functions to be remembered.
 *
 * So the tests below are mostly about what does NOT happen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerSet } from "../src/lib/timerSet";

type Name = "a" | "b" | "c";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("TimerSet", () => {
  it("runs a one-shot once, at its due time", () => {
    const timers = new TimerSet<Name>();
    const fn = vi.fn();
    timers.set("a", fn, 100);

    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clearAll silences every armed timer, whatever they are", () => {
    // The property the class exists for.
    const timers = new TimerSet<Name>();
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    timers.set("a", a, 50);
    timers.set("b", b, 5000);
    timers.setInterval("c", c, 10);

    timers.clearAll();
    vi.advanceTimersByTime(100_000);

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
    expect(timers.armed()).toEqual([]);
  });

  it("clears an interval as an interval", () => {
    // clearTimeout and clearInterval are interchangeable in a browser and not
    // guaranteed to be everywhere. A repeating timer that survived teardown
    // would be the worst kind: it fires forever.
    const timers = new TimerSet<Name>();
    const fn = vi.fn();
    timers.setInterval("a", fn, 10);
    vi.advanceTimersByTime(35);
    expect(fn).toHaveBeenCalledTimes(3);

    timers.clearAll();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("replaces a one-shot under the same name rather than stacking", () => {
    const timers = new TimerSet<Name>();
    const first = vi.fn();
    const second = vi.fn();
    timers.set("a", first, 100);
    timers.set("a", second, 100);

    vi.advanceTimersByTime(200);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("leaves a running interval alone rather than resetting its cadence", () => {
    // "Make sure this is running" is what the keep-warm caller means. Restarting
    // on every ask would push the next tick out indefinitely.
    const timers = new TimerSet<Name>();
    const fn = vi.fn();
    timers.setInterval("a", fn, 100);
    vi.advanceTimersByTime(90);
    timers.setInterval("a", fn, 100);
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("lets a callback re-arm its own timer", () => {
    // The autopilot and the resync both do this. The handle has to be dropped
    // before the callback runs, or the re-armed timer is overwritten by the
    // set's own bookkeeping and becomes untrackable — live, but invisible to
    // clearAll, which is precisely the leak this class prevents.
    const timers = new TimerSet<Name>();
    let runs = 0;
    const step = () => {
      runs++;
      if (runs < 3) timers.set("a", step, 10);
    };
    timers.set("a", step, 10);

    vi.advanceTimersByTime(30);
    expect(runs).toBe(3);
    expect(timers.armed()).toEqual([]);
  });

  it("still tracks a re-armed timer well enough to cancel it", () => {
    // The failure the comment above describes, stated as a test: re-arm from
    // inside the callback, then tear down, and nothing may fire afterwards.
    const timers = new TimerSet<Name>();
    const fn = vi.fn();
    const step = () => {
      fn();
      timers.set("a", step, 10);
    };
    timers.set("a", step, 10);

    vi.advanceTimersByTime(25);
    expect(fn).toHaveBeenCalledTimes(2);

    timers.clearAll();
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("reports what is armed, so callers can debounce on it", () => {
    const timers = new TimerSet<Name>();
    expect(timers.has("a")).toBe(false);
    timers.set("a", () => {}, 100);
    expect(timers.has("a")).toBe(true);

    // A fired one-shot is no longer armed — the lobby debounce and the resync
    // coalescer both read this to decide whether to schedule again.
    vi.advanceTimersByTime(100);
    expect(timers.has("a")).toBe(false);
  });

  it("clear on an unarmed name is a no-op", () => {
    const timers = new TimerSet<Name>();
    expect(() => timers.clear("a")).not.toThrow();
    expect(() => timers.clearAll()).not.toThrow();
  });
});
