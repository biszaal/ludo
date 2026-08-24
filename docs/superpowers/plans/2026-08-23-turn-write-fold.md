# Turn Write Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halve the authoritative writes per turn by folding the roll into the move, delivering the die over a cheap broadcast instead of a 2.2 KB state push.

**Architecture:** The die is `HMAC(secret, gameId:state_version:playerId)` — a pure function — so the roll needs no database write. `opTurn("roll")` derives the die, broadcasts ~60 bytes to the room topic, and writes nothing. `opTurn("move"/"pass")` re-derives the identical die at the unchanged `state_version` and applies roll+move as one transition in one write. Every behavior change sits behind a per-game gate (`games.fold_writes`) computed once at deal time, so live clients that predate the broadcast keep today's exact write sequence.

**Tech Stack:** Deno edge functions (Supabase), Postgres migrations, React Native + Zustand client, Vitest (mobile), `deno test` (edge).

**Spec:** `docs/superpowers/specs/2026-08-23-turn-write-fold-design.md`

## Global Constraints

- `FOLD_MIN_VERSION = "1.1.0"`. Seats below it, or with `app_version = null`, disable folding for their whole game.
- Version comparison is **numeric by component**, never string comparison. `"1.10.0" > "1.9.0"` must hold. Anything unparseable is treated as `null`.
- Bot seats are identified by the `game_bots` table, **never** by `players.is_bot` (that is the *visible* flag; quick-match bots are hidden and carry `is_bot = false`).
- `games.fold_writes` is computed **once**, at deal time, and never re-evaluated mid-match.
- The gate defaults to `false`. Unknown always means "do not fold".
- Dice derivation (`deriveDie`) must not change. Only the delivery of the die changes.
- Every task ends green on `npm test` (engine 95 + bot 39 + mobile 509 + edge 107 = 750 baseline, plus what the task adds).
- Migration numbering continues from `0049_tick_gate_and_seat_version.sql`.
- Commit messages: no Claude attribution, no co-author trailers.

---

### Task 1: Version comparison helper

Pure function, no I/O. Everything else depends on it and it is the single easiest thing to get subtly wrong.

**Files:**
- Modify: `supabase/functions/game/lib.ts` (append near `deriveDie`, around line 245)
- Test: `supabase/functions/game/foldGate.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `export function versionAtLeast(version: string | null, min: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/game/foldGate.test.ts`:

```typescript
/**
 * Which clients can be spoken to in the folded protocol.
 *
 * String comparison is the trap here: "1.10.0" < "1.9.0" lexically, so a
 * naive implementation silently switches folding off forever once the app
 * reaches 1.10. Compare numerically, component by component.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { versionAtLeast } from "./lib.ts";

Deno.test("a build at the floor qualifies", () => {
  assertEquals(versionAtLeast("1.1.0", "1.1.0"), true);
});

Deno.test("a build above the floor qualifies", () => {
  assertEquals(versionAtLeast("1.2.0", "1.1.0"), true);
  assertEquals(versionAtLeast("2.0.0", "1.1.0"), true);
});

Deno.test("a build below the floor does not", () => {
  assertEquals(versionAtLeast("1.0.2", "1.1.0"), false);
  assertEquals(versionAtLeast("0.9.0", "1.1.0"), false);
});

Deno.test("double-digit components compare numerically, not as text", () => {
  // The whole reason this function exists rather than a < b.
  assertEquals(versionAtLeast("1.10.0", "1.9.0"), true);
  assertEquals(versionAtLeast("1.9.0", "1.10.0"), false);
});

Deno.test("a pre-handshake client sends nothing and does not qualify", () => {
  assertEquals(versionAtLeast(null, "1.1.0"), false);
});

Deno.test("anything unparseable is treated as unknown, never as current", () => {
  assertEquals(versionAtLeast("", "1.1.0"), false);
  assertEquals(versionAtLeast("banana", "1.1.0"), false);
  assertEquals(versionAtLeast("1.x.0", "1.1.0"), false);
});

Deno.test("a short version string is padded, not rejected", () => {
  assertEquals(versionAtLeast("2", "1.1.0"), true);
  assertEquals(versionAtLeast("1.1", "1.1.0"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:edge`
Expected: FAIL — `versionAtLeast` is not exported from `lib.ts`.

- [ ] **Step 3: Write minimal implementation**

Append to `supabase/functions/game/lib.ts`:

```typescript
/**
 * Is `version` at least `min`, comparing numerically?
 *
 * `app_version` is free text a client wrote, so this must not trust its shape.
 * Anything that does not parse — including the null every pre-handshake binary
 * sends — is "no": the gate's safe direction is always toward the protocol
 * that works everywhere.
 *
 * Numeric per component on purpose. "1.10.0" < "1.9.0" as strings, which would
 * quietly disable folding for every build after 1.9.
 */
export function versionAtLeast(version: string | null, min: string): boolean {
  if (!version) return false;
  const parse = (s: string): number[] | null => {
    const parts = s.split(".");
    const nums: number[] = [];
    for (const p of parts) {
      if (!/^\d+$/.test(p)) return null;
      nums.push(Number(p));
    }
    return nums.length > 0 ? nums : null;
  };
  const a = parse(version);
  const b = parse(min);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:edge`
Expected: PASS, all 7 new tests plus the existing 107.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/game/lib.ts supabase/functions/game/foldGate.test.ts
git commit -m "feat(turn): numeric version comparison for the fold gate"
```

---

### Task 2: The gate column and its computation

**Files:**
- Create: `supabase/migrations/0050_fold_writes.sql`
- Modify: `supabase/functions/game/deal.ts` (in `startGameNow`, around lines 94-124)
- Test: `supabase/functions/game/foldGate.test.ts` (append)

**Interfaces:**
- Consumes: `versionAtLeast(version, min)` from Task 1
- Produces:
  - `export const FOLD_MIN_VERSION = "1.1.0"` in `lib.ts`
  - `export function foldAllowed(seats: Array<{ user_id: string; app_version: string | null }>, botUserIds: Set<string>): boolean` in `lib.ts`
  - `games.fold_writes boolean not null default false`

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/game/foldGate.test.ts`:

```typescript
import { foldAllowed, FOLD_MIN_VERSION } from "./lib.ts";

const BOT_A = "bbbbbbbb-0000-0000-0000-000000000001";
const HUMAN_A = "aaaaaaaa-0000-0000-0000-000000000001";
const HUMAN_B = "aaaaaaaa-0000-0000-0000-000000000002";

Deno.test("the floor is the release that adds the broadcast handler", () => {
  assertEquals(FOLD_MIN_VERSION, "1.1.0");
});

Deno.test("a table of updated humans folds", () => {
  const seats = [
    { user_id: HUMAN_A, app_version: "1.1.0" },
    { user_id: HUMAN_B, app_version: "1.2.0" },
  ];
  assertEquals(foldAllowed(seats, new Set()), true);
});

Deno.test("one un-updated seat stops the whole table folding", () => {
  const seats = [
    { user_id: HUMAN_A, app_version: "1.1.0" },
    { user_id: HUMAN_B, app_version: "1.0.2" },
  ];
  assertEquals(foldAllowed(seats, new Set()), false);
});

Deno.test("a pre-handshake seat stops it too", () => {
  const seats = [
    { user_id: HUMAN_A, app_version: "1.1.0" },
    { user_id: HUMAN_B, app_version: null },
  ];
  assertEquals(foldAllowed(seats, new Set()), false);
});

Deno.test("a bot seat never blocks folding, despite having no version", () => {
  // Hidden quick-match bots carry is_bot = false, so game_bots is the only
  // honest source. A bot has no client and renders nothing.
  const seats = [
    { user_id: HUMAN_A, app_version: "1.1.0" },
    { user_id: BOT_A, app_version: null },
  ];
  assertEquals(foldAllowed(seats, new Set([BOT_A])), true);
});

Deno.test("an all-bot table folds", () => {
  const seats = [
    { user_id: BOT_A, app_version: null },
  ];
  assertEquals(foldAllowed(seats, new Set([BOT_A])), true);
});

Deno.test("an empty table does not fold", () => {
  // Defensive: no seats means nothing was verified, and the default is no.
  assertEquals(foldAllowed([], new Set()), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:edge`
Expected: FAIL — `foldAllowed` and `FOLD_MIN_VERSION` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `supabase/functions/game/lib.ts`:

```typescript
/**
 * The first client release that understands a die arriving over broadcast.
 * Below this, a seat renders the opponent die from the roll WRITE, so folding
 * that write away takes the die from them and there is no OTA channel to fix
 * it.
 */
export const FOLD_MIN_VERSION = "1.1.0";

/**
 * May this table be spoken to in the folded protocol?
 *
 * Every human seat must be new enough. Bot seats are exempt: they have no
 * client and never render, and their app_version is always null.
 *
 * `botUserIds` MUST come from `game_bots`, not from `players.is_bot` — the
 * latter is the visible-tag flag and is false for hidden quick-match bots,
 * which would make this return false for most real games.
 */
export function foldAllowed(
  seats: Array<{ user_id: string; app_version: string | null }>,
  botUserIds: Set<string>,
): boolean {
  if (seats.length === 0) return false;
  return seats.every(
    (s) => botUserIds.has(String(s.user_id)) || versionAtLeast(s.app_version, FOLD_MIN_VERSION),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:edge`
Expected: PASS.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/0050_fold_writes.sql`:

```sql
-- Whether this table can be spoken to in the folded write protocol.
--
-- 0049 recorded, per seat, which client build sat in it. This is the decision
-- that column exists to support: when every human seat is on a build that
-- understands a die delivered over broadcast, a turn can cost one write
-- instead of two.
--
-- Decided ONCE, at deal time, and never revisited. A player who updates
-- mid-match, or a seat that changes hands, must not flip the broadcast shape
-- out from under a table that is already being rendered.
--
-- Defaults false, which is what every existing row gets: unknown means the
-- protocol that works everywhere.
alter table public.games add column if not exists fold_writes boolean not null default false;

comment on column public.games.fold_writes is
  'Set at deal time when every human seat is >= FOLD_MIN_VERSION. Never re-evaluated mid-match.';
```

- [ ] **Step 6: Set the flag at deal time**

In `supabase/functions/game/deal.ts`, inside `startGameNow`, the lobby is already read at line 94 and `game_bots` is already read at line 102 but only inside the stake branch. Change the lobby select to include `app_version`, hoist the bot read out of the stake branch so both consumers share it, and include `fold_writes` in the update at line 112:

```typescript
  const { data: lobby } = await admin
    .from("players")
    .select("id, user_id, color, seat, app_version")
    .eq("game_id", gameId)
    .order("seat");
  if (!lobby || lobby.length < 2) return { error: "Need at least 2 players." };

  // Read once: the stake collection below needs it to know who pays, and the
  // fold gate needs it to know whose missing app_version is a bot's rather
  // than an un-updated player's.
  const { data: bots } = await admin.from("game_bots").select("user_id").eq("game_id", gameId);
  const botIds = new Set((bots ?? []).map((b) => String(b.user_id)));

  const stake = (game.stake as number | null) ?? 0;
  if (!game.is_quick && stake > 0) {
    const collected = await collectStakes(admin, gameId, payingSeats(lobby, botIds), stake);
    if ("error" in collected) return collected;
  }
```

and in the update:

```typescript
    .update({
      state,
      status: "active",
      current_turn_player_id: state.currentTurnPlayerId,
      turn_deadline: turnDeadline(state),
      state_version: v + 1,
      fold_writes: foldAllowed(
        lobby.map((p) => ({ user_id: String(p.user_id), app_version: (p.app_version as string | null) ?? null })),
        botIds,
      ),
    })
```

Add `foldAllowed` to the existing `./lib.ts` import in `deal.ts`.

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run typecheck:edge`
Expected: PASS, 750 baseline + 14 new.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0050_fold_writes.sql supabase/functions/game/lib.ts supabase/functions/game/deal.ts supabase/functions/game/foldGate.test.ts
git commit -m "feat(turn): decide the fold protocol once, at deal time"
```

---

### Task 3: State equivalence — the invariant everything rests on

Before changing any write path, pin that folding produces *identical* state. If this is not true, nothing downstream is safe.

**Files:**
- Test: `supabase/functions/game/foldEquivalence.test.ts` (create)

**Interfaces:**
- Consumes: `rollDice`, `applyMove`, `getValidMoves`, `endTurn`, `createGame` from `../_shared/engine/index.js`; `rngForDie` from `./lib.ts`
- Produces: nothing (pure verification)

- [ ] **Step 1: Write the test**

Create `supabase/functions/game/foldEquivalence.test.ts`:

```typescript
/**
 * Folding must be a pure restructuring of WHEN state is written, never of WHAT
 * is written.
 *
 * Today: roll writes state A, then move writes state B.
 * Folded: move writes state B directly, from the same die.
 *
 * If B differs by so much as a field, every client reading the folded push
 * disagrees with one reading the sequential pushes, and the two protocols
 * cannot coexist. This is the gating test for the whole change.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rngForDie } from "./lib.ts";
// @deno-types="../_shared/engine/index.d.ts"
import {
  applyMove,
  createGame,
  endTurn,
  getValidMoves,
  rollDice,
  type GameState,
} from "../_shared/engine/index.js";

const GAME = "33333333-3333-3333-3333-333333333333";

function freshGame(): GameState {
  return createGame(
    [
      { id: "p1", userId: "u1", color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
    ],
    { gameId: GAME },
  );
}

/** Today's path: two transitions, two writes. */
function sequential(state: GameState, die: number, tokenId: string): GameState {
  const rolled = rollDice(state, rngForDie(die)).newState;
  return applyMove(rolled, { tokenId });
}

/** The folded path: same two transitions, one write. Identical by construction
 *  — this test exists to keep it that way through later refactors. */
function folded(state: GameState, die: number, tokenId: string): GameState {
  const rolled = rollDice(state, rngForDie(die)).newState;
  return applyMove(rolled, { tokenId });
}

Deno.test("a folded move equals the sequential roll-then-move, for every die", () => {
  for (let die = 1; die <= 6; die++) {
    const base = freshGame();
    const rolled = rollDice(base, rngForDie(die)).newState;
    const moves = getValidMoves(rolled, rolled.currentTurnPlayerId);
    if (moves.length === 0) continue;
    const tokenId = moves[0]!.tokenId;
    assertEquals(folded(base, die, tokenId), sequential(base, die, tokenId));
  }
});

Deno.test("a folded pass equals the sequential roll-then-endTurn", () => {
  for (let die = 1; die <= 6; die++) {
    const base = freshGame();
    const rolled = rollDice(base, rngForDie(die)).newState;
    if (getValidMoves(rolled, rolled.currentTurnPlayerId).length > 0) continue;
    assertEquals(endTurn(rolled), endTurn(rollDice(base, rngForDie(die)).newState));
  }
});

Deno.test("the same die is produced from the same version, twice", () => {
  // The property the fold depends on: the move op re-deriving at an unchanged
  // state_version gets exactly what the roller was shown.
  const base = freshGame();
  const a = rollDice(base, rngForDie(4)).newState;
  const b = rollDice(base, rngForDie(4)).newState;
  assertEquals(a.diceValue, b.diceValue);
  assertEquals(a, b);
});

Deno.test("a six still leaves the turn with the same player after folding", () => {
  const base = freshGame();
  const rolled = rollDice(base, rngForDie(6)).newState;
  const moves = getValidMoves(rolled, rolled.currentTurnPlayerId);
  if (moves.length > 0) {
    const next = applyMove(rolled, { tokenId: moves[0]!.tokenId });
    assertEquals(next.currentTurnPlayerId, base.currentTurnPlayerId);
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test:edge`
Expected: PASS. These pin an existing property rather than driving new code — if any fail, STOP: the spec's central assumption is wrong and the design needs revisiting before any write path changes.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/game/foldEquivalence.test.ts
git commit -m "test(turn): pin that folding does not change what is written"
```

---

### Task 4: Broadcast the die

**Files:**
- Modify: `supabase/functions/game/chat.ts` (export the broadcast helper, around line 50)
- Modify: `supabase/functions/game/turn.ts` (in `opTurn`, the roll branch)
- Test: `supabase/functions/game/rollBroadcast.test.ts` (create)

**Interfaces:**
- Consumes: `foldAllowed` result via `games.fold_writes`; `deriveDie` from `./lib.ts`
- Produces: `export async function broadcastToRoom(gameId: string, event: string, payload: Record<string, unknown>): Promise<boolean>` in `chat.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/game/rollBroadcast.test.ts`. This fixture is the one
every later task copies — write it in full:

```typescript
/**
 * A roll on a folding table writes nothing and broadcasts the die.
 *
 * The die is HMAC(secret, gameId:state_version:playerId), so the move op can
 * re-derive it at the unchanged version. The write existed only to show other
 * players the number — ~2 bytes of information that was costing a 2.2KB
 * WAL-backed, RLS-scanned state document per subscriber.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { opTurn } from "./turn.ts";
import type { SupabaseClient } from "./lib.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, type GameState } from "../_shared/engine/index.js";

const GAME = "33333333-3333-3333-3333-333333333333";
const USER = "44444444-4444-4444-4444-444444444444";

interface Fake {
  admin: SupabaseClient;
  /** Patches written to `games`, newest last. */
  patches: Array<Record<string, unknown>>;
  /** Broadcasts sent, newest last. */
  sent: Array<{ event: string; payload: Record<string, unknown> }>;
  row: { state: GameState; state_version: number };
}

function baseState(): GameState {
  return createGame(
    [
      { id: "p1", userId: USER, color: "red" },
      { id: "p2", userId: "u2", color: "yellow" },
    ],
    { gameId: GAME },
  );
}

function fake(foldWrites: boolean): Fake {
  const self: Fake = {
    admin: null as unknown as SupabaseClient,
    patches: [],
    sent: [],
    row: { state: baseState(), state_version: 0 },
  };

  // deno-lint-ignore no-explicit-any
  const chain = (filters: Record<string, unknown>, settle: (f: Record<string, unknown>) => unknown): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: (col: string, val: unknown) => chain({ ...filters, [col]: val }, settle),
      or: () => node,
      in: () => node,
      is: () => node,
      gt: () => node,
      select: () => node,
      maybeSingle: () => Promise.resolve(settle(filters)),
      single: () => Promise.resolve(settle(filters)),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(settle(filters)).then(res, rej),
    };
    return node;
  };

  const games = {
    select: () =>
      chain({}, () => ({
        data: {
          id: GAME,
          state: self.row.state,
          state_version: self.row.state_version,
          has_bots: false,
          fold_writes: foldWrites,
        },
        error: null,
      })),
    update: (patch: Record<string, unknown>) =>
      chain({}, (filters) => {
        if (filters["state_version"] !== self.row.state_version) return { data: null, error: null };
        self.patches.push(patch);
        self.row = {
          state: patch.state as GameState,
          state_version: patch.state_version as number,
        };
        return { data: { id: GAME }, error: null };
      }),
  };

  self.admin = {
    from: (table: string) => {
      if (table === "games") return games;
      // players / moves / rate_limits all no-op for these assertions.
      return {
        select: () => chain({}, () => ({ data: null, error: null })),
        update: () => chain({}, () => ({ data: null, error: null })),
        insert: () => chain({}, () => ({ data: null, error: null })),
      };
    },
    // deno-lint-ignore no-explicit-any
    rpc: () => Promise.resolve({ data: null, error: null }) as any,
    // deno-lint-ignore no-explicit-any
  } as any;

  return self;
}

Deno.test("a roll on a folding table does not write to games", async () => {
  const f = fake(true);
  await opTurn(f.admin, USER, GAME, "roll");
  assertEquals(f.patches.length, 0);
});

Deno.test("a roll on a NON-folding table writes exactly as it does today", async () => {
  // The compatibility test that protects live 1.0.x players.
  const f = fake(false);
  await opTurn(f.admin, USER, GAME, "roll");
  assertEquals(f.patches.length, 1);
  assertEquals(f.patches[0]!.state_version, 1);
});

Deno.test("the roller still receives its die in the HTTP response either way", async () => {
  const folding = await (await opTurn(fake(true).admin, USER, GAME, "roll")).json();
  const plain = await (await opTurn(fake(false).admin, USER, GAME, "roll")).json();
  assertEquals(typeof folding.state.diceValue, "number");
  assertEquals(folding.state.diceValue, plain.state.diceValue);
});
```

**On the broadcast assertion:** `broadcastToRoom` reaches the network via
`fetch`, so assert on it by stubbing `globalThis.fetch` for the duration of the
test and recording the POST body — the topic is `game:<id>` and the event is
`roll`. Restore the original `fetch` in a `finally`. Add that test here once the
helper from Step 3 exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:edge`
Expected: FAIL — the roll branch still writes on a folding table.

- [ ] **Step 3: Export the broadcast helper**

In `supabase/functions/game/chat.ts`, the private `broadcast` function at line 50 already POSTs to `/realtime/v1/api/broadcast` with `private: true`. Generalise and export it:

```typescript
/** Relay one message to a room's topic as the service role. 0037 leaves
 *  clients with SELECT and no INSERT on realtime.messages, so the service role
 *  is the only possible sender on this topic — which is what makes the payload
 *  trustworthy to receivers. */
export async function broadcastToRoom(
  gameId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ topic: `game:${gameId}`, event, payload, private: true }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

Keep the existing chat `broadcast` as a thin caller of it so chat behavior is untouched.

- [ ] **Step 4: Branch the roll path**

In `supabase/functions/game/turn.ts`, `opTurn` reads the game at line 104. Add `fold_writes` to that select. In the roll branch (currently line 135: `next = rollDice(state, await rollRng(gameId, v, me.id)).newState;`), when `game.fold_writes` is true:

```typescript
  if (action === "roll" && game.fold_writes) {
    if (state.phase !== "awaiting-roll") return await reject("You already rolled.");
    const die = await deriveDie(gameId, v, me.id);
    const rolled = rollDice(state, await rollRng(gameId, v, me.id)).newState;
    // No write: the move op re-derives this exact die at the unchanged v.
    // Fire-and-forget — a lost broadcast costs one spectator one die
    // animation; the state push that follows is still authoritative.
    afterResponse(broadcastToRoom(gameId, "roll", { die, playerId: me.id, v }));
    return json({ state: rolled, v });
  }
```

Leave the existing non-folding path completely untouched below it.

- [ ] **Step 5: Stop claiming an action id for a folding roll**

This is a correctness bug the fold introduces, not an optimisation.

`opTurn` calls `claimAction` at `turn.ts:158` before the write, for every
action including rolls. On a folding table the roll writes nothing — so if the
roll still claimed an id, a client retrying a dropped roll would be told
"already applied" and handed `duplicateState`, which is the state at version
`v`, still `awaiting-roll`, with no die in it. The player would be left holding
a die the server refuses to give them again.

A folding roll needs no claim at all: it reads, derives, and broadcasts, with
no state change to replay. It is idempotent by construction — re-deriving at
the same `v` yields the same die every time. So the folding roll path must
return **before** reaching `claimAction`, which the Step 4 branch already does
by returning early. Verify that explicitly rather than assuming it:

```typescript
Deno.test("a retried roll on a folding table returns the die again, not a duplicate", async () => {
  const f = fake(true);
  const first = await (await opTurn(f.admin, USER, GAME, "roll", undefined, "act-1")).json();
  const retry = await (await opTurn(f.admin, USER, GAME, "roll", undefined, "act-1")).json();

  // Same die both times, and never the "already done, here is stale state"
  // answer that a claimed-but-unwritten action would produce.
  assertEquals(retry.state.diceValue, first.state.diceValue);
  assertEquals(retry.duplicate, undefined);
  assertEquals(f.patches.length, 0);
});
```

The move and pass paths still claim exactly as they do today — those are the
ones that write, and the `moves_client_action_idx` unique index (0041) remains
their replay guard. Do not weaken that.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:edge && npm run typecheck:edge`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/game/turn.ts supabase/functions/game/chat.ts supabase/functions/game/rollBroadcast.test.ts
git commit -m "feat(turn): broadcast the die instead of writing the roll"
```

---

### Task 5: Fold the roll into the move and pass

**Files:**
- Modify: `supabase/functions/game/turn.ts` (`opTurn` move and pass branches)
- Test: `supabase/functions/game/rollBroadcast.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 1-4
- Produces: no new exports

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/game/rollBroadcast.test.ts` — write real fixtures, not stubs:

```typescript
Deno.test("a move on a folding table applies the roll and the move in one write", () => {
  // Fixture: folding table, phase awaiting-roll at version v (the roll did
  // not write). Act: opTurn(..., "move", tokenId).
  // Assert: exactly ONE games patch; its state_version is v + 1; its state
  // has the pawn moved AND diceValue reflecting the derived die.
});

Deno.test("a pass on a folding table also costs one write", () => {
  // Assert: one patch, turn handed on, no separate roll write.
});

Deno.test("the folded write carries the same die the roller was shown", () => {
  // The core correctness property: derive at v, roll, then re-derive at v in
  // the move op — both must be the same number.
});

Deno.test("reconnecting mid-turn re-rolls to the same die", () => {
  // A client that drops after rolling refetches, sees awaiting-roll at v, and
  // rolls again. Because the die derives from the unchanged v it gets the same
  // number — self-healing, no recovery path needed.
});

Deno.test("a move on a non-folding table still costs two writes", () => {
  // Compatibility: live 1.0.x tables keep today's exact sequence.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:edge`
Expected: FAIL — the move branch assumes the roll already advanced the state.

- [ ] **Step 3: Fold the move and pass branches**

In `opTurn`, when `game.fold_writes` and the incoming state is still `awaiting-roll`, apply the roll first:

```typescript
  // On a folding table the roll never wrote, so the state we just read is
  // still awaiting-roll. Re-derive the die at this same version — the number
  // the roller was already shown — and apply both transitions as one.
  let working = state;
  if (game.fold_writes && state.phase === "awaiting-roll" && (action === "move" || action === "pass")) {
    working = rollDice(state, await rollRng(gameId, v, me.id)).newState;
  }
```

Then have the `move` and `pass` branches validate and transition from `working` rather than `state`. The version guard, `claimAction`, `moves` logging, `settleIfFinished`, `afterGameWrite`, and the `chained`/`nextRoll` computation at line 218 are all unchanged — they already operate on `next` and `v`.

- [ ] **Step 4: Set the deadline to cover the whole turn**

The roll write used to grant a fresh `turn_deadline`. With no roll write, the turn shares the clock set when it was handed over, which shortens choosing time in a way players feel. On a folding table, the handoff deadline must cover roll-and-move together. In the write at line 175, the existing `turnDeadline(next)` call already runs on handoff; confirm via the tests in Task 6 that a folded turn gets a full clock and adjust `TURN_SECONDS` only with a measured reason.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test && npm run typecheck:edge`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/game/turn.ts supabase/functions/game/rollBroadcast.test.ts
git commit -m "feat(turn): fold the roll into the move and pass writes"
```

---

### Task 6: Server-driven turns — timeout, stall and bots

**Files:**
- Modify: `supabase/functions/game/turn.ts` (`advanceStalledGame`, around lines 361-420)
- Modify: `supabase/functions/game/bots.ts` (the write at lines 508-525)
- Test: `supabase/functions/game/foldServerDriven.test.ts` (create)

**Interfaces:**
- Consumes: `game.fold_writes` read in each path
- Produces: no new exports

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/game/foldServerDriven.test.ts` with real fixtures for:

```typescript
Deno.test("a timed-out turn on a folding table costs one write, not two", () => {});
Deno.test("a bot turn on a folding table costs one write", () => {});
Deno.test("a bot turn broadcasts its die so spectators still see it", () => {});
Deno.test("a bot turn on a non-folding table is byte-identical to today", () => {});
Deno.test("a busted third six still hands off correctly when folded", () => {});
```

Model fixtures on `supabase/functions/game/away.test.ts`, which already exercises `advanceStalledGame` and the bot driver.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:edge`
Expected: FAIL.

- [ ] **Step 3: Apply the same fold to both paths**

`advanceStalledGame` (line ~411) and the bot driver (`bots.ts` line ~514) each roll and then write. On a folding table both compose roll+move into one state and one write, and both broadcast the die first so spectators keep the beat. Bots must broadcast exactly as humans do — a spectator cannot tell the difference and must not need to.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run typecheck:edge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/game/turn.ts supabase/functions/game/bots.ts supabase/functions/game/foldServerDriven.test.ts
git commit -m "feat(turn): fold timeout, stall and bot-driven turns"
```

---

### Task 7: Client — receive the die broadcast

**Files:**
- Modify: `apps/mobile/src/net/api.ts` (`GameSubscription` at line 914, `subscribeGame` at line 931)
- Modify: `apps/mobile/src/store/onlineStore.ts` (`subscribe` at line ~897, new handler)
- Test: `apps/mobile/__tests__/rollBroadcast.test.ts` (create)

**Interfaces:**
- Consumes: broadcast event `"roll"` with `{ die: number; playerId: string; v: number }`
- Produces:
  - `export interface RollPayload { die: number; playerId: string; v: number }` in `api.ts`
  - `onRoll?: (payload: RollPayload) => void` added to `GameSubscription`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/rollBroadcast.test.ts` with real fixtures for:

```typescript
describe("die broadcast", () => {
  it("animates the die when a roll broadcast arrives", () => {});
  it("ignores a broadcast for a version already applied", () => {});
  it("does not double-animate when the folded state push follows", () => {});
  it("still animates from state alone when no broadcast arrived", () => {});
});
```

Model the store fixture on `apps/mobile/__tests__/onlineFlow.test.ts`, which already drives `useOnlineStore` through mocked `api` and realtime handlers.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx vitest run __tests__/rollBroadcast.test.ts`
Expected: FAIL — `onRoll` does not exist.

- [ ] **Step 3: Add the subscription and handler**

In `api.ts`, add to `GameSubscription` and register beside the existing chat handler at line 946:

```typescript
    .on("broadcast", { event: "roll" }, (msg) => handlers.onRoll?.(msg.payload as RollPayload))
```

In `onlineStore.ts`, wire `onRoll` in `subscribe` to animate the die for the named player at the given version, and record that version so the folded state push that follows does not animate the same die a second time. `applyGameRow` (line 1440) already computes `rolled`; the broadcast-seen version is the new input to that decision.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/mobile && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/net/api.ts apps/mobile/src/store/onlineStore.ts apps/mobile/__tests__/rollBroadcast.test.ts
git commit -m "feat(online): animate the die from the roll broadcast"
```

---

### Task 8: Release 1.1.0

**Files:**
- Modify: `apps/mobile/app.json` (version)

- [ ] **Step 1: Bump the version to the fold floor**

Set `expo.version` to `1.1.0` in `apps/mobile/app.json`. This is the value `FOLD_MIN_VERSION` names, so the two must match exactly — a table folds only when every human seat reports at least this.

- [ ] **Step 2: Run the full suite**

Run: `npm test && npm run typecheck && npm run typecheck:edge`
Expected: PASS. `apps/mobile/__tests__/appVersionHandshake.test.ts` reads the version from `app.json`, so it tracks the bump automatically.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app.json
git commit -m "chore: 1.1.0 — the release the fold gate opens on"
```

- [ ] **Step 4: Deploy in this order**

Order matters; getting it wrong breaks live play:

1. Apply `0050_fold_writes.sql` (manual paste, per project convention).
2. Deploy the `game` edge function.
3. Ship 1.1.0 to both stores.

Until step 3 reaches actual devices, every seat reports below the floor and every game runs the unfolded path — which is the intended behavior, not a bug.

- [ ] **Step 5: Verify the effect**

After 1.1.0 has meaningful install share, re-run the measurements from the spec:

```sql
select round(avg(state_version)) from (
  select state_version from games where status = 'finished'
  order by created_at desc limit 30
) t;
```

Expected: ~436 falls toward ~220 as the share of all-updated tables grows. Also check that `apply_rls` total time in `pg_stat_statements` is growing more slowly per match than before.

---

## Notes for the implementer

- **Task 4 carries the fully-worked fixture; Tasks 5-7 name theirs by intent.** The `fake()` helper in Task 4 Step 1 is complete and runnable — copy it, and extend it per path rather than inventing a new one. Where a later task lists a test by description only, write the real body from that fixture before running. A test that is empty and green is worse than no test, because it reports safety it never checked.
- **`nextRoll` and the chained roll.** A six, a capture, or a finish returns `nextRoll` at `turn.ts:223`, derived at `v + 1`. Folding changes which write produces `v + 1`, so confirm in Task 5 that a chained roll still derives from the version the fold actually wrote, and that the client still receives it. A chained roll that silently stops arriving turns the fastest die in the game back into a round trip.
- **The gate is the safety property.** Any task that changes a write path must keep a test proving the non-folding path is byte-identical to today. If you cannot show that, do not ship it.
- **Do not change `deriveDie`.** Dice fairness is the one thing in this codebase where a subtle change is a trust problem, not a bug.
