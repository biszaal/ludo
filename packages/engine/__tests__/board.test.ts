import { describe, it, expect } from "vitest";
import {
  FINISH_REL_INDEX,
  fromRelativeIndex,
  isSafeSquare,
  toRelativeIndex,
} from "../src/index.js";
import type { Color } from "../src/index.js";

describe("board path math", () => {
  it("places relIndex 0 on each color's start cell", () => {
    expect(fromRelativeIndex("red", 0)).toEqual({ type: "track", index: 0 });
    expect(fromRelativeIndex("green", 0)).toEqual({ type: "track", index: 13 });
    expect(fromRelativeIndex("yellow", 0)).toEqual({ type: "track", index: 26 });
    expect(fromRelativeIndex("blue", 0)).toEqual({ type: "track", index: 39 });
  });

  it("wraps the shared loop modulo 52", () => {
    // blue starts at 39; 13 steps later wraps onto absolute cell 0.
    expect(fromRelativeIndex("blue", 13)).toEqual({ type: "track", index: 0 });
  });

  it("diverts into the home column after the 51st shared cell", () => {
    expect(fromRelativeIndex("red", 50)).toEqual({ type: "track", index: 50 });
    expect(fromRelativeIndex("red", 51)).toEqual({ type: "homePath", index: 0 });
    expect(fromRelativeIndex("red", 55)).toEqual({ type: "homePath", index: 4 });
    expect(fromRelativeIndex("red", FINISH_REL_INDEX)).toBe("finished");
  });

  it("round-trips every legal relative index for every color", () => {
    const colors: Color[] = ["red", "green", "yellow", "blue"];
    for (const color of colors) {
      for (let rel = 0; rel <= FINISH_REL_INDEX; rel++) {
        expect(toRelativeIndex(color, fromRelativeIndex(color, rel))).toBe(rel);
      }
    }
  });

  it("treats the yard as having no relative index", () => {
    expect(toRelativeIndex("red", "home")).toBeNull();
  });

  it("knows the eight safe squares", () => {
    for (const safe of [0, 8, 13, 21, 26, 34, 39, 47]) {
      expect(isSafeSquare(safe)).toBe(true);
    }
    for (const unsafe of [1, 5, 12, 25, 51]) {
      expect(isSafeSquare(unsafe)).toBe(false);
    }
  });
});
