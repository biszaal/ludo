/**
 * The arithmetic behind VolumeSlider, kept apart from the component so it can
 * be tested without rendering one — the same split soundPool makes from sound.
 *
 * Two things shape the code more than they look like they should.
 *
 * The first is that everything is total. No input — a zero track width one
 * frame before layout, a NaN out of a gesture — may produce a NaN, because a
 * NaN reaching the store persists and then mutes the app on every later launch
 * with nothing on screen to explain it.
 *
 * The second is that the real value is an INTEGER step index, and 0..1 is only
 * how it is stored. Doing it the other way (add 0.05, round) puts a floating
 * point tail on every value: 0.05 is not representable, so 0.5 / 0.05 is
 * 9.999999999999998, and a decrement that trusts that arithmetic silently
 * skips a step at half volume. Index in, index out, divide once at the end.
 */

/**
 * The grid the thumb snaps to.
 *
 * Finer than this and the number under the thumb flickers between values a
 * finger cannot deliberately choose; coarser and the quiet end of the range,
 * which is where anyone adjusting volume actually wants to live, has too few
 * places to stand.
 */
export const STEP = 0.05;

/** The grid as a count, which is the form the rest of the file works in. */
const STEPS = Math.round(1 / STEP);

/** Slack for comparing a value that has been through 0..1 and back against the
 *  grid — see the header: the round trip does not land exactly. */
const EPSILON = 1e-9;

/** Bring any number into 0..1, snapping nothing. A non-finite value becomes 1:
 *  of the two ends to guess at, silence is the one nobody can diagnose. */
export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

function fromIndex(i: number): number {
  return Math.min(STEPS, Math.max(0, i)) / STEPS;
}

/** Round onto the grid, free of the floating-point tail that would otherwise
 *  reach both the display and the persisted blob. */
function snap(v: number): number {
  return fromIndex(Math.round(clampVolume(v) * STEPS));
}

/** Where a touch `x` along a track of `width` puts the volume. A drag that has
 *  left the track holds the rail it left by, which is how a finger sliding off
 *  the end still reaches 0 or 1. */
export function valueFromTouch(x: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(x)) return 0;
  return fromIndex(Math.round((x / width) * STEPS));
}

/**
 * One grid step up (`dir` 1) or down (-1), for the accessibility increment and
 * decrement actions.
 *
 * It moves to the next grid point STRICTLY in the direction asked, so a value
 * sitting off the grid joins it by the near side rather than jumping over it —
 * decrementing 37% gives 35%, not 30%. Someone stepping through by voice must
 * never find a step missing.
 */
export function stepVolume(v: number, dir: 1 | -1): number {
  const units = clampVolume(v) * STEPS;
  const next = dir > 0 ? Math.floor(units + EPSILON) + 1 : Math.ceil(units - EPSILON) - 1;
  return fromIndex(next);
}

/** The whole number shown beside the track. */
export function volumePercent(v: number): number {
  return Math.round(clampVolume(v) * 100);
}

/** The fraction of the track to fill, for the component. Separate from the
 *  stored value only so the component never has to remember to clamp. */
export function trackFraction(v: number): number {
  return snap(v);
}
