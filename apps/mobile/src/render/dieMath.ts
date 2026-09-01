/**
 * Pure 3D math for the tumbling Skia die: standard-die face values, Euler
 * rotation, diffuse shading and the affine matrices that map face-local
 * coordinates onto the screen (orthographic camera looking toward +z, screen
 * y growing downward). Everything is worklet-safe — it runs per frame on the
 * UI thread — and dependency-free so it unit-tests in Node.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface DieFace {
  /** Outward unit normal; the face center sits at `n` (unit half-edge cube). */
  n: Vec3;
  /** Face-local +x (right) and +y (down) directions in cube space. */
  u: Vec3;
  v: Vec3;
  /** Pip count shown on this face. */
  value: number;
}

interface FaceAssignment {
  front: number;
  back: number;
  right: number;
  left: number;
  top: number;
  bottom: number;
}

/**
 * Values for all six faces of a standard die (opposite faces sum to 7) with
 * the rolled value facing the camera. The four side values are the remaining
 * pips; sorted ascending they pair off (first+last, middle two) to sum 7.
 */
export function faceValues(front: number): FaceAssignment {
  "worklet";
  const back = 7 - front;
  const rest: number[] = [];
  for (let v = 1; v <= 6; v++) {
    if (v !== front && v !== back) rest.push(v);
  }
  return { front, back, right: rest[0]!, left: rest[3]!, top: rest[1]!, bottom: rest[2]! };
}

/** The cube's six faces, pip values arranged so `frontValue` faces the camera. */
export function cubeFaces(frontValue: number): DieFace[] {
  "worklet";
  const f = faceValues(frontValue);
  return [
    { n: { x: 0, y: 0, z: -1 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, value: f.front },
    { n: { x: 0, y: 0, z: 1 }, u: { x: -1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, value: f.back },
    { n: { x: 1, y: 0, z: 0 }, u: { x: 0, y: 0, z: 1 }, v: { x: 0, y: 1, z: 0 }, value: f.right },
    { n: { x: -1, y: 0, z: 0 }, u: { x: 0, y: 0, z: -1 }, v: { x: 0, y: 1, z: 0 }, value: f.left },
    { n: { x: 0, y: -1, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 }, value: f.top },
    { n: { x: 0, y: 1, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, value: f.bottom },
  ];
}

/**
 * The number a TUMBLING cube may paint on its faces, or null for none.
 *
 * A cube has to be laid out around some face value even before the server has
 * answered, and that placeholder used to be painted like any other number. It
 * cannot be, and the reason is the tumble's own easing rather than anything
 * about the placeholder: a lap's rotation eases out to identity, so the camera
 * face is within ~19 degrees of straight-on for the last third of EVERY lap and
 * within ~6 degrees for the last fifth. Landing or not, that tail is read.
 *
 * So a roll still waiting on its number spent the tail of each lap showing a
 * legible 1 — `value ?? 1` — before the real number arrived on a later lap.
 * Reported exactly that way: "the die rolls and lands on 1 before rolling again
 * and getting the actual number."
 *
 * The lap machinery in Dice.tsx already guarantees the die never STOPS on a
 * placeholder, and that was never the problem. Stopping is not what makes a
 * face readable; decelerating is.
 *
 * Deliberately NOT solved by spinning differently while waiting. That was tried
 * across several rounds and reverted wholesale in 09b0606: parking the arc and
 * carrying the wait on a second rotation meant two sources feeding one die, and
 * every fix only moved which junction the speed changed at. One tumble, one
 * rate, start to finish. The cube keeps rolling exactly as it always has — it
 * just has nothing written on it until there is something true to write.
 */
export function tumbleFaceValue(value: number | null): number | null {
  "worklet";
  return value;
}

/**
 * The waiting mark a tumbling face carries instead of a number, in FACE-LOCAL
 * units (a face spans 2, centred on the origin).
 *
 * Painting nothing was the first answer to the placeholder problem and it was
 * only half right: a cube with no markings, spinning, reads as a blank white
 * block rather than as a die — reported exactly that way. The die already has a
 * mark that means "not rolled yet", the swirl the resting face shows while it
 * waits to be tapped, so the tumbling faces wear the same one. It cannot be
 * mistaken for a value, which is the property that matters, and it keeps the
 * thing recognisably a die while the server takes its time.
 *
 * Returned as points rather than a Path so this stays free of Skia and testable
 * in Node; the caller strokes them once per skin, not per frame.
 */
export function swirlPoints(steps = 44): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const st = i / steps;
    const angle = st * 2.25 * 2 * Math.PI - Math.PI / 2;
    // 0.3 of the die across, and a face spans 2 local units to the die's 1.
    const r = 0.6 * Math.pow(st, 0.85);
    out.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }
  return out;
}

/** Rotate `p` by Euler angles (radians): X axis first, then Y, then Z. */
export function rotateVec(p: Vec3, ax: number, ay: number, az: number): Vec3 {
  "worklet";
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  let x = p.x;
  let y = p.y * cx - p.z * sx;
  let z = p.y * sx + p.z * cx;

  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const x2 = x * cy + z * sy;
  z = -x * sy + z * cy;
  x = x2;

  const cz = Math.cos(az);
  const sz = Math.sin(az);
  return { x: x * cz - y * sz, y: x * sz + y * cz, z };
}

/**
 * Diffuse brightness (0..1) for a rotated face normal. The light sits up-left
 * of the camera, so the camera-facing face reads brightest and side faces
 * fall off — enough contrast to sell the cube's edges mid-tumble.
 */
export function lambert(n: Vec3): number {
  "worklet";
  const d = n.x * -0.3 + n.y * -0.45 + n.z * -0.84;
  return Math.min(1, Math.max(0, d));
}

/**
 * Row-major 3x3 affine matrix mapping face-local coords (the face spans
 * [-1,1]²) to the screen: rotated axes `u`/`v` scaled to `h` px, face center
 * `c` (the rotated normal) offset from the die center (`cx`,`cy`).
 */
export function faceMatrix(u: Vec3, v: Vec3, c: Vec3, h: number, cx: number, cy: number): number[] {
  "worklet";
  return [u.x * h, v.x * h, cx + c.x * h, u.y * h, v.y * h, cy + c.y * h, 0, 0, 1];
}

/** Row-major 3x3 matrix rotating by `rad` and scaling per-axis about a pivot. */
export function rotateScaleAbout(rad: number, sx: number, sy: number, cx: number, cy: number): number[] {
  "worklet";
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = cos * sx;
  const b = -sin * sy;
  const d = sin * sx;
  const e = cos * sy;
  return [a, b, cx - a * cx - b * cy, d, e, cy - d * cx - e * cy, 0, 0, 1];
}
