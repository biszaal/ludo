/**
 * Board & dice skins. "classic" keeps the original color literals (guarded by
 * a unit test) — the renderer derives its depth treatments (gradients, bevels,
 * recesses) from these via shade(), so themes restyle surfaces only —
 * geometry, animation and layout never change per theme.
 */

import type { Color as PlayerColor } from "@ludo/engine";
import { palette, teamColor } from "../theme";

export type BoardThemeId = "classic" | "night" | "walnut" | "sand";

export interface BoardTheme {
  id: BoardThemeId;
  label: string;
  /** Board base plate. */
  boardBase: string;
  /** Outer stroke + center-square stroke. */
  boardEdge: string;
  /** Track cells, yard inner plate, yard slot inner. */
  cellFill: string;
  /** Empty yard-slot disc (gray recess a pawn sits in). */
  slotEmpty: string;
  /** 1px stroke around track cells. */
  cellBorder: string;
  /** Safe-square star glyph. */
  starColor: string;
  /** Team colors as rendered on this board (classic = the app-wide set). */
  team: Record<PlayerColor, string>;
  dice: { face: string; pip: string };
  /** Outline stroke around pawn body/head. */
  pawnStroke: string;
}

export const BOARD_THEMES: Record<BoardThemeId, BoardTheme> = {
  // The bright Ludo Club–style board. Values are the original Board.tsx/Dice.tsx
  // literals — do not restyle this theme.
  classic: {
    id: "classic",
    label: "Classic",
    boardBase: "#FDFDFB",
    boardEdge: "#B9B2A0",
    cellFill: "#FFFFFF",
    slotEmpty: "#C6CBD1",
    cellBorder: "#D2D2D2",
    starColor: "#AEB4BD",
    team: teamColor,
    dice: { face: "#FFFFFF", pip: "#17181C" },
    pawnStroke: "rgba(0,0,0,0.32)",
  },
  // Slate plate with ivory track — the board joins the dark table.
  night: {
    id: "night",
    label: "Night",
    boardBase: "#232830",
    boardEdge: "#3E4550",
    cellFill: "#ECE9DF",
    slotEmpty: "#C2BFB4",
    cellBorder: "#1A1E24",
    starColor: "#8B93A1",
    team: { red: "#C9403F", green: "#27915A", yellow: "#D9A422", blue: "#3B58C4" },
    dice: { face: palette.raisedSlate, pip: palette.porcelain },
    pawnStroke: "rgba(0,0,0,0.5)",
  },
  // Warm wood with cream cells and a brass-toned edge.
  walnut: {
    id: "walnut",
    label: "Walnut",
    boardBase: "#8B6844",
    boardEdge: "#5E4426",
    cellFill: "#F3E9D7",
    slotEmpty: "#D8C9AE",
    cellBorder: "#C9B694",
    starColor: "#A08454",
    team: teamColor,
    dice: { face: "#6B4E30", pip: "#F3E9D7" },
    pawnStroke: "rgba(0,0,0,0.38)",
  },
  // Soft warm off-white with clay accents; light dice with dark pips.
  sand: {
    id: "sand",
    label: "Sand",
    boardBase: "#F0E9DC",
    boardEdge: "#C9A183",
    cellFill: "#FAF6EE",
    slotEmpty: "#DED3BF",
    cellBorder: "#DDD2BE",
    starColor: "#B5A88E",
    team: teamColor,
    dice: { face: "#E8DFCE", pip: "#5B5344" },
    pawnStroke: "rgba(0,0,0,0.28)",
  },
};

export const DEFAULT_THEME = BOARD_THEMES.classic;
