/**
 * Board & dice skins. "classic" keeps the original color literals (guarded by
 * a unit test) — the renderer derives its depth treatments (gradients, bevels,
 * recesses) from these via shade(), so themes restyle surfaces only —
 * geometry, animation and layout never change per theme.
 *
 * The premium tiers (Verdant Garden through Celestial Court) add optional
 * treatments on top of that same flat palette. Surface: a plate wash, a tinted
 * inner lip, a track-cell gradient, a corner vignette. Marking: a safe-square
 * glyph (boardGlyphs.ts) and a centre medallion (faceMotifs.ts). And the two
 * that actually make a board worth buying (boardArt.ts): a MATERIAL printed
 * into the four yard plates, and a WORKED EDGE run around the rim and around
 * every yard tile.
 *
 * The order of that list is the lesson. The first cut of this tier had only the
 * surface treatments, and it looked exactly like what it was — the same flat
 * rectangles in better colors. Six colors is a budget that produces one good
 * idea and then variations of it; texture and ornament are what a player is
 * being asked to pay for. None of it moves a cell, a pawn or a millisecond —
 * see boardGlyphs.ts on why a marking is not geometry.
 *
 * Where the plate actually shows. The track interior is scaled in (Board.tsx's
 * BOARD_INTERIOR_SCALE) so the plate rings the play area, and every cell is
 * inset by cellInset() so the plate also shows between cells as grout. That
 * grid of grout lines is most of what a player reads as "the board's color" —
 * which is why a gold plate reads as a gold board even though gold covers no
 * cell at all.
 *
 * Prices mirror the catalog migrations (0013 coins, 0018/0061 gems and the
 * premium coin ladder). Display authority is the server's catalog table, not
 * this file; __tests__/boardThemes.test.ts cross-checks both directions so the
 * two cannot drift.
 */

import type { Color as PlayerColor } from "@ludo/engine";
import type { MotifKind } from "./faceMotifs";
import type { BandKind, EmblemKind, TextureKind } from "./boardArt";
import type { BoardGlyph } from "./boardGlyphs";
import { palette, teamColor } from "../theme";

export type BoardThemeId =
  | "classic"
  | "night"
  | "walnut"
  | "sand"
  | "garden"
  | "blossom"
  | "onyx"
  | "gilded"
  | "aurora"
  | "moonlit"
  | "nacre"
  | "peacock"
  | "celestial";

/**
 * The base plate's wash. Omitted, the plate takes the derived light-to-dark
 * gradient every board has always had (shade(base, ±)); given, the theme paints
 * it itself, which is the difference between a colored plate and a material —
 * a metal needs three stops and a raking angle, a hedge needs two and no shine.
 */
export interface PlateWash {
  colors: string[];
  positions?: number[];
  /** Vertical (a lit table) or diagonal (a raking light across metal). */
  angle?: "vertical" | "diagonal";
}

export interface BoardTheme {
  id: BoardThemeId;
  label: string;
  /** Cost to unlock; 0 = free. Must match the seeded `theme.<id>` catalog row. */
  price: number;
  /** Which wallet the price charges. Omitted = coins (the default tier). */
  currency?: "gems";
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
  /** Safe-square glyph color. */
  starColor: string;
  /** Team colors as rendered on this board (classic = the app-wide set). */
  team: Record<PlayerColor, string>;
  dice: { face: string; pip: string };
  /** Outline stroke around pawn body/head. */
  pawnStroke: string;

  // --- Premium treatments. Every one is optional and every one defaults to
  // exactly what the board drew before they existed. ------------------------

  /** Plate wash. Omitted = the derived light-to-dark gradient. */
  plate?: PlateWash;
  /**
   * How a yard tile is built.
   *
   * "solid" (the default, and what every board did) fills the whole 6×6 tile
   * with the seat colour. Four saturated squares is most of a Ludo board's
   * silhouette, which is why boards that differ in every other respect still
   * read as the same object — a gold board and a night board were both, at a
   * glance, four bright squares.
   *
   * "disc" sets a ROUND bed of seat colour into the board's material and leaves
   * the tile's four corners for ornament. Square yards are most of the reason
   * every Ludo board reads the same at a glance, and the disc costs nothing in
   * layout: all four slots still sit inside it, untouched.
   *
   * "ring" builds the tile out of the BOARD's material and sets the seat colour
   * as a band around it. The seat stays unmistakable — the ring, the slot rims,
   * the start cell, the home run and the centre wedge are all still its colour,
   * five separate tells — but the board reads as gold, or as a night sky, with
   * jewels set into it, rather than as four primaries in a frame. Reserved for
   * boards whose material is the point.
   */
  yardStyle?: "solid" | "ring" | "disc";
  /** The material a "ring" yard is filled with. Omitted = the plate's own tone. */
  yardPlate?: string;
  /**
   * Track-cell corner radius as a fraction of the cell. Omitted = the original
   * 2px. Square-cut cells read as stone or metal plate; generous ones read as
   * enamel counters.
   */
  cellRadius?: number;
  /**
   * Per-cell tone jitter, 0..1 (seeded, so a given board always varies the same
   * way). Every board in the catalog drew 52 identically-coloured rectangles,
   * which is the single strongest "printed grid" cue on the whole surface. Real
   * flagstones, parquet and enamel counters all vary cell to cell; a couple of
   * percent of variance is enough for the eye to stop reading a print-out.
   */
  cellVariance?: number;
  /**
   * The lit lip just inside the outer edge. Omitted = the white plastic
   * highlight. This is small and it matters: a warm brass hairline is most of
   * what separates a framed board from a molded one, and a white lip on a gold
   * plate is the single fastest way to make gold look like plastic.
   */
  lip?: string;
  /**
   * Top color of a plain track cell's vertical wash; `cellFill` stays the
   * bottom. Omitted = a flat cell, as before. Fifty-two of these are the
   * largest light surface on the board, so a two-stop wash is the difference
   * between paper and stone.
   */
  cellTop?: string;
  /** Start/safe-square marking. Omitted = the classic five-point star. */
  glyph?: BoardGlyph;
  /** Plate gloss strength, 0..1. Omitted = 0.05, the original plastic sheen. */
  sheen?: number;
  /**
   * What the plate is MADE of (render/boardArt.ts) — grain, mineral veining,
   * foliage, a star field, water, a damask weave. Drawn over the plate wash and
   * then mostly covered by the cells: what survives is the frame, the grout
   * between cells and the ring around each yard, which is exactly where the eye
   * goes looking for the material.
   */
  texture?: { kind: TextureKind; color: string; alpha: number };
  /**
   * The emblem printed on each yard plate — one composed, symmetric figure,
   * centred (render/boardArt.ts's yardEmblem).
   *
   * This is where board art lands. The track covers ~96% of the plate, so plate
   * texture survives only as slivers in the frame and grout; the four yard
   * plates are the largest uninterrupted surfaces on the board, about a third
   * of it between them.
   *
   * It was a scattered texture first, and that was the mistake: a field of
   * leaves at random angles is what a generator makes, not what a garden looks
   * like. A parterre, a guilloché medallion, a constellation — placed, and one
   * per yard — reads as designed where the same ink scattered reads as dirt.
   */
  emblem?: { kind: EmblemKind; color: string; alpha: number };
  /**
   * Ornament running around the plate inside its rim — a Greek key, a rope, a
   * run of pearls, a laurel, a deco zigzag.
   *
   * This is the single highest-value thing on a premium board. Nothing covers
   * the frame, so it is the one ornament guaranteed to be seen, and a worked
   * edge is what the eye reads as "made" rather than "tinted".
   */
  band?: {
    kind: BandKind;
    color: string;
    alpha: number;
    /**
     * The same ornament where it runs around a YARD tile rather than the plate.
     * Omitted, the rim colour is reused.
     *
     * Gilded Royal is why this exists: its rim ornament is the plate's own
     * shadow tone, because a key cut into gold is an absence of metal. The same
     * dark tone on a red or blue enamel yard is not engraving, it is a smudge —
     * ornament laid ON another material is applied, and applied metal is light.
     */
    yardColor?: string;
  };
  /**
   * Corner-darkening strength, 0..1. A flat plate photographs like a swatch;
   * a plate that falls off toward its corners reads as an object with a light
   * over it. Cheap (one radial) and it does more for perceived depth than any
   * amount of extra color.
   */
  vignette?: number;
  /**
   * A medallion struck over the centre finishing square (render/faceMotifs.ts).
   * Reserved for the top of each ladder: ornament is what a board has left to
   * offer once material has been spent, exactly as it is on the dice tier.
   *
   * `scale` is the medallion's radius in cells (the centre square is three
   * cells across, so 1.15 fills it without touching the seams).
   */
  crest?: { kind: MotifKind; color: string; alpha: number; scale: number };
}

// Declared cheap → prestige within each currency: the shop and the locker
// render this order (lib/cosmetics.ts), and the coin ladder comes before the
// gem ladder because they are separate scales, not one continuous one.
export const BOARD_THEMES: Record<BoardThemeId, BoardTheme> = {
  // The bright Ludo Club–style board. Values are the original Board.tsx/Dice.tsx
  // literals — do not restyle this theme.
  classic: {
    id: "classic",
    label: "Classic",
    price: 0,
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
    price: 600,
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
    price: 600,
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
    price: 600,
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

  // --- The premium coin ladder (0061) -------------------------------------
  // 3,000 / 12,000 / 40,000 / 100,000, the same shape as the avatar ladder in
  // 0059, and for the same reason: the board shelf stopped at 600 coins while
  // dice climbed to 75,000, so the player with the deepest wallet had nothing
  // left to want on the surface they stare at for the whole match.
  //
  // Four places, not four palettes. A garden in daylight, ink and blossom,
  // black stone and brass, and gold — each with its own material, its own
  // marking and its own light. Eight tints of one idea is the tier players
  // stop believing in (0059's note), so no two of these share a family.

  // A topiary court seen from above: box hedge, limestone path, brass rail.
  // Matte on purpose — stone in daylight has no gloss, and adding some is what
  // makes a "premium" board look like a phone case.
  garden: {
    id: "garden",
    label: "Verdant Garden",
    price: 3000,
    boardBase: "#31513A",
    plate: { colors: ["#3C6046", "#2C4835", "#213526"], positions: [0, 0.55, 1], angle: "diagonal" },
    boardEdge: "#9C8047",
    lip: "rgba(255,246,220,0.34)",
    cellFill: "#F3EFE2",
    cellTop: "#FCFAF2",
    slotEmpty: "#CDC7B4",
    cellBorder: "#DAD2BD",
    starColor: "#79916A",
    glyph: "leaf",
    // Cut flagstones, softened at the corners. No tone jitter: a garden path
    // is swept, and speckling 52 cells is how a board starts looking dirty.
    cellRadius: 0.06,
    sheen: 0.03,
    // A formal garden: four planted beds, a laurel rail, and nothing else.
    emblem: { kind: "rose", color: "#7C9A6E", alpha: 0.75 },
    // Round beds cut into the hedge, with a leaf at each corner of the plot.
    yardStyle: "disc",
    yardPlate: "#2F4B37",
    band: { kind: "laurel", color: "#C7A867", alpha: 0.8 },
    vignette: 0.2,
    // Flowerbed tones: the four seats stay unmistakably red/green/yellow/blue —
    // a seat colour is identity, not decoration, and no board may blur it — but
    // each is pulled toward something that grows.
    team: { red: "#C4514C", green: "#3E9C63", yellow: "#DFAE3E", blue: "#4767C6" },
    dice: { face: "#F3EFE2", pip: "#2C4835" },
    pawnStroke: "rgba(0,0,0,0.34)",
  },
  // Ink-wash aubergine under rice paper, with a blossom on every safe square.
  // The one board in the catalog built on a warm dark neutral rather than on a
  // hue, which is why it sits beside the garden without arguing with it.
  blossom: {
    id: "blossom",
    label: "Blossom Ink",
    price: 12000,
    boardBase: "#4A3044",
    // Plum, not charcoal. The first pass sat at #382B37 and the board came out
    // reading as Night with pink specks — a dark neutral plate is a dark
    // neutral plate whatever hue you name it. Chroma is what makes ink read as
    // ink, and it costs nothing at this value.
    plate: { colors: ["#5C3B54", "#452C40", "#2E1D2B"], positions: [0, 0.55, 1], angle: "diagonal" },
    boardEdge: "#B4838F",
    lip: "rgba(255,236,241,0.32)",
    // Rice paper, and a grid ruled in the plate's own plum rather than in grey:
    // the cells are 52 of the largest surfaces on the board, so leaving them at
    // classic white is what keeps a themed board looking like a reskin.
    cellFill: "#F5EADF",
    cellTop: "#FDF6EE",
    slotEmpty: "#D5C4BA",
    cellBorder: "#DFC9CE",
    starColor: "#C77F90",
    glyph: "blossom",
    cellRadius: 0.14,
    sheen: 0.04,
    // Brocade under the ink, beaded at the edge.
    emblem: { kind: "lattice", color: "#BE8496", alpha: 0.8 },
    band: { kind: "pearls", color: "#E7C3CB", alpha: 0.85 },
    vignette: 0.18,
    team: { red: "#CF5763", green: "#48A06A", yellow: "#E0B24A", blue: "#4C63BE" },
    dice: { face: "#F7F1EC", pip: "#3A2C38" },
    pawnStroke: "rgba(0,0,0,0.36)",
  },
  // Black stone and brass: graphite tiles, brass rail, brass lip, brass mark.
  // The only premium board with dark cells — the pawns are the brightest thing
  // on it by a wide margin, which is exactly the drama the tier is paying for.
  onyx: {
    id: "onyx",
    label: "Onyx & Brass",
    price: 40000,
    boardBase: "#1A1B20",
    plate: { colors: ["#282A31", "#191A1F", "#0F1015"], positions: [0, 0.5, 1], angle: "diagonal" },
    boardEdge: "#B08A3C",
    lip: "rgba(240,214,150,0.30)",
    cellFill: "#2E3038",
    cellTop: "#3B3E48",
    // Lifted well clear of the tile: on a dark board an empty yard slot at the
    // tile's own value is not a recess, it is a hole you cannot see.
    slotEmpty: "#4E525E",
    cellBorder: "#4A4433",
    starColor: "#C9A24A",
    glyph: "lozenge",
    // Sawn plate: square corners, and a whisper of stone-to-stone variation —
    // the only board that keeps any, because sawn stone is the one material
    // that genuinely varies tile to tile.
    cellRadius: 0.02,
    cellVariance: 0.03,
    yardStyle: "ring",
    yardPlate: "#20222A",
    sheen: 0.05,
    // Black stone, brass inlaid: a trellis on each plate, a key around the rim.
    emblem: { kind: "lattice", color: "#B08A3C", alpha: 0.75 },
    band: { kind: "meander", color: "#C9A24A", alpha: 0.85 },
    vignette: 0.3,
    // Lifted a step in luminance against the dark tiles; a seat colour that
    // reads on white does not automatically read on graphite.
    team: { red: "#D6524E", green: "#33AE72", yellow: "#E4B93E", blue: "#5273DD" },
    dice: { face: "#282A31", pip: "#E5C979" },
    pawnStroke: "rgba(0,0,0,0.5)",
    crest: { kind: "deco", color: "#C9A24A", alpha: 0.5, scale: 1.15 },
  },
  // The gold board. Struck metal plate, ivory field, fleur-de-lis marks, a
  // rosette medallion at the centre.
  //
  // The trap in a gold board is the yellow seat, which sits on the same hue as
  // the plate. So the plate's midtone is deliberately deeper and browner than
  // the marigold yard that sits on it, and the yard keeps its lit lip — value
  // separation, not hue separation, because hue is the one thing a seat colour
  // is not allowed to trade away.
  gilded: {
    id: "gilded",
    label: "Gilded Royal",
    price: 100000,
    boardBase: "#C09A3C",
    plate: { colors: ["#EBD69A", "#C09A3C", "#8A671F"], positions: [0, 0.5, 1], angle: "diagonal" },
    boardEdge: "#7E5F1E",
    lip: "rgba(255,244,205,0.62)",
    cellFill: "#FBF4E2",
    cellTop: "#FFFDF4",
    slotEmpty: "#DCCDA4",
    cellBorder: "#D8C388",
    starColor: "#B08A2E",
    glyph: "fleur",
    cellRadius: 0.02,
    // Gold with four jewelled settings, rather than four primaries in a gold
    // frame — see yardStyle. This is the board's whole argument at 100,000.
    yardStyle: "ring",
    yardPlate: "#B8912F",
    sheen: 0.09,
    // Polished, not brushed. The grain texture came off: real gold at this
    // scale is a clean sweep of light, and the striations only added noise.
    // What is left is an engine-turned medallion on each plate and a key cut
    // INTO the rim — the band is the plate's own shadow tone, because engraving
    // is an absence of metal, not a lighter metal laid on top.
    emblem: { kind: "medallion", color: "#8A671F", alpha: 0.5 },
    band: { kind: "meander", color: "#6E5116", alpha: 0.75 },
    vignette: 0.22,
    // Enamel jewels rather than the app-wide poster colors: on gold, saturated
    // primaries read as toy plastic, and the whole point of the top of the coin
    // ladder is that it does not.
    team: { red: "#B23B41", green: "#2A8A5E", yellow: "#EFC03A", blue: "#3457B8" },
    dice: { face: "#FBF4E2", pip: "#6E5116" },
    pawnStroke: "rgba(0,0,0,0.4)",
    // Ivory, not dark gold: struck in the plate's own shadow tone the medallion
    // vanished into the wedges and read as a smudge. Inlay reads by contrast
    // with what it is set into, and porcelain into gold is the real reference.
    crest: { kind: "rosette", color: "#FBF4E2", alpha: 0.5, scale: 1.15 },
  },

  // --- The gem ladder (0018 aurora, then 0061) -----------------------------
  // 250 / 260 / 420 / 600, continuing the gem line the dice and avatars use
  // rather than inventing a third scale, and topping out at the same 600 as
  // dice.sovereign — under the 750-gem pack, so the top of the line stays
  // reachable by a player who buys once.

  // Polar night — deep indigo plate, ice cells, cool-shifted team colors.
  // Premium but calibrated (no neon).
  aurora: {
    id: "aurora",
    label: "Aurora",
    price: 250,
    currency: "gems",
    boardBase: "#242A44",
    boardEdge: "#4A5478",
    cellFill: "#E9EEF6",
    slotEmpty: "#BFC9DA",
    cellBorder: "#1B2036",
    starColor: "#8FA0C4",
    team: { red: "#D9484F", green: "#2FA98C", yellow: "#D9B02E", blue: "#5B76E8" },
    dice: { face: "#2E3554", pip: "#BFE8DF" },
    pawnStroke: "rgba(0,0,0,0.45)",
  },
  // The same garden after dark: foliage gone blue-green, the path lit by
  // moonlight, weathered silver instead of brass. Deliberately a night GARDEN
  // and not a second Aurora — the plate keeps its green, the marks are leaves,
  // and the flagstones are warm grey where Aurora's are ice.
  moonlit: {
    id: "moonlit",
    label: "Moonlit Garden",
    price: 260,
    currency: "gems",
    boardBase: "#1F2E2B",
    plate: { colors: ["#2C4039", "#1E2E2A", "#141F1D"], positions: [0, 0.55, 1], angle: "diagonal" },
    boardEdge: "#8A9AA0",
    lip: "rgba(226,240,238,0.32)",
    cellFill: "#E2E8E4",
    cellTop: "#F2F6F3",
    slotEmpty: "#B9C2BD",
    cellBorder: "#C0C9C4",
    starColor: "#8DA79B",
    glyph: "leaf",
    cellRadius: 0.06,
    sheen: 0.04,
    // The same garden after dark: a wreath on each bed, silver at the rail.
    emblem: { kind: "wreath", color: "#8FA9A0", alpha: 0.7 },
    yardStyle: "disc",
    yardPlate: "#22332F",
    band: { kind: "laurel", color: "#B9C9C4", alpha: 0.7 },
    vignette: 0.24,
    team: { red: "#CE565A", green: "#37A874", yellow: "#DDB44B", blue: "#5477DA" },
    dice: { face: "#2C4039", pip: "#E2E8E4" },
    pawnStroke: "rgba(0,0,0,0.45)",
    crest: { kind: "rosette", color: "#C8D8CF", alpha: 0.3, scale: 1.15 },
  },
  // Oxblood lacquer with mother-of-pearl inlay and a gold rail. The highest
  // gloss in the catalog: lacquer is a flawless surface, so the sheen carries
  // it and nothing textures it (the same reasoning as dice.oxblood).
  nacre: {
    id: "nacre",
    label: "Lacquer & Nacre",
    price: 420,
    currency: "gems",
    boardBase: "#5A2028",
    plate: { colors: ["#6E2830", "#4E1B22", "#341116"], positions: [0, 0.55, 1], angle: "diagonal" },
    boardEdge: "#C79A5C",
    lip: "rgba(255,230,200,0.38)",
    cellFill: "#F6EFE6",
    cellTop: "#FFFBF5",
    slotEmpty: "#D8C6B6",
    cellBorder: "#DFCDBC",
    starColor: "#C2996A",
    glyph: "blossom",
    cellRadius: 0.12,
    yardStyle: "ring",
    yardPlate: "#5A2028",
    sheen: 0.1,
    // Pearl set into lacquer: concentric inlay rings, gold cord at the edge.
    emblem: { kind: "rings", color: "#C9A98C", alpha: 0.6 },
    band: { kind: "rope", color: "#E0B87A", alpha: 0.85 },
    vignette: 0.26,
    // The red seat has to survive a red board: it wins on value and chroma
    // (a bright vermilion against a dark oxblood), never on hue.
    team: { red: "#E05A50", green: "#2F9C77", yellow: "#E2B446", blue: "#4A66C8" },
    dice: { face: "#F6EFE6", pip: "#5A2028" },
    pawnStroke: "rgba(0,0,0,0.42)",
    crest: { kind: "guilloche", color: "#E8CFA2", alpha: 0.4, scale: 1.15 },
  },
  // Peacock enamel over gold: the plate runs teal to indigo across the
  // diagonal the way the feather does, champagne field, gold rail, a sunburst
  // struck into every safe square and a deco medallion at the centre. The top
  // of the gem ladder, and the one board that changes colour across its own
  // surface.
  peacock: {
    id: "peacock",
    label: "Peacock Enamel",
    price: 520,
    currency: "gems",
    boardBase: "#1B4A54",
    plate: { colors: ["#1F5A63", "#1A424E", "#231F45"], positions: [0, 0.5, 1], angle: "diagonal" },
    boardEdge: "#C9A44E",
    lip: "rgba(255,240,205,0.45)",
    cellFill: "#F4EFE3",
    cellTop: "#FDFAF1",
    slotEmpty: "#CFC8B6",
    cellBorder: "#D5CDB9",
    starColor: "#B99A54",
    glyph: "sunburst",
    cellRadius: 0.16,
    sheen: 0.08,
    // Enamel pooled into rings on each plate; deco zigzag in gold at the rail.
    emblem: { kind: "rings", color: "#4E9E97", alpha: 0.5 },
    // Enamel roundels, the way a peacock's feather ends in an eye.
    yardStyle: "disc",
    yardPlate: "#1B4A54",
    band: { kind: "chevron", color: "#C9A44E", alpha: 0.8 },
    vignette: 0.24,
    team: { red: "#D6564F", green: "#39B07E", yellow: "#E5BA47", blue: "#4F6FD8" },
    dice: { face: "#1F5A63", pip: "#F4EFE3" },
    pawnStroke: "rgba(0,0,0,0.45)",
    crest: { kind: "deco", color: "#D8B667", alpha: 0.5, scale: 1.15 },
  },
  // The top of the shelf: a night sky under glass.
  //
  // This is the board the tier is really selling, and it is the one that could
  // not have existed before render/boardArt.ts — a star field is a texture, and
  // no arrangement of six flat colors gets you one. Moon-white cells float on
  // it, the rail is an astronomer's rule in gold, and the safe squares are
  // struck with the same sunburst as the sparkles in the sky.
  celestial: {
    id: "celestial",
    label: "Celestial Court",
    price: 600,
    currency: "gems",
    boardBase: "#0E1230",
    plate: { colors: ["#1E2758", "#101538", "#06091B"], positions: [0, 0.5, 1], angle: "diagonal" },
    boardEdge: "#C9A44E",
    lip: "rgba(255,244,205,0.42)",
    // The only board in the catalog whose TRACK is dark. Every other board,
    // premium or not, lays a pale grid over its plate, and that grid is most of
    // what a player sees — which is why boards that share nothing else still
    // read as the same object. Here the track is sky too, so the whole surface
    // is one night rather than a night-coloured frame around a white cross.
    cellFill: "#1C2249",
    cellTop: "#272E5E",
    slotEmpty: "#39406E",
    cellBorder: "#3B4279",
    starColor: "#D8B667",
    glyph: "sunburst",
    cellRadius: 0.05,
    yardPlate: "#141A3E",
    sheen: 0.06,
    // The one board that keeps a scattered texture, because a sky is the one
    // subject where scatter IS the composition — and it is drawn on the plate,
    // where nothing else competes with it.
    texture: { kind: "starfield", color: "#FFFFFF", alpha: 0.8 },
    // On the plates, the sky is charted instead: seven stars and the lines
    // between them, the way an atlas draws it.
    emblem: { kind: "constellation", color: "#BFC8FF", alpha: 0.75 },
    // Four charted orbs on the night plate.
    yardStyle: "disc",
    band: { kind: "rays", color: "#D8B667", alpha: 0.85 },
    // Deeper than any other board: space has no fill light, and the fall-off is
    // most of what sells the plate as depth rather than as dark paint.
    vignette: 0.38,
    team: { red: "#E05A5F", green: "#35B183", yellow: "#E9C24C", blue: "#5B7FEA" },
    dice: { face: "#1E2758", pip: "#EDEBF6" },
    pawnStroke: "rgba(0,0,0,0.5)",
    crest: { kind: "deco", color: "#E7CE93", alpha: 0.55, scale: 1.15 },
  },
};

export const DEFAULT_THEME = BOARD_THEMES.classic;

const BOARD_THEME_LIST = Object.values(BOARD_THEMES);

/**
 * Unknown/missing ids resolve to classic rather than crashing — the same rule
 * resolveDiceSkin applies, and for a sharper reason here: the equipped board id
 * is persisted locally, so a build that no longer knows an id (a staged store
 * rollback, a downgrade) would otherwise read `.boardBase` off undefined and
 * take the whole game screen down. Looked up by value over the list rather than
 * by bracket index, so a stored "__proto__" resolves to classic too.
 */
export function resolveBoardTheme(id: string | null | undefined): BoardTheme {
  if (!id) return DEFAULT_THEME;
  return BOARD_THEME_LIST.find((t) => t.id === id) ?? DEFAULT_THEME;
}
