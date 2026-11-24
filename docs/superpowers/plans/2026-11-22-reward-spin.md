# Reward Spin (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prize wheel on Home with a daily spin, a one-off first-game spin and up to 3 match spins a day, paid in coins or gems, switched off until the server says otherwise.

**Architecture:** One migration adds `spin_log`, the `spin` config block and two SQL functions. `spin_status` derives what a player is owed from existing records. `spin_claim` checks, picks, pays and logs in one transaction. Two thin `game` edge ops expose them. The app adds a spin tile beside the daily chest and a sheet with a Skia wheel that animates to the server's segment.

**Tech Stack:** PostgreSQL (PGlite tests, `npm run test:db`), Deno edge function (`npm run test:edge`), Expo / React Native with Skia and Reanimated (vitest, `cd apps/mobile && npx vitest run`).

**Spec:** `docs/superpowers/specs/2026-11-22-reward-spin-design.md` (approved by Bishal on 22 Nov 2026). Read it first; this plan does not repeat its reasons.

## Global Constraints

- Branch `feat/reward-spin`, cut from `feat/1-3-2` (HEAD `f0fa020`). Commit per task. No push, deploy, migration apply or OTA without Bishal's go-ahead (Task 7).
- New migration **0086**. Frozen migrations are untouched. The migration file must contain no `drop` statement: the Supabase connector auto-declines any SQL containing one. Use `create or replace` (including `create or replace trigger`).
- Day = UTC date (`(p_now at time zone 'utc')::date`), the same as `daily_bonus_claim`. Reset = next 00:00 UTC.
- Wallet reasons: `spin-daily`, `spin-first`, `spin-match`. Bucket `earned`. Ext id `spin:<request_id>` for both `wallet_apply` and `gem_apply`.
- Prize tables exactly as in the spec ("Prize tables"), weights per 1,000, `tableVersion` 1.
- The end-of-match payout code (`finish.ts`, 0076/0077 functions) is not modified.
- JS-only on the client: no new native modules or config plugins. The fingerprints must still equal the 1.3.2 builds (Android `dcda256e`, iOS `58e64f82`; read them with `eas build:view <id>`).
- Copy: strings in all 7 locales (`apps/mobile/src/i18n/locales/*.ts`, typed as `Strings`). Never mention bots or dice assistance. No emoji in chrome (DESIGN.md §7).
- No automatic opening of the spin sheet in phase 1. The daily bonus sheet keeps its auto-show; two sheets must never stack.

## Review Focus

1. **The day rolls over while the sheet is open.** The source the app asks for may no longer be owed. The server refuses with `not_owed`; the app must refresh and show the next spin, not an error. Task 4 tests it.
2. **Double-tap, or a timeout after the server already paid.** One request in flight per source; a retry reuses the same request id, so the stored result comes back and nothing is paid twice. Tasks 2 and 4 test it.
3. **The kill switch flips while the sheet is open.** A claim returns `disabled`; the sheet closes and the tile disappears. Task 4 tests it.
4. **Gems are switched off in config.** The wheel shows coin segments only, and the payout matches what was drawn. Task 1 tests the table conversion.
5. **Offline on Home load.** `spinState` fails; the tile stays hidden and nothing else on Home changes. Task 4 tests it.

---

### Task 1: Migration 0086: log, config, eligibility

**Files:** Create `supabase/migrations/0086_reward_spin.sql`, `scripts/tests/spin.test.mjs`.

**Interfaces (produces):**

- Table `spin_log`: `id bigint generated always as identity primary key`, `user_id uuid not null`, `day date not null`, `source text not null check (source in ('daily','first','match'))`, `wheel text not null check (wheel in ('bronze','silver','gold','firstGame'))`, `table_version int not null`, `segment int not null`, `coins int not null default 0`, `gems int not null default 0`, `request_id uuid not null`, `created_at timestamptz not null default now()`.
  - Unique `(user_id, request_id)`.
  - Partial unique `(user_id, day) where source = 'daily'` and `(user_id) where source = 'first'`.
  - Index `(user_id, day)`.
  - No foreign key, as with `wallet_txns`.
  - RLS on. Policy `spin_log: read own`, select to `authenticated` using `user_id = auth.uid()`. Revoke insert/update/delete from `anon, authenticated`.
- `spin_default_config() returns jsonb` (immutable). The spec's config block, with `enabled: false`, `allowlistUserIds: []`, `matchMaxPerDay: 3`, `dailyCoinCap: 1500`, `tiers: {silverFromDay: 3, goldFromDay: 7}`, `tableVersion: 1` and the four tables. A segment is `{"coins": n, "w": weight}` or `{"gems": n, "w": weight}`.
- The migration seeds it once: `update app_config set value = jsonb_set(value, '{spin}', spin_default_config()) where key = 'default' and value->'spin' is null`.
- `spin_enabled(p_user uuid) returns boolean`. `default.spin.enabled` is true, or `p_user::text` is in `allowlistUserIds`.
- `spin_table(p_wheel text) returns jsonb`. The wheel's segment array, in table order. When `default.gems.enabled` is not `true`, each gem segment becomes `{"coins": gems × gems.exchangeRate (default 10), "w": same}`.
- `spin_effective_streak(p_user uuid, p_today date) returns int`. `wallets.last_bonus_on = p_today` gives `streak_day`. `= p_today - 1` gives `least(streak_day + 1, 7)`. Anything else gives 1.
- `spin_matches_finished(p_user uuid, p_today date) returns int`. Counts distinct `games` with `status = 'finished'`, `(updated_at at time zone 'utc')::date = p_today`, and an element of `state->'players'` whose `userId` is `p_user` and whose `hasLeft` is not true.
- `spin_status(p_user uuid, p_now timestamptz default now()) returns jsonb`.
  - When not `spin_enabled`, it returns `{"enabled": false}`.
  - Otherwise it returns `{"enabled": true, "tableVersion": int, "owed": {"first": "owed"|"used"|"locked", "daily": bool, "match": int}, "matchMax": int, "tier": "bronze"|"silver"|"gold", "next": {"source", "wheel", "segments"} | null, "resetsAt": "<next 00:00 UTC, ISO>"}`.
  - **first:** `used` if a `first` row exists. `owed` if `player_stats.games_played >= 1`. Otherwise `locked`.
  - **daily:** true when no `daily` row exists for today.
  - **match:** `greatest(0, least(matchMax, finished) - match rows today)`.
  - **next:** first if owed, else daily, else match. The wheel is `firstGame` for first, the tier for daily, and `bronze` for match. `segments = spin_table(wheel)`.
- Every function is `security definer`, `set search_path = public, pg_temp`. Execute is revoked from `public, anon, authenticated` and granted to `service_role`.

- [ ] **Step 1: Write the failing tests.**
  - Fixture:
    - `economySchema()`;
    - then `alter table wallets add column if not exists gems int not null default 0`;
    - then the `0018_gems.sql` slice from `create table if not exists public.gem_txns` to `-- 3.` (as `purchases.test.mjs` does);
    - then `create table app_config(key text primary key, value jsonb not null)`;
    - then 0086.
  - Helpers:
    - `enable(over = {}, gemsOn = true)` writes `default = {spin: spin_default_config() || {enabled: true, ...over}, gems: {enabled: gemsOn, exchangeRate: 10}}`;
    - `finishGame(user, {hasLeft = false, day = today})` inserts a finished game whose `state.players` holds the user;
    - `played(user, n)` writes `player_stats`;
    - `bonus(user, lastOn, streak)` sets the wallet.

```js
test('status is disabled by default and for users off the allowlist')       // seed only -> {enabled:false}; allowlist [A] -> A enabled, B not
test('a new player owes daily, first is locked, no match spins')            // owed {first:'locked', daily:true, match:0}, next.source 'daily', next.wheel 'bronze'
test('first-game spin is owed after one played game and comes first')       // played(A,1) -> first 'owed', next.source 'first', next.wheel 'firstGame'
test('tier follows the streak as it stands today')                           // claimed today at streak 3 -> silver; claimed yesterday at 6 (-> 7 today) -> gold; last claim 3 days ago (-> 1) -> bronze
test('match spins count finished games still seated, capped at 3')           // 2 games -> 2; one with hasLeft -> not counted; 5 games -> 3; yesterday's game -> not counted
test('gem segments become coins when gems are off')                         // enable({}, false) -> bronze has no gems key; the 2-gem segment is {coins:20, w:50}
test('resetsAt is the next 00:00 UTC')                                       // p_now '2026-11-22T23:30Z' -> '2026-11-23T00:00:00+00:00'
```

- [ ] **Step 2:** Run `node --test scripts/tests/spin.test.mjs`. Expected: FAIL (0086 missing).
- [ ] **Step 3:** Write 0086 with the interfaces above.
- [ ] **Step 4:** Run `node --test scripts/tests/spin.test.mjs`. Expected: all pass.
- [ ] **Step 5:** Commit: `git add supabase/migrations/0086_reward_spin.sql scripts/tests/spin.test.mjs && git commit -m "feat(spin): spin log, config and what a player is owed"`.

### Task 2: `spin_claim`: check, pick, pay, log

**Files:** Modify `supabase/migrations/0086_reward_spin.sql`, `scripts/tests/spin.test.mjs`.

**Interfaces:**

- Consumes: Task 1's functions.
- Produces: `spin_claim(p_user uuid, p_source text, p_request_id uuid, p_now timestamptz default now(), p_roll int default null) returns jsonb`. Same security and grants as Task 1.
  - Success: `{"ok": true, "segment": int, "prize": {"coins": n} | {"gems": n}, "balance": int, "gems": int, "status": spin_status(...)}`.
  - Refusal: `{"ok": false, "reason": "disabled" | "not_owed" | "bad_source"}`.

The steps, in one transaction:

1. **Replay:** a `spin_log` row with this `(user_id, request_id)` returns its stored segment and prize with current balances.
2. **Gate:** `bad_source` unless `p_source` is in (`daily`, `first`, `match`). `disabled` unless `spin_enabled`.
3. **Lock:** insert the wallet row if missing, then `select … for update` it.
4. **Eligibility:** recompute the owed state as `spin_status` does. `not_owed` if the source isn't owed (`first` must be `owed`, `daily` true, `match > 0`).
5. **Pick:** use `p_roll` if given (tests only), otherwise draw it as below. Walk the segments until the cumulative weight exceeds the roll.

   ```sql
   -- gen_random_uuid() is pg_strong_random; its first 8 hex digits are fully random
   roll := (('x' || lpad(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 16, '0'))::bit(64)::bigint
            % total_weight)::int;
   ```

6. **Cap:** if the prize is coins and today's `spin_log` coins plus the prize exceed `dailyCoinCap`, switch to the coin segment with the most coins that still fits. If none fits, use the smallest coin segment.
7. **Pay:** coins go through `wallet_apply(p_user, coins, 'spin-' || p_source, null, 'earned', 'spin:' || p_request_id)`; gems go through `gem_apply(p_user, gems, 'spin-' || p_source, 'spin:' || p_request_id)`.
8. **Log:** insert the `spin_log` row (`table_version` from config) and return.

- [ ] **Step 1: Write the failing tests** (same file, same fixture):

```js
test('claim pays the rolled segment and logs it')            // daily, p_roll 0 -> bronze[0] 25 coins; wallet +25; wallet_txns reason 'spin-daily' ext 'spin:<id>'; one spin_log row
test('a gem segment pays gems')                              // bronze p_roll 930 (the 2-gem band is 920..969) -> segment 5, gems +2, gem_txns reason 'spin-daily'
test('the same request id never pays twice')                 // claim twice with one id -> same segment, balance credited once, one spin_log row
test('daily and first cannot be claimed twice')              // second daily with a new id -> not_owed; same for first
test('match spins stop at the owed count')                   // 2 finished games -> 2 claims ok, third not_owed
test('refuses when disabled, unknown source, or not owed')   // disabled -> 'disabled'; 'weekly' -> 'bad_source'; first while locked -> 'not_owed'
test('the daily coin cap swaps in the largest prize that fits') // seed spin_log coins 1450 today; p_roll 740 (100-coin band 730..849) -> pays 50 (largest <= 50), reports segment 1
test('status after a claim reflects it')                     // new player, after the daily claim: owed.daily false, next null
```

- [ ] **Step 2:** Run `node --test scripts/tests/spin.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Add `spin_claim` to 0086.
- [ ] **Step 4:** Run `node --test scripts/tests/spin.test.mjs && npm run test:db`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(spin): claim a spin in one transaction`.

### Task 3: Edge ops `spinState` and `spinClaim`

**Files:** Create `supabase/functions/game/spin.ts`, `supabase/functions/game/spin.test.ts`. Modify `supabase/functions/game/index.ts` (router) and `supabase/functions/game/lib.ts` (`LIMITS`).

**Interfaces:**

- Consumes: `spin_status`, `spin_claim` (Tasks 1–2).
- Produces:
  - `LIMITS.spin = 30`.
  - `opSpinState(admin: SupabaseClient, userId: string): Promise<Response>`. Calls `spin_status` and returns its jsonb as-is.
  - `opSpinClaim(admin, userId, source: string, requestId: string): Promise<Response>`.
    - It rejects a source outside `daily|first|match`, or a request id that isn't a UUID, with `json({ error: "Bad request." })` and no RPC.
    - Otherwise it calls `spin_claim` with `p_user`, `p_source` and `p_request_id`, and returns its jsonb.
  - Both run `rateOk(admin, userId, "spin", LIMITS.spin)` first and return `rateLimited()` when it's false.
  - On an RPC error, both return `json({ error: "Could not spin. Try again." })`.
  - Router: `case "spinState": return await opSpinState(admin, userId);` and `case "spinClaim": return await opSpinClaim(admin, userId, String(body.source ?? ""), String(body.requestId ?? ""));`.

- [ ] **Step 1: Write the failing tests** with the `fake()` admin from `install.test.ts`:
  - `opSpinState` passes the RPC result through;
  - `opSpinClaim` sends `p_user`, `p_source`, `p_request_id`;
  - a bad source or non-UUID id makes no RPC call and returns `Bad request.`;
  - an RPC error returns the friendly error;
  - `rate_limit_hit` returning `false` returns the rate-limit message.
- [ ] **Step 2:** Run `npm run test:edge`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run `npm run test:edge`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(spin): spinState and spinClaim ops`.

### Task 4: App: types, API, store

**Files:**

- Create: `apps/mobile/src/lib/spin.ts`, `apps/mobile/src/store/spinStore.ts`, `apps/mobile/__tests__/spin.test.ts`, `apps/mobile/__tests__/spinStore.test.ts`.
- Modify: `apps/mobile/src/net/api.ts`.

**Interfaces (produces):**

- In `lib/spin.ts` (pure):
  - `type SpinSource = "first" | "daily" | "match"`;
  - `type Segment = { coins: number; w: number } | { gems: number; w: number }`;
  - `interface SpinState { enabled: boolean; owed?: { first: "owed" | "used" | "locked"; daily: boolean; match: number }; matchMax?: number; tier?: "bronze" | "silver" | "gold"; next?: { source: SpinSource; wheel: string; segments: Segment[] } | null; resetsAt?: string }`;
  - `type TileView = { kind: "hidden" } | { kind: "ready"; count: number } | { kind: "countdown"; ms: number } | { kind: "locked" }`.
  - `tileView(s: SpinState | null, now: number): TileView`:
    - `hidden` when null or disabled;
    - `ready` with `count = (first === "owed" ? 1 : 0) + (daily ? 1 : 0) + match` when that count is above 0;
    - else `locked` when first is `locked`;
    - else `countdown` until `resetsAt`.
  - `odds(segments: Segment[]): { label: Segment; pct: string }[]`. Each `pct` is `w / total` as a percent with at most one decimal, trailing `.0` dropped ("28%", "0.1%").
  - `formatCountdown(ms: number): { h: number; m: number }`. Minutes round up, minimum 1.
  - `wheelTarget(segment: number, count: number, fromDeg: number, turns: number): number`. Returns the absolute rotation in degrees that puts segment `segment`'s centre under the top pointer, at least `turns` full turns past `fromDeg`. Segment 0 is centred at 0°, and segments run clockwise.
- In `net/api.ts`:
  - `getSpinState(): Promise<SpinState>` calls `callGame("spinState")`.
  - `claimSpin(source: SpinSource, requestId: string): Promise<SpinClaim>`, where `type SpinClaim = { ok: true; segment: number; prize: { coins?: number; gems?: number }; balance: number; gems: number; status: SpinState } | { ok: false; reason: "disabled" | "not_owed" | "bad_source" }`. Both call `ensureSignedIn()` first.
- In `store/spinStore.ts` (zustand, not persisted):
  - `export const useSpin = create<SpinStore>(…)`, where `SpinStore` is `{ state: SpinState | null; claiming: boolean; refresh(): Promise<void>; claim(source: SpinSource): Promise<SpinClaim | null> }`.
  - `refresh` failure sets `state` to null.
  - `claim` keeps one pending request id per source (from `randomId()` in `lib/deviceId.ts`). It reuses that id after a thrown error (timeout or offline), clears it on any answer, and returns null while a claim is in flight.
  - On `ok`, it sets `state = status` and `useWallet.setState({ balance, gems })`.
  - On `not_owed`, it calls `refresh()` and returns the refusal.
  - On `disabled`, it sets `state = { enabled: false }`.

- [ ] **Step 1: Write the failing tests.**

```ts
// spin.test.ts
it("tileView: hidden when null or disabled")
it("tileView: ready counts first + daily + match")              // {first:'owed', daily:true, match:2} -> ready 4
it("tileView: locked when nothing owed and first is locked")
it("tileView: countdown to resetsAt otherwise")                 // resetsAt now+3h -> countdown ms 3h
it("tileView: a passed resetsAt never gives a negative countdown") // now past resetsAt, nothing owed -> countdown ms 0 (clamped)
it("odds: percentages from weights")                            // bronze -> '28%','30%',...,'0.4%','0.1%'
it("formatCountdown rounds minutes up")                         // 4h11m30s -> {h:4,m:12}; 20s -> {h:0,m:1}
it("wheelTarget lands the segment under the pointer, whole turns ahead") // t = wheelTarget(2, 8, 0, 5): (t + 2*45) % 360 === 0 and t >= 1800
it("wheelTarget works from a previous rotation")                // t = wheelTarget(3, 9, 1890, 5): (t + 3*40) % 360 === 0 and t >= 1890 + 1800

// spinStore.test.ts (vi.mock("../src/net/api"))
it("refresh failure hides the tile")                            // getSpinState rejects -> state null
it("a double tap sends one claim")                              // two concurrent claim('daily') -> claimSpin called once
it("a retry after a timeout reuses the request id")             // first rejects, second resolves -> both calls same id
it("an answer clears the request id")                           // ok then a new claim -> different id
it("not_owed refreshes instead of failing")                     // -> getSpinState called, returns the refusal
it("disabled hides the feature")                                // -> state {enabled:false}
it("ok updates the wallet")                                     // useWallet balance/gems set from the claim
```

- [ ] **Step 2:** Run `cd apps/mobile && npx vitest run __tests__/spin.test.ts __tests__/spinStore.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command, then `npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(spin): app state, API and store`.

### Task 5: App: the wheel and the spin sheet

**Files:**

- Create: `apps/mobile/src/components/SpinWheel.tsx`, `apps/mobile/src/components/SpinSheet.tsx`.
- Modify: the 7 locale files.

**Interfaces:**

- Consumes: Task 4's `useSpin`, `wheelTarget`, `odds`, `formatCountdown`.
- Produces:
  - `SpinWheel({ segments, rotation, size }: { segments: Segment[]; rotation: SharedValue<number>; size: number })`.
    - A Skia canvas: one wedge per segment, in two alternating chrome colours from the theme (never team colours), with the prize drawn as a `CoinGlyph`/`GemGlyph` mark plus the amount. A fixed pointer sits at the top.
    - The wheel group rotates by `rotation` in degrees.
  - `SpinSheet({ onClose }: { onClose: () => void })`.
    - Built on `Sheet`. It shows the label for `state.next`, the wheel, and a Spin button.
    - On tap it calls `claim(next.source)`, then animates `rotation` to `wheelTarget(segment, segments.length, current, turns)` over 4 s with an ease-out curve. With reduced motion (`useFullMotion()` false), that is 1 turn over 1.2 s.
    - Then it reveals the prize with `Confetti` (coin colours as in `DailyBonusSheet`), `playSound` and the `win` haptic.
    - "Spin again" shows while `next` is non-null; otherwise it shows "Done" plus the countdown line.
    - An "i" button toggles an odds list built from `odds(next.segments)`.
    - On `null` (a claim in flight) it does nothing. On a thrown error it shows `spin.error` and keeps the Spin button live. On `disabled` it calls `onClose`.
    - Opened with nothing owed (`next` null, from a countdown or locked tile), it shows no wheel or Spin button. It shows `spin.next` with the countdown, plus `spin.tileLocked` while first is `locked`, and always `spin.matchHint`.
- Strings: English below. Translate into the other 6 locales, keeping each file's stated register.

```ts
"spin.title": "Spin the wheel",
"spin.source.first": "First game bonus",
"spin.source.daily": "Daily spin · {tier}",
"spin.source.match": "Match spin {n} of {max}",
"spin.tier.bronze": "Bronze", "spin.tier.silver": "Silver", "spin.tier.gold": "Gold",
"spin.button": "Spin",
"spin.again": "Spin again",
"spin.done": "Done",
"spin.wonCoins": "You won {n} coins",
"spin.wonGems": "You won {n} gems",
"spin.next": "Next spin in {time}",
"spin.countdown": "{h}h {m}m",
"spin.matchHint": "Every online game you finish earns a spin, up to {max} a day.",
"spin.odds": "Prize chances",
"spin.error": "Couldn't spin. Check your connection and try again.",
"spin.tileReady": "Free spin!",
"spin.tileLocked": "Finish a game for a bonus spin",
```

- [ ] **Step 1:** Add the strings to all 7 locales. Run `npx tsc --noEmit`. Expected: passes, because every locale has every key.
- [ ] **Step 2:** Build `SpinWheel` and `SpinSheet`.
- [ ] **Step 3:** Run `npx vitest run && npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 4:** Check on the iOS simulator against a local or allowlisted server. Use the build recipe in memory `ludo-sim-driving`, and verify with `simctl io screenshot` (idb tapping is broken under Xcode-beta 27). Check that the wheel lands on the paid segment, that "Spin again" appears with a match spin owed, and that the odds list matches.
- [ ] **Step 5:** Commit: `feat(spin): the wheel and the spin sheet`.

### Task 6: App: the spin tile on Home

**Files:** Create `apps/mobile/src/components/SpinTile.tsx`. Modify `apps/mobile/src/screens/HomeScreen.tsx`.

**Interfaces:**

- Consumes: `tileView`, `formatCountdown`, `useSpin`, `SpinSheet`.
- Produces:
  - `SpinTile({ view, onPress, height }: { view: TileView; onPress: () => void; height?: number })`. Built on `Surface3D` like `DailyChestTile`, with a small drawn wheel glyph:
    - `ready`: "Free spin!" and a count badge;
    - `countdown`: "Next spin in {time}", re-rendered once a minute;
    - `locked`: "Finish a game for a bonus spin".
  - HomeScreen:
    - It calls `useSpin.getState().refresh()` in the same effect that refreshes the wallet (mount and `onlineStatus` change).
    - While `tileView` is not `hidden`, the hero zone's chest row becomes a row of `DailyChestTile` and `SpinTile`, with `flex: 1` each, a `space.sm` gap, and both at `height={metrics.chest}`. While `hidden`, the chest tile renders exactly as today.
    - Tapping opens `SpinSheet` (its own `useState`). Its `onClose` refreshes the spin state.
    - `DailyChestTile` must stay legible at half width. If its label doesn't fit at 320 pt, give it a `compact` prop that drops the secondary line.

This task's logic (`tileView`, `formatCountdown`) is tested in Task 4. Here the checks are type-checking and screenshots.

- [ ] **Step 1:** Build `SpinTile` and wire Home.
- [ ] **Step 2:** Run `npx vitest run && npx tsc --noEmit`. Expected: all pass.
- [ ] **Step 3:** Take simulator screenshots of Home with the tile ready, counting down and locked, at 320 pt and 430 pt wide, and with the feature off: Home must be identical to 1.3.2.
- [ ] **Step 4:** Run the fingerprint check: it must still equal the 1.3.2 builds.
- [ ] **Step 5:** Commit: `feat(spin): spin tile beside the daily chest`.

### Task 7: Hand-off and rollout (each production step needs Bishal's go-ahead)

- [ ] Run `npm test` from the repo root. Expected: all pass.
- [ ] Report to Bishal, and ask to go ahead with each of the steps below.
- [ ] Apply 0086 with the `execute_sql` recipe in memory `ludo-supabase-ops`: wrap it in begin/commit, insert the `schema_migrations` row `0086`, then `notify pgrst`. Verify `default.spin.enabled` is false.
- [ ] Deploy `game` with `npm run build:edge` and `supabase functions deploy game --project-ref qosoinftcnkfwoaixkae`. First diff the live source against the working tree, per memory. Then POST `{op:"spinState"}` with a real session and expect `{"enabled":false}`.
- [ ] Put Bishal's test account ids on `spin.allowlistUserIds`; he names the accounts. Check on device: odds, the cap, a retry, and the 5:45 AM Nepal reset.
- [ ] Once 1.3.2 is live on both stores, publish the OTA to the 1.3.2 runtime, then set `spin.enabled = true` when Bishal says so.
- [ ] Post on "To Grok": the `spin_log` and `spin-*` reasons for its daily note, and the 7-day watch list in the spec's "Rollout".
