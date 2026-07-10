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
