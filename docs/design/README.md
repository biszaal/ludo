# Design sources

Verbatim exports of design work, kept here so the values the app is built from
outlive the tool they were drawn in.

## 2026-09-20-premium-boards-and-dice.html

Nine board + dice "sets" — Pressed Herbarium, Moss & River Stone, Amber
Inclusion, Glacier Optic, Urushi Vermilion, Celadon Porcelain, Titanium &
Bronze, Voyager Travel Set, Carbon Monocoque. Each set is a board and a matching
pair of dice, sellable apart or as a bundle at −20%.

Exported from Claude Design; the file is a templated document, so the numbers
are not in the markup. Everything worth reading is the `specs` array in the
trailing `<script type="text/x-dc">` block, one object per set:

- `colors` — the seat palette, red/green/blue/yellow, as this board renders them
  (`BoardTheme.team`).
- `board` — `bg`, `gridBg`, `cell`, `cellBorder`, `cellShadow`, `plateTint`,
  `plateInner`, `plateShadow`, `seatRing`, `seatFill`, `frame`, `radius`.
- `decor` — placed frame ornament, as `leaf/petal/blob/fleck(x%, y%, w, h, rot,
  fill, edge, alpha)`. Only the three nature sets carry it.
- `die` — `face`, `faceTop`, `border`, `inset`, `pip`, `pipShadow`, `radius`.
- `boardPrice` / `dicePrice` / `setPrice` / `currency`.

Read it with a browser, or pull the data out directly:

    sed -n '/const specs = \[/,/^    \];/p' docs/design/2026-09-20-premium-boards-and-dice.html

Two places the implementation deliberately departs from it:

- **Safe squares stay stars.** The mock marks start cells with a glowing rotated
  square and the other four safe cells with a plain ring. All eight cells are
  correctly placed (they match `SAFE_SQUARES` in `packages/engine/src/board.ts`),
  but the star is gameplay information, not decoration, and it stays.
- **Coin sets stay matte.** `sheen` is the paid-tier tell and
  `apps/mobile/__tests__/diceSkins.test.ts` enforces it both ways, so the gloss
  the mock gives Celadon and Carbon is rendered as material, not as `sheen`.
