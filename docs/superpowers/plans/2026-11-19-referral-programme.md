# Referral Programme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pay a player 200 coins (and their friend 100) when a friend they brought plays 2 online
games and comes back on a later Nepal day, with an invite card on the Friends screen.

**Architecture:** One migration adds a `referrals` table and four SQL functions that own every rule
(config, attach, settle, list). The `game` edge function calls them from the existing friend-code
lookup, friend-room join, game settlement and activity hook, and exposes one read op. The app shows
the card, a reward pop-up and a reward-aware share message. All of this is JS-only on the client.
The app takes the programme's settings (on/off, amounts, games) from the `referrals` op response,
not from the config store. That keeps one source of truth, `referral_config()`, which is a small
departure from the spec's wording.

**Tech Stack:** PostgreSQL (Supabase) migrations, tested with PGlite (`npm run test:db`); Deno edge
function (`npm run test:edge`); Expo / React Native + zustand, tested with vitest
(`npm run test:app`).

**Spec:** `docs/superpowers/specs/2026-11-19-referral-programme-design.md`

## Global Constraints

- New migration number is **0082**; 0001–0081 are frozen and must not be edited.
- Amount defaults: `inviterCoins 200`, `inviteeCoins 100`, `gamesRequired 2`, `attachWindowHours 24`, `minHoursSinceSignup 8`, `inviterWeeklyCap 10`, `inviterLifetimeCap 25`, `enabled false`.
- "Later day" = `(now() at time zone 'Asia/Kathmandu')::date > (auth.users.created_at at time zone 'Asia/Kathmandu')::date` **and** `now() - created_at >= make_interval(hours => minHoursSinceSignup)` (8 h, Bishal 19 Nov).
- Ledger: `wallet_apply(user, amount, 'referral-invitee' | 'referral-inviter', null, 'earned', 'referral:<id>:invitee' | 'referral:<id>:inviter')`.
- Bots (`bot_identities`) are never inviter, invitee, or listed. No UI text mentions bots.
- Client changes are JS-only: native fingerprints must stay ios `c7729dc5…` / android `5b79a5be…`.
- Every new UI string exists in all 7 locales (en, hi, ne, bn, ur, es, pt-BR); i18n tests enforce it.
- No deploys, no `supabase db push`, no EAS builds. Bishal runs those.
- Commit only when Bishal says so (his standing rule); no Claude attribution in commit messages.
- Work on branch `feat/referrals`, cut from `feat/own-app-promos`.

## Review Focus

1. **A sign-up just before Nepal midnight.** It must not qualify minutes later: the 8-hour minimum (Bishal, 19 Nov) blocks it. Task 1 tests both sides of that line.
2. **The invitee deletes their account.** The referral row disappears with them (FK cascade) and the inviter's card simply loses the line. Task 1 tests the cascade.
3. **A player with no profile name** (a guest who skipped the name screen) appears as a localised "New player" on cards and pop-ups. Task 3 tests the fallback.
4. **A second code lookup or room join** by an already-referred player changes nothing. The first referral wins. Task 1 tests it.
5. **The programme is off, or the op fails.** The card is hidden, no pop-up appears, and Share sends the plain message. Task 3 tests the store and mapping under both.

---

### Task 1: Migration 0082 and its SQL contract tests

**Files:**

- Create: `supabase/migrations/0082_referrals.sql`
- Create: `scripts/tests/referrals.test.mjs`

**Interfaces:**

- Produces (all `security definer`, `set search_path = public, pg_temp`, execute revoked from public/anon/authenticated and granted to `service_role` only):
  - `referral_config() returns jsonb`: the defaults object above, overlaid with `app_config.value->'economy'->'referral'` from the `key='default'` row (`defaults || coalesce(override, '{}')`).
  - `referral_attach(p_invitee uuid, p_inviter uuid, p_source text) returns jsonb`: returns `{"attached": false}`, or `{"attached": true, "inviteeCoins": n, "gamesRequired": n}`.
  - `referral_settle(p_invitee uuid) returns jsonb`: returns `{"paid": false}`, or `{"paid": true, "referralId", "inviterUserId", "inviteeUserId", "inviterPaid": bool, "inviterCoins", "inviteeCoins"}`.
  - `referral_list(p_user uuid) returns jsonb`: returns `{"config": {enabled, inviterCoins, inviteeCoins, gamesRequired}, "invited": [...], "invitedBy": {...} | null}`. Each item has `id, name (null if no profile), avatarId, gamesPlayed (min(games_played, gamesRequired)), state ('playing' | 'nextDay' | 'rewarded' | 'capped'), rewardedAt`. `invited` is sorted newest first.
- Table `public.referrals`, exactly as in the spec's Data section: RLS enabled, no policies, index `referrals_inviter_idx (inviter_user_id, created_at)`.

- [ ] **Step 1: Create the branch**

Run: `git switch -c feat/referrals feat/own-app-promos`
Expected: `Switched to a new branch 'feat/referrals'`

- [ ] **Step 2: Write the failing tests in `scripts/tests/referrals.test.mjs`**

Follow `scripts/tests/economy.test.mjs`. Build the schema as `economySchema()` plus these fixtures, then `0082_referrals.sql`:
`alter table auth.users add column created_at timestamptz not null default now();`
`create table bot_identities(user_id uuid primary key);`
`create table app_config(key text primary key, value jsonb not null);`
`create table profiles(user_id uuid primary key, display_name text, avatar_id text);`

Set the programme on per test with `insert into app_config values ('default', '{"economy":{"referral":{"enabled":true}}}')`. Name users with the `uid(n)` helper. Tests:

```js
test('attach records a code referral for a new player', ...)       // attached true, inviteeCoins 100, gamesRequired 2; one row, source 'code', status 'pending'
test('attach refuses when the programme is off', ...)               // no app_config override -> {attached:false}, no row
test('attach refuses a player older than the window', ...)          // invitee created_at = now() - interval '25 hours'
test('attach refuses self, and bots on either side', ...)           // invitee = inviter; inviter in bot_identities; invitee in bot_identities
test('the first referral wins', ...)                                 // second attach to another inviter -> attached false, original row unchanged
test('attach refuses the reverse of an existing referral', ...)      // A referred B; B -> A attach is refused
test('settle waits for enough games', ...)                           // 1 game, signed up yesterday (Nepal) -> {paid:false}, status pending
test('settle waits for a later Nepal day', ...)                      // 2 games, signed up today (Nepal) -> {paid:false}
test('settle pays both sides once', ...)                             // 2 games, signed up yesterday -> paid; wallet_txns has referral-invitee +100 and referral-inviter +200 with the two ext_ids; status 'rewarded'; second call -> {paid:false}, balances unchanged
test('a sign-up just before Nepal midnight waits 8 hours', ...)    // created_at = start of today Nepal minus 5 minutes, 2 games, now earlier than created_at + 8h -> {paid:false}; created_at 9h ago and yesterday (Nepal) -> paid
test('an inviter at the weekly cap is not paid, the invitee still is', ...) // 10 rewarded referrals for the inviter in the last 7 days -> invitee +100 only, status 'inviter_capped', inviterPaid false
test('the lifetime cap applies the same way', ...)                   // 25 rewarded, older than 7 days
test('deleting the invitee removes the referral', ...)               // delete from auth.users -> referrals row gone
test('list shows invited friends with their state', ...)             // states playing (1 game), nextDay (2 games, same day), rewarded; gamesPlayed capped at 2; name null when no profile; invitedBy filled for the invitee
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test scripts/tests/referrals.test.mjs`
Expected: FAIL. The schema step errors because `0082_referrals.sql` does not exist.

- [ ] **Step 4: Write `supabase/migrations/0082_referrals.sql`**

Table, index, RLS, the four functions and the grants. In `referral_settle`, lock the pending row
`for update` and count `games_played` from `player_stats` (0 if no row). Caps count this inviter's
rows with `status = 'rewarded'`: `qualified_at > now() - interval '7 days'` for the weekly cap, and
all of them for the lifetime cap. `referral_attach` returns `{"attached": false}` on any refusal and
uses `insert … on conflict (invitee_user_id) do nothing`. Head the file with a comment block in the
style of 0081: why the rules exist and how to switch the programme on.

- [ ] **Step 5: Run the tests to verify they pass, then the whole DB suite**

Run: `node --test scripts/tests/referrals.test.mjs && npm run test:db`
Expected: all pass.

---

### Task 2: Edge function: recording, payout hooks and the `referrals` op

**Files:**

- Create: `supabase/functions/game/referral.ts`
- Create: `supabase/functions/game/referral.test.ts`
- Modify: `supabase/functions/game/social.ts` (`opFriendLookup`)
- Modify: `supabase/functions/game/room.ts` (`opJoin`: select `host_user_id`, attach after a successful join)
- Modify: `supabase/functions/game/finish.ts` (`settleIfFinished`)
- Modify: `supabase/functions/game/index.ts` (activity hook and `case "referrals"`)
- Modify: `supabase/functions/game/lib.ts` (`LIMITS.referrals = 120`)

**Interfaces:**

- Consumes: the Task 1 SQL functions via `admin.rpc`.
- Produces:
  - `export type ReferralAttach = { attached: false } | { attached: true; inviteeCoins: number; gamesRequired: number }`
  - `export async function attachReferral(admin: SupabaseClient, inviteeId: string, inviterId: string, source: "code" | "room"): Promise<ReferralAttach>`: never throws; an RPC error yields `{ attached: false }`.
  - `export async function settleReferrals(admin: SupabaseClient, userIds: string[], push: typeof sendPush = sendPush): Promise<void>`: one `referral_settle` per distinct id. On `paid`, push the inviter `"You earned {inviterCoins} coins"` / `"{name} played 2 games."` (only if `inviterPaid`), and the invitee `"You earned {inviteeCoins} coins"` / `"Thanks for joining {name}."`. Use `data: { type: "referral" }` and names from `displayNameOf`. Never throws.
  - `export async function opReferrals(admin: SupabaseClient, userId: string): Promise<Response>`: `rateOk(admin, userId, "referrals", LIMITS.referrals)`, then `json(referral_list result)`. On RPC error: `json({ error: "Could not load invites." })`.
  - `friendLookup` response gains an optional `referral: { attached: true, inviteeCoins, gamesRequired }`. It is present only when attached; existing fields and errors are unchanged.

- [ ] **Step 1: Write the failing tests in `referral.test.ts`**

Use a hand-rolled fake admin in the style of `gameModes.test.ts` that records `rpc` calls and returns canned data.

```ts
Deno.test("attachReferral passes invitee, inviter and source to referral_attach", ...) // rpc name + args { p_invitee, p_inviter, p_source }
Deno.test("attachReferral treats an RPC error as not attached", ...)                   // -> { attached: false }
Deno.test("settleReferrals settles each distinct user once", ...)                       // ["a","b","a"] -> 2 referral_settle calls
Deno.test("settleReferrals pushes both sides on a payout, and only the invitee when the inviter is capped", ...) // fake push records recipients
Deno.test("opReferrals returns referral_list for the caller", ...)                      // body equals the rpc data
Deno.test("opFriendLookup adds referral only when it attached", ...)                     // fake friend_codes/profiles/player_stats rows; attach rpc returns attached true -> body.referral set; false -> no key
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx --yes deno@2.1.4 test --no-check --allow-env --allow-net supabase/functions/game/referral.test.ts` with `SUPABASE_URL=https://example.supabase.co SUPABASE_SERVICE_ROLE_KEY=test`
Expected: FAIL. The module `./referral.ts` is not found.

- [ ] **Step 3: Implement `referral.ts` and wire the hooks**

- `opFriendLookup`: once the profile is found (after the block check), call `await attachReferral(admin, userId, targetId, "code")` and spread `referral` into the response when attached.
- `opJoin`: on the success path, when `host_user_id !== userId`, call `afterResponse(attachReferral(admin, userId, hostUserId, "room"))`.
- `settleIfFinished`: after the RPC succeeds, call `afterResponse(settleReferrals(admin, next.players.map(p => p.userId).filter(Boolean)))`.
- `index.ts`: inside the existing `touchGate.should(userId)` block, add `afterResponse(settleReferrals(admin, [userId]))`, and add `case "referrals": return await opReferrals(admin, userId);`.

- [ ] **Step 4: Run the new tests and the whole edge suite**

Run: `npm run test:edge`
Expected: all pass, including the existing `gameModes`/`seatVersion` tests that exercise `opJoin`.

---

### Task 3: App data layer: API, store, pure mapping, strings

**Files:**

- Modify: `apps/mobile/src/net/api.ts` (`getReferrals`; `lookupFriendCode` return type gains `referral?`)
- Create: `apps/mobile/src/lib/referrals.ts`
- Create: `apps/mobile/src/store/referralStore.ts`
- Modify: `apps/mobile/src/i18n/locales/{en,hi,ne,bn,ur,es,pt-BR}.ts`
- Create: `apps/mobile/__tests__/referrals.test.ts`

**Interfaces:**

- Consumes: the `referrals` op and `friendLookup.referral` from Task 2.
- Produces:
  - Types in `lib/referrals.ts`: `export type Translate = ReturnType<typeof useT>` (from `../i18n`); `ReferralState = "playing" | "nextDay" | "rewarded" | "capped"`; `ReferralFriend = { id: string; name: string | null; avatarId: string | null; gamesPlayed: number; state: ReferralState; rewardedAt: string | null }`; `ReferralsResponse = { config: { enabled: boolean; inviterCoins: number; inviteeCoins: number; gamesRequired: number }; invited: ReferralFriend[]; invitedBy: ReferralFriend | null }`.
  - `export async function getReferrals(): Promise<ReferralsResponse>` in `api.ts` (`callGame("referrals")`).
  - `export function cardRows(r: ReferralsResponse, t: Translate): Array<{ id: string; name: string; status: string; done: boolean }>`: the name falls back to `t("referral.newPlayer")`; the status strings are those below.
  - `export function unannounced(r: ReferralsResponse, announced: readonly string[]): Array<{ key: string; coins: number; name: string | null; side: "inviter" | "invitee" }>`: the key is `` `${id}:inviter` `` or `` `${id}:invitee` ``. Only `rewarded` rows count for the inviter side; `rewarded` and `capped` count for the invitee side (`invitedBy`).
  - `export function friendShareMessage(t: Translate, name: string, code: string, url: string, rewardOn: boolean): string`: uses `invite.friendMessageReward` when `rewardOn`, `invite.friendMessage` otherwise.
  - `useReferrals` (zustand): `data: ReferralsResponse | null`, `load(opts?: { force?: boolean }): Promise<void>` (skips when the last load was under 5 minutes ago unless `force`; on failure keeps `data` null), `announced: string[]` (persisted via `kvStorage`, store name `ludo-referrals`), `markAnnounced(keys: string[]): void`.
- New i18n keys (English values; translate the other six):
  - `referral.cardTitle`: "Invite friends: you get {inviterCoins}, they get {inviteeCoins}"
  - `referral.cardRule`: "When a friend adds your code and plays {games} games"
  - `referral.shareCode`: "Share my code {code}"
  - `referral.empty`: "Nobody yet. Share your code with a friend who's new to the game."
  - `referral.playing`: "{played} of {games} games"
  - `referral.nextDay`: "Back tomorrow to finish"
  - `referral.rewarded`: "✓ {coins} coins"
  - `referral.capped`: "Done"
  - `referral.newPlayer`: "New player"
  - `referral.lookupNote`: "Add {name} and play {games} games: you'll get {coins} coins."
  - `referral.noticeInviter`: "+{coins} coins: {name} played {games} games"
  - `referral.noticeInvitee`: "+{coins} coins for joining {name}"
  - `invite.friendMessageReward`: "Add me on Ludo! I’m {name}, my friend code is {code}. Once you’ve played 2 games, we both get coins.\n{url}"

- [ ] **Step 1: Write the failing tests in `__tests__/referrals.test.ts`**

```ts
it("maps each state to its line", ...)            // playing -> "1 of 2 games", nextDay, rewarded -> "✓ 200 coins", capped -> "Done"
it("names a friend with no profile 'New player'", ...)
it("announces each reward once per side", ...)     // unannounced(r, []) has inviter+invitee keys; unannounced(r, those keys) is []
it("does not announce pending friends", ...)
it("uses the reward share message only when the programme is on", ...) // in every locale: contains code + url; reward line only when rewardOn
it("load keeps data null when the op fails", ...)  // mock api.getReferrals rejecting
it("load skips a second fetch within 5 minutes unless forced", ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/mobile && npx vitest run __tests__/referrals.test.ts`
Expected: FAIL. Cannot find module `../src/lib/referrals`.

- [ ] **Step 3: Implement `lib/referrals.ts`, `store/referralStore.ts`, `getReferrals`, and the 13 keys in all 7 locales**

- [ ] **Step 4: Run the app suite and the type check**

Run: `cd apps/mobile && npx vitest run && npx tsc --noEmit`
Expected: all pass (including the i18n "every key / no untranslated string" tests), tsc exit 0.

---

### Task 4: App UI: invite card, lookup note, Home pop-up

**Files:**

- Create: `apps/mobile/src/components/InviteCard.tsx`
- Create: `apps/mobile/src/components/ReferralNotice.tsx`
- Modify: `apps/mobile/src/screens/FriendsScreen.tsx` (card above the "Add a friend" button; `useReferrals.getState().load({ force: true })` on mount)
- Modify: `apps/mobile/src/screens/AddFriendScreen.tsx` (share through `friendShareMessage(..., rewardOn)`; after a successful code lookup with `referral`, show `referral.lookupNote` under the found player)
- Modify: `apps/mobile/src/screens/HomeScreen.tsx` (load on mount; show `ReferralNotice` for the first `unannounced` item only when no other Home sheet is open; on close, `markAnnounced` + wallet refresh)

**Interfaces:**

- Consumes: `useReferrals`, `cardRows`, `unannounced`, `friendShareMessage` (Task 3); `useFriends().myCode`; `INVITE_BASE`; existing `Surface3D`, `Sheet`, `Button`, `SectionLabel`.
- Produces: `InviteCard()` (no props; renders null when `data` is null or `!data.config.enabled`), and `ReferralNotice({ item, onClose })`.

- [ ] **Step 1: Build `InviteCard` and `ReferralNotice` from the spec's sketch, in the Friends screen's `Surface3D` style**

- [ ] **Step 2: Wire the three screens**

The "no other Home sheet" condition is: `!bonusSheet && !coinsSheet && !roomSheet && !quickSheet && !sheetMode && !savePrompt.reason`.

- [ ] **Step 3: Verify the suite, the types and the fingerprints**

Run: `cd apps/mobile && npx vitest run && npx tsc --noEmit && for p in ios android; do npx expo-updates fingerprint:generate --platform $p | python3 -I -c "import json,sys;print(json.load(sys.stdin)['hash'][:8])"; done`
Expected: all tests pass, tsc exit 0, fingerprints `c7729dc5` and `5b79a5be`.

---

### Task 5: Hand-off

**Files:** none in the repo (Notion and memory only).

- [ ] **Step 1: Run every suite once more from the repo root**

Run: `npm run test:db && npm run test:edge && npm run test:app`
Expected: all pass.

- [ ] **Step 2: Report to Bishal, ask to commit, and list his rollout steps in order**

The steps: apply 0082 → deploy `game` → publish the app update → set `economy.referral.enabled` to true.

- [ ] **Step 3: Update Notion**

Set the "Referral programme design" row to In progress with a note. Post the rollout order and what to measure on "To Grok".
