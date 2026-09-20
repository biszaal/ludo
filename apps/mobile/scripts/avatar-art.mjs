/**
 * Avatar set v2 — what the thirty-three characters look like.
 *
 * This module is the source of truth for the art. It draws each avatar as an
 * SVG string in a 512x512 space; gen-avatars.mjs rasterizes that to the PNGs
 * the app ships. Nothing here touches the filesystem, so the tests can read the
 * catalog and render a face without regenerating anything.
 *
 * The shape of it. A character is a spec, not a drawing: a face shape, an eye
 * kit, a brow, a mouth, a skin tone, and either hair or a hat out of the
 * libraries below, plus optional `back`/`front` markup for whatever makes that
 * character itself. v1 drew each of its twenty-one faces as a bespoke op list
 * on one shared head, which is why they all looked like siblings — every face
 * was the same circle with different hair. Here the head itself varies (seven
 * face shapes), and so do the eyes (ten kits), brows and mouths, which is most
 * of why the set reads as a cast rather than a palette.
 *
 * Three things differ deliberately from the reference sheet this was drawn
 * from, and all three are the house rules winning over the sheet:
 *
 *  1. The chip is a quiet tinted paper, never a rarity colour. The sheet put
 *     the tier in the chip background — grey / pale blue / violet / gold. Two
 *     of those are seat colours (blue at 215deg, gold at 46deg, against the
 *     yellow seat's 46deg), worn on a player's face, on a board where the seat
 *     colour is the thing you must read. CHIP_TONES below is unchanged from
 *     v1: true greys and violets only, at least 40deg off every seat hue, and
 *     paler and flatter than any of them. Rarity is read from the ornament
 *     instead — a gold crown, a silver helm, a nemes — which is how the
 *     premium tiers have always signalled themselves.
 *
 *  2. No tier ring. The sheet drew a 10-unit coloured ring inside the chip
 *     edge. PlayerChip already frames the avatar in the seat's colour, and it
 *     learned the hard way that a second coloured frame under that one reads
 *     as a double border. The chip keeps v1's single dark hairline.
 *
 *  3. No motif behind the character. The sheet's legendary tier sat on a
 *     radial glow with a full 360-degree ray field, and Diya on a ring of
 *     festival rays. A patterned chip reads as texture at 48pt on a player
 *     card and competes with the board mid-turn, which is what got the v1
 *     patterns removed. Rays that survive are struck over the head only, from
 *     the head's own centre, so they read as a halo the character wears.
 */

// --- Color ------------------------------------------------------------------

const hx = (h) => { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const rgb = (a) => "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => { const A = hx(a), B = hx(b); return rgb(A.map((v, i) => v + (B[i] - v) * t)); };
const dk = (c, t) => mix(c, "#000000", t);
const lt = (c, t) => mix(c, "#ffffff", t);

const SKIN = { porcelain: "#FDE3CE", light: "#F8D2B0", tan: "#EFBF8E", honey: "#E0A86B", olive: "#C98D5A", brown: "#A9713F", deep: "#87532E", dark: "#673C21" };
const HAIR = { black: "#1C130E", espresso: "#33200F", brown: "#6B4226", auburn: "#8C3F26", ginger: "#DB5A28", sand: "#C99A54", blonde: "#E8C270", platinum: "#DED7CB", purple: "#6C4FA3", lilac: "#9B8FC7", teal: "#1F6F73", pink: "#D9538A", white: "#F0F0F4", grey: "#8A8F99" };

const GOLD = "#E0AE39", GOLD_D = "#B9861F", GOLD_L = "#F6D77A";

/**
 * The chip tones — one flat color each, no gradient and no pattern behind the
 * character. The chip is a background: anything drawn in it competes with the
 * board during a turn, so it stays a single quiet fill.
 *
 * The seats own red, green, yellow and blue, so the chips use none of those
 * families: a tone is either a true grey (r === g === b, no hue at all) or sits
 * in the violet/magenta band, which is the widest gap the seat hues leave —
 * 132deg between blue at 226 and red at 358. Every violet here is at least
 * 40deg from all four.
 *
 * Hue is only half of it, and the weaker half — it collapses under
 * colorblindness. Every tone is also far paler and flatter than any seat
 * (sat <= 0.35 vs 0.56-0.86, light >= 0.80 vs 0.42-0.59), so the frame reads
 * as the color and the chip reads as tinted paper. See the tests in
 * __tests__/avatars.test.ts, which enforce all of it.
 */
export const CHIP_TONES = {
  pearl: "#EDEDED",
  slate: "#D2D2D2",
  lilac: "#E4D8EC",
  violet: "#EBD9EC",
  orchid: "#ECDAE8",
};

/** The chip's own edge — v1's single dark hairline, kept over the sheet's tier ring. */
const CHIP_RIM = "rgba(0,0,0,0.15)";

/**
 * An optional outline on a character's outermost shape.
 *
 * A pale silhouette on a pale chip renders as nothing — a white helmet bubble
 * or a steamed dumpling simply has no edge against #EDEDED. v1 solved this by
 * ringing the head in rgba(0,0,0,0.12), which works but puts a dark line on
 * all thirty-three whether they need one or not, and this art is flat by
 * design. So the six characters whose silhouette is lighter than the chip can
 * tell carry an outline in their own hue instead, and the catalog declares it.
 */
const rimAttr = (r, w = 7) => (r ? ` stroke="${r}" stroke-width="${w}" stroke-linejoin="round"` : "");

// --- Face -------------------------------------------------------------------

/**
 * Seven head shapes. `rx` is the half-width, `tf`/`bf` how far the curve
 * carries that width toward the crown and the chin, and `t`/`b` where the head
 * starts and ends. Everything else — ears at y302, eyes at y292, mouth at y356
 * — is fixed, so a feature kit drops onto any head without retuning.
 */
const FACE = {
  round: { rx: 122, tf: 0.80, bf: 0.78, t: 132, b: 408 },
  oval: { rx: 112, tf: 0.72, bf: 0.62, t: 128, b: 416 },
  heart: { rx: 124, tf: 0.86, bf: 0.44, t: 134, b: 410 },
  square: { rx: 122, tf: 0.74, bf: 0.94, t: 136, b: 396 },
  wide: { rx: 132, tf: 0.82, bf: 0.82, t: 142, b: 398 },
  long: { rx: 108, tf: 0.74, bf: 0.60, t: 124, b: 424 },
  chubby: { rx: 130, tf: 0.86, bf: 0.88, t: 146, b: 400 },
};

function facePath(k) {
  const f = FACE[k] ?? FACE.round, cx = 256, m = (f.t + f.b) / 2 + 8;
  const kT = (m - f.t) * 0.56, kB = (f.b - m) * 0.58, hT = f.rx * f.tf, hB = f.rx * f.bf;
  return `M256 ${f.t} C ${cx + hT} ${f.t} ${cx + f.rx} ${m - kT} ${cx + f.rx} ${m} C ${cx + f.rx} ${m + kB} ${cx + hB} ${f.b} 256 ${f.b} C ${cx - hB} ${f.b} ${cx - f.rx} ${m + kB} ${cx - f.rx} ${m} C ${cx - f.rx} ${m - kT} ${cx - hT} ${f.t} 256 ${f.t} Z`;
}

// --- Features ---------------------------------------------------------------

function eyes(kind, o = {}) {
  const y = o.y ?? 292, dx = o.dx ?? 50, ink = o.ink ?? "#1E1A19", c = 256;
  const L = c - dx, R = c + dx;
  const shine = (x, yy, r) => `<circle cx="${x}" cy="${yy}" r="${r}" fill="#fff"/>`;
  const pair = (f) => f(L, -1) + f(R, 1);
  switch (kind) {
    case "big": return pair((x, s) => `<ellipse cx="${x}" cy="${y}" rx="25" ry="29" fill="${ink}"/>` + shine(x - 8 * s, y - 10, 8) + shine(x + 7 * s, y + 9, 4));
    case "almond": return pair((x, s) => `<path d="M${x - 26} ${y - 2} Q ${x} ${y - 26} ${x + 26} ${y - 2} Q ${x} ${y + 24} ${x - 26} ${y - 2} Z" fill="${ink}"/>` + shine(x - 7, y - 8, 6)
      + `<path d="M${x + 26 * s} ${y - 6} q ${12 * s} ${-6} ${18 * s} ${-14}" stroke="${ink}" stroke-width="6" fill="none" stroke-linecap="round"/>`);
    case "lash": return pair((x, s) => `<ellipse cx="${x}" cy="${y}" rx="23" ry="27" fill="${ink}"/>` + shine(x - 7, y - 9, 7.5) + shine(x + 8, y + 8, 3.5)
      + `<path d="M${x - 24} ${y - 16} q 24 -18 48 0" stroke="${ink}" stroke-width="8" fill="none" stroke-linecap="round"/>`
      + `<path d="M${x + 22 * s} ${y - 20} l ${14 * s} -12" stroke="${ink}" stroke-width="7" fill="none" stroke-linecap="round"/>`);
    case "sleepy": return pair((x) => `<path d="M${x - 24} ${y - 4} a 24 26 0 0 1 48 0 z" fill="${ink}"/><path d="M${x - 26} ${y - 4} h 52" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>` + shine(x - 8, y - 14, 5));
    case "kawaii": return pair((x) => `<rect x="${x - 19}" y="${y - 30}" width="38" height="60" rx="19" fill="${ink}"/>` + shine(x - 6, y - 14, 9) + shine(x + 7, y + 11, 4.5));
    case "beady": return pair((x) => `<circle cx="${x}" cy="${y}" r="19" fill="${ink}"/>` + shine(x - 6, y - 6, 6));
    case "wink": return `<ellipse cx="${L}" cy="${y}" rx="23" ry="27" fill="${ink}"/>${shine(L - 7, y - 9, 7)}<path d="M${R - 24} ${y + 2} q 24 -22 48 0" stroke="${ink}" stroke-width="9" fill="none" stroke-linecap="round"/>`;
    case "glow": return pair((x) => `<rect x="${x - 22}" y="${y - 14}" width="44" height="28" rx="14" fill="${o.glow ?? "#5BE3E8"}"/><rect x="${x - 13}" y="${y - 7}" width="26" height="14" rx="7" fill="#fff" opacity=".85"/>`);
    case "gem": return pair((x) => `<path d="M${x} ${y - 26} l 24 26 -24 26 -24 -26 z" fill="${o.glow ?? "#7FE1D8"}"/><path d="M${x} ${y - 26} l 24 26 -24 0 z" fill="#fff" opacity=".45"/>`);
    default: return pair((x) => `<ellipse cx="${x}" cy="${y}" rx="22" ry="27" fill="${ink}"/>` + shine(x - 7, y - 10, 7) + shine(x + 8, y + 9, 3.5));
  }
}

function brows(kind, c, o = {}) {
  const y = o.y ?? 242, dx = o.dx ?? 52, w = o.w ?? 9;
  const m = (x, s) => {
    switch (kind) {
      case "thick": return `<path d="M${x - 30} ${y + 4} q 30 -16 60 0" stroke="${c}" stroke-width="13" fill="none" stroke-linecap="round"/>`;
      case "arch": return `<path d="M${x - 28} ${y + 6} q 28 -22 56 -2" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
      case "straight": return `<path d="M${x - 28} ${y} h 56" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
      case "raised": return `<path d="M${x - 26} ${y + (s < 0 ? 6 : -2)} q 26 -18 52 ${s < 0 ? -4 : 4}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
      case "none": return "";
      default: return `<path d="M${x - 28} ${y + 4} q 28 -16 56 0" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
    }
  };
  return m(256 - dx, -1) + m(256 + dx, 1);
}

function mouth(kind, o = {}) {
  const y = o.y ?? 356, ink = o.ink ?? "#7A2E22";
  switch (kind) {
    case "grin": return `<path d="M${256 - 38} ${y - 8} q 38 46 76 0 z" fill="${ink}"/><path d="M${256 - 30} ${y - 8} h 60 q -8 10 -30 10 q -22 0 -30 -10 z" fill="#fff"/><path d="M${256 - 16} ${y + 14} q 16 14 32 0 q -16 -6 -32 0 z" fill="#E0708A"/>`;
    case "tooth": return `<path d="M${256 - 34} ${y - 6} q 34 40 68 0 z" fill="${ink}"/><rect x="${256 - 13}" y="${y - 6}" width="26" height="12" rx="3" fill="#fff"/>`;
    case "smirk": return `<path d="M${256 - 30} ${y} q 30 20 56 -12" stroke="${ink}" stroke-width="9" fill="none" stroke-linecap="round"/>`;
    case "lips": return `<path d="M${256 - 30} ${y - 4} q 14 -12 30 -2 q 16 -10 30 2 q -18 30 -60 0 z" fill="${o.lip ?? "#D0566B"}"/><path d="M${256 - 24} ${y - 2} q 24 10 48 0" stroke="${dk(o.lip ?? "#D0566B", 0.3)}" stroke-width="3" fill="none"/>`;
    case "tiny": return `<ellipse cx="256" cy="${y + 2}" rx="12" ry="14" fill="${ink}"/>`;
    case "cat": return `<path d="M${256 - 22} ${y - 4} q 11 16 22 0 q 11 16 22 0" stroke="#6B5147" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    case "none": return "";
    case "flat": return `<path d="M${256 - 24} ${y} h 48" stroke="${ink}" stroke-width="8" stroke-linecap="round"/>`;
    case "bot": return `<rect x="${256 - 34}" y="${y - 12}" width="68" height="24" rx="12" fill="${o.bot ?? "#2B3440"}"/><path d="M${256 - 20} ${y - 12} v 24 M256 ${y - 12} v 24 M${256 + 20} ${y - 12} v 24" stroke="${lt(o.bot ?? "#2B3440", 0.5)}" stroke-width="3"/>`;
    default: return `<path d="M${256 - 32} ${y - 6} q 32 38 64 0 q -32 14 -64 0 z" fill="${ink}"/>`;
  }
}

// --- Body parts -------------------------------------------------------------

const ears = (skin) => {
  const d = dk(skin, 0.10);
  return `<ellipse cx="130" cy="302" rx="27" ry="31" fill="${skin}" stroke="${d}" stroke-width="3"/><ellipse cx="382" cy="302" rx="27" ry="31" fill="${skin}" stroke="${d}" stroke-width="3"/>`;
};
const blush = (c) => `<ellipse cx="164" cy="334" rx="28" ry="17" fill="${c}" opacity=".62"/><ellipse cx="348" cy="334" rx="28" ry="17" fill="${c}" opacity=".62"/>`;
const nose = (skin, y = 326) => `<path d="M248 ${y} q 8 10 16 0" stroke="${dk(skin, 0.22)}" stroke-width="6" fill="none" stroke-linecap="round" opacity=".75"/>`;
const neck = (skin) => `<path d="M212 352 h 88 v 74 q -44 26 -88 0 z" fill="${dk(skin, 0.10)}"/>`;
const hairShade = () => `<path d="M136 214 q 120 -46 240 0 q -30 34 -120 34 q -90 0 -120 -34 z" fill="#000" opacity=".07"/>`;

const bust = (c, o = {}) =>
  `<path d="M256 424 C 352 424 438 486 462 580 L 50 580 C 74 486 160 424 256 424 Z" fill="${c}"/>`
  + `<path d="M256 424 c -26 0 -44 18 -44 34 0 12 20 22 44 22 s 44 -10 44 -22 c 0 -16 -18 -34 -44 -34 z" fill="${dk(c, 0.16)}" opacity=".55"/>`
  + (o.collar ?? "");

// --- Hair and headgear ------------------------------------------------------
//
// Each entry returns { back, front } so a shape can sit behind the head (a
// ponytail, a bun, a braid) and in front of it (the fringe) in one call. `rim`
// is the optional outline from the catalog, and it only ever goes on the
// outermost shape — an outline on an interior highlight would read as a crease.

const H = {
  bowl: (c, rim) => ({ back: "", front: `<path d="M126 274 C 122 168 176 110 256 110 C 336 110 390 168 386 274 C 380 244 366 232 360 226 C 348 206 316 192 256 192 C 196 192 164 206 152 226 C 146 232 132 244 126 274 Z" fill="${c}"${rimAttr(rim)}/><path d="M256 110 c 62 0 104 36 118 92 -22 -40 -62 -62 -118 -62 s -96 22 -118 62 c 14 -56 56 -92 118 -92 z" fill="${lt(c, 0.16)}"/>` }),
  side: (c, rim) => ({ back: "", front: `<path d="M126 272 C 120 166 176 108 256 108 C 338 108 390 168 386 272 C 378 240 368 228 362 222 C 356 196 340 176 316 166 C 284 214 216 226 156 222 C 146 232 134 248 126 272 Z" fill="${c}"${rimAttr(rim)}/>` }),
  curtain: (c, rim) => ({ back: `<path d="M112 300 C 104 168 168 104 256 104 C 344 104 408 168 400 300 L 400 400 L 352 400 L 352 230 L 160 230 L 160 400 L 112 400 Z" fill="${c}"${rimAttr(rim)}/>`, front: `<path d="M128 266 C 124 164 178 106 256 106 C 334 106 388 164 384 266 C 372 224 344 196 300 186 C 292 214 272 232 244 240 C 200 252 168 236 150 216 C 138 230 132 248 128 266 Z" fill="${c}"/>` }),
  longStraight: (c, rim) => ({ back: `<path d="M108 320 C 100 166 168 100 256 100 C 344 100 412 166 404 320 L 404 430 L 340 430 L 340 220 L 172 220 L 172 430 L 108 430 Z" fill="${c}"${rimAttr(rim)}/>`, front: `<path d="M130 268 C 126 160 180 104 256 104 C 332 104 386 160 382 268 C 372 222 340 192 256 192 C 172 192 140 222 130 268 Z" fill="${c}"${rimAttr(rim)}/><path d="M256 104 c 76 0 126 56 126 126 -18 -52 -62 -82 -126 -82 z" fill="${lt(c, 0.14)}" opacity=".8"/>` }),
  bunTop: (c, rim) => ({ back: `<circle cx="256" cy="96" r="46" fill="${c}"${rimAttr(rim)}/>`, front: `<path d="M128 272 C 124 164 178 108 256 108 C 334 108 388 164 384 272 C 372 226 340 198 256 198 C 172 198 140 226 128 272 Z" fill="${c}"${rimAttr(rim)}/><circle cx="256" cy="98" r="44" fill="${lt(c, 0.08)}"/>` }),
  twoBuns: (c, rim) => ({ back: `<circle cx="130" cy="176" r="52" fill="${c}"/><circle cx="382" cy="176" r="52" fill="${c}"/>`, front: `<path d="M128 274 C 124 164 178 106 256 106 C 334 106 388 164 384 274 C 372 226 340 198 256 198 C 172 198 140 226 128 274 Z" fill="${c}"${rimAttr(rim)}/>` }),
  afro: (c, rim) => ({ back: `<circle cx="256" cy="196" r="152" fill="${c}"${rimAttr(rim)}/><circle cx="142" cy="196" r="82" fill="${c}"/><circle cx="370" cy="196" r="82" fill="${c}"/><circle cx="256" cy="108" r="92" fill="${c}"/>`, front: `<path d="M134 270 C 130 180 182 140 256 140 C 330 140 382 180 378 270 C 362 214 322 192 256 192 C 190 192 150 214 134 270 Z" fill="${c}"/><path d="M256 140 c 60 0 104 30 116 84 -26 -38 -62 -56 -116 -56 z" fill="${lt(c, 0.13)}"/>` }),
  spiky: (c, rim) => ({ back: "", front: `<path d="M126 280 C 122 170 178 114 256 114 C 334 114 390 170 386 280 C 360 238 320 214 256 214 C 192 214 152 238 126 280 Z" fill="${c}"/><path d="M132 204 L 176 92 L 204 152 L 230 82 L 256 142 L 282 82 L 308 152 L 336 92 L 380 204 C 320 160 192 160 132 204 Z" fill="${c}"${rimAttr(rim)}/><path d="M256 114 c -50 0 -88 22 -108 60 26 -28 62 -42 108 -42 z" fill="${lt(c, 0.16)}" opacity=".8"/>` }),
  ponytail: (c, rim) => ({ back: `<path d="M370 200 c 60 10 84 70 70 128 -10 42 -40 66 -70 70 l -8 -52 c 20 -8 34 -26 32 -52 -2 -30 -22 -44 -46 -48 z" fill="${c}"/>`, front: `<path d="M128 270 C 124 162 180 106 256 106 C 336 106 392 164 384 272 C 372 224 344 196 300 188 C 276 222 210 236 152 226 C 140 238 132 254 128 270 Z" fill="${c}"${rimAttr(rim)}/>` }),
  braidCrown: (c, rim) => ({ back: "", front: `<path d="M130 268 C 126 162 180 106 256 106 C 332 106 386 162 382 268 C 370 222 340 194 256 194 C 172 194 142 222 130 268 Z" fill="${c}"${rimAttr(rim)}/><path d="M140 216 q 116 -66 232 0" stroke="${lt(c, 0.22)}" stroke-width="22" fill="none" stroke-linecap="round" stroke-dasharray="26 12"/>` }),
  wavy: (c, rim) => ({ back: `<path d="M106 330 C 96 168 166 100 256 100 C 346 100 416 168 406 330 C 396 300 384 316 372 296 L 372 224 L 140 224 L 140 296 C 128 316 116 300 106 330 Z" fill="${c}"${rimAttr(rim)}/>`, front: `<path d="M130 266 C 126 160 180 104 256 104 C 332 104 386 160 382 266 C 368 214 336 190 256 190 C 176 190 144 214 130 266 Z" fill="${c}"/>` }),
};

const HAT = {
  cap: (c, b, rim) => {
    const B = b ?? dk(c, 0.26);
    return `<path d="M132 178 C 128 100 184 60 256 60 C 328 60 384 100 380 178 Z" fill="${c}"${rimAttr(rim)}/><path d="M256 60 c 58 0 100 30 114 82 -24 -38 -62 -58 -114 -58 z" fill="${lt(c, 0.14)}"/><rect x="130" y="160" width="252" height="26" rx="13" fill="${dk(c, 0.14)}"/><path d="M150 180 C 182 166 330 166 362 180 C 350 214 302 230 256 230 C 210 230 162 214 150 180 Z" fill="${B}"/><path d="M158 180 C 188 170 324 170 354 180 C 322 190 190 190 158 180 Z" fill="${lt(B, 0.2)}"/><circle cx="256" cy="72" r="13" fill="${dk(c, 0.14)}"/>`;
  },
  beanie: (c, _b, rim) => `<path d="M132 252 C 128 160 180 116 256 116 C 332 116 384 160 380 252 Z" fill="${c}"${rimAttr(rim)}/><rect x="110" y="238" width="292" height="42" rx="21" fill="${dk(c, 0.18)}"/><circle cx="256" cy="104" r="22" fill="${lt(c, 0.16)}"/>`,
  crown: (c, _b, rim) => `<path d="M136 236 L 152 128 L 200 186 L 256 106 L 312 186 L 360 128 L 376 236 Z" fill="${c}"${rimAttr(rim)}/><rect x="128" y="228" width="256" height="40" rx="18" fill="${lt(c, 0.2)}" stroke="${dk(c, 0.22)}" stroke-width="6"/>`,
  turban: (c, a, rim) => `<path d="M118 268 C 112 152 178 96 256 96 C 334 96 400 152 394 268 C 380 226 366 208 340 196 C 300 178 214 178 172 196 C 146 208 132 226 118 268 Z" fill="${c}"${rimAttr(rim)}/><path d="M124 250 q 132 -78 264 0" stroke="${lt(c, 0.2)}" stroke-width="16" fill="none"/><path d="M134 214 q 122 -72 244 0" stroke="${dk(c, 0.14)}" stroke-width="12" fill="none"/>${a ?? ""}`,
  hood: (c, _b, rim) => `<path d="M96 430 C 88 208 156 96 256 96 C 356 96 424 208 416 430 L 356 430 C 362 246 330 172 256 172 C 182 172 150 246 156 430 Z" fill="${c}"${rimAttr(rim)}/>`,
};

/**
 * A fan of rays across an arc, struck from the chip's centre.
 *
 * Only ever used over the head (a halo a character wears), never as a full
 * circle. A 360-degree ray field is a motif on the chip, which is the pattern
 * the chip-tone rules exist to keep off the board.
 */
function rayArc(n, a0, a1, r1, r2, w, c) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const a = ((a0 + (a1 - a0) * (i / (n - 1))) * Math.PI) / 180;
    const x1 = 256 + Math.cos(a) * r1, y1 = 256 + Math.sin(a) * r1;
    const x2 = 256 + Math.cos(a) * r2, y2 = 256 + Math.sin(a) * r2;
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  }
  return s;
}

// --- Assembler --------------------------------------------------------------

/** One avatar spec to a complete 512x512 SVG document. */
export function buildSVG(ch) {
  const tone = CHIP_TONES[ch.tone];
  if (!tone) throw new Error(`${ch.id}: unknown chip tone ${ch.tone}`);
  // A character preserved from v1 brings its whole body with it — none of the
  // feature libraries below apply, because the point of keeping it is that it
  // is exactly what it was. See Onyx.
  if (ch.legacy) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`
      + `<circle cx="256" cy="256" r="250" fill="${tone}"/>`
      + `<g transform="translate(6,6) scale(5)">${ch.legacy}</g>`
      + `<circle cx="256" cy="256" r="245" fill="none" stroke="${CHIP_RIM}" stroke-width="10"/>`
      + `</svg>`;
  }
  const sk = SKIN[ch.skin] ?? ch.skin;
  const hair = ch.hair ? H[ch.hair](ch.hairColor ?? HAIR.brown, ch.rim) : { back: "", front: "" };
  const browCol = ch.browColor ?? dk(ch.hairColor ?? HAIR.brown, 0.18);
  const bl = ch.blush ?? mix(sk, "#E86A5A", 0.45);
  const body = [
    bust(ch.bust ?? "#5C6B8A", { collar: ch.collar }),
    hair.back,
    ch.back ?? "",
    neck(sk),
    ch.noEars ? "" : ears(sk),
    `<path d="${facePath(ch.face ?? "round")}" fill="${sk}"/>`,
    ch.faceMark ?? "",
    ch.hair || ch.hat ? hairShade() : "",
    brows(ch.brow ?? "soft", browCol, ch.browOpts),
    eyes(ch.eyes ?? "round", ch.eyeOpts),
    ch.noNose ? "" : nose(sk, ch.noseY),
    blush(bl),
    mouth(ch.mouth ?? "smile", ch.mouthOpts),
    hair.front,
    ch.hat ? HAT[ch.hat](ch.hatColor ?? "#D24B3E", ch.hatColor2, ch.rim) : "",
    ch.front ?? "",
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`
    + `<circle cx="256" cy="256" r="250" fill="${tone}"/>`
    + `<g>${body}</g>`
    + `<circle cx="256" cy="256" r="245" fill="none" stroke="${CHIP_RIM}" stroke-width="10"/>`
    + `</svg>`;
}

// --- Cast -------------------------------------------------------------------
//
// `tone` is the chip this character sits on, `edge` the colour of its outermost
// silhouette where that silhouette meets the chip, and `rim` the outline it
// carries when `edge` alone cannot be told from `tone`. The tests read all
// three: every character must clear the chip, and every rim must be justified
// by an edge that does not.

export const AVATARS = [
  // --- The starter four: free since 0013 -------------------------------------
  { id: "leo", name: "Leo", tag: "Young King", tone: "pearl", edge: HAIR.brown,
    skin: "light", face: "round", eyes: "round", brow: "soft", mouth: "smile", bust: "#A87C3C", hair: "bowl", hairColor: HAIR.brown,
    front: `<path d="M156 168 L 170 84 L 212 132 L 256 66 L 300 132 L 342 84 L 356 168 Z" fill="${GOLD_L}" stroke="${GOLD_D}" stroke-width="8" stroke-linejoin="round"/><rect x="146" y="160" width="220" height="34" rx="16" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="7"/>` },

  { id: "sunny", name: "Sunny", tag: "Spark", tone: "pearl", edge: "#E8501F",
    skin: "porcelain", face: "round", eyes: "round", brow: "soft", mouth: "smile", bust: "#A8663E", hair: "spiky", hairColor: "#E8501F", browColor: "#C7441A" },

  { id: "coco", name: "Coco", tag: "Sunshine", tone: "violet", edge: "#231309",
    skin: "brown", face: "round", eyes: "big", brow: "soft", mouth: "grin", bust: "#3F8F6B", hair: "afro", hairColor: "#231309" },

  { id: "zara", name: "Zara", tag: "Topknot", tone: "orchid", edge: "#22140C",
    skin: "honey", face: "oval", eyes: "lash", brow: "arch", mouth: "lips", mouthOpts: { lip: "#B4536A" }, bust: "#A86282", hair: "bunTop", hairColor: "#22140C",
    front: `<circle cx="120" cy="330" r="19" fill="none" stroke="#F2C24A" stroke-width="9"/><circle cx="392" cy="330" r="19" fill="none" stroke="#F2C24A" stroke-width="9"/>` },

  // --- 300 coins (0013) ------------------------------------------------------
  { id: "rex", name: "Rex", tag: "Rookie", tone: "slate", edge: "#5175BC",
    skin: "porcelain", face: "round", eyes: "round", brow: "soft", mouth: "smile", bust: "#4E6BA8", hat: "cap", hatColor: "#5175BC", hatColor2: "#3B5590", browColor: "#6B5340" },

  { id: "nina", name: "Nina", tag: "Double Trouble", tone: "lilac", edge: "#1B0F08",
    skin: "brown", face: "round", eyes: "big", brow: "arch", mouth: "smile", bust: "#7059A8", hair: "twoBuns", hairColor: "#1B0F08",
    back: `<circle cx="116" cy="188" r="66" fill="#1B0F08"/><circle cx="396" cy="188" r="66" fill="#1B0F08"/><circle cx="116" cy="188" r="24" fill="#E85C9A"/><circle cx="396" cy="188" r="24" fill="#E85C9A"/>` },

  { id: "milo", name: "Milo", tag: "Freckles", tone: "violet", edge: "#B0722F",
    skin: "porcelain", face: "round", eyes: "round", brow: "soft", mouth: "smile", bust: "#39877A", hair: "side", hairColor: "#B0722F",
    faceMark: `<g fill="#C98A5E" opacity=".85">${[[196, 318], [214, 330], [186, 338], [316, 318], [298, 330], [326, 338]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6"/>`).join("")}</g>` },

  { id: "ivy", name: "Ivy", tag: "Trailhead", tone: "pearl", edge: "#4B8A38",
    skin: "light", face: "oval", eyes: "round", brow: "soft", mouth: "smile", bust: "#6D8A5B", hat: "beanie", hatColor: "#4B8A38", browColor: "#6B5340",
    front: `<path d="M112 250 h 288" stroke="#3D7130" stroke-width="5" opacity=".6"/>` },

  // --- 500 coins (0013) ------------------------------------------------------
  { id: "ace", name: "Ace", tag: "Gamer", tone: "lilac", edge: HAIR.purple,
    skin: "light", face: "square", eyes: "round", brow: "straight", mouth: "smirk", bust: "#4A4F8C", hair: "bowl", hairColor: HAIR.purple,
    front: `<rect x="60" y="256" width="392" height="64" rx="32" fill="#22262E"/><rect x="74" y="266" width="86" height="44" rx="22" fill="#4E5BD8"/><rect x="352" y="266" width="86" height="44" rx="22" fill="#4E5BD8"/><path d="M126 258 C 122 150 180 96 256 96 C 332 96 390 150 386 258" stroke="#22262E" stroke-width="30" fill="none"/><circle cx="117" cy="288" r="9" fill="#8CF2E0"/>` },

  { id: "ruby", name: "Ruby", tag: "Ribbon", tone: "orchid", edge: "#4A2A18",
    skin: "porcelain", face: "heart", eyes: "lash", brow: "arch", mouth: "smile", bust: "#A65A5E", hair: "side", hairColor: "#4A2A18",
    front: `<g transform="translate(330,150) rotate(-12)"><path d="M0 0 L -62 -30 L -62 34 Z" fill="#E8386F"/><path d="M0 0 L 62 -30 L 62 34 Z" fill="#E8386F"/><path d="M0 0 L -62 -30 L -58 2 Z" fill="#C42557"/><path d="M0 0 L 62 -30 L 58 2 Z" fill="#C42557"/><circle cx="0" cy="0" r="17" fill="#C42557"/></g>` },

  { id: "bruno", name: "Bruno", tag: "The Uncle", tone: "pearl", edge: HAIR.espresso,
    skin: "tan", face: "wide", eyes: "round", brow: "thick", mouth: "tooth", mouthOpts: { y: 372 }, bust: "#9A7442", hair: "side", hairColor: HAIR.espresso,
    back: `<ellipse cx="256" cy="330" rx="152" ry="144" fill="${HAIR.espresso}"/>`,
    front: `<path d="M194 344 q 62 -24 124 0 q -18 28 -62 28 q -44 0 -62 -28 z" fill="${HAIR.espresso}"/><path d="M214 392 q 42 16 84 0 q -10 32 -42 32 q -32 0 -42 -32 z" fill="${HAIR.espresso}"/>` },

  { id: "kito", name: "Kito", tag: "Alley Cat", tone: "pearl", edge: "#E88C3E",
    skin: "#F3C79C", face: "wide", eyes: "beady", brow: "none", mouth: "cat", bust: "#5E7183", noEars: true, noNose: true,
    back: `<path d="M124 226 L 112 96 L 226 168 Z" fill="#E88C3E"/><path d="M388 226 L 400 96 L 286 168 Z" fill="#E88C3E"/><path d="M136 214 L 130 130 L 208 180 Z" fill="#F8D3B4"/><path d="M376 214 L 382 130 L 304 180 Z" fill="#F8D3B4"/>`,
    front: `<path d="M134 250 C 132 168 186 132 256 132 C 326 132 380 168 378 250 C 362 208 322 186 256 186 C 190 186 150 208 134 250 Z" fill="#E88C3E"/><ellipse cx="256" cy="348" rx="62" ry="48" fill="#FBE7D4"/><path d="M256 330 l 18 14 -18 16 -18 -16 z" fill="#E8628C"/><path d="M256 360 v 12 q 0 12 -14 12 M256 372 q 0 12 14 12" stroke="#8A6A58" stroke-width="6" fill="none" stroke-linecap="round"/><g stroke="#B08163" stroke-width="6" stroke-linecap="round" fill="none"><path d="M180 330 l -56 -8 M180 348 l -58 10 M332 330 l 56 -8 M332 348 l 58 10"/></g>` },

  // --- 100 gems: the showcase pair (0018) ------------------------------------
  { id: "nova", name: "Nova", tag: "Static", tone: "lilac", edge: HAIR.lilac,
    skin: "light", face: "square", eyes: "round", brow: "straight", mouth: "smirk", bust: "#5F55A8", hair: "spiky", hairColor: HAIR.lilac, browColor: "#7F76A8" },

  // Onyx is the one character v2 did not redraw, and that is on purpose.
  //
  // Players recognise him by the red cap — it is why the cap carries the one
  // colour override in the catalog, restored once already after a refactor
  // turned him into a silhouette of flat charcoal — and at least one player
  // asked for this face specifically. A redraw is not an upgrade to someone
  // who liked the thing you replaced, so the original art is kept verbatim
  // rather than reinterpreted, and the v2 drawing ships beside it as Onyx II.
  //
  // The body below is v1's op list, unchanged, still written in the 100-unit
  // space it was drawn in. buildSVG maps that space onto the v2 chip with a
  // single transform — x5 about the centre, so the composition fills r=250
  // exactly as it used to fill r=256 — and nothing else about it moves.
  { id: "onyx", name: "Onyx", tag: "Street Ball", tone: "slate", edge: "#D93636",
    skin: "#C68642", bust: "#2A2E36",
    legacy:
      `<ellipse cx="50" cy="102" rx="30" ry="20" fill="#2A2E36"/>`
      + `<circle cx="50" cy="55" r="26" fill="#C68642"/>`
      + `<circle cx="50" cy="55" r="26" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1.5"/>`
      + `<circle cx="24" cy="56" r="5" fill="#C68642"/>`
      + `<circle cx="24" cy="56" r="5" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1.2"/>`
      + `<circle cx="76" cy="56" r="5" fill="#C68642"/>`
      + `<circle cx="76" cy="56" r="5" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1.2"/>`
      + `<path d="M26 46 A25 25 0 0 1 74 46 L74 42 L26 42 Z" fill="#0B0C0F"/>`
      + `<path d="M25 44 A25 22 0 0 1 75 44 L75 47 L25 47 Z" fill="#D93636"/>`
      + `<path d="M23 43 H77 A3.5 3.5 0 0 1 77 50 H23 A3.5 3.5 0 0 1 23 43 Z" fill="rgb(163,41,41)"/>`
      + `<circle cx="50" cy="27" r="4" fill="rgb(163,41,41)"/>`
      + `<path d="M42 66 Q50 75 58 66 Q50 70 42 66 Z" fill="#7A3B2E"/>`
      + `<ellipse cx="41" cy="55" rx="4.6" ry="5.6" fill="#26221E"/>`
      + `<circle cx="42.6" cy="52.5" r="1.7" fill="#FFFFFF"/>`
      + `<ellipse cx="59" cy="55" rx="4.6" ry="5.6" fill="#26221E"/>`
      + `<circle cx="60.6" cy="52.5" r="1.7" fill="#FFFFFF"/>`
      + `<path d="M36 47 Q41 44 46 47" fill="none" stroke="#5A4632" stroke-width="2.2" stroke-linecap="round"/>`
      + `<path d="M54 47 Q59 44 64 47" fill="none" stroke="#5A4632" stroke-width="2.2" stroke-linecap="round"/>`
      + `<ellipse cx="33" cy="62" rx="4.5" ry="2.8" fill="rgba(255,120,120,0.35)"/>`
      + `<ellipse cx="67" cy="62" rx="4.5" ry="2.8" fill="rgba(255,120,120,0.35)"/>` },

  // Onyx II — the v2 drawing of the same character, sold beside the original.
  // The red cap is the one piece of clothing that does not take the bust
  // colour, and it is deliberately louder than the bust rule allows: it is a
  // crown-sized accent, not a torso, and the only such override in the catalog.
  { id: "onyx-ii", name: "Onyx II", tag: "Street Ball", tone: "slate", edge: "#D8322F",
    skin: "deep", face: "round", eyes: "big", brow: "straight", mouth: "smirk", bust: "#22262E", hat: "cap", hatColor: "#D8322F", hatColor2: "#A8231F", browColor: "#2A1A10" },

  // --- Regalia: the coin prestige line (0059) --------------------------------
  { id: "laurel", name: "Laurel", tag: "Victor", tone: "pearl", edge: HAIR.sand,
    skin: "porcelain", face: "oval", eyes: "almond", brow: "arch", mouth: "smile", bust: "#6B6440", hair: "braidCrown", hairColor: HAIR.sand,
    front: `<path d="M134 224 q 122 -84 244 0 q -18 26 -40 12 q -62 -46 -164 0 q -22 14 -40 -12 z" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="5"/>${[[168, 206], [204, 184], [256, 174], [308, 184], [344, 206]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="22" ry="13" fill="${GOLD_L}" stroke="${GOLD_D}" stroke-width="4" transform="rotate(${(x - 256) / 6} ${x} ${y})"/>`).join("")}<path d="M256 140 l 8 20 20 8 -20 8 -8 20 -8 -20 -20 -8 20 -8 z" fill="#FFF6D8"/>` },

  // Saga's helm and Pharo's nemes are the two v1 faces whose spec colour and
  // visible silhouette were never the same thing: both declared a dark hair
  // colour the chip never sees, because a steel helm and a gold headdress sit
  // on top of it. Measured honestly they are paler than every chip tone, so
  // both now carry the outline they always needed.
  { id: "saga", name: "Saga", tag: "Shieldmaiden", tone: "lilac", edge: "#C8CFD7", rim: "#82878C",
    skin: "tan", face: "square", eyes: "round", brow: "thick", mouth: "smile", bust: "#3C4454", browColor: "#8A6B3C",
    back: `<path d="M126 300 q 0 120 130 130 q 130 -10 130 -130 l 0 -80 -260 0 z" fill="${HAIR.sand}"/><path d="M116 200 l -66 -110 q 78 6 116 78 z" fill="#CDD3DA" stroke="#82878C" stroke-width="7" stroke-linejoin="round"/><path d="M396 200 l 66 -110 q -78 6 -116 78 z" fill="#CDD3DA" stroke="#82878C" stroke-width="7" stroke-linejoin="round"/>`,
    front: `<path d="M128 262 C 124 156 180 100 256 100 C 332 100 388 156 384 262 L 384 224 q -128 -54 -256 0 z" fill="#C8CFD7" stroke="#82878C" stroke-width="7" stroke-linejoin="round"/><path d="M256 100 c 60 0 102 36 116 90 -24 -40 -64 -62 -116 -62 z" fill="#E9EEF3"/><rect x="112" y="228" width="288" height="36" rx="16" fill="#9CA6B2"/><path d="M244 264 h 24 l -6 78 q -6 8 -12 0 z" fill="#C8CFD7"/><path d="M256 136 l 9 22 22 9 -22 9 -9 22 -9 -22 -22 -9 22 -9 z" fill="${GOLD_L}"/>` },

  { id: "pharo", name: "Pharo", tag: "Nile Heir", tone: "slate", edge: GOLD, rim: "#927125",
    skin: "honey", face: "long", eyes: "almond", brow: "straight", mouth: "lips", mouthOpts: { lip: "#B4506A" }, bust: "#1F3358",
    back: `<path d="M96 200 h 320 v 300 h -76 V 236 H 172 v 264 H 96 Z" fill="${GOLD}" stroke="#927125" stroke-width="7" stroke-linejoin="round"/><g fill="#1F3358">${[116, 146, 176, 336, 366, 396].map((x) => `<rect x="${x}" y="206" width="16" height="290"/>`).join("")}</g>`,
    front: `<path d="M120 152 q 136 -64 272 0 l -8 60 q -128 -52 -256 0 z" fill="${GOLD_L}" stroke="#927125" stroke-width="7" stroke-linejoin="round"/><rect x="100" y="200" width="312" height="42" rx="12" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="5"/><path d="M256 244 l 22 34 -22 56 -22 -56 z" fill="${GOLD_L}" stroke="${GOLD_D}" stroke-width="4"/><circle cx="256" cy="140" r="16" fill="#7B4FC4" stroke="${GOLD_D}" stroke-width="5"/>` },

  { id: "regis", name: "Regis", tag: "The Sovereign", tone: "violet", edge: HAIR.brown,
    skin: "porcelain", face: "round", eyes: "round", brow: "soft", mouth: "smile", bust: "#F3F0E4", hair: "bowl", hairColor: HAIR.brown,
    collar: `<g fill="#2C2620">${[[160, 506], [210, 530], [262, 504], [314, 532], [366, 508], [186, 556], [290, 558], [392, 552], [118, 548]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="5" ry="11"/>`).join("")}</g>`,
    front: `<path d="M126 128 L 152 62 L 190 110 L 224 48 L 256 104 L 288 48 L 322 110 L 360 62 L 386 128 Z" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="7" stroke-linejoin="round"/><rect x="116" y="120" width="280" height="44" rx="20" fill="${GOLD_L}" stroke="${GOLD_D}" stroke-width="7"/>${[[164, 142], [210, 142], [302, 142], [348, 142]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" fill="#fff"/>`).join("")}<circle cx="256" cy="142" r="15" fill="#7B4FC4" stroke="${GOLD_D}" stroke-width="4"/>` },

  // --- Celestial: the gem prestige line (0059) -------------------------------
  { id: "astra", name: "Astra", tag: "Stargazer", tone: "pearl", edge: "#6E5FA8",
    skin: "porcelain", face: "heart", eyes: "lash", brow: "arch", mouth: "lips", mouthOpts: { lip: "#C9587C" }, bust: "#3E3559", hair: "longStraight", hairColor: "#6E5FA8",
    front: `<path d="M138 208 q 118 -72 236 0" stroke="#D8D3EA" stroke-width="14" fill="none" stroke-linecap="round"/>${[[176, 190, 20], [256, 162, 28], [336, 190, 20]].map(([x, y, r]) => `<path d="M${x} ${y - r} l ${r * 0.3} ${r * 0.62} ${r * 0.7} ${r * 0.18} -${r * 0.5} ${r * 0.5} ${r * 0.16} ${r * 0.7} -${r * 0.66} -${r * 0.36} -${r * 0.66} ${r * 0.36} ${r * 0.16} -${r * 0.7} -${r * 0.5} -${r * 0.5} ${r * 0.7} -${r * 0.18} z" fill="#EFEAFF" stroke="#B9AEDD" stroke-width="3"/>`).join("")}<circle cx="256" cy="164" r="8" fill="#fff"/>` },

  { id: "selene", name: "Selene", tag: "Moonlit", tone: "slate", edge: "#2A1A3E",
    skin: "deep", face: "oval", eyes: "almond", brow: "arch", mouth: "lips", mouthOpts: { lip: "#9E4A64" }, bust: "#2F3B52", hair: "longStraight", hairColor: "#2A1A3E",
    front: `<path d="M164 88 a 56 56 0 1 0 50 84 a 44 44 0 1 1 -50 -84 z" fill="#EDEAF7" stroke="#B9B2D8" stroke-width="4"/><path d="M300 108 l 8 18 20 3 -14 14 3 20 -17 -10 -17 10 3 -20 -14 -14 20 -3 z" fill="#CFC9E8"/><g fill="#EDEAF7">${[[126, 320], [136, 356], [130, 392], [386, 320], [376, 356], [382, 392]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11"/>`).join("")}</g>` },

  { id: "solis", name: "Solis", tag: "Daybreak", tone: "lilac", edge: "#3A2414",
    skin: "honey", face: "round", eyes: "round", brow: "soft", mouth: "smile", bust: "#8A6A2E", hair: "bowl", hairColor: "#3A2414",
    back: rayArc(13, -172, -8, 132, 244, 11, GOLD),
    front: `<path d="M130 216 q 126 -74 252 0 q -14 30 -34 20 q -92 -48 -184 0 q -20 10 -34 -20 z" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="5"/><path d="M256 132 l 10 26 26 10 -26 10 -10 26 -10 -26 -26 -10 26 -10 z" fill="#FFF7DC"/>` },

  // --- v2's twelve new faces --------------------------------------------------
  // The set was 21 faces and every one of them was a person. These add the two
  // things it had none of — a South Asian line, which is the audience Ludo
  // actually has, and a handful of characters who are not human at all.

  { id: "momo", name: "Momo", tag: "Steamed Fresh", tone: "slate", edge: "#FDF7EA", rim: "#8B8881",
    skin: "#F7EEDA", face: "chubby", eyes: "kawaii", brow: "none", mouth: "tiny", mouthOpts: { ink: "#B4705A" }, noEars: true, noNose: true, bust: "#A26B3C", blush: "#F5A78E",
    back: `<g stroke="#D9E4EC" stroke-width="9" fill="none" stroke-linecap="round" opacity=".9"><path d="M150 130 q -20 -26 0 -52 q 20 -26 0 -52"/><path d="M368 126 q -20 -24 0 -48 q 20 -24 0 -48"/></g>`,
    collar: `<path d="M96 500 h 320 q -14 40 -46 44 H 142 q -32 -4 -46 -44 z" fill="#8A4E20"/>`,
    front: `<path d="M124 226 q 26 -40 46 2 q 24 -50 46 0 q 22 -52 40 0 q 20 -52 40 0 q 22 -50 46 0 q 20 -42 46 -2 q -14 -100 -132 -100 q -118 0 -132 100 z" fill="#FDF7EA" stroke="#8B8881" stroke-width="7" stroke-linejoin="round"/><g stroke="#E0D0B0" stroke-width="5" fill="none"><path d="M170 228 q 4 -58 30 -86 M216 228 q -2 -62 20 -90 M256 228 v -92 M296 228 q 2 -62 -20 -90 M342 228 q -4 -58 -30 -86"/></g><path d="M124 226 q 132 -30 264 0" stroke="#E6D7B8" stroke-width="6" fill="none"/>` },

  { id: "tashi", name: "Tashi", tag: "Red Panda", tone: "pearl", edge: "#C9673A",
    skin: "#E9AE72", face: "wide", eyes: "beady", brow: "none", mouth: "none", noEars: true, noNose: true, bust: "#5C4A3C", blush: "#D9825A",
    back: `<circle cx="118" cy="182" r="58" fill="#C9673A"/><circle cx="394" cy="182" r="58" fill="#C9673A"/><circle cx="118" cy="182" r="34" fill="#F6E2CE"/><circle cx="394" cy="182" r="34" fill="#F6E2CE"/>`,
    front: `<path d="M132 250 C 130 166 184 128 256 128 C 328 128 382 166 380 250 C 362 206 322 184 256 184 C 190 184 150 206 132 250 Z" fill="#C9673A"/><path d="M156 262 q 46 -34 88 4 q -44 42 -88 -4 z" fill="#F6E2CE"/><path d="M356 262 q -46 -34 -88 4 q 44 42 88 -4 z" fill="#F6E2CE"/><ellipse cx="256" cy="356" rx="54" ry="38" fill="#F6E2CE"/><path d="M256 334 l 17 14 -17 16 -17 -16 z" fill="#3A2A20"/><path d="M256 364 v 8 q 0 12 -15 12 M256 372 q 0 12 15 12" stroke="#8A6A58" stroke-width="6" fill="none" stroke-linecap="round"/>` },

  { id: "bolt", name: "Bolt", tag: "Unit B-7", tone: "pearl", edge: "#8E9BAA",
    skin: "#C9D2DC", face: "square", eyes: "glow", eyeOpts: { glow: "#37D9E8" }, brow: "none", mouth: "bot", noNose: true, noEars: true, bust: "#3A4655",
    back: `<circle cx="118" cy="300" r="30" fill="#96A3B2"/><circle cx="394" cy="300" r="30" fill="#96A3B2"/><circle cx="118" cy="300" r="13" fill="#37D9E8"/><circle cx="394" cy="300" r="13" fill="#37D9E8"/><path d="M256 108 v -46" stroke="#96A3B2" stroke-width="12"/><circle cx="256" cy="52" r="20" fill="#F05A4B"/>`,
    front: `<path d="M128 244 C 124 150 180 104 256 104 C 332 104 388 150 384 244 Z" fill="#8E9BAA"/><path d="M256 104 c 62 0 104 32 118 86 -24 -36 -64 -56 -118 -56 z" fill="#B7C2CD"/><rect x="118" y="234" width="276" height="26" rx="13" fill="#5E6B7A"/><path d="M228 268 l 24 -22 -8 26 20 -4 -28 34 8 -26 z" fill="#FFD84D"/>` },

  { id: "mira", name: "Mira", tag: "Jasmine", tone: "orchid", edge: "#1C1008",
    skin: "honey", face: "heart", eyes: "lash", brow: "arch", mouth: "lips", mouthOpts: { lip: "#C24A62" }, bust: "#C2456B", hair: "longStraight", hairColor: "#1C1008",
    front: `<circle cx="256" cy="228" r="11" fill="#C2264E"/><path d="M136 214 q 120 -70 240 0" stroke="${GOLD}" stroke-width="7" fill="none"/><path d="M256 208 v -44" stroke="${GOLD}" stroke-width="7"/><circle cx="256" cy="158" r="15" fill="${GOLD_L}" stroke="${GOLD_D}" stroke-width="4"/>${[-1, 1].map((s) => `<g transform="translate(${256 + s * 130},336)"><circle cx="0" cy="0" r="12" fill="${GOLD}"/><path d="M-20 16 h 40 l -14 26 h -12 z" fill="${GOLD_L}" stroke="${GOLD_D}" stroke-width="4"/><circle cx="0" cy="50" r="8" fill="${GOLD}"/></g>`).join("")}` },

  { id: "rana", name: "Rana", tag: "Rajput", tone: "pearl", edge: "#E8A32C", rim: "#976A1D",
    skin: "honey", face: "square", eyes: "almond", brow: "thick", mouth: "smile", mouthOpts: { y: 376 }, bust: "#AE4E38", browColor: "#241505",
    hat: "turban", hatColor: "#E8A32C",
    front: `<path d="M318 108 q 46 -34 62 10 q -30 -4 -50 20 z" fill="#C2264E"/><circle cx="256" cy="176" r="18" fill="#C2264E" stroke="${GOLD_D}" stroke-width="5"/><path d="M172 346 q 34 -28 70 -8 M340 346 q -34 -28 -70 -8" stroke="#241505" stroke-width="16" fill="none" stroke-linecap="round"/>` },

  { id: "sylva", name: "Sylva", tag: "Grovekeeper", tone: "lilac", edge: "#2E7E5B",
    skin: "#F0D7BC", face: "heart", eyes: "almond", eyeOpts: { ink: "#1E3B2A" }, brow: "arch", mouth: "smile", bust: "#3A6B57", hair: "curtain", hairColor: "#2E7E5B", noEars: true, browColor: "#276148",
    back: `<path d="M128 236 L 78 176 q 60 -18 74 34 z" fill="#F0D7BC"/><path d="M384 236 L 434 176 q -60 -18 -74 34 z" fill="#F0D7BC"/>`,
    front: `<path d="M140 200 q 116 -72 232 0" stroke="#6B4A2E" stroke-width="10" fill="none"/>${[[168, 178, -30], [212, 152, -16], [256, 142, 0], [300, 152, 16], [344, 178, 30]].map(([x, y, r]) => `<path d="M${x} ${y} q -22 -22 0 -40 q 22 18 0 40 z" fill="#4FA96E" transform="rotate(${r} ${x} ${y})"/>`).join("")}<circle cx="212" cy="158" r="8" fill="#F2E27A"/><circle cx="300" cy="158" r="8" fill="#F2E27A"/>` },

  { id: "draco", name: "Draco", tag: "Hatchling", tone: "pearl", edge: "#5EA372",
    skin: "#79C08A", face: "wide", eyes: "gem", eyeOpts: { glow: "#F5C542" }, brow: "none", mouth: "tooth", mouthOpts: { ink: "#4F7A57" }, noEars: true, noNose: true, bust: "#3E6B4E", blush: "#4F9E66",
    back: `<path d="M126 226 L 60 132 q 76 -6 110 58 z" fill="#5EA372"/><path d="M386 226 L 452 132 q -76 -6 -110 58 z" fill="#5EA372"/><path d="M118 300 q -46 -10 -58 -50 q 42 8 62 26 z" fill="#4C8B5F"/><path d="M394 300 q 46 -10 58 -50 q -42 8 -62 26 z" fill="#4C8B5F"/>`,
    front: `<path d="M128 240 C 124 156 180 112 256 112 C 332 112 388 156 384 240 C 366 198 322 176 256 176 C 190 176 146 198 128 240 Z" fill="#5EA372"/><path d="M256 84 l 16 40 h -32 z M204 104 l 14 34 h -28 z M308 104 l 14 34 h -28 z" fill="#F5C542"/><ellipse cx="256" cy="344" rx="52" ry="38" fill="#8FCE9E"/><circle cx="238" cy="332" r="7" fill="#3E6B4E"/><circle cx="274" cy="332" r="7" fill="#3E6B4E"/>` },

  { id: "vega", name: "Vega", tag: "Deep Field", tone: "slate", edge: "#EDF2F7", rim: "#828588",
    skin: "brown", face: "round", eyes: "big", brow: "soft", mouth: "smile", bust: "#DCE3EA", noEars: true, browColor: "#2A1A10",
    back: `<circle cx="256" cy="286" r="196" fill="#EDF2F7"/><circle cx="256" cy="286" r="196" fill="none" stroke="#828588" stroke-width="10"/>`,
    front: `<path d="M116 218 a 150 150 0 0 1 280 0 q -30 46 -140 46 q -110 0 -140 -46 z" fill="#2E3E55"/><path d="M148 206 a 118 118 0 0 1 84 -74 q -66 26 -76 80 z" fill="#8FB6E0" opacity=".7"/><rect x="66" y="270" width="44" height="60" rx="14" fill="#C3CEDA"/><rect x="402" y="270" width="44" height="60" rx="14" fill="#C3CEDA"/>` },

  { id: "frost", name: "Frost", tag: "First Snow", tone: "slate", edge: "#DCE7F0", rim: "#797F84",
    skin: "porcelain", face: "oval", eyes: "almond", eyeOpts: { ink: "#25405C" }, brow: "arch", mouth: "lips", mouthOpts: { lip: "#B76A86" }, bust: "#4E6E8E", hair: "longStraight", hairColor: "#DCE7F0", browColor: "#A8BECF",
    back: `<g fill="#FFFFFF" opacity=".75">${[[104, 150, 9], [150, 96, 7], [398, 160, 8], [356, 100, 6], [86, 330, 7], [430, 320, 9], [122, 430, 6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("")}</g>`,
    front: `<path d="M136 202 q 120 -74 240 0" stroke="#9EC6E0" stroke-width="9" fill="none"/><g stroke="#EAF4FB" stroke-width="7" stroke-linecap="round" fill="none"><path d="M256 106 v 62 M229 122 l 54 30 M283 122 l -54 30"/></g><circle cx="256" cy="138" r="11" fill="#fff"/>` },

  { id: "diya", name: "Diya", tag: "Festival of Lights", tone: "violet", edge: "#2A150A",
    skin: "olive", face: "oval", eyes: "lash", brow: "arch", mouth: "lips", mouthOpts: { lip: "#C0405F" }, bust: "#7A2F5E", hair: "wavy", hairColor: "#2A150A",
    // The sheet ringed Diya in a full circle of festival rays. Struck over the
    // head only, they are a halo she wears; struck all the way round, they are
    // a pattern on the chip, and a patterned chip competes with the board.
    back: `<g opacity=".55">${rayArc(13, -168, -12, 150, 246, 9, "#F5B93C")}</g>`,
    front: `<circle cx="256" cy="230" r="10" fill="#C2264E"/>${[[150, 178], [196, 150], [256, 140], [316, 150], [362, 178]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 2 ? 20 : 16}" fill="#F0932B"/><circle cx="${x}" cy="${y}" r="${i === 2 ? 11 : 9}" fill="#FFE08A"/>`).join("")}<path d="M134 196 q 122 -80 244 0" stroke="#D96C1F" stroke-width="9" fill="none"/>` },

  { id: "ember", name: "Ember", tag: "Phoenix Heir", tone: "pearl", edge: "#C2401C",
    skin: "tan", face: "heart", eyes: "lash", eyeOpts: { ink: "#3A1408" }, brow: "arch", mouth: "lips", mouthOpts: { lip: "#C43B47" }, bust: "#8A4030", hair: "longStraight", hairColor: "#C2401C", browColor: "#9A2F12",
    back: `<path d="M112 276 q -56 -76 -20 -160 q 40 62 40 120 z" fill="#F0932B"/><path d="M400 276 q 56 -76 20 -160 q -40 62 -40 120 z" fill="#F0932B"/><path d="M146 232 q -34 -66 -6 -122 q 26 50 26 96 z" fill="#F5C542"/><path d="M366 232 q 34 -66 6 -122 q -26 50 -26 96 z" fill="#F5C542"/>`,
    front: `<path d="M256 96 q 44 44 22 92 q -22 -34 -22 -34 q 0 34 -22 34 q -22 -48 22 -92 z" fill="#FFD75E"/><path d="M134 208 q 122 -76 244 0 q -16 26 -38 14 q -84 -46 -168 0 q -22 12 -38 -14 z" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="5"/>` },

  { id: "rani", name: "Rani", tag: "The Maharani", tone: "orchid", edge: "#1A0E06",
    skin: "honey", face: "heart", eyes: "lash", brow: "arch", mouth: "lips", mouthOpts: { lip: "#B02F52" }, bust: "#8A3159", hair: "longStraight", hairColor: "#1A0E06",
    collar: `<path d="M256 470 q 70 4 92 46 q -92 22 -184 0 q 22 -42 92 -46 z" fill="${GOLD}" opacity=".9"/>`,
    front: `<path d="M140 190 L 156 116 L 196 158 L 256 92 L 316 158 L 356 116 L 372 190 Z" fill="${GOLD_L}" stroke="${GOLD_D}" stroke-width="7" stroke-linejoin="round"/><rect x="132" y="182" width="248" height="34" rx="16" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="6"/>${[[180, 199], [218, 199], [294, 199], [332, 199]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="#F4F0FF"/>`).join("")}<circle cx="256" cy="199" r="12" fill="#C2264E" stroke="${GOLD_D}" stroke-width="4"/><circle cx="256" cy="236" r="10" fill="#C2264E"/><path d="M140 300 q -22 44 0 72" stroke="${GOLD}" stroke-width="8" fill="none"/><circle cx="140" cy="378" r="13" fill="${GOLD_L}" stroke="${GOLD_D}" stroke-width="4"/><path d="M372 300 q 22 44 0 72" stroke="${GOLD}" stroke-width="8" fill="none"/><circle cx="372" cy="378" r="13" fill="${GOLD_L}" stroke="${GOLD_D}" stroke-width="4"/><path d="M300 326 q 24 4 28 -12" stroke="${GOLD}" stroke-width="6" fill="none"/>` },
];
