# Folding the turn write

**Status:** design, approved for planning
**Date:** 2026-08-23
**Phase:** 2 (Phase 1 shipped in `0049_tick_gate_and_seat_version.sql` + app 1.0.2)

## Problem

A turn costs two authoritative writes to `games`, and each one fans out a full
state document to every seat.

Measured on production (`qosoinftcnkfwoaixkae`, last 30 finished games, and the
24h of `moves` retained at the time):

| Quantity | Measured |
|---|---|
| `state_version` bumps per match | 436 |
| Split of those | ~50% roll, ~40% move, ~10% pass |
| Seats per match | 3.35 |
| `state` document size | 2,237 bytes avg, 3,209 max |
| Realtime messages per match | ~1,460 (436 × 3.35) |
| Realtime egress per match | ~3.2 MB |
| Edge invocations per match | ~190 |

Two consequences:

1. The top query on the database by total time is Realtime's WAL authorization
   scan — 2,255,435 calls, 3.5 hours of CPU, 5.54 ms mean — at 26 weekly active
   users. Every `games` UPDATE is re-checked against RLS once *per subscriber*.
   Supabase's documentation is explicit that this path is single-threaded and
   that "compute upgrades don't have a large effect", so this does not improve
   by paying more.
2. On the free plan the 2M monthly message quota caps the game at roughly 1,370
   matches/month. Pro raises that to 5M, at which point database CPU and egress
   become the limits rather than the quota.

The roll write is the one to attack: it is half of all writes, and it exists
only so other players can see the die.

## The fact this design rests on

The die is not random at write time. `deriveDie` (`lib.ts:240`) is:

```
HMAC(server_secret, "<info>:<gameId>:<state_version>:<playerId>")
```

It is a pure function of the game, the version, and the player. `rollRng`
(`turn.ts:77`) wraps it, and `prepareRoll` already exposes it to the roller
before the roll happens. The stall path already re-derives it at the same
version.

**Therefore the roll needs no database write for correctness.** The move op can
recompute the identical die from the unchanged `state_version` and apply the
roll and the move as one state transition, in one write. The roll write is
purely a delivery mechanism for a number other people need to see — and it is
paying document-sized, WAL-backed, RLS-scanned prices to deliver ~2 bytes.

Clients cannot derive the die themselves: they do not hold the key, which is
the anti-cheat property. That is why the die must still be *delivered*, not
merely recomputed.

## Design

### The roll op stops writing

`opTurn(action: "roll")` currently derives the die, applies `rollDice`, and
writes the resulting state. It will instead:

1. Derive the die, exactly as now.
2. Return it to the roller in the HTTP response, exactly as now.
3. Broadcast `{ die, playerId, v }` to the room topic — a payload of roughly
   60 bytes — instead of writing.
4. Not touch `games` at all.

The broadcast uses the mechanism `chat.ts` already has: a service-role POST to
`/realtime/v1/api/broadcast` on the `game:<id>` topic. 0037 leaves clients with
SELECT and no INSERT on `realtime.messages`, so the service role is the only
possible sender on that topic and the payload cannot be forged by a peer — the
same property that made chat trustworthy.

### The move op folds the roll in

`opTurn(action: "move")` reads the game at version `v`, where `v` is unchanged
because the roll did not write. It then:

1. Re-derives the die for `(gameId, v, playerId)` — the same value the roller
   was shown.
2. Applies `rollDice` with that die, then `applyMove`, producing one state.
3. Writes once, `state_version: v + 1`, under the existing version guard.

`pass` folds identically: derive, `rollDice`, `endTurn`, one write. This
absorbs the ~10% of writes that are passes as well as the ~50% that are rolls.

### What the other seats receive

Per turn, instead of two 2.2 KB state pushes:

- one ~60 byte broadcast carrying the die, at the moment it is rolled
- one 2.2 KB state push carrying the resulting position

The client animates the die from the broadcast the instant it arrives — which
is when it arrives today — and animates the hop when the state push lands. The
felt sequence is unchanged. There is no dead air during a chooser's think time,
which is the property that ruled out the simpler full fold.

### Client rendering

`applyGameRow` (`onlineStore.ts:1440`) already handles a die arriving in the
same write that hands the turn on — that is the `busted` branch, for a busted
third six. The folded push is the same shape, so the die/hop sequencing has an
existing path to extend rather than a new one to invent.

The broadcast handler is new and sits beside `onChat` in `subscribeGame`
(`api.ts:931`).

## The gate

Folding changes what an observer receives. A client that does not know about
the die broadcast will render the pawn moving without a die ever appearing.
Every currently-shipped binary is such a client, and there is no OTA channel to
fix them — `expo-updates` is not a dependency, so a store binary is replaced
only by the user updating.

So the fold is decided **per game, at deal time**, and only when every human
seat can understand it:

```
fold_allowed = every players row for this game either
                 (a) has app_version >= FOLD_MIN_VERSION, or
                 (b) is a bot seat
```

Three things this must get right:

- **Bot seats are identified by `game_bots`, never by `players.is_bot`.**
  `is_bot` is the *visible* flag; quick-match bots are deliberately hidden and
  carry `is_bot = false` (`bots.ts:212`). Using it would treat every hidden bot
  as an un-upgraded human and disable folding in quick match — which is where
  most games are played.
- **NULL means no.** Every seat taken before 1.0.2 records `app_version = null`
  (0049). Unknown must read as "cannot fold"; the safe direction to fail is
  toward the behavior that works everywhere.
- **Compare versions numerically, never as strings.** `app_version` is free text
  written by a client. `"1.10.0" < "1.9.0"` lexically, which would silently
  disable folding for every build after 1.9. Parse to numeric components and
  compare those; treat anything unparseable as NULL.
- **The decision is pinned for the match.** It is computed once when the game is
  dealt and stored on the `games` row, not re-evaluated per turn. A seat filled
  by a reconnecting player, or a player who updates mid-match, must not flip the
  broadcast shape out from under a table mid-game.

That requires one more column: `games.fold_writes boolean not null default
false`, set by `deal.ts` at start.

## Details that are not obvious

**The turn clock.** Today the roll write sets a fresh `turn_deadline`, so a
player gets a full clock to *choose* after rolling. With no roll write, the
whole turn shares the clock that started when the turn was handed over. That
shortens choosing time in a way players would feel. The fold must therefore set
the turn's deadline to cover roll-and-move together when the turn is handed
over, and `TURN_SECONDS` should be re-examined against how long a turn actually
takes end to end rather than assumed to still be right.

**Reconnect is self-healing.** A client that drops between rolling and moving
refetches and sees `awaiting-roll` at version `v` — it does not know it rolled.
It rolls again, and because the die is derived from the unchanged `v`, it gets
*the same die*. No special recovery path is needed. This is a property worth an
explicit test, because it is the kind of thing a later refactor could silently
break.

**Idempotency.** `claimAction` currently claims before the write. With the roll
no longer writing, a replayed roll must remain safe — it re-derives the same
die and re-broadcasts, which is harmless — but `moves` row logging and the
`moves_client_action_idx` unique index (0041) both need to be re-reasoned about
for the roll path specifically. The idempotency ledger must not be weakened.

**Chained rolls.** A six, a capture, or a finish leaves the same player owing
another roll, and `turn.ts:223` returns `nextRoll` for it. Since the chained
roll's die depends on the *new* version, the fold must confirm the chain still
derives correctly across a folded write, and that `nextRoll` is still handed
back.

**Busted third six.** `bustedRollDice` handles a roll that never reaches
`diceValue` because the same write hands off the turn. Under folding this case
gets more common, not less. Existing behavior must be preserved exactly.

**Server-driven turns.** `advanceStalledGame` and the timeout path roll on
behalf of an absent player, and `driveBotTurns` (`bots.ts:514`) writes per bot
action. These all fold the same way and all sit behind the same per-game gate,
since a 1.0.1 spectator watching a bot needs the die just as much.

## Expected effect

Per match, at the same 436-action volume:

Of the 436 actions, ~218 are rolls and ~219 are moves-or-passes. Folding pairs
each roll with the move or pass that follows it, so the write count halves to
roughly one per turn:

| | Today | Folded |
|---|---|---|
| `games` writes | 436 | ~220 |
| Realtime state pushes | ~1,460 | ~730 |
| Broadcast messages | 0 | ~730 (~60 bytes each) |
| Egress | ~3.2 MB | ~1.6 MB |
| `apply_rls` scans | ~436 | ~220 |

Message *count* is roughly unchanged, because a broadcast is still a message.
What drops by more than half is database writes, WAL volume, the RLS scan that
is currently the single most expensive thing the database does, and egress.

## Non-goals

- **Migrating to `broadcast_changes`.** Moving the state push itself off
  `postgres_changes` is the larger architectural win and remains the eventual
  destination, but it is a hard break for every shipped client and can only
  land as a dual-publish once 1.0.1/1.0.2 usage has drained. Separate spec.
- **Reducing the 190 edge invocations per match.** Untouched here.
- **Changing dice fairness, the RNG, or anything a player could perceive as
  affecting outcomes.** The die derivation is unchanged; only its delivery
  changes.

## Testing

- **Engine/edge, TDD:** a folded move produces byte-identical state to today's
  roll-then-move sequence, for the same die. This is the core invariant and
  should be property-tested across many dice and positions, not spot-checked.
- The re-derived die at unchanged `v` equals the die the roller was handed.
- Reconnect mid-turn re-rolls to the same value.
- The gate: all-new humans folds; one NULL seat does not; a hidden bot seat does
  not block; the decision does not change mid-match.
- Chained rolls, busted third six, timeout and bot-driven turns each still
  behave as they do today under folding.
- **Client:** a die broadcast animates the die; a folded state push animates the
  hop; the two arriving out of order does not double-animate or lose either.
- **Compatibility:** a game with the gate off produces exactly today's write
  sequence. This is the test that protects live players.

## Risks

| Risk | Mitigation |
|---|---|
| A dropped broadcast means a spectator misses a die | The state push still lands and is authoritative; the board stays correct. Degrades to Option B's behavior for one turn rather than desyncing. |
| Gate computed wrong → 1.0.1 players lose the die | Gate defaults to `false`; NULL reads as no; compatibility test pins the unfolded path. |
| Folded state diverges from sequential state | Property test on equivalence is the gating test for the whole change. |
| Shortened choosing time | Deadline set to cover the whole turn; re-examine `TURN_SECONDS`. |

## Rollout

1. Migration: `games.fold_writes`.
2. Edge: fold behind the gate, gate off for every existing game.
3. Client 1.1.0: broadcast handler, die/hop sequencing.
4. `FOLD_MIN_VERSION = "1.1.0"`, enabling folding only for tables where every
   human seat is on it.
5. Watch `apply_rls` total time and realtime egress; both should fall with the
   share of all-updated tables.
