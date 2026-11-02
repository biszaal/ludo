/**
 * Runs queued jobs one per animation frame.
 *
 * Frenzy applies moves from several clocks at once, and React Native fires the
 * timers that fall due together in one JS batch — which renders once. Board
 * reads a pawn's walk off the state's single `lastAction`, so two moves in one
 * render would leave the first with nothing to walk from: it would fly. Spacing
 * the moves a frame apart gives each its own render. A frame is ~16ms, well
 * under anything a player can see.
 */

export interface FrameQueue {
  push(job: () => void): void;
  /** Drop everything still queued (leaving, pausing). */
  clear(): void;
}

export function createFrameQueue(schedule: (cb: () => void) => void = nextFrame): FrameQueue {
  const jobs: Array<() => void> = [];
  let pending = false;
  // A frame requested before clear() must not run what was pushed after it.
  let epoch = 0;

  const pump = (at: number) => {
    if (at !== epoch) return;
    pending = false;
    const job = jobs.shift();
    if (!job) return;
    job();
    if (jobs.length > 0 && !pending) request();
  };

  const request = () => {
    pending = true;
    const at = epoch;
    schedule(() => pump(at));
  };

  return {
    push(job) {
      jobs.push(job);
      if (!pending) request();
    },
    clear() {
      jobs.length = 0;
      pending = false;
      epoch++;
    },
  };
}

function nextFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => cb());
  else setTimeout(cb, 16);
}
