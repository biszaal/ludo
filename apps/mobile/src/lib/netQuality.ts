/**
 * How good is the link, in the only terms the player cares about.
 *
 * Pure and dependency-light (no react-native, no expo-network) so the Node
 * suite can exercise the thresholds directly — the store that feeds these live
 * signals is connectionStore.ts. Same split as layout.ts / useLayout.ts.
 *
 * This exists because the app previously had no way to tell "the server is
 * thinking" from "this phone has no signal". Both looked identical for the
 * ~25s the turn retry ladder takes, by which point the turn clock had expired
 * and the stall bot had played the seat, with nothing ever shown to explain it.
 */

export type Link = "online" | "slow" | "offline";

/** How many recent round trips to judge on. */
export const RTT_WINDOW = 5;

/**
 * Fewest samples before speed is judged at all.
 *
 * Below this the app has barely made any calls — the opening request against a
 * cold isolate is routinely slow and says nothing about the link. Guessing from
 * one or two samples would flash a banner during startup on every device.
 */
export const MIN_SAMPLES = 3;

/** Median round trip at or above which the link is worth mentioning. */
export const SLOW_RTT_MS = 2000;

/** Add a sample, keeping only the most recent {@link RTT_WINDOW}. Returns a new
 *  array — the caller holds this in store state, which must not be mutated. */
export function pushRtt(window: readonly number[], ms: number): number[] {
  return [...window, ms].slice(-RTT_WINDOW);
}

function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Classify the link.
 *
 * The median — not the mean, and not the latest sample — is what gives this
 * hysteresis. One 6s round trip is an ordinary event on a mobile network, and a
 * banner that flickers on every one of them is noise the player learns to
 * ignore. A median only moves once the pattern does.
 *
 * `reachable === null` means the platform did not say. That is not evidence of
 * an outage, so it is judged on speed alone: telling a player who is fine that
 * they are offline is worse than saying nothing.
 */
export function classify(reachable: boolean | null, recentRttMs: readonly number[]): Link {
  if (reachable === false) return "offline";
  if (recentRttMs.length < MIN_SAMPLES) return "online";
  return median(recentRttMs) >= SLOW_RTT_MS ? "slow" : "online";
}

/**
 * Collapse expo-network's `NetworkState` into the one question this app asks.
 *
 * Every field on that type is optional, and the two that matter disagree in the
 * case worth catching: a captive portal or a dead-zone Wi-Fi reports
 * `isConnected: true` with `isInternetReachable: false`. Reachability wins
 * wherever it is stated — a connection that reaches nothing is an outage as far
 * as a turn is concerned.
 *
 * Reporting nothing is not the same as reporting an outage, so it stays null.
 */
export function reachableFrom(s: { isConnected?: boolean; isInternetReachable?: boolean }): boolean | null {
  if (s.isInternetReachable !== undefined) return s.isInternetReachable;
  if (s.isConnected !== undefined) return s.isConnected;
  return null;
}
