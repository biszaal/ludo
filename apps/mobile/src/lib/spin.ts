/**
 * Reward spin, app side (server: migration 0086, ops spinState / spinClaim).
 *
 * The server decides what is owed and which prize each spin pays; nothing here
 * can change a result. These helpers only present it: what the Home tile
 * says, the odds list, the countdown to the next reset, and the rotation that
 * stops the wheel on the segment the server picked.
 *
 * Pure, so it is tested in Node (__tests__/spin.test.ts).
 */

export type SpinSource = "first" | "daily" | "match";

/** One wedge of a wheel. `w` is its weight per 1,000. */
export type Segment = { coins: number; w: number } | { gems: number; w: number };

/** spin_status, as the server sends it. Only `enabled` is present when off. */
export interface SpinState {
  enabled: boolean;
  tableVersion?: number;
  owed?: { first: "owed" | "used" | "locked"; daily: boolean; match: number };
  matchMax?: number;
  tier?: "bronze" | "silver" | "gold";
  next?: { source: SpinSource; wheel: string; segments: Segment[] } | null;
  resetsAt?: string;
}

export type TileView =
  | { kind: "hidden" }
  | { kind: "ready"; count: number }
  | { kind: "countdown"; ms: number }
  | { kind: "locked" };

/** What the Home tile shows for this state at this moment. */
export function tileView(s: SpinState | null, now: number): TileView {
  if (!s || !s.enabled || !s.owed) return { kind: "hidden" };
  const { first, daily, match } = s.owed;
  const count = (first === "owed" ? 1 : 0) + (daily ? 1 : 0) + Math.max(0, match);
  if (count > 0) return { kind: "ready", count };
  if (first === "locked") return { kind: "locked" };
  const reset = s.resetsAt ? Date.parse(s.resetsAt) : NaN;
  return { kind: "countdown", ms: Number.isFinite(reset) ? Math.max(0, reset - now) : 0 };
}

/** Each segment's chance, as shown on the odds screen: "28%", "2.5%", "0.1%". */
export function odds(segments: Segment[]): { label: Segment; pct: string }[] {
  const total = segments.reduce((sum, s) => sum + s.w, 0);
  return segments.map((label) => {
    const pct = total > 0 ? Math.round((label.w / total) * 1000) / 10 : 0;
    return { label, pct: `${pct}%` };
  });
}

/** Time left, rounded up to whole minutes and never below one. */
export function formatCountdown(ms: number): { h: number; m: number } {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/**
 * The absolute rotation (degrees, clockwise) that stops the wheel with
 * `segment`'s centre under the pointer at the top, at least `turns` full turns
 * past `fromDeg` and less than one more. Segment 0 is centred at the top when
 * the rotation is 0, and segments run clockwise.
 */
export function wheelTarget(segment: number, count: number, fromDeg: number, turns: number): number {
  const step = 360 / count;
  const base = fromDeg + turns * 360;
  const offset = (((-segment * step - base) % 360) + 360) % 360;
  return base + offset;
}
