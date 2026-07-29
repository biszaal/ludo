-- Remote config. Ad frequency, economy amounts and shop flags live here rather
-- than in the binary, so they can be tuned per-region after launch without a
-- store release — eCPM varies ~10x between markets and we don't know ours yet.
--
-- One row per key: 'default' plus optional ISO-3166 country codes. The edge
-- function deep-merges the country row over 'default', and the client merges
-- that over its own baked-in defaults, so a partial row is always safe.
--
-- Read-only to clients. Everything here is presentation and pacing; coin
-- AMOUNTS are re-decided server-side on every grant, so a client that lies
-- about config can still never mint coins.

create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;
drop policy if exists "config: read" on public.app_config;
create policy "config: read"
  on public.app_config for select to authenticated using (true);
-- no insert/update/delete policies: dashboard / service role only

-- Seed. Ad pacing starts deliberately conservative: nothing shows until a
-- player has finished a few matches, and never after a staked loss (worst
-- possible moment to interrupt). Loosen from the dashboard once eCPM is known.
--
-- Fairness invariant: rewarded placements grant ACCESS (entry, coins) and
-- PAYOUT only. `hintLocalOnly` is not a toggle for online hints — hints are
-- hard-gated off in PvP in client code; this only controls the vs-AI affordance.
insert into public.app_config (key, value) values (
  'default',
  '{
    "ads": {
      "enabled": true,
      "banner": { "home": true, "lobby": true },
      "interstitial": {
        "enabled": true,
        "minSecondsBetween": 180,
        "minSessionsBeforeFirst": 2,
        "minMatchesBeforeFirst": 3,
        "maxPerSession": 3,
        "suppressAfterStakedLoss": true
      },
      "rewarded": {
        "freeEntry": true,
        "coinGrant": true,
        "doublePot": true,
        "hintLocalOnly": true
      }
    },
    "economy": {
      "quickStake": 100,
      "startingBalance": 500,
      "dailyBonusBase": 50,
      "streakStep": 25,
      "streakMaxDay": 7
    },
    "shop": { "enabled": true, "coinPacksEnabled": false }
  }'::jsonb
) on conflict (key) do nothing;
