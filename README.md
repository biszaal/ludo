# Ludo

Real-time multiplayer Ludo game. **The game engine is the source of truth;
everything else is a projection of state.**

Monorepo (npm workspaces):

| Package | What it is | Status |
| --- | --- | --- |
| `packages/engine` | Pure, deterministic TypeScript rules engine. No UI, no I/O. | ✅ done, 56 tests |
| `apps/mobile` | Expo + React Native + Skia client (local hot-seat). | ✅ playable, on-device verification pending |
| `supabase/` | Postgres + realtime + Edge Functions (online play). | ⏳ planned |

## Prerequisites

- Node 20+ (`.nvmrc` pins 22)
- For the mobile app: **Xcode** (iOS) or **Android Studio** (Android). The app uses
  `@shopify/react-native-skia`, a native module, so it needs a **development build**
  — Expo Go will not work.

## Install

```bash
npm install
npm run build:engine   # the app consumes the engine's built output
```

## Test (no device needed)

```bash
npm test              # engine (56) + client store flow (7), all in Node
npm run test:engine   # engine only
npm run typecheck     # type-check every workspace
npm run typecheck:edge # type-check the Deno edge functions (downloads deno on first run)
```

The store tests drive a full hot-seat game through the exact UI intents
(`roll` / `selectToken` / `pass`) with a seeded dice source.

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

## Architecture

```
UI intent → store → pure engine transition → new GameState → UI re-renders
```

The engine ([packages/engine/src](packages/engine/src)) exposes `createGame`,
`rollDice`, `getValidMoves`, `validateMove`, `applyMove`, `endTurn`, `checkWin`.
Rendering coordinates live only in [apps/mobile/src/render/boardLayout.ts](apps/mobile/src/render/boardLayout.ts);
the engine never knows about pixels. Visual language: [apps/mobile/DESIGN.md](apps/mobile/DESIGN.md).
