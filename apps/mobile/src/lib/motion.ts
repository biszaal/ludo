/**
 * Shared Reanimated worklets for the app's looping "waiting" motion.
 *
 * One linear shared value drives a whole cluster of pieces; each piece reads its
 * own slice of the cycle through `arc`, so a wave of tiles or seats moves from a
 * single animation rather than one timer per element.
 */

/**
 * 0 at rest → 1 at apex → 0, over this index's slice of a 0..1 cycle.
 *
 * `span` is the fraction of the cycle a piece spends moving; `stagger` is the
 * offset between neighbours. Leaving `span + (n - 1) * stagger` under 1 gives a
 * beat of stillness before the wave restarts.
 */
export function arc(wave: number, index: number, span: number, stagger: number): number {
  "worklet";
  const local = (wave + 1 - index * stagger) % 1;
  return local < span ? Math.sin((local / span) * Math.PI) : 0;
}
