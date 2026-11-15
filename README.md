# Ludo

Real-time multiplayer Ludo game. **The game engine is the source of truth;
everything else is a projection of state.**

Monorepo (npm workspaces):

| Package | What it is | Status |
| --- | --- | --- |
| `packages/engine` | Pure, deterministic TypeScript rules engine. No UI, no I/O. | Implemented and tested |
| `packages/bot` | Bot move selection and simulation. | Implemented and tested |
| `apps/mobile` | Expo + React Native + Skia client: local and online play, accounts, cosmetics and purchases. | Native release checks required |
| `supabase/` | Postgres, realtime and Edge Functions for authoritative online play and economy. | Implemented; migration and deployment required |

## Prerequisites

- Node 22.13+ on the 22.x line (`.nvmrc` selects 22), or Node 24.3+
- For the mobile app: **Xcode** (iOS) or **Android Studio** (Android). The app uses
  `@shopify/react-native-skia`, a native module, so it needs a **development build**
  — Expo Go will not work.

## Install

```bash
npm ci
npm run build:packages   # the app consumes the shared packages' built output
```

## Test (no device needed)

```bash
npm run build:edge    # generate the shared modules consumed by server tests
npm test              # engine, bot, mobile, Deno server and PostgreSQL tests
npm run test:db       # focused PostgreSQL transaction regressions (no Docker)
npm run test:engine   # engine only
npm run typecheck     # type-check every workspace
npm run typecheck:edge # type-check the Deno edge functions (downloads deno on first run)
```

The store tests drive game flows through the same UI intents as the app. The
PostgreSQL tests run real wallet, statistics and settlement functions in PGlite.
They do not replace full Supabase migration/RLS checks or concurrent-client and
native purchase tests. CI runs the builds, both type checks and all test suites.

See [the remediation plan](docs/remediation-plan.md) for priorities, acceptance
criteria, current limitations and the required server/client rollout order.

## Run the app (device / simulator)

First time — build & install the dev client (this also starts Metro):

```bash
npm run ios       # → cd apps/mobile && expo run:ios   (needs Xcode)
# or
npm run android   # needs Android Studio + an emulator/device
```

After the dev build is installed, day-to-day:

```bash
npm run mobile    # expo start — open the installed dev build
```

Then: pick 2–4 players → **Start game** → tap **Roll** → tap a highlighted token.
Pass-and-play on one device.

## Server setup

Two one-off steps per Supabase environment. Without them the cron heartbeat
silently no-ops, and an online game every player walks away from freezes
forever — bots stop mid-match and staked pots are never paid out.

```sh
supabase secrets set TICK_SECRET=$(openssl rand -hex 32)
```

Then, with the same value:

```sql
insert into internal_config (key, value) values
  ('tick_url',    'https://<project-ref>.supabase.co/functions/v1/game'),
  ('tick_secret', '<the same value>')
on conflict (key) do update set value = excluded.value;
```

Both sides fail closed: a missing secret means "no tick", never an open
endpoint. See [supabase/migrations/0034_game_tick.sql](supabase/migrations/0034_game_tick.sql).

### Dice secret

Online dice are derived rather than drawn, from a keyed hash of the roll's own
coordinates — game, seat, and `state_version`. That is what lets the server tell
a player their number *before* they tap it, so the tumble never waits on the
network (`prepareRoll`, [supabase/functions/game/turn.ts](supabase/functions/game/turn.ts)).

```sh
supabase secrets set DICE_SECRET=$(openssl rand -hex 32)
```

Unlike the tick secret this one fails *open*, deliberately: without it rolls
fall back to `crypto.getRandomValues` and clients to the old tumble-until-the-
answer-arrives path, so games still play — they just feel slower on a poor
connection. Nothing in the repo stands in for it, because the derivation is a
published function of public inputs and the key is the only thing making a roll
unguessable. Watch for `[dice] DICE_SECRET is unset` in the function logs.

Rotating it is safe between rolls and only ever costs a re-tumble: a roll whose
number was fetched under the old key lands, disagrees with the server, and rolls
again to show the real one.

## Architecture

```
UI intent → store → pure engine transition → new GameState → UI re-renders
```

The engine ([packages/engine/src](packages/engine/src)) exposes `createGame`,
`rollDice`, `getValidMoves`, `validateMove`, `applyMove`, `endTurn`, `checkWin`.
Rendering coordinates live only in [apps/mobile/src/render/boardLayout.ts](apps/mobile/src/render/boardLayout.ts);
the engine never knows about pixels. Visual language: [apps/mobile/DESIGN.md](apps/mobile/DESIGN.md).

For the live user base, follow [the production rollout gates](docs/live-rollout.md) before applying pending migrations or releasing the SDK upgrade.
