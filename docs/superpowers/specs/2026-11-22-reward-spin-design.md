# Reward spin — design (phase 1)

Date: 2026-11-22. Source: Grok's "add a reward spin" proposal of 22 Nov, approved by Bishal.
Bishal chose the phase 1 scope (option A) and the build approach (count at claim time).

## Why

The goal is to get a new player to finish their first online game and come back on day 2. On 21 Nov only
2 of 12 non-Google sign-ups played a first game, and the day-2 bonus had 0 claims. A wheel gives a reason
to finish game 1 (a bonus spin waits for you) and a reason to come back tomorrow (a better daily spin).

## Goals

- A daily free spin, a one-off first-game spin and up to 3 match spins a day, paying coins or gems.
- Prizes chosen on the server; the app only animates to the segment it is told.
- Ships switched off: nothing shows until the server setting turns it on, for test accounts first.
- Delivered as an over-the-air update to the 1.3.2 runtime (no native code), once 1.3.2 is live on both stores.

## Non-goals (phase 2, after we see phase 1's numbers)

- Ad spins ("watch an ad for a Super Spin").
- The gentler streak rule (a missed day drops one tier instead of resetting).
- Spin notifications.
- A local-midnight reset.

## Anti-goals

- No paid spins, ever: no gems or money buy a spin (monetisation fairness rule: money and ads buy access
  and appearance, never outcome; a purchasable random prize would also be a loot box).
- Nothing about a spin may touch how a game plays: no rerolls, no assist, nothing that varies by spins.
- No app copy mentions bots or dice assistance.
- The end-of-match payout path is not modified.

## Approaches considered

1. **Count at claim time (chosen).** When the wheel opens, the server derives what the player is owed from
   records that already exist, and one database function checks, picks and pays in a single transaction.
   No new bookkeeping in the game; a spin cannot be lost to a failed write.
2. **Grant tokens when a game ends** (Grok's design). Explicit, but adds a write to the payout step on every
   game, a path with a history of subtle bugs; a failed token write silently loses a spin.
3. Counting on the device. Rejected: forgeable.

## Rules (decided)

| Spin | Who gets it | When it resets | Wheel |
|---|---|---|---|
| Daily | Everyone, once a day | 00:00 UTC (5:45 AM Nepal), the same reset as the daily bonus | Bronze, Silver or Gold by streak |
| First game | Once per account, after at least one game in `player_stats.games_played` | Never | First-game |
| Match | One per online game finished today while still seated, max 3 a day | 00:00 UTC | Bronze |

- **Streak tier:** days 1–2 Bronze, 3–6 Silver, 7 Gold. The streak is the daily bonus streak in
  `wallets.streak_day`, read as it would stand today (if today's bonus is not claimed yet: yesterday's
  claim → streak + 1, capped at 7; otherwise 1). It resets on a missed day, as the bonus does today.
- **Existing players** who have already played get the first-game spin the first time they open the wheel.
- **A finished game** = `games.status = 'finished'`, finished today (UTC, by `games.updated_at`), with the
  player's `userId` in `state.players` and `hasLeft` not true. Quick match and friend rooms both count;
  local and vs-computer games do not. Finished games are kept 7 days, so today's are always there.
- **Order on the wheel screen:** first-game spin first, then daily, then match spins.

## Prize tables (Grok's, unchanged; weights per 1,000)

- **Bronze** (EV ≈ 66 coins): 25 c 280, 50 c 300, 75 c 150, 100 c 120, 150 c 70, 2 gems 50, 250 c 25,
  500 c 4, 1,000 c 1.
- **Silver** (EV ≈ 104): 50 c 300, 75 c 220, 100 c 180, 150 c 120, 2 gems 80, 250 c 70, 500 c 25, 1,000 c 5.
- **Gold** (EV ≈ 170): 100 c 300, 150 c 250, 200 c 180, 5 gems 120, 300 c 100, 500 c 40, 1,000 c 10.
- **First game** (EV ≈ 139): 100 c 400, 150 c 300, 200 c 200, 5 gems 80, 500 c 20.

Gems are valued at `gems.exchangeRate` (10 coins per gem). A heavy player's phase 1 daily maximum EV is
about 170 + 3 × 66 ≈ 370 coins, beside a 100-coin stake and a 50–200 daily bonus.

## Server

**Config** — a new `spin` block in `app_config.default`, read only by the server:

```json
"spin": {
  "enabled": false,
  "allowlistUserIds": [],
  "matchMaxPerDay": 3,
  "dailyCoinCap": 1500,
  "tiers": { "silverFromDay": 3, "goldFromDay": 7 },
  "tableVersion": 1,
  "tables": {
    "bronze":    [{ "coins": 25, "w": 280 }, …, { "gems": 2, "w": 50 }, …],
    "silver":    [ … ],
    "gold":      [ … ],
    "firstGame": [ … ]
  }
}
```

Live 1.3.1 and 1.3.2 apps ignore unknown config keys (`mergeConfig`, since July), so adding it is safe.

**Table** `spin_log`: id, user_id, day (UTC date), source (`daily` | `first` | `match`), wheel, table_version,
segment index, coins, gems, request_id, created_at.
- Unique `(user_id, request_id)` for idempotent retries.
- Partial unique `(user_id, day) where source = 'daily'` and `(user_id) where source = 'first'`, so a race
  can never pay a daily or first-game spin twice.
- RLS: a player can read only their own rows; no client inserts or updates.

**Function** `spin_claim(p_user, p_source, p_request_id, p_tables jsonb, …)` — security definer,
service role only, one transaction:
1. A repeat of a known request id returns the stored result (no second payout).
2. Lock the player's `wallets` row (serialises match spins).
3. Check eligibility for the source (rules above); refuse with a reason if not owed.
4. Pick a segment with `extensions.gen_random_bytes` over the weights.
5. If today's spin coins plus this prize would pass `dailyCoinCap`, pay the largest segment that fits and
   report that segment instead.
6. Pay through `wallet_apply` / `gem_apply` with reason `spin-daily`, `spin-first` or `spin-match`, bucket
   `earned`, ext_id `spin:<request_id>`. If gems are switched off, a gem prize pays coins at the exchange rate.
7. Insert the `spin_log` row and return segment index, prize and new balances.

A read-only `spin_status(p_user, …)` returns what is owed now: daily (yes/no and tier), first game
(owed / used / locked), match spins left today, and the next reset time.

**Edge ops** in the `game` function:
- `spinState` → `{ enabled, owed: { first, daily, match }, tier, next: { source, wheel, segments }, resetsAt }`.
  `segments` are the wheel the next spin uses, from the same table the server picks from, so the drawn
  wheel and the odds screen can never disagree with the payout.
- `spinClaim { source, requestId }` → `{ segment, prize, balance, gems, state }` (state as from `spinState`).
- Both answer `{ enabled: false }` / refuse unless `spin.enabled` is true or the caller is on the allowlist.
- Rate-limited like `dailyBonus`.

## App

- **Home:** the hero zone's chest row splits in two, the chest tile on the left and a spin tile on the right,
  at the chest's height, so Home's height budget does not change. The spin tile renders only when
  `spinState.enabled` is true; otherwise the chest keeps the full row, as today.

```
 ┌──────────────────────┐ ┌──────────────────────┐
 │ [chest] Day 3 bonus  │ │ [wheel] Free spin! ②  │   spins owed: badge with the count
 └──────────────────────┘ └──────────────────────┘
                          │ [wheel] Next spin 4h  │   nothing owed: countdown to the reset
                          │ [wheel] Finish a game │   first-game spin still locked (new player,
                          │         for a bonus   │   daily spin used)
```

- **Spin sheet** (a `Sheet`, like the daily bonus): the wheel drawn with Skia, a pointer and a Spin button.
  A label names the spin ("First game bonus", "Daily spin · Silver", "Match spin 2 of 3"). The wheel
  decelerates onto the server's segment; then the prize reveal with the existing confetti, the coins/gems
  pills refresh, and "Spin again" shows while more spins are owed. An "i" opens the odds: each prize and its
  chance, from the same `segments`.
- **Offline / refused:** a claim that fails leaves the spin owed (nothing was paid) and the button live again;
  the same request id is reused on retry, so a slow success cannot pay twice.
- Strings in all 7 locales. Haptics and sounds from the existing set.

## Rollout

1. Build and deploy with `spin.enabled = false`; migration, then the `game` function, then the OTA.
2. Put Bishal's test accounts on the allowlist; check odds, the cap, retries and the day reset on device.
3. When 1.3.2 is live on both stores and the OTA has reached it: `enabled = true` for everyone.
4. Watch for 7 days: share of new players who finish game 1 (target above 50%), day-2 returns, spins per
   active player by source, spin coins issued per active player. Grok reads `spin_log` and the `spin-*`
   wallet reasons.
5. Then decide phase 2 (ad spins, gentler streak, notifications).

Kill switch: `spin.enabled = false` hides the tile and refuses claims.

## Left to the builder

- Exact SQL for the effective streak, the RNG draw and the cap fallback, within the rules above.
- Wheel art, segment colours and the deceleration curve, in the app's existing style (Skia, as the dice).
- Whether `spin_log` needs a retention rule (it grows by at most 5 rows per player per day).
- Tests: SQL in PGlite (eligibility per source, races on daily/first, idempotent retry, cap, gem fallback,
  `hasLeft` games not counted), edge op tests, and app tests for the tile states and the sheet's retry.

Known limit: a rematch reuses the finished game's row, so a rematch finished on the same day counts as one
game, not two. It can only under-count, never over-pay.

## Phase 2 reference (from Grok's 22 Nov proposal, kept here so the Notion message could be cleared)

Not built in phase 1. Recorded verbatim in substance for the phase 2 design.

- **Ad Super Spin:** offered only after the daily free spin is used; opt-in button "Watch an ad for a Super Spin
  (up to 2,000 coins)"; max 3 a day; needs an `ad_rewards` row (placement `spin`) granted by AdMob SSV and unused.
  Ad spins and the existing gem/coin ads share one daily rewarded budget. Keep the flat 100-coin ad only for the
  out-of-coins moment. Table (EV ≈ 132): 50 c 28%, 100 c 30%, 150 c 15%, 200 c 12%, 300 c 7%, 4 gems 5%,
  500 c 2.5%, 1,000 c 0.4%, 2,000 c 0.1%.
- **Gentler streak:** a missed day drops one tier (Gold → Silver → Bronze) instead of resetting; show the next
  tier ("Come back tomorrow: Silver spin").
- **Notifications** (max 1 a day, early evening local, none if the app was opened that day, stop after 3 ignored):
  - Daily: "Your daily spin is ready. Spin, then jump into a match."
  - Streak: "Day 3 tomorrow: your spin upgrades to Silver."
  - Unused match spin: "You earned a match spin. Use it before midnight."
  - New player, no game yet (day 1 evening): "Finish your first game to unlock a free spin."
- **Config keys Grok proposed for later:** `ad: {enabled, maxPerDay: 3, requireFreeUsedFirst, requireSsv}`,
  `streakTiers.missDropsOneTier`, `push: {enabled, localHour: 19, maxPerDay: 1, stopAfterIgnored: 3}`.
- **Extra metrics for phase 2:** ad-spin opt-in % and rewarded impressions per DAU (Kongregate bar ≥ 30%), ad
  revenue per day, push open and opt-out rates, observed prize mix against the table per version.
