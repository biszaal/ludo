# Broadcasting the state delta

**Status:** design, approved for planning
**Date:** 2026-08-25
**Follows:** `2026-08-23-turn-write-fold-design.md` (shipped), which removed the
roll *write*. This removes the state *fan-out*.

## Problem

Every authoritative write to `games` pushes a full state document to every
subscribed seat, and clients learn about opponents' moves no other way.

Measured on production before the fold shipped:

| Quantity | Measured (pre-fold) |
|---|---|
| `state_version` bumps per match | 436 |
| Split of those | ~50% roll, ~40% move, ~10% pass |
| Seats per match | 3.35 |
| `state` document size | 2,237 bytes avg, 3,209 max |
| Realtime egress per match | ~3.2 MB |

The fold already removed the roll writes (~50%) and the pass folds (~10%), so
the live baseline is roughly 40–50% of the table above. **Re-measuring is step
one of the plan** — this design should be justified against the current number,
not against a stale one. What does not change with the fold is the shape of the
cost: the top query on the database by total time is Realtime's WAL
authorization scan, re-checked against RLS *once per subscriber* per UPDATE,
and Supabase documents that path as single-threaded and largely immune to
compute upgrades.

The remaining writes are moves. A move is a state transition, and the document
it produces is ~2.2 KB. The transition itself is about 80 bytes.

## The fact this design rests on

Client and server produce **byte-identical** states from the same transition.

This is not an aspiration; it is already load-bearing in production. The
client's optimistic reconciliation confirms a prediction by
`JSON.stringify` equality against the server's own state (`statesEqual`,
`onlineStore.ts`), and the entire fold protocol depends on it. It is guarded
today by two tests: `must not be given a clock` (the engine stamps
`lastAction.timestamp` 0, and a client passing a real clock would produce a
state right in every way but one) and `the edge function runs the very same
engine build`.

**Therefore an opponent's move needs no document.** Given the current state and
the action, every client can compute the next state itself — the same argument
the fold made for the die, applied to the position.

What the fold could not do, this can: the die had to be *delivered* because
clients do not hold the HMAC key. A move has no such secret. The acting player
already sends it, and the server already validates it.

## Design

### The server broadcasts the transition

After a successful write at `v+1`, `turn.ts` broadcasts on the room topic:

```
event "turn": {
  from: v, v: v+1,            // the versions this transition spans
  die, playerId,              // what was rolled, and by which seat
  tokenId: string | null,     // null means the turn was passed
  deadline, sum
}
```

`tokenId: null` rather than a separate `pass` flag: one shape means one replay
branch on the client and one encoder on the server, and a payload that cannot
express "a move AND a pass" by accident.

- `from` makes contiguity explicit rather than inferred, so a gap is detected
  without reasoning about what `v` *should* have been.
- `deadline` is required because `GameSnapshot` carries `turn_deadline` and the
  row feed that used to supply it is going away.
- `sum` is a short hash of the resulting state (see **Divergence**).

This uses `broadcastToRoom` unchanged — it is already generalised over the
event, and 0037 leaves clients with SELECT and no INSERT on
`realtime.messages`, so the service role is the only possible sender. That is
the same property that made chat and the folded die trustworthy.

Every server-side write path must broadcast: `opTurn`, the bot driver
(`bots.ts`), and the stall path (`advanceStalledGame`, which has three
drivers). A write that does not broadcast is a table that goes quiet.

### Transitions that are not turns

Deals, leaves, rematches, settlements and seat changes are not turn actions and
have no compact form worth inventing. They broadcast:

```
event "sync": { v }
```

meaning "refetch". Roughly 20 bytes, rare, and it lands on the resync path that
already exists.

### The client replays it

A new `receiveTurn` sits beside `receiveRoll` in `onlineStore.ts`, which is its
template — the guards are the same shape.

1. `payload.from !== lastAppliedV` → a gap or a reorder. `scheduleResync`;
   apply nothing.
2. Replay with the shared engine from the current state: `rollDice` with the
   carried die, then `applyMove` or `endTurn`.
3. Hash the result and compare with `sum`. Mismatch → `scheduleResync`; apply
   nothing.
4. Match → `enqueueGameRow({ state, status, state_version: v, stake, turn_deadline })`.

**Step 4 is the load-bearing decision of this design.** The delta path
terminates in the *existing* row queue, so everything downstream is untouched:
the animation pacing that stops two moves collapsing into one impossible hop,
`statesEqual` reconciliation, `pending` confirmation, the `rollBumped` one-shot,
the turn clocks. A delta becomes a cheaper way to obtain the same row, not a
second way to drive the board. This is what keeps the change out of the most
delicately-tuned code in the store.

`stake` is stable for the life of a match and is already held client-side.

### How this sits with the fold

On a table that is both folding and delta-enabled, a turn now produces two
broadcasts and no document: the `roll` event when the die is rolled, then the
`turn` event when the mover commits. That is the same two-beat sequence the
fold already established — die first, position second — with the second beat
shrinking from 2.2 KB to 80 bytes.

The client needs no new sequencing for it. `rollBumped` is the existing
one-shot that stops the following state push animating a die a second time, and
it spends itself against the row the delta produces exactly as it does against
the row the write produced.

### The client stops subscribing to `games`

On a delta-enabled table, `subscribeGame` does not register the `games`
postgres_changes listener. This is where the saving actually is: without it,
deltas are a latency improvement that reduces nothing.

The `players` listener stays. It is a different, much smaller feed and it
carries lobby and presence.

### Divergence

`sum` is a short hash over the serialised state, computed identically on both
sides. Its purpose is not to catch network corruption — it is to catch **engine
drift between a shipped client and the deployed edge function**.

That risk already exists and is already silent: today a drift turns every
optimistic prediction into a mismatch, which a player sees as the die
re-rolling itself after it has landed. Under deltas the consequence would be
worse (a board that quietly disagrees with the server), so the invariant the
system already depends on becomes one it can also *check*. Ten bytes on an
80-byte message is a fair price for turning "probably correct" into "provably
correct, or resynced".

Hash the **engine-produced** state on both sides, not a jsonb round-trip: key
order differs after Postgres stores it (see `jsonbOrder` in
`onlineFlow.test.ts`), and both sides here compute from the engine.

The algorithm is the plan's choice, but it must be: computed over
`JSON.stringify` of the engine state (the exact input `statesEqual` already
compares, so it inherits a proven invariant rather than introducing a new one);
identical in the mobile bundle and in Deno, with no native or platform
dependency; cheap enough on Hermes to run per delta on a low-end phone; and
truncated to about 8 hex characters. Collision resistance is not a security
property here — the payload is already unforgeable because only the service
role can send on the topic — so this is a drift detector, and 32 bits of it is
ample.

### Confirm-only HTTP responses

The acting player still receives a full document echoed back over HTTP, and
they already predicted it.

The client sends `predictSum` alongside its action. The server compares it with
the hash of the state it just wrote:

- agree → `{ v, ok: true }`, roughly 40 bytes
- disagree, or no `predictSum` sent → the full state, exactly as today

This is `statesEqual` moved to the server's side of the wire. Because any
disagreement returns the full document, a hashing bug degrades to today's
behaviour rather than to a wrong board — the same fail-safe shape as the fold
gate.

## The gate

Deltas change what an observer receives. A client that does not understand them
would see nothing happen at all. Every currently-shipped binary is such a
client, and there is no OTA channel — `expo-updates` is not a dependency.

So it is decided **per game, at deal time**, mirroring `fold_writes`:

```
delta_allowed = every players row for this game either
                  (a) has app_version >= DELTA_MIN_VERSION, or
                  (b) is a bot seat
```

stored as `games.delta_writes`, fail-safe to false.

Three things this must get right:

- **Bot seats come from `game_bots`, never `players.is_bot`.** `is_bot` is the
  *visible* flag; hidden quick-match bots carry `is_bot = false`. Using it would
  treat every hidden bot as an un-upgraded human and disable deltas in quick
  match, which is where most games are played. This is a documented scar from
  the fold round.
- **Version comparison is numeric per component**, never lexical: `"1.10.0" <
  "1.9.0"` as strings would switch deltas off forever after 1.9.
- **Both halves ship in ONE client build.** The fold round's scar: 1.0.2 could
  hear an opponent's folded die but deadlocked on its own, and it was in App
  Store review when that was found.

Deltas carry the die explicitly, so unlike the fold they do not depend on
`DICE_SECRET`. The two gates stay independent.

## Failure modes

| Failure | Detected by | Recovery |
|---|---|---|
| Broadcast dropped | `from !== lastAppliedV` on the next delta | resync |
| Out-of-order delivery | same | resync |
| Engine drift client ↔ edge | `sum` mismatch | resync, and it becomes visible rather than silent |
| Non-turn transition | server sends `sync` | resync |
| Socket drop | existing `onReconnect` | existing resync |
| Server broadcast POST fails | nothing — see risk 1 below | version probe |

## Risks

**1. There is no longer a passive safety net.** Today a dropped realtime message
is covered by the fact that the *next* write also carries the whole state, so a
client repairs itself without noticing. Under deltas, a dropped broadcast is
caught only by the gap check on the *next* delta — which, if it is the last
move of a turn and the next player is thinking, means the board can sit stale
for a while. `broadcastToRoom` already returns a boolean nobody checks, and it
can fail.

Mitigation: a light periodic version probe while a game is active — a cheap
`state_version`-only read, well below the cost of the row feed it replaces —
plus honouring the broadcast's own failure by falling back to a `sync`. The
plan must size this; it is the part of the design most likely to need tuning
against real behaviour.

**2. The subscription decision needs the flag before subscribe time.**
`delta_writes` is fixed at deal time and travels on the game row, but the join,
create and quick-match paths do not uniformly guarantee the row is in hand
before `subscribe()` runs. The plan must pick one of: always subscribe with the
row feed and drop the listener once the flag is known (simple, briefly
double-delivers, and the row queue already dedupes by `v`), or reorder those
paths so the flag is always known first (cleaner, more surface touched). The
first is recommended — double delivery is already a case the client handles.

**3. Resync becomes hotter.** Every divergence, gap and non-turn transition
routes through it. It is already coalesced, single-flight and backed off, but it
was tuned when it was an exception path.

## Out of scope

**The compact wire codec is deliberately dropped.** Trimming the denormalised
`Token.color` and derivable `Token.playerId` (~65% of the document) was worth
considering only because that document travelled 436 times a match. Once
opponents learn moves from an 80-byte broadcast, it travels on join and resync
only — a handful of times per match. Optimising it would be work aimed at a cost
that no longer exists, and it would change the shape stored in jsonb, which is
the riskiest thing in the area.

Response compression is likewise not pursued: the fan-out path, not the HTTP
path, is the dominant cost, and WAL fan-out is not compressible from here.

## Testing

- **Shared fixture for the hash.** One vector list exercised by both the mobile
  suite and the Deno suite, so an accidental divergence in the hashing itself
  fails at build time rather than in a match.
- **Extend `the edge function runs the very same engine build`.** It moves from
  a guard on prediction quality to a guard on board correctness.
- **Client:** gap → resync and no apply; `sum` mismatch → resync and no apply;
  happy path → exactly one row on the queue; `sync` → resync.
- **Server:** every write path emits exactly one `turn` or one `sync`. Assert
  this per path rather than in aggregate — a silent path is the failure this
  design is most exposed to.
- **E2E against production** with two anon users over HTTP, as the fold round
  did, including a deliberately dropped broadcast.

## Rollout

1. Re-measure the post-fold baseline. If it does not justify the work, stop.
2. Migration: `games.delta_writes`.
3. Deploy the server. It broadcasts deltas that no client consumes yet; old
   clients remain on the row feed and are unaffected.
4. Ship the client build carrying `DELTA_MIN_VERSION` — both halves together.
5. Tables enable deltas only once every human seat is new enough.
