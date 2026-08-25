/**
 * The app's sense of its own link.
 *
 * Deliberately free of native imports so the Node suite can drive it directly;
 * `lib/connection.ts` is the thin piece that subscribes this to expo-network
 * and installs it into the network layer, the same way initSound/initPresence
 * wire their stores up at launch.
 *
 * Not persisted. A link is a fact about right now, and a stale one restored
 * from disk at launch would be worse than no opinion at all.
 */

import { create } from "zustand";
import { classify, pushRtt, type Link } from "../lib/netQuality";

interface ConnectionState {
  link: Link;
  /** Null until the platform tells us; see classify() on why that is not "offline". */
  reachable: boolean | null;
  /** Recent round trips, most recent last. Exposed for tests and diagnostics. */
  rtt: number[];
  /** Record a completed call. `null` means it was never answered. */
  observeCall: (rttMs: number | null) => void;
  setReachable: (reachable: boolean | null) => void;
  /** Resolve true as soon as the link is usable, or false when `budgetMs` runs
   *  out. Resolves immediately when the link is already up. */
  waitForOnline: (budgetMs: number) => Promise<boolean>;
  reset: () => void;
}

/** Everyone still waiting on the link to come back. */
let waiters: Array<(ok: boolean) => void> = [];

function releaseWaiters(ok: boolean): void {
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve(ok);
}

export const useConnection = create<ConnectionState>((set, get) => ({
  link: "online",
  reachable: null,
  rtt: [],

  observeCall: (rttMs) => {
    // An unanswered call is not a measurement. Recording the timeout as a round
    // trip would poison the median and leave the app reading "slow" long after
    // the link recovered — reachability is what reports an outage, not this.
    if (rttMs === null) return;
    const rtt = pushRtt(get().rtt, rttMs);
    set({ rtt, link: classify(get().reachable, rtt) });
  },

  setReachable: (reachable) => {
    const link = classify(reachable, get().rtt);
    set({ reachable, link });
    if (link !== "offline") releaseWaiters(true);
  },

  waitForOnline: (budgetMs) =>
    new Promise<boolean>((resolve) => {
      if (get().link !== "offline") {
        resolve(true);
        return;
      }
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      // Each waiter owns its own budget: one caller giving up must never cut
      // another's wait short, and none may outlive its own.
      const timer = setTimeout(() => done(false), budgetMs);
      waiters.push(done);
    }),

  reset: () => {
    releaseWaiters(false);
    set({ link: "online", reachable: null, rtt: [] });
  },
}));
