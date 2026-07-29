# Design System: Ludo

Single source of truth for the app's visual language. Adapted from the
stitch-design-taste directives for a **React Native (Expo + Skia)** game.
The Skia board is the centerpiece; everything else is restrained chrome that
frames it without competing.

## 1. Visual Theme & Atmosphere

Density **3** (airy, focused — the board breathes), Variance **5** (deliberate
asymmetry in the chrome, never in the board grid), Motion **7** (tactile,
physical — dice tumble, tokens hop, turns pulse).

A dark, tactile "game table at night" mood: a deep charcoal felt surface with a
single raised board that reads as a physical object — soft inner depth, no flat
fills. Calm and premium between turns; alive and physical during them. The
interface gets out of the way of play.

## 2. Color Palette & Roles

### Chrome neutrals (the table, panels, text)
- **Felt Charcoal** (#14171C) — primary app background (never pure black).
- **Raised Slate** (#1C2026) — panels, the board base plate.
- **Lifted Slate** (#242932) — elevated cards, the dice tray.
- **Hairline** (rgba(255,255,255,0.08)) — 1px structural separators.
- **Porcelain** (#F4F6F8) — primary text, token glyphs on dark.
- **Muted Steel** (#9BA3AF) — secondary text, metadata, inactive players.
- **Ivory Cell** (#ECE9DF) — empty track squares on the board.

### Functional team palette (RESERVED for tokens, yards, home columns, start cells)
These four are the only saturated colors in the product and appear **only** on
the board and a player's own panel — never as generic UI accents. Calibrated to
sit together on dark without vibrating (no fire-engine primaries).
- **Vermilion** (#E5484D) — red player.
- **Jade** (#2FA968) — green player.
- **Marigold** (#EFB728) — yellow player (use Felt Charcoal text on top).
- **Cobalt** (#3E63DD) — blue player.

### Dynamic accent
There is **no fixed accent color.** The active accent — primary CTA fill, focus
ring, active-turn pulse — is **the current player's team color**. On neutral
screens (Home) with no turn context, the primary CTA uses **Porcelain** fill with
Felt Charcoal text. This makes "whose turn it is" the loudest signal in the app.

## 3. Typography

- **Display / UI:** `Outfit` — geometric, warm, confident. Titles, player names,
  turn labels, buttons. Hierarchy via weight (600/700) + color, not giant sizes.
- **Numeric / Mono:** `JetBrains Mono` — dice value, token counts, room codes,
  timers. All standalone numbers are mono.
- **Body:** `Outfit` 400/500, relaxed leading, secondary color for support text.
- Load via `@expo-google-fonts/outfit` and `@expo-google-fonts/jetbrains-mono`.
- **Banned:** Inter, system-default for headings, any serif, ALL-CAPS sentences
  (single-word labels like "ROLL" may be uppercase).

## 4. Component Stylings

- **Buttons:** Flat fills, generous rounding (16px), comfortable height (≥52px,
  always ≥44px tap target). Tactile press: scale to 0.96 + 1px down-translate on
  pressIn (spring back on release). No outer glow, no gradient borders.
- **Primary CTA (Roll):** Filled in the active player's color; large, thumb-reachable,
  bottom of the Game screen. Disabled = Lifted Slate fill, Muted Steel label.
- **Panels / Cards:** Raised Slate fill, 20px rounding, a soft *downward* shadow
  tinted toward Felt Charcoal (not black), 1px Hairline. Cards only when elevation
  means something (a player's turn, the dice tray).
- **Player panel:** Compact row — color chip, name, count of finished tokens
  (mono). The active player's panel lifts (Lifted Slate) with a soft pulsing ring
  in their color; inactive panels recede (Muted Steel text, flat).
- **Dice:** A physical rounded square (Lifted Slate, soft depth) in a tray, pips
  in Porcelain. Tumbles on roll and settles with a spring; idle dice float gently.
- **Inputs (room code / name):** Label above in Muted Steel, field in Raised Slate
  with Hairline border, focus ring in Porcelain. Mono for the code field.
- **Empty / Loading:** Skeletal shimmer blocks matching panel dimensions — never a
  spinner. Empty lobby = a composed "waiting for players" seat layout, not bare text.

## 5. Layout Principles (React Native)

- Flexbox (RN has no CSS grid); spacing on an 8pt scale (4/8/12/16/24/32).
- The board is a centered square sized to `min(screenWidth − 32, screenHeight × 0.5)`
  so it never crowds the panels or the Roll button.
- Game screen vertical rhythm: opponents row (top) → board (center) → your panel +
  dice + Roll (bottom, thumb zone).
- Home is the game hub (arcade-lobby structure, our visual language): a lean
  status header — wallet pills (coins, gems) on the left, identity + settings on
  the right, no wordmark (the diorama and app icon carry the brand; the animated
  mark lives on the loading screen) — over a single centered hero — the
  player's *equipped* board, pawns and die staged in the lamplight as a Skia
  diorama — over one dominant PLAY CTA, a terse row of mode tiles, and a bottom
  dock of drawn-glyph entries (Shop, Friends, Stats, How to play). One screen,
  no scrolling: only the diorama flexes; header, tiles, dock and ad strip are
  fixed-height. The hero must always display real equipped cosmetics — it is a
  showcase, never stock art. Social proof under PLAY uses real presence counts
  only, and hides at zero.
- Generous safe-area padding; respect notches/home indicators (`SafeAreaView`).
- Single column always (it's a phone); no horizontal scroll anywhere.

## 6. Motion & Interaction

- Spring physics everywhere: `stiffness 100, damping 20` default. No linear easing.
- **Dice roll:** quick tumble (rotate + scale jitter) resolving to the value with a
  settle spring (~450ms). Haptic tap on settle.
- **Token move:** hops cell-to-cell along its path — a short arc (translateY dip +
  scale 1.0→1.08→1.0) per step, staggered, not a straight slide.
- **Capture:** captured token scales to 0 and arcs back to its yard slot.
- **Active turn:** the current player's panel + their start cell breathe with a slow
  perpetual pulse (opacity/scale loop) in their color.
- Animate only `transform` + `opacity`. Heavy board animation stays in Skia /
  isolated components to protect 60fps.
- (Implementation note: Reanimated drives chrome motion; added/​tuned on-device in
  the polish milestone. Core board renders correctly without it.)

## 7. Anti-Patterns (Banned)

- No emojis in app chrome (use Skia/SVG shapes and glyphs). Exception: player
  expression — chat reactions and the speech bubbles beside avatars are emoji
  by design (Ludo Club convention).
- No `Inter`, no system-default headings, no serif fonts.
- No pure black `#000000` — Felt Charcoal is the floor.
- No neon glows, no oversaturated/fire-engine player colors, no rainbow gradients.
- The four team colors are board-only — never generic button/text accents.
- No generic circular loading spinners.
- No placeholder names ("John Doe", "Player1") — use real-feel names or "You".
- No AI copy clichés ("Seamless", "Elevate", "Unleash", "Next-Gen").
- Centered heroes and equal tile/dock rows are permitted **only on the Home
  hub** (hero diorama, mode-tile row, dock). Every other screen stays
  asymmetric — no centered heroes, no equal-card grids elsewhere.
- No fake round stats; no broken remote images (board art is drawn in Skia).
