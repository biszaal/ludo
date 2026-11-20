# Country Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small country flag next to each player's name in online games, on the results screen and in the Friends list.

**Architecture:** The server records each player's country (ISO code only) from Cloudflare's `cf-ipcountry` request header. Hidden quick-match bots get a country that suits their name, from a SQL function. The app renders the code as an emoji flag. Players can hide theirs in Settings.

**Tech Stack:** PostgreSQL migration (PGlite tests, `npm run test:db`), Deno edge function (`npm run test:edge`), Expo / React Native (vitest, `npm run test:app`).

**Spec:** Bishal's request relayed on 20 Nov 2026 ("a country flag next to each player's name, like Ludo King"). He asked for it to be planned and built ("plan it and implement it"), handing over the open calls. Claude Code's calls:

- the flag shows by default, and is hidden from Settings;
- hidden bots get a country that suits their name, distributed like real players, with about 1 in 10 showing none;
- labelled friend-room bots get no flag;
- no country picker in this version (hide/show only).

Grounding is in memory `ludo-country-flags-idea`.

## Global Constraints

- New migration **0083** (0082 is referrals). Frozen migrations are untouched.
- Store only a two-letter uppercase ISO code. Never an IP address, a city or coordinates. Ignore `XX` and `T1` (Cloudflare's unknown and Tor values).
- Hidden-bot rule: a bot's flag must suit its name, and nothing may mark a seat as a bot. Labelled friend-room bots stay colour-only (`botOf` returns null).
- JS-only on the client (fingerprints ios `c7729dc5…`, android `5b79a5be…` unchanged), so it ships as an update.
- Old servers: if the `country` column doesn't exist yet, profile reads must fall back to the old select, never lose names and avatars.
- Strings in all 7 locales. No deploys, migrations or builds by Claude. Commit only when Bishal says so.

## Review Focus

1. **The app update ships before migration 0083 is applied.** Profile reads must still return names and avatars. Task 3 tests the fallback.
2. **Cloudflare sends `XX`, `T1`, lowercase or an empty value.** Nothing is stored. Task 1 (SQL) and Task 2 (header parse) test it.
3. **A player hides their flag, then their next request arrives.** The server must not set it again. Task 1 tests it.
4. **A new bot is minted with a guest handle or a name.** It gets a country by the same rule as the backfill. Task 1 tests `bot_country_for` on both kinds.
5. **A friend-room labelled bot.** It shows no flag. Task 3 keeps `botOf` ahead of the flag lookup, as it already is for names.

---

### Task 1: Migration 0083 and SQL tests

**Files:** Create `supabase/migrations/0083_country_flags.sql`, `scripts/tests/countryFlags.test.mjs`.

**Interfaces (produces):**

- Columns on `profiles`: `country text check (country ~ '^[A-Z]{2}$')` (nullable) and `country_hidden boolean not null default false`.
- `profile_set_country(p_user uuid, p_country text) returns boolean`. Validates the code (2 letters, uppercased, not XX/T1). Then sets `country` only where it is null, `country_hidden` is false and the user is not in `bot_identities`. Returns whether a row changed.
- `bot_country_for(p_user uuid, p_name text) returns text` (immutable).
  - Named bots map by the name's first word, ignoring trailing digits and initials: Aarav, Arjun, Ipsita, Nikhil, Priya, Rahul → IN. Maya, Mina, Tara → NP. Anika, Nadia → BD. Aisha → PK. Omar → AE. Clara, Lucas, Sofia → BR. Elena, Mateo → ES. Jonas, Lena → DE. Daniel, Leo, Noah → US. Isla → GB. Tomas → PT.
  - Every other name, including guest handles, takes a bucket from `abs(hashtext(p_user::text)) % 100`: 0–49 IN, 50–64 NP, 65–74 BD, 75–79 PK, 80–84 AE, 85–89 US, 90–99 null.
- `bot_assign_country(p_user uuid) returns text`. Sets the profile's country from `bot_country_for` when null; returns it.
- Backfill: every hidden bot profile (`bot_identities.visible = false`) with a null country.
- Grants: execute for `service_role` only.

- [ ] **Step 1:** Write the failing tests. Fixture: `economySchema()`, plus `bot_identities(user_id uuid primary key, visible boolean not null default false)` and `profiles(user_id uuid primary key, display_name text, avatar_id text)`, then 0083.

```js
test('set_country stores a valid code once', ...)            // 'np' -> 'NP'; a second call with 'IN' changes nothing
test('set_country ignores unknown and malformed codes', ...) // XX, T1, '', null, 'USA', '1A' -> false, country null
test('a hidden flag is never set again', ...)                // country_hidden true -> false, stays null
test('set_country never touches a bot', ...)                 // user in bot_identities -> false
test('named bots get a country that suits the name', ...)    // 'Arjun K'->IN, 'Rahul99'->IN, 'Maya'->NP, 'Omar87'->AE, 'Clara14'->BR, 'Elena V28'->ES, 'Isla'->GB
test('guest-handle bots are stable and spread like players', ...) // same uuid -> same code; over 2000 uuids IN is the most common and null is 5–15%
test('bot_assign_country fills only an empty country', ...)
```

- [ ] **Step 2:** Run `node --test scripts/tests/countryFlags.test.mjs`. Expected: FAIL, because 0083 doesn't exist yet.
- [ ] **Step 3:** Write 0083.
- [ ] **Step 4:** Run `node --test scripts/tests/countryFlags.test.mjs && npm run test:db`. Expected: all pass.

### Task 2: Edge function: record the country, give minted bots one

**Files:** Create `supabase/functions/game/country.ts` and `country.test.ts`. Modify `index.ts` (the country gate) and `bots.ts` (after both profile inserts).

**Interfaces (produces):**

- `countryFromHeaders(h: Headers): string | null`, reading `cf-ipcountry` with the same validation as the SQL.
- `recordCountry(admin, userId, h: Headers): Promise<void>`. Calls `profile_set_country` when a code exists, and swallows errors.
- `export const countryGate = createTouchGate(5 * 60_000)`. In the router: `if (countryGate.should(userId)) afterResponse(recordCountry(admin, userId, req.headers))`.
- `bots.ts`: after a successful bot profile insert (named or guest), call `afterResponse(admin.rpc("bot_assign_country", { p_user: uid }))`.

- [ ] **Step 1:** Write the failing tests: `countryFromHeaders` accepts `NP`/`np` and rejects XX/T1/empty/`USA`; `recordCountry` calls the RPC with the code; no header means no call; an RPC error doesn't throw.
- [ ] **Step 2:** Run them. Expected: FAIL, because the module is missing.
- [ ] **Step 3:** Implement and wire.
- [ ] **Step 4:** Run `npm run test:edge`. Expected: all pass.

### Task 3: App: flags on seats, results and Friends, plus the Settings toggle

**Files:**

- Create: `apps/mobile/src/lib/flags.ts`, `apps/mobile/__tests__/flags.test.ts`.
- Modify: `net/api.ts`, `components/PlayerChip.tsx`, `components/GameView.tsx`, `components/ResultsOverlay.tsx`, `screens/OnlineGameScreen.tsx`, `screens/FriendsScreen.tsx`, `screens/SettingsScreen.tsx`, and the 7 locales.

**Interfaces (produces):**

- `flagEmoji(code: string | null | undefined): string | null`: two regional-indicator symbols, or null for anything that isn't `^[A-Za-z]{2}$` or is XX/T1.
- `Profile.country?: string | null`.
- `getProfiles`: selects `country` too. **If that select errors, retry once with the old column list** (an old server).
- `MyProfile` gains `countryShown: boolean | null` (null when unknown).
- `setCountryShown(shown: boolean): Promise<boolean>`. Self-update of `country_hidden = !shown`; hiding also sets `country = null`; returns success.
- Display:
  - `PlayerChip`: optional `country`, with the flag before the name.
  - `GameView`: `countryFor?: (playerId) => string | null`, passed to each chip and to `ResultsOverlay`.
  - `ResultsOverlay`: `countryFor`, with the flag before the names in the ranked rows.
  - `OnlineGameScreen`: `countryFor` returns null for `botOf`, otherwise `profileOf(id)?.country`.
  - `FriendsScreen` `Row`: optional `country`.
  - Settings: a "Show my country flag" row.
- New strings, in all 7 locales: `settings.showCountry` "Show my country flag" and `settings.showCountryHint` "Other players see it next to your name. It comes from where you play."

- [ ] **Step 1:** Write the failing tests (`flags.test.ts`):
  - `flagEmoji('NP')` is 🇳🇵 and `'in'` is 🇮🇳;
  - null for XX, T1, '', null, 'USA';
  - `getProfiles` falls back to the old select when the first one errors (mock the supabase client).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement and wire the screens.
- [ ] **Step 4:** Run `cd apps/mobile && npx vitest run && npx tsc --noEmit`, plus the fingerprint check. Expected: all pass, and fingerprints `c7729dc5` / `5b79a5be`.

### Task 4: Hand-off

- [ ] Run `npm test` from the repo root.
- [ ] Tell Bishal: the rollout order (0082 → 0083 → deploy `game` → update), the privacy-policy line, and ask to commit.
- [ ] Add a "To Grok" note and a board row: privacy-policy line plus data-safety note, owner Bishal.
