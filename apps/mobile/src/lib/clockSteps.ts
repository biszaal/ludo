/**
 * How often the turn clock repaints.
 *
 * The turn clock is the one animation that runs for the whole of an online
 * match: a turn hands over, the clock restarts, and it drains for as long as the
 * seat takes. Driven straight off its animation it repainted on EVERY display
 * frame — measured on a Galaxy S26 Ultra as one Skia redraw per frame, match
 * long, which kept the main thread and the GPU busy even while nobody was
 * doing anything and never let the phone idle. On a mid-range phone that is
 * sustained heat for twenty minutes, and a phone that is slow after the game.
 *
 * But the clock only needs a new frame when what it shows has actually moved.
 * A ring a few hundred pixels round draining over thirty seconds moves by one
 * pixel roughly twenty times a second; everything in between repaints the
 * same picture. So the animation still runs every frame — it is a timing
 * curve on the UI thread and costs next to nothing — but what the clock DRAWS
 * is snapped to whole steps, and the canvas only hears about a new step.
 *
 * Pure (no react-native), so the Node suite can pin the arithmetic.
 */

/**
 * The most repaints a second the clock may ask for.
 *
 * Only reached on short clocks (an away seat's, or the last seconds of a
 * resync), where one step per pixel would ask for more frames than the display
 * has. Thirty is still smooth for an edge crawling round a ring — each step is
 * then a couple of pixels — and it is a quarter of what a 120Hz panel would
 * otherwise be asked for.
 */
export const MAX_STEPS_PER_SECOND = 30;

/**
 * How many distinct positions the clock shows over a turn: one per physical
 * pixel of its length, capped at MAX_STEPS_PER_SECOND over the turn.
 */
export function clockSteps(lengthPx: number, seconds: number): number {
  const byPixels = Math.ceil(lengthPx);
  const byRate = Math.ceil(seconds * MAX_STEPS_PER_SECOND);
  return Math.max(1, Math.min(byPixels, byRate));
}

/**
 * Progress (1 = the whole turn left, 0 = out of time) snapped to the step it
 * is on.
 *
 * Snapped UP: the clock holds each step until that step has fully elapsed, so
 * it never reads emptier than the time actually left, and it reaches zero
 * exactly when the time does.
 */
export function steppedProgress(progress: number, steps: number): number {
  "worklet";
  const p = Math.max(0, Math.min(1, progress));
  return Math.ceil(p * steps) / steps;
}
