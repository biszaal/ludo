# Skeletons for the cold wait

**Status:** design, approved for planning
**Date:** 2026-09-04
**Branch:** `feat/weak-link-and-motion-tiers`

## Problem

Seven surfaces across six screens fetch over the network, and every one of them
renders something *wrong* while it waits.

| Surface | On screen during the wait | Why that is wrong |
|---|---|---|
| Shop grid (`CosmeticsBrowser mode="shop"`) | An empty grid | Reads as "nothing for sale" |
| Customize locker (`CosmeticsBrowser mode="locker"`) | An empty grid | Reads as "you own nothing" |
| Friends list | An empty list | Reads as "you have no friends" |
| Add friend — your code | `ActivityIndicator` | A spinner, banned by DESIGN §7 |
| Add friend — recently played with | The section is absent | Silently missing, no trace |
| Player profile card | Name renders as `"Ludo player"` | Names a stranger something they are not |
| Account tray | The guest "Save account" pitch | **Tells a signed-in player they are a guest** |

The last two are worse than blank: they are confidently false for a beat and
then change their mind.

The shop row is not hypothetical. It was reported as a bug — "avatars are not
loading on the shop" — and then withdrawn a minute later — "nvm it is loading
now". Nothing had failed. `sellableItems` filters on `inCatalog(prices, sku)`
(`lib/cosmetics.ts`), so before the catalog fetch resolves the grid is
legitimately empty, and the screen offers no way to tell that apart from a shop
with nothing in it. A wait that cannot be distinguished from a result is a bug
whether or not the fetch eventually lands.

DESIGN.md §4 already prescribes the fix — "**Empty / Loading:** Skeletal
shimmer blocks matching panel dimensions — never a spinner" — and §7 bans
"generic circular loading spinners". This design implements a convention the
project already committed to, and retires the one spinner that shipped against
it.

## The distinction this rests on: cold, not refreshing

The app is local-first. `profileStore`, `settingsStore`, `statsStore`,
`walletStore`, `entitlementsStore` and `configStore` all persist through
`zustand/persist`, so most screens hold real data before any request is made. A
skeleton drawn over data we already have is a regression — it replaces
something true with something that only promises to become true.

**So a skeleton appears only where there is nothing to show, and never over
cached content.**

That rule is what decides the scope, and it excludes more than it includes:

- **Home, Settings, How to play, Stats and match history** get nothing. Stats
  and history are local (`statsStore`); there is no fetch to wait on.
- **The Account identity tray** gets nothing, deliberately.
  `currentName = mine?.displayName || displayName` (`AccountScreen.tsx`) is a
  considered local-first fallback: the server's copy is authoritative, and
  until it lands the persisted local name is already correct. Shimmering over a
  correct name would be a downgrade.
- **Game, Lobby and Online** get nothing. Their waits already have shapes —
  `QuickMatchSearch`, `ConnectionStrip`, `DealingOverlay`.

One detail worth recording so it is not rediscovered: `kvStorage` is
AsyncStorage (`lib/storage.ts`), so persisted stores rehydrate on a later tick
rather than at first paint, and nothing in the codebase reads
`persist.hasHydrated()`. In practice `LoadingScreen`'s `MIN_VISIBLE_MS` floor of
650ms covers rehydration on launch, so hydration is *not* the cold case this
design targets. The durable cold case is a fetch that has never happened (fresh
install, cleared data) or one that is slow or failed.

## Design

### The phase, as arithmetic

`src/lib/loadPhase.ts` — pure, no React Native import, Node-testable, in the
same shape as `motionTier.ts` beside `useMotion.ts`.

```ts
export type LoadPhase = "cold" | "stalled" | "ready";

export interface LoadSignals {
  /** Do we hold something worth showing right now? */
  hasData: boolean;
  /** Has an attempt finished and failed? */
  failed: boolean;
  /** ms since this wait began. */
  elapsedMs: number;
}

export const STALL_AFTER_MS = 6000;
export const SHOW_AFTER_MS = 120;
export const MIN_DWELL_MS = 400;

export function loadPhase(s: LoadSignals): LoadPhase;
```

| Condition | Phase |
|---|---|
| `hasData` | `ready` |
| `failed`, or `elapsedMs >= STALL_AFTER_MS` | `stalled` |
| otherwise | `cold` |

`hasData` wins over `failed`: a refresh that fails while we hold a cached
catalog is not the player's problem, and the shop should keep working. Only a
wait with nothing behind it can reach `stalled`.

`stalled` is the half of this that earns its place. A skeleton that shimmers
forever is worse than an empty grid — it promises content that is not coming
and offers nothing to do about it. Six seconds sits just past
`ConnectionStrip`'s `AT_RISK_AFTER_MS` of 5000, which is already this app's
considered answer to "how long before a wait is worth mentioning".

### The dwell pair

`SHOW_AFTER_MS` and `MIN_DWELL_MS` are the anti-flash pair. Do not paint a
skeleton for a wait that resolves in 50ms — the surface was going to be empty
for those 50ms either way, and a skeleton that appears and vanishes inside three
frames reads as a glitch. Once painted, hold it 400ms so it does not blink out.
`LoadingScreen` already makes this argument for the launch screen; the same
reasoning, the same shape.

The arithmetic lives in `loadPhase.ts` and is unit-tested. The timers live in
`src/lib/useLoadPhase.ts`, the React Native wrapper.

### The primitive

`src/components/Skeleton.tsx` exports:

- `SkeletonGroup` — owns **one** shared value for every block inside it, and
  reads `useFullMotion()`. Carries `accessibilityRole="progressbar"` with a
  label naming what is loading.
- `SkeletonBlock` — a rounded rectangle at a given width, height and radius,
  `accessible={false}`.
- `SkeletonLine` — a block at text-line proportions, for name and caption rows.

Each block reads its slice of the group's cycle through
`arc(wave, index, span, stagger)` (`lib/motion.ts`) and lifts a faint porcelain
sheen over itself, so a grid ripples rather than pulsing in unison — one
animation driving a cluster, exactly as `LoadingScreen`'s tile wave does.
Opacity only, per DESIGN §6.

The sheen is an opacity lift and not a band translated across the block. A real
sweep needs the block's pixel width to know how far to travel, and several
blocks are percentage-width — the cosmetic swatches are `22%` — so it would
cost an `onLayout` measure per block to animate a highlight nobody parses at
1.4s a cycle. The ripple that actually reads is the one *across* the blocks,
and the stagger already carries it.

On the `reduced` motion tier the group never starts the loop and blocks render
flat `liftedSlate`. `SettingsScreen` already reads `useFullMotion()` to drive
the motion toggle's own value; skeletons are the first surface to change what it
*draws* because of it.

Blocks sit on `liftedSlate` against `raisedSlate` panels, so they read as part
of the tray rather than as holes cut in it.

### The stalled card

`src/components/LoadFailed.tsx` — a `Surface3D` holding one sentence of plain
copy naming what did not arrive, and a Retry button wired to the same loader
that failed. No error codes, no apology.

### Compositions live beside the markup they mimic

There is no `components/skeletons/` directory. `CosmeticsBrowser` owns its grid
skeleton, `FriendsScreen` owns its row skeleton, and so on. A skeleton's only
job is to match the geometry of the real thing, and that stays true only while
the two are edited together.

### Store changes

Smaller than expected — most of the signal already exists.

**`entitlementsStore`** — `catalogKnown(prices)` is already `hasData`. Add a
non-persisted `failed: boolean`, set in the `catch` that currently swallows the
error silently and cleared on success. That is what feeds the retry card.

**`friendsStore`** — `ready` is set `true` *before* `refresh()` runs, so it
means "signed in", not "list loaded"; a fresh mount has `ready === true` and
`friendships === []` while the fetch is in flight. Add a separate `loaded`
flag, set after the first `refresh()` resolves, plus `failed`.

While adding that: `refresh()` has no `try/catch`, and every caller invokes it
as `void refresh()`. **A failed friends fetch is an unhandled promise rejection
today.** Wrapping it is required for `failed` anyway, so the fix comes with the
work rather than as a separate change.

`recentPlayers` needs a flag of its own, `recentLoaded`. An empty array cannot
answer `hasData`: "fetched, and you have played nobody new" and "not fetched
yet" are the same value, and they want opposite treatments — the first hides
the section, the second shimmers it.

**Your code and the player profile card** need no new state — `myCode` and
`profiles[userId]` are each non-null only once their fetch has landed, so they
answer `hasData` directly.

### Surface by surface

| Surface | `hasData` | Skeleton |
|---|---|---|
| Shop grid | `catalogKnown(prices)` | Hero block, caption lines, 4-column swatch grid |
| Locker | `catalogKnown(prices)` | Same composition |
| Friends list | `friends.loaded` | Three friend rows (avatar, name line, action) |
| Your code | `!!myCode` | One mono-width block, replacing `ActivityIndicator` |
| Recently played | `friends.recentLoaded` | Two rows under the section label |
| Player profile | `!!profiles[userId]` | Avatar circle, name bar, record tray |
| Account tray | `identity !== null` | Two text lines and a button-height block |

## Failure modes

- **Fetch resolves inside `MIN_DWELL_MS`.** The skeleton is held the remaining
  few hundred ms. Deliberate; a blink costs more than the delay.
- **Fetch resolves inside `SHOW_AFTER_MS`.** No skeleton ever paints.
- **Fetch fails, retry succeeds.** `failed` clears on success, phase returns to
  `ready`, card is replaced by content.
- **Offline indefinitely.** `stalled` at 6s, retry card, tappable as often as
  the player likes.
- **Refresh fails over a cached catalog.** `hasData` is true, so nothing
  changes on screen. The shop keeps working offline.
- **Reduced motion tier.** Static blocks, same layout, no loop.

## Risks

- **Geometry drift.** A skeleton that no longer matches its panel is worse than
  none, because the content jumps when it resolves. Colocation is the
  mitigation; there is no automated check.
- **6s may be early on a genuinely weak link.** This branch exists because weak
  links are real. If the retry card proves to appear over links that were about
  to succeed, `STALL_AFTER_MS` is one constant in a pure module.
- **`friendsStore` carries realtime subscriptions**, so adding flags there is
  the highest-risk edit in the set. The change is additive — new fields, one
  `try/catch` — and touches no subscription logic.

## Out of scope

- Payload work and connection awareness beyond what this branch already has.
- Home, Settings, How to play, Stats, match history, Game, Lobby, Online.
- Hydration gating via `persist.hasHydrated()`. `LoadingScreen` covers it.
- A React Native render-test harness. `vitest` runs Node-only by design.

## Testing

`__tests__/loadPhase.test.ts`, written before the module:

- `hasData` returns `ready` regardless of `failed` or `elapsedMs`
- `failed` without data returns `stalled` at any elapsed time
- elapsed at, just under, and just over `STALL_AFTER_MS`
- neither failed nor stalled nor holding data returns `cold`
- the dwell constants order correctly (`SHOW_AFTER_MS < MIN_DWELL_MS < STALL_AFTER_MS`)

Then `npx tsc --noEmit` and the full `npx vitest run` for the store changes
(`entitlementsStore.test.ts` and any friends coverage), and an on-device pass
through the simulator recipe for the seven compositions, in both motion tiers
and with the network off. The visuals are not claimed working until seen.

## Rollout

Client-only. No edge function, no migration, no server change, no feature flag.
Ships with the branch.
