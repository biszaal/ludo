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
  return { kind: "countdown", ms: msUntilReset(s, now) ?? 0 };
}

/** Time left to the daily reset (never negative), or null when the spin is off or unread. */
export function msUntilReset(s: SpinState | null, now: number): number | null {
  if (!s || !s.enabled || !s.resetsAt) return null;
  const reset = Date.parse(s.resetsAt);
  return Number.isFinite(reset) ? Math.max(0, reset - now) : null;
}

/**
 * How long the Home tile waits before it re-reads the clock. Once a minute
 * normally; when the reset is less than a minute away, just after it, so the
 * tile can ask the server what the new day owes. Once the reset has passed
 * (and the re-read hasn't landed yet), back to once a minute, so a failing
 * read is not retried in a tight loop.
 */
export function tileTickMs(ms: number): number {
  if (ms <= 0) return 60_000;
  return ms < 60_000 ? ms + 1_000 : 60_000;
}

/** Each segment's chance, as shown on the odds screen: "28%", "2.5%", "0.1%". */
export function odds(segments: Segment[]): { label: Segment; pct: string }[] {
  const total = segments.reduce((sum, s) => sum + s.w, 0);
  return segments.map((label) => {
    const pct = total > 0 ? Math.round((label.w / total) * 1000) / 10 : 0;
    return { label, pct: `${pct}%` };
  });
}

export type WedgeFill = "ivory" | "navy" | "gold";

/**
 * How each wedge is painted: the top coin prize (the first, if two tie) gets
 * the gold wedge, and the rest alternate ivory and navy in wheel order, so two
 * neighbours never share a colour unless the gold breaks the run.
 */
export function wedgeFills(segments: Segment[]): WedgeFill[] {
  let top = -1;
  segments.forEach((s, i) => {
    if ("coins" in s && (top < 0 || s.coins > (segments[top] as { coins: number }).coins)) top = i;
  });
  let alt = 0;
  return segments.map((_, i) => {
    if (i === top) return "gold";
    return alt++ % 2 === 0 ? "ivory" : "navy";
  });
}

export type RimMetal = "bronze" | "silver" | "gold";

/** The rim's metal says which wheel this is; the first-game wheel is gold. */
export function rimMetal(wheel: string): RimMetal {
  if (wheel === "bronze" || wheel === "gold") return wheel;
  if (wheel === "firstGame") return "gold";
  return "silver";
}

/**
 * How far the pointer leans (degrees; negative = its tip pushed to the right)
 * at a wheel rotation. The wheel turns clockwise, so each peg comes up to the
 * pointer from the left, pushes it over, and lets it drop back upright the
 * moment it passes; over the middle of a wedge it hangs straight. Runs on the
 * UI thread, every frame of a spin.
 */
export function flapperTilt(rotation: number, count: number, maxDeg = 14): number {
  "worklet";
  const step = 360 / count;
  // 0 when a peg is exactly under the pointer, rising as the wheel turns on.
  const phase = ((((rotation + step / 2) % step) + step) % step) / step;
  return phase > 0.7 ? -((phase - 0.7) / 0.3) * maxDeg : 0;
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
