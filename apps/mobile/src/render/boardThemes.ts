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
import type { BandKind, DecorItem, EmblemKind, TextureKind } from "./boardArt";
import type { BoardGlyph } from "./boardGlyphs";
import { palette, teamColor } from "../theme";

export type BoardThemeId =
  | "classic"
  | "night"
  | "walnut"
  | "sand"
  | "garden"
  | "blossom"
  | "carbon"
  | "onyx"
  | "celadon"
  | "riverstone"
  | "voyager"
  | "gilded"
  | "aurora"
  | "moonlit"
  | "titanium"
  | "nacre"
  | "herbarium"
  | "urushi"
  | "amber"
  | "peacock"
  | "celestial"
  | "glacier";

/**
 * The base plate's wash. Omitted, the plate takes the derived light-to-dark
 * gradient every board has always had (shade(base, ±)); given, the theme paints
 * it itself, which is the difference between a colored plate and a material —
 * a metal needs three stops and a raking angle, a hedge needs two and no shine.
 */
export interface PlateWash {
  colors: string[];
  positions?: number[];
  /**
   * Vertical (a lit table), diagonal (a raking light across metal), or radial
   * (a light source standing over the board). Poured and cast materials —
   * resin, glass, glaze — read as radial and as nothing else: their brightest
   * point is a place on the surface, not an edge of it.
   */
  angle?: "vertical" | "diagonal" | "radial";
  /** Radial only: the light's centre, as a fraction of the board. Default
   *  [0.3, 0.1] — over the shoulder, which is where a table lamp is. */
  center?: [number, number];
  /** Radial only: the light's reach, as a fraction of the board. Default 1.2. */
  radius?: number;
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

  // --- Material treatments. Same contract as everything above: each one is
  // optional, and each one defaults to exactly what the board drew before it
  // existed. ----------------------------------------------------------------

  /**
   * A second wash laid over the plate. One gradient describes a colour; two
   * describe a material — resin poured over a dark bed, a lit face falling
   * away into an unlit one. The base carries the body and this carries the
   * light, so its colours usually end transparent.
   */
  plateTop?: PlateWash;
  /**
   * The surface the track sits on, when it differs from the plate.
   *
   * The plate rings the play area and shows between the cells as grout, and
   * that grid of grout lines is most of what a player reads as the board's
   * colour. A board whose frame is one material and whose deck is another — a
   * bronze rail around a brushed titanium deck — needs the two to be separate
   * things. Omitted, the plate shows through exactly as it always has.
   */
  interior?: PlateWash;
  /** Rim stroke thickness. Omitted = 2.5, the original moulded edge. */
  edgeWidth?: number;
  /**
   * Dash pattern for the rim, as [on, off] in points. A stitched edge is the
   * fastest way to say a board is not moulded: leather, canvas, a travel set
   * that rolls up. Omitted = a solid rim.
   */
  edgeDash?: [number, number];
  /**
   * The hairlines along a track cell's top and bottom edge. Omitted, they stay
   * the original white-over-shadow pair, which reads as moulded plastic — a
   * stone or metal deck wants a dimmer top line and a deeper bottom one.
   */
  emboss?: { top: string; bottom: string };
  /**
   * How far the seat colour is laid INTO the material, 0..1, on the four yard
   * plates, the home runs and the start cells. Omitted = 1, opaque, which is
   * how every board has drawn them.
   *
   * Under 1 the material shows through the seat colour, and that is the whole
   * difference between a colour printed on a board and a colour that is part
   * of one: a seat set into glass or into slate should be tinted stone, not a
   * sticker on stone. It deliberately never reaches the centre wedges or the
   * pawns — a seat has to stay identifiable at a glance, and those are where a
   * player actually looks to find their own.
   */
  plateTint?: number;
  /** The ring around an empty yard slot. Omitted = a tonal step off the seat. */
  slotRing?: string;
  /** The disc inside an empty yard slot. Omitted = derived from `slotEmpty`. */
  slotFill?: string;
  /**
   * Ornament placed by hand in the frame — a frond across a corner, moss in the
   * rail, a bubble caught in the resin (render/boardArt.ts's frameDecor).
   *
   * It stays OUT of the playing surface, which is the rule the whole tier is
   * built on: a token or a die landing on ornament makes both harder to read,
   * and the frame is the one part of the board nothing is ever placed on. That
   * is also why this is a list and not a generator — six things put where they
   * belong beat sixty scattered, and the earlier scattered pass is what proved
   * it.
   */
  decor?: DecorItem[];
  /**
   * The table this board is played on.
   *
   * A board is an object on a surface, and the surface has always been the
   * same one: a blue felt that was chosen to sit under the bright classic
   * plate. Under a black lacquer board or a slab of glass it stops being a
   * table and starts being a background the board is pasted onto — the boards
   * that read least well in play are exactly the ones furthest from that blue.
   *
   * `colors` runs top to bottom, `ink` is the woven game-glyph pattern and
   * `lamp` the pool of light the board sits in. Omitted, the felt is the
   * app's own, unchanged — so this is opt-in per board and the fourteen
   * screens that are not the game table never see it (they are chrome, and
   * chrome belongs to the app rather than to what you bought).
   */
  table?: { colors: string[]; positions?: number[]; ink: string; lamp: string };
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
    interior: { colors: ["#FDFDFB", "#E6E6E4"], angle: "diagonal" },
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
    plate: { colors: ["#393E45", "#232830", "#1F232A"], positions: [0, 0.55, 1], angle: "diagonal" },
    lip: "rgba(255,255,255,0.22)",
    cellTop: "#F7F4EC",
    cellRadius: 0.06,
    sheen: 0.04,
    vignette: 0.22,
    interior: { colors: ["#32373E", "#20242C"], angle: "diagonal" },
    texture: { kind: "grain", color: "#FFFFFF", alpha: 0.08 },
    table: { colors: ["#22262E", "#161A20", "#0D0F13"], positions: [0, 0.52, 1], ink: "rgba(220,230,245,0.05)", lamp: "rgba(230,240,255,0.05)" },
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
    plate: { colors: ["#977757", "#8B6844", "#7A5C3C"], positions: [0, 0.55, 1], angle: "diagonal" },
    lip: "rgba(255,225,180,0.3)",
    cellTop: "#FBF4E6",
    cellRadius: 0.07,
    sheen: 0.05,
    vignette: 0.22,
    interior: { colors: ["#937351", "#7E5F3E"], angle: "diagonal" },
    texture: { kind: "grain", color: "#2A1608", alpha: 0.22 },
    table: { colors: ["#3A2A1E", "#241A12", "#14100B"], positions: [0, 0.52, 1], ink: "rgba(255,235,205,0.05)", lamp: "rgba(255,240,210,0.055)" },
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
    plate: { colors: ["#F2EBE0", "#F0E9DC", "#D3CDC2"], positions: [0, 0.55, 1], angle: "diagonal" },
    lip: "rgba(255,255,255,0.6)",
    cellTop: "#FFFCF4",
    cellRadius: 0.08,
    sheen: 0.04,
    vignette: 0.14,
    interior: { colors: ["#F1EBDE", "#DAD4C8"], angle: "diagonal" },
    texture: { kind: "veins", color: "#9A8E74", alpha: 0.12 },
    table: { colors: ["#3E3A32", "#292620", "#171512"], positions: [0, 0.52, 1], ink: "rgba(255,248,230,0.05)", lamp: "rgba(255,250,235,0.055)" },
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
    interior: { colors: ["#3F5D48", "#2D4A35"], angle: "diagonal" },
    texture: { kind: "foliage", color: "#8FAE7E", alpha: 0.45 },
    table: { colors: ["#26382A", "#182619", "#0D150E"], positions: [0, 0.52, 1], ink: "rgba(225,245,220,0.05)", lamp: "rgba(235,255,230,0.055)" },
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
    interior: { colors: ["#573E51", "#432C3E"], angle: "diagonal" },
    texture: { kind: "damask", color: "#D9A9B6", alpha: 0.35 },
    table: { colors: ["#33242C", "#20161C", "#120C10"], positions: [0, 0.52, 1], ink: "rgba(255,230,240,0.05)", lamp: "rgba(255,235,245,0.055)" },
  },
  // Black stone and brass: graphite tiles, brass rail, brass lip, brass mark.
  // The only premium board with dark cells — the pawns are the brightest thing
  // on it by a wide margin, which is exactly the drama the tier is paying for.
  /**
   * Twill carbon under clear coat, with a lime tracer.
   *
   * The weave is the `twill` material, and it is honest about being an
   * approximation: a real 2x2 at board size is a few pixels across, so what is
   * drawn is what the eye reads at that scale — light running two ways over the
   * surface. Seats sit at 0.7 so the weave carries through them, which is what
   * makes them read as laid UNDER the clear coat rather than painted on it.
   */
  carbon: {
    id: "carbon",
    label: "Carbon Monocoque",
    price: 30000,
    boardBase: "#0B0C0E",
    plate: { colors: ["#16181B", "#0B0C0E"], angle: "diagonal" },
    boardEdge: "rgba(155,232,60,0.45)",
    edgeWidth: 2,
    lip: "rgba(255,255,255,0.14)",
    interior: { colors: ["#1C1F23", "#121417"], angle: "diagonal" },
    texture: { kind: "twill", color: "#FFFFFF", alpha: 0.3 },
    cellFill: "#1A1D21",
    cellTop: "#2A2E34",
    cellBorder: "rgba(155,232,60,0.22)",
    emboss: { top: "rgba(255,255,255,0.12)", bottom: "rgba(0,0,0,0.5)" },
    cellRadius: 0.06,
    plateTint: 0.7,
    slotEmpty: "#14161A",
    slotRing: "rgba(255,255,255,0.35)",
    slotFill: "#2E3238",
    starColor: "#9BE83C",
    glyph: "star",
    sheen: 0.05,
    vignette: 0.3,
    team: { red: "#FF4D5E", green: "#9BE83C", yellow: "#FFC13C", blue: "#3FA6FF" },
    dice: { face: "#25292E", pip: "#9BE83C" },
    pawnStroke: "rgba(0,0,0,0.55)",
    table: { colors: ["#1A1D20", "#111315", "#08090A"], positions: [0, 0.52, 1], ink: "rgba(155,232,60,0.05)", lamp: "rgba(200,255,150,0.04)" },
  },
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
    interior: { colors: ["#2A2B30", "#18191D"], angle: "diagonal" },
    texture: { kind: "grain", color: "#C9A24A", alpha: 0.12 },
    emboss: { top: "rgba(255,255,255,0.14)", bottom: "rgba(0,0,0,0.5)" },
    table: { colors: ["#1E2028", "#141519", "#0A0B0D"], positions: [0, 0.52, 1], ink: "rgba(201,162,74,0.05)", lamp: "rgba(255,230,170,0.05)" },
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
  /**
   * Slate out of a streambed, with moss in the joints.
   *
   * The first board to use placed ornament (render/boardArt.ts's frameDecor):
   * moss does not grow evenly over a stone, it grows where water sits, so the
   * six clumps are put along the rail and in the corners and nowhere near the
   * track. Seats sit at 0.82 so they read as wet stone taking a colour rather
   * than as paint on stone.
   */
  /**
   * Pale celadon glaze with cobalt drawn under it.
   *
   * The crackle is the material: a glaze that has aged has a net of hairlines
   * through it, and `veins` at a whisper is what that is — anything stronger
   * stops being a fired surface and becomes a cracked one. Cobalt is used as
   * the cell border rather than as ink on the surface, so the blue sits UNDER
   * the glaze the way underglaze actually does.
   */
  celadon: {
    id: "celadon",
    label: "Celadon Porcelain",
    price: 60000,
    boardBase: "#CFDCD4",
    plate: { colors: ["#EAF0E8", "#CFDCD4", "#E4ECE6"], positions: [0, 0.6, 1], angle: "diagonal" },
    boardEdge: "#9FB4AC",
    edgeWidth: 2,
    lip: "rgba(255,255,255,0.9)",
    interior: { colors: ["#F3F7F1", "#DCE7E0"], angle: "diagonal" },
    texture: { kind: "veins", color: "#6E8A84", alpha: 0.14 },
    cellFill: "#E3EDE6",
    cellTop: "#FBFDFA",
    cellBorder: "rgba(60,95,168,0.34)",
    emboss: { top: "rgba(255,255,255,0.7)", bottom: "rgba(120,150,140,0.22)" },
    cellRadius: 0.1,
    plateTint: 0.9,
    slotEmpty: "#DAE6E0",
    slotRing: "rgba(60,95,168,0.55)",
    slotFill: "#E8F0EA",
    starColor: "#5A7FA8",
    glyph: "star",
    sheen: 0.06,
    vignette: 0.16,
    // The design's glaze colours ran 76 apart for red against yellow and 81 for
    // green against blue. Lifted clear of 90 without leaving the palette a
    // glazed pot could hold.
    team: { red: "#C24E48", green: "#4FA57A", yellow: "#DBAE4A", blue: "#2F55AA" },
    dice: { face: "#FAFCF8", pip: "#27459A" },
    pawnStroke: "rgba(0,0,0,0.28)",
    table: { colors: ["#3B4A46", "#26312E", "#161D1B"], positions: [0, 0.52, 1], ink: "rgba(235,245,240,0.05)", lamp: "rgba(240,255,250,0.05)" },
  },
  riverstone: {
    id: "riverstone",
    label: "Moss & River Stone",
    price: 75000,
    boardBase: "#242A2C",
    plate: { colors: ["#4A5356", "#242A2C", "#333A3C"], positions: [0, 0.7, 1], angle: "radial", center: [0.25, 0.05], radius: 1.3 },
    boardEdge: "#6E7A6A",
    edgeWidth: 3,
    lip: "rgba(200,220,200,0.22)",
    interior: { colors: ["#3F4749", "#202628"], angle: "radial", center: [0.25, 0], radius: 1.2 },
    cellFill: "#394144",
    cellTop: "#596366",
    cellBorder: "rgba(12,16,16,0.7)",
    emboss: { top: "rgba(215,235,215,0.22)", bottom: "rgba(0,0,0,0.42)" },
    cellRadius: 0.08,
    plateTint: 0.82,
    slotEmpty: "#1C2122",
    slotRing: "rgba(196,216,190,0.5)",
    slotFill: "#6C7A6A",
    starColor: "#C4D8BE",
    glyph: "star",
    sheen: 0.04,
    vignette: 0.3,
    // The design's slate seats were 91 apart at best and 55 at worst; these
    // clear 90 on every pair while staying as drab as slate allows.
    team: { red: "#9E4238", green: "#4E9A5C", yellow: "#C29A3E", blue: "#2C4A86" },
    dice: { face: "#5A6260", pip: "#171B1A" },
    pawnStroke: "rgba(0,0,0,0.45)",
    table: { colors: ["#2E3A38", "#1C2524", "#101514"], positions: [0, 0.52, 1], ink: "rgba(220,240,220,0.05)", lamp: "rgba(230,255,230,0.05)" },
    decor: [
      { shape: "blob", x: -0.02, y: 0.26, w: 0.0889, h: 0.1867, rot: 12, fill: "rgba(126,170,84,1)", edge: "rgba(56,86,44,0.9)", a: 0.72 },
      { shape: "blob", x: 0.93, y: 0.08, w: 0.0844, h: 0.1467, rot: -18, fill: "rgba(140,182,96,1)", edge: "rgba(62,92,48,0.9)", a: 0.64 },
      { shape: "blob", x: 0.4, y: 0.92, w: 0.1956, h: 0.0756, rot: 6, fill: "rgba(112,158,78,1)", edge: "rgba(48,78,40,0.9)", a: 0.68 },
      { shape: "blob", x: 0.92, y: 0.62, w: 0.08, h: 0.1556, rot: 28, fill: "rgba(132,174,90,1)", edge: "rgba(56,86,44,0.85)", a: 0.6 },
      { shape: "blob", x: 0.18, y: -0.01, w: 0.1644, h: 0.0667, rot: -8, fill: "rgba(120,164,82,1)", edge: "rgba(52,82,42,0.85)", a: 0.62 },
      { shape: "blob", x: 0.66, y: -0.02, w: 0.1156, h: 0.0622, rot: 10, fill: "rgba(134,176,92,1)", edge: "rgba(58,88,46,0.85)", a: 0.5 },
      { shape: "fleck", x: 0.03, y: 0.78, w: 0.0111, h: 0.0111, rot: 0, fill: "rgba(226,242,216,0.9)", a: 0.6 },
      { shape: "fleck", x: 0.96, y: 0.3, w: 0.0089, h: 0.0089, rot: 0, fill: "rgba(226,242,216,0.9)", a: 0.55 },
    ],
  },
  /**
   * A roll-up travel board: tan saddle leather with a stitched rail.
   *
   * The only board with a broken rim, and the reason `edgeDash` exists. A
   * saddle stitch is the fastest way to say a board was sewn rather than
   * moulded, and every other board in the catalog is moulded.
   */
  voyager: {
    id: "voyager",
    label: "Voyager Travel Set",
    price: 90000,
    boardBase: "#6B4523",
    plate: { colors: ["#A2703F", "#6B4523", "#6B4523"], positions: [0, 0.75, 1], angle: "radial", center: [0.25, 0.05], radius: 1.2 },
    boardEdge: "rgba(247,228,193,0.55)",
    edgeWidth: 3,
    edgeDash: [7, 5],
    lip: "rgba(255,225,180,0.3)",
    interior: { colors: ["#B07C48", "#7A5129"], angle: "radial", center: [0.3, 0], radius: 1.1 },
    texture: { kind: "grain", color: "#3A2410", alpha: 0.2 },
    cellFill: "#9A6A38",
    cellTop: "#C08E58",
    cellBorder: "rgba(70,42,18,0.55)",
    emboss: { top: "rgba(255,220,170,0.28)", bottom: "rgba(60,35,12,0.45)" },
    cellRadius: 0.07,
    plateTint: 0.95,
    slotEmpty: "#78522A",
    slotRing: "rgba(240,210,150,0.65)",
    slotFill: "#B68A3C",
    starColor: "#F2DCA8",
    glyph: "star",
    sheen: 0.04,
    vignette: 0.24,
    // The design's tannery colours sat 84 apart for red against yellow and 50
    // for green against blue — the closest pair in the whole set.
    // The yellow is lighter than the design's: tan on tan, its own leather was
    // swallowing that corner.
    team: { red: "#A2382C", green: "#3A8C54", yellow: "#E8B95A", blue: "#2C3F86" },
    dice: { face: "#F6ECD8", pip: "#33200C" },
    pawnStroke: "rgba(0,0,0,0.45)",
    table: { colors: ["#4A3520", "#2E2114", "#18110A"], positions: [0, 0.52, 1], ink: "rgba(255,230,190,0.05)", lamp: "rgba(255,235,200,0.06)" },
  },
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
    interior: { colors: ["#C4A14A", "#AF8C37"], angle: "diagonal" },
    texture: { kind: "damask", color: "#6E5116", alpha: 0.3 },
    table: { colors: ["#2E2414", "#1E170D", "#100C06"], positions: [0, 0.52, 1], ink: "rgba(255,230,160,0.05)", lamp: "rgba(255,235,175,0.06)" },
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
    plate: { colors: ["#3A3F57", "#242A44", "#20253C"], positions: [0, 0.55, 1], angle: "diagonal" },
    lip: "rgba(200,225,255,0.3)",
    cellTop: "#F4F8FF",
    cellRadius: 0.1,
    sheen: 0.06,
    vignette: 0.26,
    interior: { colors: ["#333951", "#21263E"], angle: "diagonal" },
    texture: { kind: "starfield", color: "#BFD4FF", alpha: 0.3 },
    table: { colors: ["#1E2440", "#141A2E", "#0A0D18"], positions: [0, 0.52, 1], ink: "rgba(200,220,255,0.05)", lamp: "rgba(215,230,255,0.055)" },
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
    interior: { colors: ["#2F3D3A", "#1C2A27"], angle: "diagonal" },
    texture: { kind: "foliage", color: "#B9C9C4", alpha: 0.35 },
    table: { colors: ["#1E2E2C", "#14201E", "#0B1211"], positions: [0, 0.52, 1], ink: "rgba(220,240,235,0.05)", lamp: "rgba(230,250,245,0.055)" },
    crest: { kind: "rosette", color: "#C8D8CF", alpha: 0.3, scale: 1.15 },
  },
  // Oxblood lacquer with mother-of-pearl inlay and a gold rail. The highest
  // gloss in the catalog: lacquer is a flawless surface, so the sheen carries
  // it and nothing textures it (the same reasoning as dice.oxblood).
  /**
   * Machined from two metals: a brushed titanium deck inside a bronze rail.
   *
   * The first board in the catalog whose FRAME and DECK are different
   * materials, which is what `interior` exists for — everything before this
   * was one plate showing through the grout. The seats are laid in at 0.92 so
   * they read as anodised into the metal rather than painted on it, and the
   * cell hairlines drop the white top line every earlier board carried: white
   * over shadow is moulded plastic, and it is the single fastest way to make
   * metal look like a toy.
   */
  titanium: {
    id: "titanium",
    label: "Titanium & Bronze",
    price: 380,
    currency: "gems",
    boardBase: "#2A2D33",
    plate: { colors: ["#3A3D42", "#22252A", "#33363C"], positions: [0, 0.55, 1], angle: "diagonal" },
    boardEdge: "#8A6A3C",
    edgeWidth: 3,
    lip: "rgba(255,235,190,0.35)",
    interior: { colors: ["#4A4E55", "#2A2D33"], angle: "diagonal" },
    texture: { kind: "grain", color: "#FFFFFF", alpha: 0.24 },
    cellFill: "#3B3F46",
    cellTop: "#5A5F67",
    cellBorder: "rgba(20,22,26,0.8)",
    emboss: { top: "rgba(255,255,255,0.2)", bottom: "rgba(0,0,0,0.45)" },
    cellRadius: 0.04,
    plateTint: 0.92,
    slotEmpty: "#20232A",
    slotRing: "rgba(233,203,142,0.6)",
    slotFill: "#6E5637",
    starColor: "#E9CB8E",
    glyph: "star",
    sheen: 0.04,
    vignette: 0.28,
    band: { kind: "rope", color: "#C9A870", alpha: 0.7 },
    // Solid, not a ring. A ring yard leaves the seat as a band around the
    // board's own material, and on a deck this dark that reduced all four
    // corners to the same near-black square — the one thing a yard exists to
    // prevent. `plateTint` already sets the seat INTO the metal; the plate
    // does not also have to give it up.
    // Pulled off the design's own metals, which sat too close together to tell
    // apart: its red and yellow were 58 apart in RGB and its green and blue 51,
    // against the 90 every board has to clear. Muted is the look, but a player
    // finding their own tokens is not something the look gets to cost — so the
    // four are separated on the green channel and left as earthy as that
    // allows.
    team: { red: "#AE4230", green: "#3E9668", yellow: "#C99B36", blue: "#3F51A6" },
    dice: { face: "#5A5F67", pip: "#E9CB8E" },
    pawnStroke: "rgba(0,0,0,0.5)",
    table: { colors: ["#2A2E34", "#1A1D22", "#101214"], positions: [0, 0.52, 1], ink: "rgba(255,235,190,0.05)", lamp: "rgba(255,240,215,0.05)" },
  },
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
    interior: { colors: ["#663037", "#521D24"], angle: "diagonal" },
    texture: { kind: "veins", color: "#E0B87A", alpha: 0.3 },
    table: { colors: ["#331A1E", "#201013", "#12080A"], positions: [0, 0.52, 1], ink: "rgba(255,225,200,0.05)", lamp: "rgba(255,230,205,0.06)" },
    crest: { kind: "guilloche", color: "#E8CFA2", alpha: 0.4, scale: 1.15 },
  },
  // Peacock enamel over gold: the plate runs teal to indigo across the
  // diagonal the way the feather does, champagne field, gold rail, a sunburst
  // struck into every safe square and a deco medallion at the centre. The top
  // of the gem ladder, and the one board that changes colour across its own
  // surface.
  /**
   * A herbarium sheet under glass: specimens pressed flat on foxed cotton rag.
   *
   * The brightest board in the material tier, and the one that most needed the
   * playfield kept clear — pressed botanicals over a track would be unreadable
   * twice over. Everything sits in the frame, which is exactly what a specimen
   * sheet looks like: the plant laid out, the margin annotated.
   */
  herbarium: {
    id: "herbarium",
    label: "Pressed Herbarium",
    price: 440,
    currency: "gems",
    boardBase: "#E2D4B6",
    plate: { colors: ["#F6EEDB", "#E2D4B6", "#CFBE99"], positions: [0, 0.7, 1], angle: "radial", center: [0.2, 0], radius: 1.3 },
    boardEdge: "#9C8A63",
    edgeWidth: 3,
    lip: "rgba(255,255,255,0.6)",
    interior: { colors: ["#FBF5E6", "#E8DCC1"], angle: "radial", center: [0.3, 0.1], radius: 1.2 },
    cellFill: "#EFE4CB",
    cellTop: "#FDF9EE",
    cellBorder: "rgba(70,60,35,0.4)",
    emboss: { top: "rgba(255,255,255,0.5)", bottom: "rgba(150,130,90,0.18)" },
    cellRadius: 0.08,
    plateTint: 0.82,
    slotEmpty: "#CDC7B4",
    slotRing: "rgba(70,60,35,0.45)",
    slotFill: "#DCCDA8",
    starColor: "#8A7A4E",
    glyph: "star",
    sheen: 0.03,
    vignette: 0.18,
    // Iron-gall inks read close together; the design's came in at 72 for red
    // against yellow and 87 for green against blue. Separated on the green
    // channel, which keeps the herbarium palette and loses none of the seats.
    team: { red: "#B54A35", green: "#5E7A3C", yellow: "#D2A63C", blue: "#3A5A9A" },
    dice: { face: "#FBF4E3", pip: "#43602C" },
    pawnStroke: "rgba(0,0,0,0.3)",
    table: { colors: ["#4A4436", "#302C22", "#1A1813"], positions: [0, 0.52, 1], ink: "rgba(255,245,220,0.05)", lamp: "rgba(255,248,225,0.06)" },
    decor: [
      { shape: "leaf", x: 0.01, y: 0.01, w: 0.2133, h: 0.0667, rot: 8, fill: "rgba(94,122,60,1)", edge: "rgba(52,76,32,0.9)", a: 0.72 },
      { shape: "leaf", x: 0.58, y: -0.01, w: 0.2311, h: 0.0622, rot: -6, fill: "rgba(120,140,72,1)", edge: "rgba(62,86,38,0.9)", a: 0.66 },
      { shape: "leaf", x: -0.02, y: 0.88, w: 0.2489, h: 0.0667, rot: -6, fill: "rgba(84,110,56,1)", edge: "rgba(44,66,28,0.9)", a: 0.64 },
      { shape: "leaf", x: 0.64, y: 0.92, w: 0.2178, h: 0.0622, rot: 6, fill: "rgba(110,132,66,1)", edge: "rgba(56,80,34,0.9)", a: 0.6 },
      { shape: "leaf", x: -0.04, y: 0.34, w: 0.0667, h: 0.2133, rot: 6, fill: "rgba(104,128,64,1)", edge: "rgba(52,76,32,0.9)", a: 0.6 },
      { shape: "leaf", x: 0.94, y: 0.4, w: 0.0622, h: 0.2311, rot: -6, fill: "rgba(96,120,58,1)", edge: "rgba(48,70,30,0.9)", a: 0.58 },
      { shape: "petal", x: 0.36, y: 0.0, w: 0.08, h: 0.0667, rot: 14, fill: "rgba(214,150,160,1)", edge: "rgba(158,86,104,0.9)", a: 0.66 },
      { shape: "petal", x: 0.5, y: 0.94, w: 0.0756, h: 0.0667, rot: -22, fill: "rgba(226,180,120,1)", edge: "rgba(168,116,60,0.9)", a: 0.62 },
      { shape: "petal", x: 0.0, y: 0.62, w: 0.0667, h: 0.0622, rot: 40, fill: "rgba(206,158,176,1)", edge: "rgba(142,88,108,0.85)", a: 0.54 },
      { shape: "petal", x: 0.95, y: 0.16, w: 0.0622, h: 0.0578, rot: -30, fill: "rgba(214,150,160,1)", edge: "rgba(150,84,102,0.85)", a: 0.5 },
    ],
  },
  /**
   * Resin poured over a dark walnut bed, with a frond and a scatter of bubbles
   * caught in it.
   *
   * The one board whose cells are brighter than its plate: light travels
   * through the body of a slab of amber, so the track glows from underneath
   * rather than being printed on top. That inverts the usual contrast, which
   * is why the safe stars are cut dark here — a white star on lit resin is the
   * one marking that would disappear.
   */
  /**
   * Twenty coats of black lacquer, with gold dust drifted across it.
   *
   * The only board in the catalog whose seats are laid in at full strength —
   * `plateTint` stays 1 here on purpose. Vermilion on black is the whole point
   * of urushi, and tinting it into the ground would turn the one high-contrast
   * material in the tier into another muted one.
   *
   * The gold is a starfield at low alpha, which is nearer to maki-e than it
   * sounds: hand-scattered dust is uneven, mostly fine, with the occasional
   * larger flake catching the light. It survives in the grout between cells,
   * which is where a lacquered ground shows anyway.
   */
  urushi: {
    id: "urushi",
    label: "Urushi Vermilion",
    price: 480,
    currency: "gems",
    boardBase: "#0C0705",
    // The design holds the ground colour from 70% outwards, so the far stop is
    // repeated rather than left to run — a wash has to end at 1.
    plate: { colors: ["#241712", "#0C0705", "#0C0705"], positions: [0, 0.7, 1], angle: "radial", center: [0.3, 0.1], radius: 1.2 },
    boardEdge: "#C9973F",
    edgeWidth: 2,
    lip: "rgba(255,220,170,0.3)",
    interior: { colors: ["#1B100C", "#0B0605"], angle: "radial", center: [0.2, 0], radius: 1.1 },
    texture: { kind: "starfield", color: "#E8C57A", alpha: 0.5 },
    cellFill: "#140B08",
    cellTop: "#1E120D",
    cellBorder: "rgba(201,151,63,0.42)",
    emboss: { top: "rgba(255,220,160,0.14)", bottom: "rgba(0,0,0,0.5)" },
    cellRadius: 0.09,
    slotEmpty: "#160C08",
    slotRing: "rgba(201,151,63,0.8)",
    slotFill: "#8A6A2E",
    starColor: "#D8B366",
    glyph: "star",
    sheen: 0.1,
    vignette: 0.3,
    band: { kind: "meander", color: "#C9973F", alpha: 0.8 },
    // Only the green moved: against the design's blue it sat 69 apart, under
    // the 90 a seat has to clear. The vermilion and the gold are the design's.
    team: { red: "#D9412C", green: "#2F9A62", yellow: "#E0A92B", blue: "#2A4694" },
    dice: { face: "#1C100B", pip: "#C9973F" },
    pawnStroke: "rgba(0,0,0,0.55)",
    table: { colors: ["#2A1A14", "#170D09", "#0A0605"], positions: [0, 0.52, 1], ink: "rgba(255,220,160,0.05)", lamp: "rgba(255,225,170,0.06)" },
  },
  amber: {
    id: "amber",
    label: "Amber Inclusion",
    price: 500,
    currency: "gems",
    boardBase: "#221206",
    plate: { colors: ["#3A2009", "#150A03"], angle: "diagonal" },
    plateTop: { colors: ["#4A2B10", "rgba(34,18,6,0.55)"], angle: "radial", center: [0.28, 0.04], radius: 1.3 },
    boardEdge: "#C98A34",
    edgeWidth: 3,
    lip: "rgba(255,214,140,0.35)",
    interior: { colors: ["#6B3F12", "#2A1607"], angle: "radial", center: [0.3, 0], radius: 1.2 },
    // Pulled back from the design's near-yellow resin. Lit amber at full
    // strength is the same hue as the yellow seat, and a yard that matches the
    // board it sits on stops being a yard — on the device the whole
    // bottom-right corner simply disappeared. Darker and browner keeps the lit
    // slab and gives all four seats something to read against.
    cellFill: "#A55F19",
    cellTop: "#E9A94E",
    cellBorder: "rgba(90,48,12,0.7)",
    emboss: { top: "rgba(255,236,190,0.55)", bottom: "rgba(120,62,12,0.5)" },
    cellRadius: 0.1,
    plateTint: 0.88,
    slotEmpty: "#3A200A",
    slotRing: "rgba(255,214,140,0.6)",
    slotFill: "#C9863A",
    starColor: "#5A3208",
    glyph: "star",
    sheen: 0.08,
    vignette: 0.26,
    // The design's yellow was amber on amber: its own board swallowed it, and
    // cooling the cells was not enough on the device. A pale gold is the one
    // yellow that survives a warm board, and it clears the seat rule against
    // the other three by a wide margin.
    team: { red: "#C8503A", green: "#6E8E3A", yellow: "#F5D25A", blue: "#4A6C90" },
    dice: { face: "#FFCE6E", pip: "#2E1804" },
    pawnStroke: "rgba(0,0,0,0.5)",
    table: { colors: ["#3A2410", "#24160A", "#140C05"], positions: [0, 0.52, 1], ink: "rgba(255,220,150,0.05)", lamp: "rgba(255,225,160,0.06)" },
    decor: [
      { shape: "leaf", x: 0.02, y: 0.04, w: 0.2444, h: 0.0667, rot: 6, fill: "rgba(96,74,26,1)", edge: "rgba(52,36,10,0.9)", a: 0.7 },
      { shape: "leaf", x: 0.6, y: 0.93, w: 0.2222, h: 0.0622, rot: -6, fill: "rgba(110,84,30,1)", edge: "rgba(58,40,12,0.9)", a: 0.62 },
      { shape: "leaf", x: -0.03, y: 0.52, w: 0.0622, h: 0.2133, rot: 4, fill: "rgba(104,80,28,1)", edge: "rgba(54,38,12,0.9)", a: 0.58 },
      { shape: "fleck", x: 0.28, y: 0.01, w: 0.0156, h: 0.0156, rot: 0, fill: "rgba(255,236,180,0.95)", a: 0.75 },
      { shape: "fleck", x: 0.72, y: 0.02, w: 0.0111, h: 0.0111, rot: 0, fill: "rgba(255,236,180,0.95)", a: 0.7 },
      { shape: "fleck", x: 0.02, y: 0.3, w: 0.0133, h: 0.0133, rot: 0, fill: "rgba(255,236,180,0.95)", a: 0.7 },
      { shape: "fleck", x: 0.96, y: 0.46, w: 0.0111, h: 0.0111, rot: 0, fill: "rgba(255,236,180,0.95)", a: 0.65 },
      { shape: "fleck", x: 0.95, y: 0.84, w: 0.0089, h: 0.0089, rot: 0, fill: "rgba(255,246,210,1)", a: 0.7 },
      { shape: "fleck", x: 0.4, y: 0.96, w: 0.0133, h: 0.0133, rot: 0, fill: "rgba(255,236,180,0.95)", a: 0.65 },
    ],
  },
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
    interior: { colors: ["#2B5760", "#19434C"], angle: "diagonal" },
    texture: { kind: "ripple", color: "#C9A44E", alpha: 0.3 },
    table: { colors: ["#14343A", "#0D2228", "#061316"], positions: [0, 0.52, 1], ink: "rgba(200,240,245,0.05)", lamp: "rgba(215,250,255,0.055)" },
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
    interior: { colors: ["#1F233E", "#0D102C"], angle: "diagonal" },
    emboss: { top: "rgba(190,205,255,0.16)", bottom: "rgba(0,0,0,0.5)" },
    table: { colors: ["#151A3C", "#0D1028", "#060816"], positions: [0, 0.52, 1], ink: "rgba(215,225,255,0.05)", lamp: "rgba(230,235,255,0.06)" },
    crest: { kind: "deco", color: "#E7CE93", alpha: 0.55, scale: 1.15 },
  },
  /**
   * A slab of cast glass over a dark deck. The flagship, and the only board
   * that is mostly not there.
   *
   * Everything on the playing surface is white at 3-13% over the deck, and
   * `plateTint` drops to 0.46 — the lowest in the catalog by a wide margin —
   * so the seats are glass that has been tinted rather than glass with colour
   * sitting on it. That is the whole material, and it is also why the safe
   * stars are cut in pale blue rather than white: white on white glass is the
   * one marking that would vanish.
   */
  glacier: {
    id: "glacier",
    label: "Glacier Optic",
    price: 620,
    currency: "gems",
    boardBase: "#0A0E1E",
    plate: { colors: ["#141B33", "#0A0E1E", "#131A30"], positions: [0, 0.6, 1], angle: "diagonal" },
    boardEdge: "rgba(180,215,255,0.34)",
    edgeWidth: 1.5,
    lip: "rgba(255,255,255,0.28)",
    interior: { colors: ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.01)", "rgba(140,190,255,0.07)"], positions: [0, 0.45, 1], angle: "diagonal" },
    cellFill: "rgba(255,255,255,0.03)",
    cellTop: "rgba(255,255,255,0.13)",
    cellBorder: "rgba(190,220,255,0.3)",
    emboss: { top: "rgba(255,255,255,0.35)", bottom: "rgba(10,20,40,0.35)" },
    cellRadius: 0.14,
    // The design's 0.46 was measured against a pale deck; over this one the
    // seats went to smoke on the device. 0.6 is still the lowest in the
    // catalog by a distance, and still unmistakably tinted glass.
    plateTint: 0.6,
    slotEmpty: "#1B2440",
    slotRing: "rgba(255,255,255,0.55)",
    slotFill: "#2A3A60",
    starColor: "#BEDCFF",
    glyph: "star",
    sheen: 0.1,
    vignette: 0.34,
    team: { red: "#FF6B8A", green: "#5BE3B0", yellow: "#FFD36B", blue: "#6FB2FF" },
    dice: { face: "#E2F0FF", pip: "#5D8FD6" },
    pawnStroke: "rgba(0,0,0,0.45)",
    table: { colors: ["#16203A", "#0D1426", "#070A14"], positions: [0, 0.52, 1], ink: "rgba(200,225,255,0.05)", lamp: "rgba(210,235,255,0.06)" },
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
