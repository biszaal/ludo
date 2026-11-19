# Referral programme: design

Date: 19 Nov 2026. Status: awaiting Bishal's approval. Growth plan step 3.

## Why

Paid ads are paused. The growth plan's free channel is players bringing friends, but most new
players never come back, so a reward paid at install mostly pays for people who leave. This
programme pays only once the invited friend has actually played and returned.

Success looks like: a steady trickle of qualified referrals each week, referred players returning
at a higher rate than organic ones, and no visible farming.

## Goals

- When a referred player qualifies, pay the inviter **200 coins** and the new player **100 coins**.
- **Qualifying** means the new player has finished **2 online games** (games against hidden bots
  count) and is active on a **later Nepal calendar day** than the day they signed up, **and at least
  8 hours after signing up** (added 19 Nov at Bishal's request, so a sign-up just before midnight
  can't qualify minutes later).
- A referral is **recorded** when a player who signed up less than **24 hours** ago either looks up
  a friend code or joins a friend room by its code. There is no new code-entry step.
- An **invite card** on the Friends screen shows the offer, a Share button and each invited
  friend's progress.
- A **pop-up** on Home tells each side when their reward has landed. A push is sent as well, best
  effort.
- Amounts, rules and an on/off switch live in server config.

## Non-goals (this version)

- Milestone bonuses (for example 5 friends), a Home banner, leaderboards.
- Links that survive an install (Android install referrer, paid attribution), and `?friend=` links.
- Device or advertising-ID checks.
- Credit for games against the computer or pass-and-play. Those never reach the server.
- Recording a referral when a new player finds someone by username. Only codes and room joins
  count (Claude Code's call: the card promotes the code, and a name search can land on a
  stranger).
- Anything retroactive for players who signed up before launch.

## Anti-goals (failures even if it works)

- Paying anything at install or sign-up.
- A reward that one person can farm in one sitting. That is why the second-day rule exists.
- Showing or hinting at hidden bots. Bots can never be an inviter or an invitee, and are never
  listed.
- Paying twice. Every grant goes through the ledger with a unique key.

## Constraints

- **Migrations:** 0001–0081 are taken and frozen. This one is **0082**. Changes to money paths need
  SQL tests in the PGlite harness (`scripts/tests`, `npm run test:db`).
- **Deploy order:** the migration first, then the `game` function. Bishal deploys both.
- **App part:** JavaScript only, so it ships as an over-the-air update to the 1.3.1 runtime. The
  native fingerprints must stay ios `c7729dc5…` and android `5b79a5be…`.
- **Older app versions:** they still trigger attach and payout through the server. Their players
  simply see coins arrive, with no card and no pop-up.
- **Monetisation rule:** coins buy access, never outcome, so a coin reward is within bounds.
- **Push:** it reaches few players today, so the pop-up is the main notice.
- **Public repo:** no secrets in code or docs.

## Approaches considered

1. **Server hooks on existing calls plus a `referrals` table (chosen).** Recording happens where
   the friend-code lookup and the room join already run. Payout is checked after each finished
   game and when the player is active.
2. **Detecting referrals later from existing tables (rejected).** Code lookups are not stored
   anywhere, so most referrals would be invisible. It would also lag.
3. **An "enter a friend's code" screen (rejected).** It adds a step the code lookup already makes
   unnecessary.

## Design

### Data: `public.referrals` (migration 0082)

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, primary key, default gen_random_uuid() | |
| inviter_user_id | uuid, not null, → auth.users on delete cascade | |
| invitee_user_id | uuid, not null, **unique**, → auth.users on delete cascade | one referral per new player |
| source | text, check in ('code', 'room') | |
| status | text, default 'pending', check in ('pending', 'rewarded', 'inviter_capped') | |
| created_at | timestamptz, default now() | when the referral was recorded |
| qualified_at | timestamptz, null | when it paid out |

- Index on (inviter_user_id, created_at).
- RLS on, with **no client policies**. Clients read only through the edge function.

### Config: `app_config` economy.referral

```json
{ "enabled": false, "inviterCoins": 200, "inviteeCoins": 100, "gamesRequired": 2,
  "attachWindowHours": 24, "minHoursSinceSignup": 8, "inviterWeeklyCap": 10,
  "inviterLifetimeCap": 25 }
```

- The defaults live in code, with `enabled: false`. When disabled: nothing is recorded, nothing is
  paid, and the card is hidden.
- The client reads `enabled`, the two amounts and `gamesRequired` for the card copy, through the
  existing config store.

### Recording: SQL `referral_attach(p_invitee, p_inviter, p_source, p_window_hours) → boolean`

The function records nothing, and returns false, if any of these is true:

- the invitee is the inviter;
- the invitee's `auth.users.created_at` is older than the window;
- either user is in `bot_identities`;
- the invitee already has a referral (the unique key; use `on conflict do nothing`);
- the reverse referral already exists (inviter was referred by this invitee).

Otherwise it inserts the row and returns true. The first referral recorded wins.

Callers, only when `enabled`:

- **`opFriendLookup`:** after a successful lookup (target found and not blocked), call
  attach(caller, target, 'code'). Make the call **synchronously**, and add
  `referral: { attached: true, inviteeCoins, gamesRequired }` to the response when it returns true.
  The Add Friend screen uses that to tell the new player about their reward. The lookup's existing
  fields and errors stay the same.
- **`opJoin`:** after a successful join of a friend room, call attach(joiner, host_user_id,
  'room'). It never runs for quick match, or when the joiner is the host. Running it after the
  response is fine.

### Payout: SQL `referral_settle(p_invitee, p_cfg jsonb) → jsonb`

1. Lock the invitee's `pending` row (`for update`). If there isn't one, return `{ paid: false }`.
2. Check `player_stats.games_played ≥ gamesRequired`.
3. Check that today's date in Asia/Kathmandu is later than the invitee's sign-up date in
   Asia/Kathmandu, and that at least `minHoursSinceSignup` (default 8) hours have passed since
   sign-up. If any check fails, return `{ paid: false }`.
4. `wallet_apply` creates missing wallet rows itself, so nothing extra is needed here.
5. Pay the invitee: `wallet_apply(invitee, inviteeCoins, 'referral-invitee', null, 'earned',
   'referral:<id>:invitee')`.
6. Look at the inviter's rewarded referrals in the last 7 days and in total. If either cap is
   reached, set `inviter_capped` and pay nothing more. Otherwise pay the inviter
   `wallet_apply(inviter, inviterCoins, 'referral-inviter', null, 'earned',
   'referral:<id>:inviter')` and set `rewarded`.
7. Set `qualified_at = now()`. Return `{ paid: true, inviterPaid, inviterUserId, referralId }`.

Callers, only when `enabled`, after the response so they never slow a game:

- **`finish.ts`:** after `settle_finished_game` succeeds, call settle for each human seat.
- **The router's activity hook** (`index.ts`, next to the `touch_activity` call that `touchGate`
  allows at most once per user every 30 minutes per isolate): call settle for the caller. This
  covers a player who finished 2 games on day one and only opens the app on day two. They are
  paid on their first request of day two.
- When a payout happens, push to both (English, like the other pushes): "You earned 200 coins:
  {name} played 2 games." and "You earned 100 coins for joining {name}."

Concurrency: the row lock plus the ledger's unique `ext_id` make a double call safe.

### Read: new op `referrals`

Rate-limited. It returns:

```text
{ config: { enabled, inviterCoins, inviteeCoins, gamesRequired },
  invited: [ { id, name, avatarId, gamesPlayed /* capped at gamesRequired */,
               state: 'playing' | 'nextDay' | 'rewarded' | 'capped', rewardedAt } ],
  invitedBy: { id, name, state, rewardedAt } | null }
```

- `playing` means fewer than the required games. `nextDay` means enough games but still the
  sign-up day.
- Names come from `profiles`. An invitee with no profile shows a localised "New player".
- Bots can't appear, because they can't be recorded in the first place.

### App

- **`api.getReferrals()`** calls the op.
- **Invite card** at the top of `FriendsScreen`, above "Add a friend", in the screen's existing
  surface style. It is hidden when the config is disabled or the call fails.

  ```text
  Invite friends: you get 200, they get 100
  When a friend adds your code and plays 2 games
  [ Share my code K7PXQ2 ]
  Asha      1 of 2 games
  Ravi      back tomorrow to finish
  Mina      ✓ 200 coins
  ```

  With nobody invited yet, the list is replaced by one line explaining the rule.
- **Share text:** when the programme is on, the Share button sends a variant of the friend-code
  message (new key `invite.friendMessageReward`): code, landing link, and "once you've played 2
  games, we both get coins". Add Friend's own Share button uses the same variant.
- **Add Friend:** when a lookup response includes `referral.attached`, show one line under the
  found player: "Add {name} and play 2 games: you'll get 100 coins."
- **Reward pop-up on Home:**
  - Fetch referrals on Home mount, at most once every 5 minutes, and also whenever Friends loads.
  - Compare rewarded ids against a persisted "already announced" set on the device.
  - Show a sheet: "+200 coins: Ravi played 2 games" or "+100 coins for joining Asha". Then refresh
    the wallet.
  - It is the lowest-priority sheet: show it only when no other Home sheet is open (bonus
    calendar, save prompt, notification prompt).
- **Strings:** every new string in all 7 locales. The i18n tests enforce coverage.

## Rollout

1. Migration 0082 plus its SQL tests. Bishal applies it.
2. `game` function changes, with `enabled` false. Bishal deploys after the migration.
3. App changes go in the next over-the-air update to the 1.3.1 runtime (check the fingerprints).
4. Set `enabled: true` when that update is published. Older app versions get paid silently.

## Measurement

- Referrals by status, per week.
- Referred vs organic D1 and D7 return. Use `auth.refresh_tokens` per-day activity until the daily
  active-days table exists.
- Inviters hitting caps. This feeds Ludo Manager's abuse watch.

## Testing

- **SQL (PGlite, `scripts/tests/referrals.test.mjs`):**
  - attach: inside and outside the window, self, bot on either side, duplicate, reverse loop.
  - settle: too few games, same day, qualifies, idempotent re-run, weekly and lifetime caps (the
    invitee is still paid while the inviter is marked capped).
  - The ledger rows and `ext_id`s.
- **Deno:**
  - Lookup and join call attach only on success and only when enabled.
  - The lookup response adds `referral` only when attached.
  - The `referrals` op returns the right shape and states.
  - The finish and activity hooks call settle.
- **App (vitest):**
  - The pure mapping from op rows to card lines.
  - The announced-set logic: announce once, then never again.
  - The share variant in every locale.

## Risks

- **Farming with extra guest accounts:** reinstalling on Android creates a new guest. The second-day
  rule, the caps and a reward worth about one avatar keep the payoff small. Ludo Manager watches for
  farms. Device checks are a possible version 2.
- **A real friend who adds the code after 24 hours** isn't counted. That's accepted.
- **Game counting:** `games_played` counts a game for a player still listed in it at the end. A
  player who left mid-game may still count. That's accepted.

## Left to the builder

- The card's exact layout within the app's surface style, and the pop-up component.
- The throttle value, if 5 minutes proves wrong.
- Where the server and client config defaults are merged. Follow how `economy.stakeTiers` reaches
  both sides today.
- Copy wording, as long as it keeps the meaning above.
