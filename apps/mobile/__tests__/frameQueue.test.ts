/**
 * The frame queue spaces Frenzy moves one per animation frame, so every move
 * reaches the board as its own render (Board reads a pawn's walk off the
 * state's single lastAction — two moves in one render would fly the first).
 */

import { describe, it, expect } from "vitest";
import { createFrameQueue } from "../src/lib/frameQueue";

function manualFrames() {
  const frames: Array<() => void> = [];
  return { frames, schedule: (cb: () => void) => void frames.push(cb) };
}

describe("frame queue", () => {
  it("runs at most one job per frame, in the order they were pushed", () => {
    const { frames, schedule } = manualFrames();
    const queue = createFrameQueue(schedule);
    const ran: string[] = [];

    queue.push(() => ran.push("a"));
    queue.push(() => ran.push("b"));
    expect(ran).toEqual([]);

    frames.shift()!();
    expect(ran).toEqual(["a"]);
    frames.shift()!();
    expect(ran).toEqual(["a", "b"]);
    expect(frames).toHaveLength(0);
  });

  it("drops what is still queued on clear", () => {
    const { frames, schedule } = manualFrames();
    const queue = createFrameQueue(schedule);
    const ran: string[] = [];

    queue.push(() => ran.push("a"));
    queue.push(() => ran.push("b"));
    queue.clear();
    while (frames.length) frames.shift()!();

    expect(ran).toEqual([]);
  });
});
