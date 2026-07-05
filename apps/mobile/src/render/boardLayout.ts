/**
 * Board geometry: maps the engine's abstract {@link TokenPosition} to pixel
 * coordinates on a 15×15 Ludo grid. This is the ONLY place board pixels are
 * defined — the engine never knows about rendering.
 *
 * Origin is top-left, in cell units [col, row], 0..14. Consecutive track
 * indices follow the classic cross; the four corner "shoulders" turn diagonally,
 * as on a physical board.
 */

import type { Color as PlayerColor, TokenPosition } from "@ludo/engine";

export const GRID = 15;

/** The 52 shared track cells, in absolute order (index 0 = red's start). */
export const TRACK_CELLS: ReadonlyArray<readonly [number, number]> = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], // 0-4
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], // 5-10
  [7, 0], [8, 0], // 11-12
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], // 13-17
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], // 18-23
  [14, 7], [14, 8], // 24-25
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], // 26-30
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], // 31-36
  [7, 14], [6, 14], // 37-38
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], // 39-43
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8], // 44-49
  [0, 7], [0, 6], // 50-51
];

/** Each color's 5 home-column cells, outer → inner (toward the center). */
export const HOME_CELLS: Record<PlayerColor, ReadonlyArray<readonly [number, number]>> = {
  red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
};

/** Absolute track index of each color's colored start cell. */
export const START_CELL_INDEX: Record<PlayerColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

/** Corner yard blocks (6×6) per color, as a top-left cell + size. */
export const YARD_BLOCKS: Record<PlayerColor, { col: number; row: number; size: number }> = {
  red: { col: 0, row: 0, size: 6 },
  green: { col: 9, row: 0, size: 6 },
  yellow: { col: 9, row: 9, size: 6 },
  blue: { col: 0, row: 9, size: 6 },
};

/** Four token rest slots inside each yard, as grid-unit centers [gx, gy]. */
export const YARD_SLOTS: Record<PlayerColor, ReadonlyArray<readonly [number, number]>> = {
  red: [[1.5, 1.5], [4.5, 1.5], [1.5, 4.5], [4.5, 4.5]],
  green: [[10.5, 1.5], [13.5, 1.5], [10.5, 4.5], [13.5, 4.5]],
  yellow: [[10.5, 10.5], [13.5, 10.5], [10.5, 13.5], [13.5, 13.5]],
  blue: [[1.5, 10.5], [4.5, 10.5], [1.5, 13.5], [4.5, 13.5]],
};

/** Where each color's finished tokens cluster, just inside the center. */
const FINISH_APPROACH: Record<PlayerColor, { center: readonly [number, number]; axis: "x" | "y" }> = {
  red: { center: [6.7, 7.5], axis: "y" },
  green: { center: [7.5, 6.7], axis: "x" },
  yellow: { center: [8.3, 7.5], axis: "y" },
  blue: { center: [7.5, 8.3], axis: "x" },
};

export interface Point {
  x: number;
  y: number;
}

/** Pixel size of one cell for a square board of `boardSize` px. */
export function cellSize(boardSize: number): number {
  return boardSize / GRID;
}

/** Top-left pixel of a cell. */
export function cellRect(col: number, row: number, cell: number): Point {
  return { x: col * cell, y: row * cell };
}

/** Pixel center of a cell. */
export function cellCenterPx(col: number, row: number, cell: number): Point {
  return { x: (col + 0.5) * cell, y: (row + 0.5) * cell };
}

/** Pixel position of a grid-unit point (e.g. a yard slot center). */
export function gridPointPx(gx: number, gy: number, cell: number): Point {
  return { x: gx * cell, y: gy * cell };
}

/**
 * Pixel center for a single token, given its position and which of its owner's
 * four tokens it is (0..3, used to fan out stacked tokens in the yard / center).
 */
export function tokenCenterPx(
  color: PlayerColor,
  position: TokenPosition,
  tokenIndex: number,
  cell: number,
): Point {
  if (position === "home") {
    const [gx, gy] = YARD_SLOTS[color][tokenIndex % 4]!;
    return gridPointPx(gx, gy, cell);
  }
  if (position === "finished") {
    const { center, axis } = FINISH_APPROACH[color];
    const spread = (tokenIndex - 1.5) * 0.18;
    const gx = center[0] + (axis === "x" ? spread : 0);
    const gy = center[1] + (axis === "y" ? spread : 0);
    return gridPointPx(gx, gy, cell);
  }
  const [col, row] =
    position.type === "track" ? TRACK_CELLS[position.index]! : HOME_CELLS[color][position.index]!;
  return cellCenterPx(col, row, cell);
}
