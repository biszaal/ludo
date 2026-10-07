/**
 * A pawn's walk as a function of ONE clock.
 *
 * `t` counts steps walked: 0 is the pawn standing where it started, k is the
 * end of the k-th step, by which time it has landed on the k-th cell of its
 * route and sat there a moment (see HOP_AIR). On a phone whose sound arrives
 * late the clock starts below zero, and the pawn holds still until it reaches
 * 0 (render/waypoints.hopPreRollMs). Board animates `t` with a single
 * linear timing over the whole move and reads everything off it — where the
 * pawn is, how high it is, which landings have happened and which thocks are
 * due — so none of those can drift against each other.
 *
 * WHY NOT A CHAIN OF TIMINGS, which is what this replaced: Reanimated starts
 * each link of a `withSequence` on the frame the previous link finished, and
 * the part of that frame that ran past the finish is thrown away. That is
 * sub-frame per link, and it adds up: the hop's y chain had two links per cell
 * against x's one, so at 60Hz a six-cell move took 1000ms instead of 900 and
 * each landing trailed its cell by ~40ms — the pawn came down beside the square
 * and stalled at every cell. 60Hz is what every opponent's move ran at on
 * Android's adaptive refresh (see modules/high-frame-rate), so that was most
 * moves.
 *
 * Pure and worklet-safe, like dieMath and pipShapes: Board calls these on the
 * UI thread every frame of a walk, and the Node suite pins the arithmetic.
 */

export interface WalkPt {
  x: number;
  y: number;
}

/**
 * The share of each hop step spent in the air; for the rest the pawn sits on
 * the cell it just landed on.
 *
 * The sit is part of what makes it read as HOPPING. The first version of the
 * one-clock walk touched each cell for a single instant and took straight off
 * again, and at 120Hz that looked like gliding (user, 2026-09-27). The old
 * chained timings stalled at each landing by accident — the dropped frame
 * described above — which is the part of their look worth keeping, on purpose
 * and on the beat. At HOP_STEP_MS (160) this is a 112ms jump and a 48ms sit;
 * the sit lives inside the step, so the move's length does not change.
 *
 * Tuned on a device, and it is a narrow band: 0.75 with nothing else still
 * glided; 0.6 with a higher jump and a landing squash was "too bouncy and
 * aggressive — the game is supposed to be calm". What made the difference in
 * the end is the ground shadow Board keeps on the board (see hopHeight), not a
 * harder hop.
 */
export const HOP_AIR = 0.7;

/**
 * Where the pawn's FOOT is, `t` steps into its walk — on the board, with no
 * lift: the lift is hopHeight, kept apart so the pawn's shadow can stay on the
 * board while the pawn leaves it. A pawn and its shadow parting company is
 * what makes a hop read as a hop; lifted together they just ride an arc.
 *
 * Within each step the pawn travels linearly for the first `air` of it and then
 * sits on the cell for the rest. `air` 1 never sits — a captured pawn's glide.
 */
export function walkPoint(from: WalkPt, points: readonly WalkPt[], t: number, air: number): WalkPt {
  "worklet";
  const n = points.length;
  if (n === 0) return from;
  const c = Math.max(0, Math.min(n, t));
  const k = Math.min(Math.floor(c), n - 1);
  const f = Math.min(1, (c - k) / air);
  const a = k === 0 ? from : points[k - 1]!;
  const b = points[k]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/**
 * How high the pawn is, 0..1 of the hop's full lift: a parabola over each jump
 * — the curve the old up-then-down pair of quad eases traced — and 0 while it
 * sits.
 */
export function hopHeight(t: number, cells: number, air: number): number {
  "worklet";
  if (t <= 0 || t >= cells) return 0;
  const f = (t - Math.floor(t)) / air;
  return f >= 1 ? 0 : 4 * f * (1 - f);
}

/**
 * How many landings have happened by clock `t`: step k touches down at
 * `k - 1 + air`. Every step of a forward walk counts; a retrace counts only its
 * arrival (it glides; fifty bumps home would be a machine-gun).
 */
export function landingsBy(t: number, cells: number, retrace: boolean, air: number): number {
  "worklet";
  // The epsilon keeps a landing that falls exactly on a frame from rounding
  // one frame late (5.1 + 0.6 - 0.7 is 4.999… in floating point).
  const landed = Math.max(0, Math.min(cells, Math.floor(t - air + 1e-9) + 1));
  if (retrace) return landed >= cells ? 1 : 0;
  return landed;
}

/**
 * Where in its jump a hop's sound is HEARD: 0 is take-off, 1 the landing.
 *
 * At the top. The clip is a "boing" whose pitch falls, and heard from the apex
 * it falls with the pawn and ends as it lands — it is cut to the length of the
 * descent (scripts/gen-hop-sound.mjs). Heard on the landing instead, the whole
 * glide played while the pawn sat still on the cell and read flat ("not as fun
 * as it was", user, 2026-09-27). What it used to be was an accident: on a
 * Galaxy the sound arrived ~200ms late, which happened to drop it onto the next
 * hop's fall — and onto some other moment on a phone with a different delay.
 * With the delay measured per device (moveTiming.soundLeadMs), this is the
 * design, on every device.
 */
export const HOP_SOUND_AT = 0.5;

/**
 * How many hop sounds are due by clock `t`, each asked for `leadCells` ahead of
 * the moment it should be heard — the measured audio delay, in cells of this
 * walk (moveTiming.soundLeadMs() / the step). A forward hop is heard at
 * HOP_SOUND_AT of its jump; a retrace glides, and sounds once, on arrival. Read
 * off the walk clock, so the sounds keep the hops' rhythm.
 *
 * On a phone with a long delay the lead is longer than the run-up to the first
 * sound, so Board starts the clock that much early (the pre-roll) and the first
 * sound is due exactly at the clock's start. Before the delay is measured it
 * can be due before the start, and asks to sound at once. Either way it is due
 * on the very first frame, and a caller that only fires when this count
 * CHANGES never sees that one change — which silenced the first hop of every
 * move while it was so; keep a count of what has been played instead.
 */
export function cuesBy(t: number, cells: number, retrace: boolean, leadCells: number, air: number): number {
  "worklet";
  if (retrace) return landingsBy(t + leadCells, cells, true, air);
  const due = Math.floor(t + leadCells - air * HOP_SOUND_AT + 1e-9) + 1;
  return Math.max(0, Math.min(cells, due));
}
