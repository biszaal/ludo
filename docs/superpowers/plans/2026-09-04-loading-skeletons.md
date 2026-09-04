# Loading Skeletons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the seven network-backed surfaces in the mobile app a skeletal
loading state, so none of them renders a wrong or empty answer while it waits.

**Architecture:** A pure phase module (`lib/loadPhase.ts`) decides
`cold | stalled | ready` and, with the anti-flash dwell rules, what the screen
should actually show. A thin React Native hook (`lib/useLoadPhase.ts`) owns the
timers. One primitive (`components/Skeleton.tsx`) draws the blocks, driven by a
single shared value per group and gated on the device's motion tier. Each
screen composes its own skeleton beside the markup it mimics.

**Tech Stack:** Expo SDK 56 (`expo ~56.0.12`), React Native 0.85.3, React
19.2.3, TypeScript, Zustand, Reanimated, Vitest (Node environment only — no
React Native render harness exists).

Per `apps/mobile/AGENTS.md`: read the versioned docs at
<https://docs.expo.dev/versions/v56.0.0/> before writing code against any Expo
API. No task in this plan introduces a new Expo API — the components use React
Native and Reanimated primitives already in use elsewhere in the app.

**Spec:** `docs/superpowers/specs/2026-09-04-loading-skeletons-design.md`

## Global Constraints

- Run all commands from `apps/mobile/`. Tests: `npm test`. Types: `npm run typecheck`.
- **No new dependencies.** Nothing gets added to `package.json`.
- **No spinners.** DESIGN.md §7 bans generic circular loading indicators. Task 9 deletes the one that shipped.
- **Animate only `transform` and `opacity`** (DESIGN.md §6).
- **Colors come from `src/theme.ts` tokens only.** Skeleton blocks are `palette.liftedSlate`; the sheen is `palette.porcelain`. No hex literals.
- **The four team colors are board-only** — never used in a skeleton (DESIGN.md §7).
- **A skeleton never covers cached data.** `hasData` beats `failed` in every wiring.
- **Vitest runs in Node** (`environment: "node"`). Any module a test imports must not import `react-native`. This is why `loadPhase.ts` is pure and `useLoadPhase.ts` is separate, mirroring `motionTier.ts` / `useMotion.ts`.
- **`friendsStore` cannot be unit-tested** — it imports `AppState` from `react-native`. Its changes are verified by typecheck and on-device only. Do not write a test file for it.
- Commit after every task. No Claude/AI attribution or co-author trailers in commit messages.

---

## File Structure

**Created:**
- `src/lib/loadPhase.ts` — pure phase + dwell arithmetic. No imports.
- `src/lib/useLoadPhase.ts` — RN hook wrapping it with timers.
- `src/components/Skeleton.tsx` — `SkeletonGroup`, `SkeletonBlock`, `SkeletonLine`.
- `src/components/LoadFailed.tsx` — the stalled retry card.
- `__tests__/loadPhase.test.ts` — unit tests for the pure module.

**Modified:**
- `src/store/entitlementsStore.ts` — add `failed`.
- `src/store/friendsStore.ts` — add `loaded`, `failed`, `recentLoaded`; wrap `refresh()`.
- `src/components/CosmeticsBrowser.tsx` — shop + locker grid skeleton.
- `src/screens/FriendsScreen.tsx` — friends list skeleton.
- `src/screens/AddFriendScreen.tsx` — code card + recent players; deletes `ActivityIndicator`.
- `src/screens/PlayerProfileScreen.tsx` — profile card skeleton.
- `src/screens/AccountScreen.tsx` — account tray skeleton.
- `__tests__/entitlementsStore.test.ts` — cover the `failed` flag.

---

### Task 1: The pure phase module

**Files:**
- Create: `apps/mobile/src/lib/loadPhase.ts`
- Test: `apps/mobile/__tests__/loadPhase.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type LoadPhase = "cold" | "stalled" | "ready"`; `type SkeletonView = "hidden" | "skeleton" | "stalled" | "content"`; `interface LoadSignals { hasData: boolean; failed: boolean; elapsedMs: number }`; `loadPhase(s: LoadSignals): LoadPhase`; `skeletonView(o: { phase: LoadPhase; waitMs: number; shownMs: number | null }): SkeletonView`; constants `STALL_AFTER_MS = 6000`, `SHOW_AFTER_MS = 120`, `MIN_DWELL_MS = 400`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/loadPhase.test.ts`:

```ts
/**
 * When a wait earns a skeleton, and when it stops deserving one.
 *
 * The rule that matters most is that held data beats a failed refresh: a shop
 * that already has a catalog must keep working when the network drops, and
 * must never trade a working grid for a retry card.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_DWELL_MS,
  SHOW_AFTER_MS,
  STALL_AFTER_MS,
  loadPhase,
  skeletonView,
  type LoadSignals,
} from "../src/lib/loadPhase";

/** A wait that has just begun with nothing behind it. */
const FRESH: LoadSignals = { hasData: false, failed: false, elapsedMs: 0 };

describe("loadPhase", () => {
  it("is ready whenever we hold data, whatever else happened", () => {
    expect(loadPhase({ ...FRESH, hasData: true })).toBe("ready");
    expect(loadPhase({ hasData: true, failed: true, elapsedMs: 60_000 })).toBe("ready");
  });

  it("is cold while a young, unfailed wait has nothing to show", () => {
    expect(loadPhase(FRESH)).toBe("cold");
    expect(loadPhase({ ...FRESH, elapsedMs: STALL_AFTER_MS - 1 })).toBe("cold");
  });

  it("stalls on a failure, however early", () => {
    expect(loadPhase({ ...FRESH, failed: true })).toBe("stalled");
  });

  it("stalls once the wait passes the threshold", () => {
    expect(loadPhase({ ...FRESH, elapsedMs: STALL_AFTER_MS })).toBe("stalled");
    expect(loadPhase({ ...FRESH, elapsedMs: STALL_AFTER_MS + 1 })).toBe("stalled");
  });
});

describe("skeletonView", () => {
  it("shows nothing at all for a wait that resolves inside the show delay", () => {
    expect(skeletonView({ phase: "cold", waitMs: SHOW_AFTER_MS - 1, shownMs: null })).toBe("hidden");
    expect(skeletonView({ phase: "ready", waitMs: SHOW_AFTER_MS - 1, shownMs: null })).toBe("content");
  });

  it("paints the skeleton once the wait outlives the show delay", () => {
    expect(skeletonView({ phase: "cold", waitMs: SHOW_AFTER_MS, shownMs: null })).toBe("skeleton");
  });

  it("holds a painted skeleton for the minimum dwell, so it cannot blink", () => {
    expect(skeletonView({ phase: "ready", waitMs: 300, shownMs: MIN_DWELL_MS - 1 })).toBe("skeleton");
    expect(skeletonView({ phase: "ready", waitMs: 600, shownMs: MIN_DWELL_MS })).toBe("content");
  });

  it("never re-hides a skeleton it has already painted", () => {
    // waitMs is irrelevant once shownMs exists — the block is on screen.
    expect(skeletonView({ phase: "cold", waitMs: 10, shownMs: 5 })).toBe("skeleton");
  });

  it("gives a stalled wait the retry card", () => {
    expect(skeletonView({ phase: "stalled", waitMs: STALL_AFTER_MS, shownMs: 5000 })).toBe("stalled");
  });

  it("orders its constants so the delays cannot cross", () => {
    expect(SHOW_AFTER_MS).toBeLessThan(MIN_DWELL_MS);
    expect(MIN_DWELL_MS).toBeLessThan(STALL_AFTER_MS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/mobile && npx vitest run __tests__/loadPhase.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/lib/loadPhase"`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/mobile/src/lib/loadPhase.ts`:

```ts
/**
 * When a wait has earned a skeleton, and when it has stopped deserving one.
 *
 * Pure and dependency-light (no react-native import) so the Node test suite can
 * exercise the thresholds directly, exactly as motionTier.ts / useMotion.ts and
 * layout.ts / useLayout.ts split. The timers live in useLoadPhase.ts.
 *
 * The app is local-first: most stores persist, so most screens hold real data
 * before any request is made. A skeleton drawn over data we already have
 * replaces something true with something that only promises to become true.
 * Hence the rule this module encodes above all others — holding data wins over
 * every other signal, a failed refresh included.
 */

/** What the fetch is doing. */
export type LoadPhase = "cold" | "stalled" | "ready";

/** What the screen should actually render. */
export type SkeletonView = "hidden" | "skeleton" | "stalled" | "content";

export interface LoadSignals {
  /** Do we hold something worth showing right now? */
  hasData: boolean;
  /** Has an attempt finished and failed? */
  failed: boolean;
  /** ms since this wait began. */
  elapsedMs: number;
}

/**
 * How long a wait may go unexplained before it is treated as broken.
 *
 * A skeleton that shimmers forever is worse than an empty grid — it promises
 * content that is not coming and offers nothing to do about it. Six seconds
 * sits just past ConnectionStrip's AT_RISK_AFTER_MS of 5000, which is already
 * this app's answer to "how long before a wait is worth mentioning".
 */
export const STALL_AFTER_MS = 6000;

/** Below this, a wait resolves faster than a skeleton could be read. */
export const SHOW_AFTER_MS = 120;

/** Once painted, a skeleton stays this long — a blink reads as a glitch. */
export const MIN_DWELL_MS = 400;

export function loadPhase(s: LoadSignals): LoadPhase {
  if (s.hasData) return "ready";
  if (s.failed || s.elapsedMs >= STALL_AFTER_MS) return "stalled";
  return "cold";
}

/**
 * The anti-flash pair, applied.
 *
 * `shownMs` is null until the skeleton has actually painted. That is what
 * separates "too early to bother" from "already on screen, do not yank it".
 */
export function skeletonView(o: {
  phase: LoadPhase;
  waitMs: number;
  shownMs: number | null;
}): SkeletonView {
  const { phase, waitMs, shownMs } = o;
  if (phase === "ready") {
    return shownMs !== null && shownMs < MIN_DWELL_MS ? "skeleton" : "content";
  }
  if (phase === "stalled") return "stalled";
  return waitMs < SHOW_AFTER_MS && shownMs === null ? "hidden" : "skeleton";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/mobile && npx vitest run __tests__/loadPhase.test.ts
```

Expected: PASS, 10 tests (4 in `loadPhase`, 6 in `skeletonView`).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/loadPhase.ts apps/mobile/__tests__/loadPhase.test.ts
git commit -m "feat(loading): decide when a wait has earned a skeleton"
```

---

### Task 2: The timer hook

**Files:**
- Create: `apps/mobile/src/lib/useLoadPhase.ts`

**Interfaces:**
- Consumes: `loadPhase`, `skeletonView`, `SkeletonView` from Task 1.
- Produces: `useLoadPhase(hasData: boolean, failed: boolean): SkeletonView`.

No test: this file imports React and cannot run under the Node suite. All of its
arithmetic lives in Task 1, which is tested. Verified by typecheck.

- [ ] **Step 1: Write the implementation**

Create `apps/mobile/src/lib/useLoadPhase.ts`:

```ts
/**
 * The live loading view: turns "do we have data" and "did it fail" into the one
 * value a screen renders on, with the dwell timers that stop a skeleton
 * flashing. Thin wrapper over the pure helpers in loadPhase.ts, exactly as
 * useMotion.ts wraps motionTier.ts.
 */

import { useEffect, useRef, useState } from "react";
import { loadPhase, skeletonView, type SkeletonView } from "./loadPhase";

/**
 * How often the view is re-evaluated while a wait is unsettled.
 *
 * A polled tick rather than timers armed at each boundary: the boundaries move
 * as `hasData` and `failed` change under it, and 10Hz for the length of a
 * network wait costs a comparison and, at most, one re-render of a screen whose
 * content is a handful of static blocks. It stops the moment the wait settles.
 */
const TICK_MS = 100;

export function useLoadPhase(hasData: boolean, failed: boolean): SkeletonView {
  const startedAt = useRef(Date.now());
  /** When the skeleton first painted; null until it has. */
  const shownAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const waitMs = now - startedAt.current;
  const view = skeletonView({
    phase: loadPhase({ hasData, failed, elapsedMs: waitMs }),
    waitMs,
    shownMs: shownAt.current === null ? null : now - shownAt.current,
  });

  // Stamped after the render that shows it, so the dwell is measured from the
  // frame the player could first see rather than from the decision to paint.
  useEffect(() => {
    if (view === "skeleton" && shownAt.current === null) shownAt.current = Date.now();
  }, [view]);

  const settled = view === "content" || view === "stalled";
  useEffect(() => {
    if (settled) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [settled]);

  return view;
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
cd apps/mobile && npm run typecheck
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/lib/useLoadPhase.ts
git commit -m "feat(loading): hold the dwell timers behind one hook"
```

---

### Task 3: The skeleton primitive

**Files:**
- Create: `apps/mobile/src/components/Skeleton.tsx`

**Interfaces:**
- Consumes: `arc` from `src/lib/motion.ts`; `useFullMotion` from `src/lib/useMotion.ts`; `palette`, `radius` from `src/theme.ts`.
- Produces: `SkeletonGroup({ label, children })`, `SkeletonBlock({ width, height, rad?, index?, style? })`, `SkeletonLine({ width, index?, size? })`.

No test: React Native component, no render harness in this repo. Verified by
typecheck and the on-device pass in Task 12.

- [ ] **Step 1: Write the implementation**

Create `apps/mobile/src/components/Skeleton.tsx`:

```tsx
/**
 * Skeleton blocks — the shape of a panel that has not arrived yet.
 *
 * DESIGN.md §4 asks for "skeletal shimmer blocks matching panel dimensions —
 * never a spinner", and §7 bans the spinner outright. This is the primitive
 * that pays that off; the compositions live beside the markup they mimic, so
 * the two are edited together and the geometry cannot silently drift.
 *
 * One shared value drives a whole group and each block reads its own slice
 * through `arc` — the same single-animation-per-cluster pattern as the launch
 * screen's tile wave, so a grid ripples rather than pulsing in unison.
 *
 * The sheen is an opacity lift rather than a band translated across the block.
 * Several blocks are percentage-width (the 22% cosmetic swatches), and a real
 * sweep needs the block's pixel width — which would mean an onLayout measure
 * per block to animate a highlight nobody parses at 1.4s a cycle. The ripple
 * that reads is the one ACROSS the blocks, and the stagger already carries it.
 */

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { arc } from "../lib/motion";
import { useFullMotion } from "../lib/useMotion";
import { palette, radius as radiusToken } from "../theme";

const CYCLE_MS = 1400;
/** Fraction of a cycle one block spends lit, and the offset between blocks. */
const SHEEN_SPAN = 0.45;
const STAGGER = 0.07;
/** Peak sheen. Any brighter and a resting block reads as selected, not absent. */
const SHEEN_PEAK = 0.06;

/** Null when the device cannot afford the loop — blocks then render flat. */
const WaveContext = createContext<SharedValue<number> | null>(null);

interface SkeletonGroupProps {
  /** What is loading, for screen readers: "Loading the shop". */
  label: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonGroup({ label, children, style }: SkeletonGroupProps) {
  const full = useFullMotion();
  const wave = useSharedValue(0);

  useEffect(() => {
    if (!full) return;
    wave.value = withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(wave);
  }, [full, wave]);

  return (
    <WaveContext.Provider value={full ? wave : null}>
      <View accessibilityRole="progressbar" accessibilityLabel={label} style={style}>
        {children}
      </View>
    </WaveContext.Provider>
  );
}

interface SkeletonBlockProps {
  width: DimensionValue;
  height: number;
  /** Match the radius of the real thing this stands in for. */
  rad?: number;
  /** Position in the group's wave. Neighbours should differ by one. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonBlock({ width, height, rad = radiusToken.sm, index = 0, style }: SkeletonBlockProps) {
  const wave = useContext(WaveContext);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: rad, backgroundColor: palette.liftedSlate, overflow: "hidden" },
        style,
      ]}
    >
      {wave ? <Sheen wave={wave} index={index} /> : null}
    </View>
  );
}

function Sheen({ wave, index }: { wave: SharedValue<number>; index: number }) {
  const sheenStyle = useAnimatedStyle(() => ({
    opacity: arc(wave.value, index, SHEEN_SPAN, STAGGER) * SHEEN_PEAK,
  }));
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: palette.porcelain }, sheenStyle]}
    />
  );
}

/** A block at text-line proportions, for names and captions. */
export function SkeletonLine({
  width,
  index = 0,
  size = 13,
}: {
  width: DimensionValue;
  index?: number;
  /** The font size of the line this replaces. */
  size?: number;
}) {
  // Shorter than the line box: a full-height bar reads as a filled field.
  return <SkeletonBlock width={width} height={Math.round(size * 0.85)} rad={4} index={index} />;
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
cd apps/mobile && npm run typecheck
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/Skeleton.tsx
git commit -m "feat(loading): draw skeleton blocks on one shared wave"
```

---

### Task 4: The stalled retry card

**Files:**
- Create: `apps/mobile/src/components/LoadFailed.tsx`

**Interfaces:**
- Consumes: `Surface3D`, `Button`, theme tokens.
- Produces: `LoadFailed({ message, onRetry })`.

- [ ] **Step 1: Write the implementation**

Create `apps/mobile/src/components/LoadFailed.tsx`:

```tsx
/**
 * What a wait becomes when it stops being a wait.
 *
 * A skeleton that shimmers forever promises content that is not coming, so
 * loadPhase hands over to this after STALL_AFTER_MS or on an outright failure.
 * It says which thing did not arrive and offers the one action worth offering.
 * No error code and no apology: neither helps, and both make an ordinary
 * dropped connection feel like a fault the player caused.
 */

import { Surface3D } from "./Surface3D";
import { Button } from "./Button";
import { Text } from "react-native";
import { font, palette, radius, space } from "../theme";

interface LoadFailedProps {
  /** Names what did not arrive: "The shop didn't load." */
  message: string;
  onRetry: () => void;
}

export function LoadFailed({ message, onRetry }: LoadFailedProps) {
  return (
    <Surface3D rad={radius.lg} faceStyle={{ padding: space.lg, gap: space.md, alignItems: "center" }}>
      <Text
        style={{
          fontFamily: font.regular,
          fontSize: 13,
          color: palette.mutedSteel,
          textAlign: "center",
        }}
      >
        {message}
      </Text>
      <Button label="Try again" variant="ghost" onPress={onRetry} />
    </Surface3D>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
cd apps/mobile && npm run typecheck
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/LoadFailed.tsx
git commit -m "feat(loading): offer a retry when a wait stops being a wait"
```

---

### Task 5: Entitlements learns that a fetch failed

**Files:**
- Modify: `apps/mobile/src/store/entitlementsStore.ts` (interface ~line 36, initial state ~line 51, `refresh` lines 54-73)
- Test: `apps/mobile/__tests__/entitlementsStore.test.ts` (append)

**Interfaces:**
- Produces: `useEntitlements` gains `failed: boolean` — not persisted.

- [ ] **Step 1: Write the failing test**

Append to `apps/mobile/__tests__/entitlementsStore.test.ts`:

```ts
describe("a catalog fetch that fails", () => {
  it("records the failure so the shop can offer a retry", async () => {
    vi.mocked(api.getEntitlements).mockRejectedValueOnce(new Error("offline"));
    await useEntitlements.getState().refresh();
    expect(useEntitlements.getState().failed).toBe(true);
  });

  it("clears the failure once a later fetch lands", async () => {
    vi.mocked(api.getEntitlements).mockRejectedValueOnce(new Error("offline"));
    await useEntitlements.getState().refresh();

    vi.mocked(api.getEntitlements).mockResolvedValueOnce({
      skus: [],
      catalog: [{ sku: "avatar.leo", price: 0, currency: "coins" }],
    } as unknown as Awaited<ReturnType<typeof api.getEntitlements>>);
    await useEntitlements.getState().refresh();

    expect(useEntitlements.getState().failed).toBe(false);
    expect(useEntitlements.getState().prices["avatar.leo"]).toBe(0);
  });

  it("keeps the cached catalog when a refresh fails, so the shop still sells", async () => {
    useEntitlements.setState({ prices: { "avatar.leo": 0 }, owned: ["avatar.leo"] });
    vi.mocked(api.getEntitlements).mockRejectedValueOnce(new Error("offline"));
    await useEntitlements.getState().refresh();
    expect(useEntitlements.getState().prices["avatar.leo"]).toBe(0);
    expect(useEntitlements.getState().owned).toContain("avatar.leo");
  });
});
```

Also extend the existing `afterEach` reset at the top of the file so `failed`
does not leak between tests — change:

```ts
  useEntitlements.setState({ owned: [], prices: {}, loading: false, buying: null });
```

to:

```ts
  useEntitlements.setState({ owned: [], prices: {}, loading: false, buying: null, failed: false });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/mobile && npx vitest run __tests__/entitlementsStore.test.ts
```

Expected: FAIL — `failed` is `undefined`, not `true`.

- [ ] **Step 3: Write minimal implementation**

In `apps/mobile/src/store/entitlementsStore.ts`, add to the `EntitlementsStore`
interface, directly after the `loading: boolean;` line:

```ts
  /** True when the last attempt finished and failed. Never persisted — a
   *  failure is about this moment's network, not about the cached catalog,
   *  which stays valid and stays sellable. */
  failed: boolean;
```

Add `failed: false,` to the initial state, directly after `loading: false,`.

Then rewrite `refresh` (lines 54-73) as:

```ts
      refresh: async () => {
        if (get().loading) return;
        set({ loading: true });
        try {
          const { skus, catalog } = await api.getEntitlements();
          const prices: Record<string, number> = {};
          const currencies: Record<string, "coins" | "gems"> = {};
          for (const item of catalog) {
            prices[item.sku] = item.price;
            if (item.currency === "gems") currencies[item.sku] = "gems";
          }
          set({ owned: skus, prices, currencies, failed: false });
        } catch {
          // Offline — keep the cached view; buying will fail loudly anyway.
          // The flag is only read when there is NO cached catalog to fall back
          // on, which is the one case a player can neither see nor act on.
          set({ failed: true });
        } finally {
          set({ loading: false });
        }
      },
```

The `partialize` block at the bottom of the file is left exactly as it is —
`failed` is deliberately absent from it, so a failure never survives a restart.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx vitest run __tests__/entitlementsStore.test.ts && npm run typecheck
```

Expected: PASS on all tests, no typecheck output.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/store/entitlementsStore.ts apps/mobile/__tests__/entitlementsStore.test.ts
git commit -m "feat(shop): remember that a catalog fetch failed"
```

---

### Task 6: The shop and locker grid

**Files:**
- Modify: `apps/mobile/src/components/CosmeticsBrowser.tsx` (imports; body after line 127; grid at lines 190-241)

**Interfaces:**
- Consumes: `useLoadPhase` (Task 2), `SkeletonGroup`/`SkeletonBlock`/`SkeletonLine` (Task 3), `LoadFailed` (Task 4), `catalogKnown` and `failed` (Task 5).

This is the surface that motivated the work: `sellableItems` filters on
`inCatalog(prices, sku)`, so before the catalog lands the grid is empty and
says nothing.

- [ ] **Step 1: Add the imports**

In `apps/mobile/src/components/CosmeticsBrowser.tsx`, add to the existing
import block:

```tsx
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from "./Skeleton";
import { LoadFailed } from "./LoadFailed";
import { useLoadPhase } from "../lib/useLoadPhase";
```

and add `catalogKnown` to the existing `entitlementsStore` import, which becomes:

```tsx
import { catalogKnown, currencyOf, isUnlocked, priceOf, useEntitlements } from "../store/entitlementsStore";
```

- [ ] **Step 2: Read the phase in the component body**

Directly after the existing line 127 (`const items = mode === "locker" ? …`),
add:

```tsx
  // The catalog is what both modes are actually waiting on: the shop filters
  // its grid through it, and the locker's "owned" verdict is unanswerable
  // without it (isUnlocked fails closed on an unknown catalog, by design).
  const failed = useEntitlements((s) => s.failed);
  const view = useLoadPhase(catalogKnown(prices), failed);
```

- [ ] **Step 3: Swap the grid on the phase**

Replace the whole `{/* Item grid */}` block (lines 190-241, from the comment
through the closing `</View>` of the wrapping row) with:

```tsx
      {/* Item grid */}
      {view === "stalled" ? (
        <LoadFailed
          message={
            mode === "shop"
              ? "The shop didn't load. Check your connection and try again."
              : "Your collection didn't load. Check your connection and try again."
          }
          onRetry={() => void refresh()}
        />
      ) : view === "skeleton" ? (
        <SkeletonGroup
          label={mode === "shop" ? "Loading the shop" : "Loading your collection"}
          style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <View key={`sk-${i}`} style={{ width: "22%", alignItems: "center", padding: space.xs }}>
              <SkeletonBlock width={56} height={56} rad={radius.md} index={i} />
            </View>
          ))}
        </SkeletonGroup>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.lg }}>
          {items.map((item) => {
            const unlocked = isUnlocked(owned, prices, item.sku);
            const selected = item.id === highlightId;
            const locked = mode === "shop" && !unlocked;
            const price = priceOf(prices, item.sku);
            const currency = currencyOf(currencies, item.sku);
            if (category === "avatar") {
              return (
                <AvatarSwatch
                  key={item.id}
                  id={item.id}
                  selected={selected}
                  price={price}
                  currency={currency}
                  locked={locked}
                  onSelect={() => onSelect(item, unlocked)}
                />
              );
            }
            if (category === "board") {
              return (
                <ThemeSwatch
                  key={item.id}
                  theme={resolveBoardTheme(item.id)}
                  selected={selected}
                  price={price}
                  currency={currency}
                  locked={locked}
                  onSelect={() => onSelect(item, unlocked)}
                />
              );
            }
            return (
              <DiceSwatch
                key={item.id}
                skin={DICE_SKINS[item.id as DiceSkinId]}
                theme={boardTheme}
                selected={selected}
                price={price}
                currency={currency}
                locked={locked}
                onSelect={() => onSelect(item, unlocked)}
              />
            );
          })}
          {Array.from({ length: fillers }).map((_, i) => (
            <View key={`filler-${i}`} style={{ width: "22%" }} />
          ))}
        </View>
      )}
```

Note `view === "hidden"` deliberately falls through to the content branch: the
grid renders empty for those first 120ms, which is exactly what it did before
and is too short to see.

- [ ] **Step 4: Skeleton the hero caption too**

The caption under the hero preview reads `highlightItem?.label ?? highlightId`,
which resolves to a raw id like `leo` before the catalog lands. Replace the
caption `<View style={{ alignItems: "center", gap: 2 }}>…</View>` block with:

```tsx
        <View style={{ alignItems: "center", gap: 2 }}>
          {view === "skeleton" ? (
            <SkeletonGroup label="Loading item details" style={{ alignItems: "center", gap: 6 }}>
              <SkeletonLine width={96} size={17} index={0} />
              <SkeletonLine width={64} size={12} index={1} />
            </SkeletonGroup>
          ) : (
            <>
              <Text style={{ fontFamily: font.display, fontSize: 17, color: palette.porcelain, textTransform: "capitalize" }}>
                {highlightItem?.label ?? highlightId}
              </Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>{status}</Text>
            </>
          )}
        </View>
```

- [ ] **Step 5: Verify**

```bash
cd apps/mobile && npm run typecheck && npm test
```

Expected: no typecheck output; the full suite passes.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/CosmeticsBrowser.tsx
git commit -m "feat(shop): show the grid loading instead of showing it empty"
```

---

### Task 7: Friends learns what it has actually loaded

**Files:**
- Modify: `apps/mobile/src/store/friendsStore.ts` (interface ~lines 40-55, initial state ~lines 82-90, `init` line 118, `refresh` lines 126-130, `loadRecentPlayers` lines 146-150)

**Interfaces:**
- Produces: `useFriends` gains `loaded: boolean`, `failed: boolean`, `recentLoaded: boolean`.

No test file: this store imports `AppState` from `react-native` and cannot run
under the Node suite. Verified by typecheck and Task 12's device pass.

Two things are wrong here today. `ready` is set `true` *before* `refresh()` runs
(line 118), so it means "signed in", not "list loaded" — a fresh mount has
`ready === true` and `friendships === []` while the fetch is in flight, which is
indistinguishable from having no friends. And `refresh()` has no `try/catch`
while every caller invokes it as `void refresh()`, so **a failed friends fetch
is an unhandled promise rejection today.** The wrapping needed for `failed`
fixes that as a side effect.

- [ ] **Step 1: Add the fields to the interface**

In the `FriendsStore` interface, directly after `ready: boolean;`, add:

```ts
  /** True once a refresh has actually resolved. Distinct from `ready`, which
   *  only says we are signed in — it is set before the first fetch runs, so on
   *  its own it cannot tell an empty list apart from an unfetched one. */
  loaded: boolean;
  /** True when the last refresh finished and threw. */
  failed: boolean;
  /** True once recent players have been fetched. An empty array cannot answer
   *  this: "you have played nobody new" and "not asked yet" are the same
   *  value, and they want opposite treatments. */
  recentLoaded: boolean;
```

- [ ] **Step 2: Add them to the initial state**

Directly after `ready: false,` add:

```ts
  loaded: false,
  failed: false,
  recentLoaded: false,
```

- [ ] **Step 3: Wrap refresh**

Replace `refresh` (lines 126-130) with:

```ts
  refresh: async () => {
    try {
      const [friendships, invites] = await Promise.all([friends.listFriendships(), friends.listMyInvites()]);
      set({ friendships, invites });
      await mergeProfiles(get, set, friendships, invites);
      set({ loaded: true, failed: false });
    } catch {
      // Every caller invokes this as `void refresh()`, so a throw here used to
      // surface as an unhandled rejection and nothing else. The screen reads
      // the flag instead, and keeps whatever rows it already had.
      set({ failed: true });
    }
  },
```

- [ ] **Step 4: Wrap loadRecentPlayers**

Replace `loadRecentPlayers` (lines 146-150) with:

```ts
  loadRecentPlayers: async () => {
    try {
      const players = await getRecentPlayers();
      set({ recentPlayers: players, recentLoaded: true });
      if (players.length > 0) await mergeStats(get, set, players.map((p) => p.user_id));
    } catch {
      // Nothing to retry against on this screen — the section simply stays
      // hidden, exactly as it does for a player with no past opponents.
      set({ recentLoaded: true });
    }
  },
```

- [ ] **Step 5: Verify**

```bash
cd apps/mobile && npm run typecheck && npm test
```

Expected: no typecheck output; the full suite passes.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/store/friendsStore.ts
git commit -m "fix(friends): tell an empty list apart from an unfetched one

refresh() had no try/catch and every caller invokes it as void refresh(),
so a failed fetch surfaced as an unhandled rejection and the screen said
'No friends yet'. It now records loaded/failed and the screen reads them."
```

---

### Task 8: The friends list

**Files:**
- Modify: `apps/mobile/src/screens/FriendsScreen.tsx` (imports; body near line 40; list at lines 173-186)

**Interfaces:**
- Consumes: `loaded`/`failed` (Task 7), `useLoadPhase`, `SkeletonGroup`/`SkeletonBlock`/`SkeletonLine`, `LoadFailed`.

- [ ] **Step 1: Add the imports**

```tsx
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from "../components/Skeleton";
import { LoadFailed } from "../components/LoadFailed";
import { useLoadPhase } from "../lib/useLoadPhase";
```

This file does **not** currently import `radius`. Change line 36 from:

```tsx
import { font, palette, space } from "../theme";
```

to:

```tsx
import { font, palette, radius, space } from "../theme";
```

- [ ] **Step 2: Read the phase**

After the existing `const refresh = useFriends((s) => s.refresh);` line, add:

```tsx
  const loaded = useFriends((s) => s.loaded);
  const failed = useFriends((s) => s.failed);
```

and after `const dockPad = useDockClearance();` add:

```tsx
  // Friends are fetched fresh on every visit — this store does not persist —
  // so the cold wait here is every mount, not only the first ever.
  const view = useLoadPhase(loaded, failed);
```

- [ ] **Step 3: Swap the list**

Replace the `{friendIds.length === 0 ? (…) : (` opening and its empty-state
`Surface3D` (lines 176-186) with:

```tsx
          {view === "stalled" ? (
            <LoadFailed
              message="Your friends list didn't load. Check your connection and try again."
              onRetry={() => void refresh()}
            />
          ) : view === "skeleton" ? (
            <SkeletonGroup label="Loading your friends" style={{ gap: space.sm }}>
              {[0, 1, 2].map((i) => (
                // Geometry copied from <Row> below: edge={2}, padding space.md,
                // a 36pt avatar, ONE 15pt name line, and an action chip at
                // compact-Button height. A taller block or a second caption
                // line would make the list jump when the real rows land.
                <Surface3D
                  key={`sk-${i}`}
                  edge={2}
                  faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}
                >
                  <SkeletonBlock width={36} height={36} rad={radius.pill} index={i} />
                  <View style={{ flex: 1 }}>
                    <SkeletonLine width="60%" size={15} index={i} />
                  </View>
                  <SkeletonBlock width={64} height={40} rad={radius.md} index={i + 1} />
                </Surface3D>
              ))}
            </SkeletonGroup>
          ) : friendIds.length === 0 ? (
            <Surface3D faceStyle={{ padding: space.lg, gap: space.sm, alignItems: "center" }}>
              <PeopleGlyph size={36} />
              <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>No friends yet</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
                Share your friend code, or add someone you've played with — tap “Add a friend” above.
              </Text>
            </Surface3D>
          ) : (
```

Note the `ready ? … : "Connecting…"` ternary inside the empty state is gone:
the skeleton is what "connecting" looks like now, and by the time this branch
renders the list is genuinely empty.

`ready` was referenced in exactly two places in this file — its binding on line
40 and that ternary on line 181 — so with the ternary gone it is dead. Delete
line 40:

```tsx
  const ready = useFriends((s) => s.ready);
```

(`noUnusedLocals` is off in this project, so the typecheck will not catch it for
you.)

- [ ] **Step 4: Verify**

```bash
cd apps/mobile && npm run typecheck && npm test
```

Expected: no typecheck output; the full suite passes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/FriendsScreen.tsx
git commit -m "feat(friends): shimmer the list instead of claiming you have none"
```

---

### Task 9: The add-friend screen, and the last spinner

**Files:**
- Modify: `apps/mobile/src/screens/AddFriendScreen.tsx` (the `react-native` import; the `{myCode ? … : <ActivityIndicator …/>}` block inside the "HOW FRIENDS FIND YOU" card; the `{recentPlayers.length > 0 ? … : null}` block)

Anchor by those code landmarks, not by line number: an unrelated refactor moved
`SectionLabel` out of this file into `components/SectionLabel.tsx` (now imported
near the top) and shifted everything below it. `<SectionLabel>` is still used
exactly as before at each of its three call sites, so the JSX in this task is
unaffected — only the line numbers moved.

**Interfaces:**
- Consumes: `recentLoaded` (Task 7), `useLoadPhase`, `SkeletonGroup`/`SkeletonBlock`/`SkeletonLine`.

This task deletes the `ActivityIndicator` at line 155 — the one banned spinner
that shipped (DESIGN.md §7).

- [ ] **Step 1: Fix the imports**

Change the `react-native` import (the second import in the file) from:

```tsx
import { ActivityIndicator, Pressable, Share, Text, TextInput, View } from "react-native";
```

to:

```tsx
import { Pressable, Share, Text, TextInput, View } from "react-native";
```

and add:

```tsx
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from "../components/Skeleton";
import { useLoadPhase } from "../lib/useLoadPhase";
```

- [ ] **Step 2: Read the two phases**

Next to the existing `const recentPlayers = useFriends((s) => s.recentPlayers);`
binding, add:

```tsx
  const recentLoaded = useFriends((s) => s.recentLoaded);
```

and in the component body, before the `return`:

```tsx
  // Two independent waits on one screen. Neither has anything to retry against
  // here — the code is fetched once and the recents section is optional — so
  // both simply resolve or quietly stay away.
  const codeView = useLoadPhase(!!myCode, false);
  const recentView = useLoadPhase(recentLoaded, false);
```

- [ ] **Step 3: Replace the spinner**

Replace the `myCode ? (…) : (<ActivityIndicator … />)` block (lines 148-157)
with:

```tsx
            {myCode ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Copy your friend code" onPress={() => void onCopy()}>
                <Text style={{ fontFamily: font.mono, fontSize: 20, color: palette.mutedSteel, letterSpacing: 5 }}>
                  {myCode}
                </Text>
              </Pressable>
            ) : codeView === "skeleton" || codeView === "stalled" ? (
              <SkeletonGroup label="Loading your friend code">
                {/* Six mono glyphs at 20pt plus five 5pt gaps — the width the
                    real code occupies, so nothing shifts when it lands. */}
                <SkeletonBlock width={97} height={20} rad={4} />
              </SkeletonGroup>
            ) : null}
```

The `stalled` branch keeps the block rather than swapping in a retry card: this
card still shows the player's username and its Copy and Share buttons, so the
screen is not blocked, and there is no separate loader to retry against.

- [ ] **Step 4: Skeleton the recents section**

Replace the `{recentPlayers.length > 0 ? (…) : null}` block (lines 227-241)
with:

```tsx
        {/* Recently played with */}
        {recentView === "skeleton" ? (
          <View style={{ gap: space.sm }}>
            <SectionLabel>RECENTLY PLAYED WITH</SectionLabel>
            <SkeletonGroup label="Loading players you've played with" style={{ gap: space.sm }}>
              {[0, 1].map((i) => (
                // Geometry copied from <PlayerRow> at the bottom of this file:
                // edge={2}, padding space.md, a 36pt avatar, ONE 15pt name
                // line, and an "Add" chip at compact-Button height.
                <Surface3D
                  key={`sk-${i}`}
                  edge={2}
                  faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}
                >
                  <SkeletonBlock width={36} height={36} rad={radius.pill} index={i} />
                  <View style={{ flex: 1 }}>
                    <SkeletonLine width="55%" size={15} index={i} />
                  </View>
                  <SkeletonBlock width={52} height={40} rad={radius.md} index={i + 1} />
                </Surface3D>
              ))}
            </SkeletonGroup>
          </View>
        ) : recentPlayers.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <SectionLabel>RECENTLY PLAYED WITH</SectionLabel>
            {recentPlayers.map((p) => (
              <PlayerRow
                key={p.user_id}
                profile={p}
                sent={sentTo.includes(p.user_id)}
                onAdd={() => void onAdd(p.user_id)}
                onOpen={() => void viewPlayer(p.user_id)}
              />
            ))}
          </View>
        ) : null}
```

`Surface3D`, `radius` and `SectionLabel` are all already imported in this file —
no import changes are needed beyond Step 1. (`SectionLabel` used to be a local
function at the bottom of this file; an unrelated refactor moved it to
`components/SectionLabel.tsx`. Its three call sites are unchanged.)

- [ ] **Step 5: Verify the spinner is gone**

```bash
cd apps/mobile && grep -rn "ActivityIndicator" src/
```

Expected: no matches anywhere in `src/`.

- [ ] **Step 6: Verify**

```bash
cd apps/mobile && npm run typecheck && npm test
```

Expected: no typecheck output; the full suite passes.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/AddFriendScreen.tsx
git commit -m "feat(friends): retire the last spinner for a skeleton

DESIGN.md §7 bans generic circular loading indicators; the friend-code
card shipped with one. It and the recents section now shimmer."
```

---

### Task 10: The player profile card

**Files:**
- Modify: `apps/mobile/src/screens/PlayerProfileScreen.tsx` (imports; body near line 58; card at lines 94-110)

**Interfaces:**
- Consumes: `useLoadPhase`, `SkeletonGroup`/`SkeletonBlock`/`SkeletonLine`.

`viewPlayer()` pushes this screen and *then* fetches, so a player reached by
friend code renders as `"Ludo player"` — a name that is not theirs — until the
profile lands.

- [ ] **Step 1: Add the imports**

```tsx
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from "../components/Skeleton";
import { useLoadPhase } from "../lib/useLoadPhase";
```

This file does **not** currently import `radius`. Change line 28 from:

```tsx
import { font, palette, space } from "../theme";
```

to:

```tsx
import { font, palette, radius, space } from "../theme";
```

- [ ] **Step 2: Read the phase**

After the existing `const profile = profiles[userId];` line, add:

```tsx
  // viewPlayer navigates first and fetches second, so a stranger reached by
  // friend code has no cached card — and the fallback name is someone else's.
  const view = useLoadPhase(!!profile, false);
```

- [ ] **Step 3: Swap the card**

Replace the identity `Surface3D` (lines 94-110) with:

```tsx
        <Surface3D faceStyle={{ padding: space.xl, gap: space.md, alignItems: "center" }}>
          {view === "skeleton" || view === "stalled" ? (
            <SkeletonGroup label="Loading this player" style={{ alignItems: "center", gap: space.md }}>
              <SkeletonBlock width={88} height={88} rad={radius.pill} index={0} />
              <SkeletonLine width={140} size={22} index={1} />
              <SkeletonLine width={72} size={13} index={2} />
            </SkeletonGroup>
          ) : (
            <>
              <View>
                <AvatarGlyph id={profile?.avatar_id ?? "orbit-moss"} size={88} />
                {known ? <PresenceDot online={online} size={20} /> : null}
              </View>
              <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }} numberOfLines={1}>
                {name}
              </Text>
              {known ? (
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                  {online ? "Online now" : "Offline"}
                </Text>
              ) : null}
            </>
          )}
        </Surface3D>
```

`stalled` keeps the skeleton rather than a retry card: the action buttons below
work regardless of whether the card resolved, so blocking them behind a failure
notice would take away more than it explains.

- [ ] **Step 4: Verify**

```bash
cd apps/mobile && npm run typecheck && npm test
```

Expected: no typecheck output; the full suite passes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/PlayerProfileScreen.tsx
git commit -m "feat(friends): stop naming a stranger before we know them"
```

---

### Task 11: The account tray

**Files:**
- Modify: `apps/mobile/src/screens/AccountScreen.tsx` (imports; body near line 223; account tray at lines 346-381)

**Interfaces:**
- Consumes: `useLoadPhase`, `SkeletonGroup`/`SkeletonBlock`/`SkeletonLine`.

`identity` starts `null` and `signedIn` is `!!identity && !identity.isGuest`
(line 223), so **a signed-in player opening this screen is told they are a
guest** and offered "Save account" before it corrects itself.

The identity tray above it is deliberately left alone: `currentName` falls back
to the persisted local name, which is already right.

- [ ] **Step 1: Add the imports**

```tsx
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from "../components/Skeleton";
import { useLoadPhase } from "../lib/useLoadPhase";
```

- [ ] **Step 2: Read the phase**

Directly after `const signedIn = !!identity && !identity.isGuest;` (line 223),
add:

```tsx
  // Until the identity read lands, `signedIn` is false — which pitches a
  // signed-in player the guest CTA and then takes it back. Wrong beats blank.
  const identityView = useLoadPhase(identity !== null, false);
```

- [ ] **Step 3: Swap the tray**

Replace the `{signedIn ? (…) : (…)}` contents of the Account `Surface3D`
(lines 350-380) so the whole conditional becomes:

```tsx
              {identityView === "skeleton" || identityView === "stalled" ? (
                <SkeletonGroup label="Loading your account" style={{ gap: space.md }}>
                  <SkeletonLine width="70%" size={15} index={0} />
                  <SkeletonLine width="90%" size={13} index={1} />
                  {/* 56, not 52: a Button's total height is its 52pt face plus
                      depth.edge (4). Standing in at 52 would shift the tray by
                      4pt the moment the identity read lands. */}
                  <SkeletonBlock width="100%" height={56} rad={radius.md} index={2} />
                </SkeletonGroup>
              ) : signedIn ? (
                <>
                  {/* The email can be null — an Apple link makes an account
                      recoverable without ever handing us an address. */}
                  <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.porcelain }}>
                    {identity?.email ? `Signed in as ${identity.email}` : "Signed in"}
                  </Text>
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                    Your coins, gems and looks are backed up to this account.
                  </Text>
                  <Button
                    label="Sign out"
                    variant="ghost"
                    onPress={() => void signOutToGuest().then(refreshIdentity)}
                  />
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                    You're playing as a guest. Save an account so your coins, gems and looks survive a
                    reinstall or a new phone — no account needed to keep playing.
                  </Text>
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <View style={{ flex: 1 }}>
                      <Button label="Save account" onPress={() => setAccountSheet("save")} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label="Sign in" variant="ghost" onPress={() => setAccountSheet("signin")} />
                    </View>
                  </View>
                </>
              )}
```

`stalled` keeps the skeleton: the honest fallback for an unknown identity is
"we don't know yet", and defaulting to the guest pitch is the exact error being
fixed.

- [ ] **Step 4: Verify**

```bash
cd apps/mobile && npm run typecheck && npm test
```

Expected: no typecheck output; the full suite passes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/AccountScreen.tsx
git commit -m "fix(account): stop telling a signed-in player they're a guest"
```

---

### Task 12: Verification pass

**Files:** none — this task changes nothing.

Everything above is verified by types and by the Node suite, which cannot render
a single one of these components. This task is where the work is actually seen.

- [ ] **Step 1: Full suite and types**

```bash
cd apps/mobile && npm run typecheck && npm test
```

Expected: no typecheck output; every test passes. Record the test count.

- [ ] **Step 2: Confirm no spinner survived**

```bash
cd apps/mobile && grep -rn "ActivityIndicator" src/
```

Expected: no matches.

- [ ] **Step 3: Confirm no skeleton covers cached data**

```bash
cd apps/mobile && grep -rn "useLoadPhase(" src/
```

Expected: **six** call sites covering the seven surfaces — `CosmeticsBrowser`
serves both the shop and the locker from one call, and `AddFriendScreen` has
two of its own. Read each one and confirm its first argument is a "do we hold
data" expression —
`catalogKnown(prices)`, `loaded`, `!!myCode`, `recentLoaded`, `!!profile`,
`identity !== null` — and never a "is a request in flight" flag.

- [ ] **Step 4: On-device pass, full motion tier**

Launch the app (`npm start`, Expo Go on the simulator) and visit each surface
with the network throttled or briefly disabled:

- Shop → grid shimmers, then fills. Hero caption shimmers, no raw id flashes.
- Profile → Customize locker shimmers, then fills.
- Friends → three rows shimmer; "No friends yet" appears only after loading.
- Add a friend → the code block shimmers where the spinner was; recents shimmer.
- Tap a player → the card shimmers; no "Ludo player" flash.
- Account → the tray shimmers; a signed-in player never sees the guest pitch.

Confirm the ripple runs across blocks rather than every block pulsing together.

- [ ] **Step 5: On-device pass, reduced motion tier**

Set the app's motion preference to `reduced` in Settings (or enable the OS
"Reduce Motion" setting) and repeat Step 4. Every skeleton must render as flat
static blocks with no loop, and the layouts must be identical.

- [ ] **Step 6: On-device pass, offline**

With the device in airplane mode, clear the app's data and open the Shop.
After ~6 seconds the grid must give way to the retry card. Restore the network
and tap "Try again" — the grid fills.

Then, with a cached catalog already in hand, go offline and reopen the Shop:
the grid must render normally. A failed refresh over held data must change
nothing on screen.

- [ ] **Step 7: Commit any fixes and report**

Report what was seen on device, including anything that needed adjusting. Do
not claim the visuals work without having run Steps 4-6.

---

## Notes for the executor

- **Geometry is the whole point.** If a skeleton block does not match the size
  of the thing it stands in for, content jumps when it resolves and the
  skeleton has made things worse. When in doubt, measure against the real
  markup in the same file.
- **`view === "hidden"` falls through to content everywhere.** That is
  intentional: for the first 120ms the screen renders exactly what it renders
  today, which is too brief to see.
- **Do not add `failed` to any `partialize` block.** A failure is about this
  moment's network and must not survive a restart.
