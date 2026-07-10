/**
 * Guards the tumbling die's 3D math: a standard die layout (opposite faces sum
 * to 7), a rotation that really is orthonormal, and the affine matrices that
 * map face-local pips onto the screen. If these drift the roll can land showing
 * the wrong number.
 */

import { describe, it, expect } from "vitest";
import {
  cubeFaces,
  faceMatrix,
  faceValues,
  lambert,
  rotateScaleAbout,
  rotateVec,
  type Vec3,
} from "../src/render/dieMath";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe("faceValues", () => {
  it("keeps the rolled value on the front face", () => {
    for (let v = 1; v <= 6; v++) expect(faceValues(v).front).toBe(v);
  });

  it("makes every opposite pair sum to 7", () => {
    for (let v = 1; v <= 6; v++) {
      const f = faceValues(v);
      expect(f.front + f.back).toBe(7);
      expect(f.left + f.right).toBe(7);
      expect(f.top + f.bottom).toBe(7);
    }
  });

  it("uses each value exactly once", () => {
    for (let v = 1; v <= 6; v++) {
      const f = faceValues(v);
      const all = [f.front, f.back, f.left, f.right, f.top, f.bottom].sort();
      expect(all).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });
});

describe("cubeFaces", () => {
  it("builds six faces whose axes are orthonormal", () => {
    for (const face of cubeFaces(3)) {
      const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
      close(dot(face.n, face.u), 0);
      close(dot(face.n, face.v), 0);
      close(dot(face.u, face.v), 0);
      close(dot(face.n, face.n), 1);
      close(dot(face.u, face.u), 1);
      close(dot(face.v, face.v), 1);
    }
  });

  it("puts the rolled value toward the camera (front face, normal -z)", () => {
    const front = cubeFaces(5).find((f) => f.n.z === -1)!;
    expect(front.value).toBe(5);
  });
});

describe("rotateVec", () => {
  const p: Vec3 = { x: 0.3, y: -0.7, z: 0.5 };

  it("is the identity at zero angles", () => {
    const r = rotateVec(p, 0, 0, 0);
    close(r.x, p.x);
    close(r.y, p.y);
    close(r.z, p.z);
  });

  it("returns after a full turn on every axis", () => {
    const r = rotateVec(p, 2 * Math.PI, 2 * Math.PI, 2 * Math.PI);
    close(r.x, p.x);
    close(r.y, p.y);
    close(r.z, p.z);
  });

  it("preserves length (pure rotation)", () => {
    const r = rotateVec(p, 1.1, -0.4, 2.7);
    close(Math.hypot(r.x, r.y, r.z), Math.hypot(p.x, p.y, p.z));
  });

  it("flips the front normal to the back after a half X turn", () => {
    const r = rotateVec({ x: 0, y: 0, z: -1 }, Math.PI, 0, 0);
    close(r.z, 1);
  });
});

describe("lambert", () => {
  it("stays within 0..1 and lights the camera-facing face the most", () => {
    const faces = cubeFaces(1);
    const values = faces.map((f) => lambert(f.n));
    for (const b of values) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
    const front = lambert({ x: 0, y: 0, z: -1 });
    for (const b of values) expect(front).toBeGreaterThanOrEqual(b);
  });
});

describe("faceMatrix", () => {
  it("maps face-local corners through unrotated axes to the screen", () => {
    // Front face at identity: local (1,1) should land h right and h down of center.
    const m = faceMatrix({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 20, 100, 200);
    const apply = (x: number, y: number) => ({
      x: m[0]! * x + m[1]! * y + m[2]!,
      y: m[3]! * x + m[4]! * y + m[5]!,
    });
    close(apply(0, 0).x, 100);
    close(apply(0, 0).y, 200);
    close(apply(1, 1).x, 120);
    close(apply(1, 1).y, 220);
  });
});

describe("rotateScaleAbout", () => {
  const apply = (m: number[], x: number, y: number) => ({
    x: m[0]! * x + m[1]! * y + m[2]!,
    y: m[3]! * x + m[4]! * y + m[5]!,
  });

  it("is the identity at zero rotation and unit scale", () => {
    const m = rotateScaleAbout(0, 1, 1, 50, 60);
    close(apply(m, 12, 34).x, 12);
    close(apply(m, 12, 34).y, 34);
  });

  it("keeps the pivot fixed under rotation and scale", () => {
    const m = rotateScaleAbout(0.8, 1.3, 0.7, 50, 60);
    close(apply(m, 50, 60).x, 50);
    close(apply(m, 50, 60).y, 60);
  });

  it("scales distances from the pivot per axis", () => {
    const m = rotateScaleAbout(0, 2, 0.5, 10, 10);
    close(apply(m, 20, 10).x, 30); // 10 right of pivot doubles
    close(apply(m, 10, 20).y, 15); // 10 below pivot halves
  });
});
