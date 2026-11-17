# Reliability and product improvement plan

Started: 2026-11-03. Baseline: 1,387 tests passing, workspace and Edge type checks passing.

This plan follows the repository audit. Completion means the stated acceptance
checks pass; implementation alone is not release approval. No plan can guarantee
zero defects, so each stage includes failure tests, deployment order and recovery.

## Operating rules

- Preserve the shared deterministic engine and server authority.
- Fix currency and payment correctness before expanding features or refactoring
  the multiplayer protocol.
- Implement financial state transitions as database transactions. A retry must
  repeat the same outcome, and an aborted transaction must leave no partial debit,
  credit or completion marker.
- Never recover an unavailable payment/consent service by bypassing its checks.
- Keep production deploys, historical balance repair and external store changes
  separate from local implementation. Prepare exact changes and evidence first.
- Record verified results and remaining limitations in this document.

## Stage 1 — Economy, payment identity and consent

Status: core fixes implemented locally; release gates remain open. Dependencies: none.
Owner: repository implementation; deployment owner must sign off staging evidence.

### E1: Atomic room start

Replace per-seat HTTP debits and compensating refunds with a service-only SQL
operation that validates the waiting game/version and expected roster, collects
all human stakes, and activates the game in one transaction. Serialize competing
starts and reject stale rosters. Never fall back to the vulnerable sequence if
the migration is missing.

Acceptance:
- Repeated starts with one broke player change no balances or ledger rows.
- A subsequent successful start charges every human exactly once.
- A failed game write rolls back all charges.
- Duplicate or stale requests do not charge again.
- Bot seats are not charged; untrusted callers cannot execute the RPC.
- New seats cannot be inserted into an already active table.

### E2: Atomic settlement

Read authoritative finished state inside a service-only transaction. Credit all
eligible places and record statistics before marking the relevant work complete.
Retain existing per-place payout keys so retries can reconcile previous partial
credits. A settlement error must remain retryable and observable.

Acceptance:
- A failure on any recipient rolls back newly issued credits and completion.
- Retrying after failure pays once; a duplicate successful call changes nothing.
- Bots and unplaced players receive no payout.
- Statistics are written once per completed match, including free matches.
- Recovery includes finished games missing either payout or statistics.
- A rematch cannot overwrite an unsettled result; its counters start fresh.

### P1: Purchase identity gate

Track SDK configuration separately from confirmed RevenueCat identity. Before a
purchase, ensure the SDK belongs to the current application user. A failed login,
account switch or stale asynchronous completion must close the purchase gate.
Treat pending delivery separately from cancellation or payment failure.

Acceptance:
- Configuring the SDK alone never authorizes a store purchase.
- Failed identity attachment causes zero purchase calls.
- A successful retry restores purchasing for the correct user.
- An older login completion cannot reopen purchasing for a superseded user.
- Delayed fulfillment has explicit pending/recovery messaging before release.

### C1: Consent recovery

After consent collection fails, use the SDK's stored `canRequestAds` verdict;
unknown remains false. Add privacy-options access when required by the SDK.

Acceptance:
- No consent and an SDK error result in no ad request.
- Previously valid permission can recover through the SDK's cached verdict.
- Initialization never implies permission to request ads.
- Privacy choices can be revisited when required.

### E3: Atomic quick-match entry and cancellation

Status: implemented locally in migration 0077 and matching client/server code;
staging concurrency and native release gates remain open.

- One transaction creates/claims the room, inserts the seat with its app version,
  charges the wallet, records its earned/purchased funding and stores a request
  key. Retrying a cancelled search returns a closed-search result, not a new debit.
- User and pool locks serialize simultaneous searches. The deal locks the game,
  validates its version/roster and refuses any human seat without a funded entry.
- Cancellation holds the same game lock as the deal. It refunds funded entries
  and deletes seats together, restoring purchased funds to their original bucket.
  If the deal wins, cancellation returns the active match without a refund or
  automatic forfeiture. The client waits for this answer before returning home.
- Retention uses the same refund entries. Free rematches cannot refund the old
  paid match. Old queue rows and new atomic rows are kept in separate pools.
- Room-code joins cannot bypass paid entry. Bot-fill and cancellation responses
  verify membership before disclosing an active match.

Acceptance: joining, creating and leaving the queue preserve the ledger under
interruption, concurrent fill, retries and retention cleanup. Each charge/refund
has a durable key tied to a funded seat, and no unfunded seat starts. Local tests
cover failure rollback and ordered race outcomes; **true simultaneous database
sessions still require staging verification**.

Compatibility: updated clients send `requestId`. Clients without it receive
“Update the app to start quick match safely.” Release the compatible client and
drain legacy queues/workers during cutover; do not deploy this server silently
against an unsupported installed-client population. The request/entry records
are durable financial/replay evidence and are not purged with game retention.
Plan explicit archival capacity before sustained high traffic.

## Stage 2 — Release verification and dependency maintenance

Status: CI, focused PostgreSQL tests, README, Vitest 4 migration and compatible
dependency patches implemented locally. Audit now has no critical findings;
15 affected package entries remain. See [dependency review](dependency-review.md)
for exposure, mitigations and ownership. Full staging/native verification remains open.

- Add CI for package builds, all unit tests, both type checks and database
  transaction tests. Use clean checkouts so committed build output cannot mask
  stale source. Keep deployment credentials out of pull-request jobs.
- Exercise migrations against a disposable database. Distinguish focused SQL
  transaction tests from full Supabase migrations, RLS and concurrency tests.
- Audit dependencies, update compatible patches, verify native compatibility and
  document any remaining advisory with its reachable code path and mitigation.
- Add a release checklist for secrets, webhook authentication, cron health,
  migration order, native smoke tests, crash reporting and rollback.
- Update README setup, current features and verification commands.

Acceptance: a clean build is reproducible; critical integration failures block
release; any unexecuted native or infrastructure check is named explicitly.

## Stage 3 — Trust and complete player journeys

Status: bot disclosure and assisted-dice explanation implemented locally;
durable purchase reconciliation and remaining journeys are still queued.
Product decision confirmed by the user on
2026-11-03: label bots and explain the existing assisted-dice rule.

- Label computer opponents consistently in quick match, profiles and chat.
- Preserve assisted dice and explain the exact rule before joining and in How
  to play. Label computer opponents consistently; remove contradictory human
  claims and hidden-bot presentation. Keep server, UI, tests and store claims
  consistent. The new quick-match setup and How to Play copy covers all seven
  locales. Bots use labelled identities and no simulated player chat; migration
  0077 also labels existing bot seats and mutes their chat. Historical bot profile
  cleanup and native/translation review remain separate follow-up work.
- Add durable purchase-delivery tracking, reconciliation and refund/transfer
  handling. Use transaction identity, not a balance increase, to identify delivery.
- Verify cold-start return to an active match and account switching during
  outstanding network requests.
- Coordinate first-session prompts; keep the path into the first game short.

Acceptance: a player can understand their opponent and rules, recover a paid
purchase, and distinguish an outage from a completed action.

## Stage 4 — Accessibility, localization and maintainability

Status: shared button semantics, 44-point button/close controls and improved
secondary-text contrast implemented locally. Board actions, modal focus,
localization and native accessibility validation remain queued.

- Expose individual token actions and game-state announcements to screen readers.
- Standardize button roles, disabled states, modal focus and 44-point controls.
- Measure contrast on rendered backgrounds; add semantic text/error colors.
- Move remaining user-facing literals into all seven catalogs. Separate Unicode
  display names from stable searchable handles; migrate validation coherently.
- Test text scaling and keyboard behavior on a small phone and tablet, plus Urdu
  text direction and longer translations.
- Split online state handling by connection, reconciliation, turns, chat and
  rematches with behavior-preserving tests. Extract rendering layers only where
  responsibilities are clear; avoid a broad rewrite.

Acceptance: complete gameplay and purchase journeys are operable with assistive
technology; supported languages have no English-only critical steps; module
extraction preserves current protocol behavior.

## Stage 5 — Measurement and market readiness

Status: queued. Requires product analytics destination and store/domain access.

- Define consent-aware events for first game start/completion, matchmaking exit,
  reconnect, invite share/join, payment delivery and rewarded-ad fulfillment.
- Establish baseline activation, D1/D7 retention, match completion, delivery
  failure rates and cost per completed match before choosing improvement targets.
- Refresh screenshots and store metadata against the shipping build; generate
  catalog counts from source rather than maintaining them by hand.
- Provide HTTPS invites with installed-app routing and an install fallback.
- Validate a focused positioning hypothesis with players; record experiment,
  audience, success measure and stopping rule before increasing acquisition spend.

Acceptance: product priorities can be connected to measured player outcomes;
public claims and screenshots match the released app.

## Deployment and recovery for Stage 1

1. Run local regression tests, SQL rollback/idempotency tests and type checks.
2. Run the same scenarios in staging with real Supabase roles, two concurrent
   clients, forced request interruption and payment sandbox identities.
3. Inspect existing waiting staked rooms and finished-game ledgers. The previous
   bug can leave ambiguous history; never bulk-reset payout flags or auto-adjust
   player balances without reconciling the original ledger.
4. Drain/pause staked room starts and legacy quick queues during the server cutover. Additive SQL does not
   make an old deployed function stop using its old debit/refund sequence.
5. Coordinate release of the request-key-capable native client. Apply migrations
   0076 and 0077 in order, then deploy the game function, then verify a
   low-stake staged room and settlement before reopening new staked rooms.
6. Ship the client identity/consent fixes after native sandbox smoke tests.
7. Monitor failed settlements, ledger deltas, payment delivery and ad readiness.
   If a new regression appears, disable the affected entry point and forward-fix;
   do not roll back to the known unsafe debit/refund implementation.

## Evidence log

- Audit baseline: 114 engine + 41 bot + 964 mobile + 268 Edge tests passed.
- Audit reproductions: failed room-start retries added 100 coins per retry after
  the first refund; failed settlement retained `payout_done=true` and suppressed
  the next credit attempt.
- Implementation and verification results will be recorded below as completed.

### Implemented in this patch

- Migration `0076_atomic_game_economy.sql`: transactional staked friend-room
  start, transactional payouts/statistics, service-role-only RPCs, late-seat
  rejection, cron recovery predicate and retention of unsettled results.
- Server handlers use the transactions with no old debit/refund fallback;
  rematches settle the old result first and reset stats/dry-turn counters.
- Purchase identity checks query the current app user and native SDK identity;
  logins, purchases and restores share a serialized queue.
- Pending gem delivery has distinct localized messaging and a shop refresh path.
  Delivery still uses the existing balance comparison; durable receipt-based
  reconciliation remains a Stage 3 requirement.
- Consent failure consults cached SDK permission, otherwise pauses requests.
  Settings exposes required privacy choices; editing them invalidates a loaded
  interstitial and updates ad readiness. New copy covers all seven catalogs;
  native layout and translation review remain required.
- CI verifies builds, both type checks and all suites. PGlite tests use actual
  wallet/statistics migrations and the new migration; only the platform schema
  and HTTP dispatch are fixtures. This is not a full Supabase migration test.
- `shell-quote` updated from 1.10.0 to 1.12.0 within existing dependency ranges.
  npm audit now reports 29 affected packages (2 critical, 9 high, 16 moderate,
  2 low), down from 30. Remaining critical entries are Vitest/Tinypool tooling;
  upgrade them together and rerun the suite. No public test/dev server should
  be exposed while the older tooling remains. Native/dev-tool dependencies
  need reachability and compatibility review rather than a forced bulk update.

### Required checks before release

- Full Supabase migration replay, RLS/role tests and two-connection races for
  deal vs deal, deal vs join/leave, settlement vs settlement, and rematch vs
  settlement. PGlite is single-connection and does not prove these races.
- Native sandbox purchases: failed login, account switch during checkout,
  cancellation, restore, delayed webhook and restart while delivery is pending.
- Native ads: fresh consent offline, cached consent offline, required privacy
  choices, revocation, and reopening Settings on iOS/Android.
- Reconcile historical payout flags against actual ledger entries. The patch
  intentionally does not guess which previously flagged matches were underpaid.
- Apply migration before deploying the updated game function, using the cutover
  steps above. Confirm cron HTTP responses and oldest unsettled result age.
- See [release checklist](release-checklist.md) for the execution record.

### Final local verification — 2026-11-04

On Node **22.23.4**, the combined command completed successfully:

```sh
npm run typecheck:edge
npm run typecheck
npm test
```

- Engine: **114 passed**.
- Bot: **41 passed**.
- Mobile: **980 passed** across 99 files.
- Edge: **267 passed**. Seven obsolete debit/refund mock tests were replaced by
  database transaction coverage; new server checks cover RPC routing and rematch
  settlement failure. Test-count changes do not mean coverage was simply dropped.
- PostgreSQL: **13 passed**, including rollback after state/ledger/stats failures,
  replay, rounding, bots, role grants, retention and the cron wake-up predicate.
- Total: **1,415 passed**.
- Both workspace and Edge type checks passed; shared generated builds had no diff.
- `git diff --check` passed.

The initial supported-Node wrapper failed because nested `npx` inherited its
parent's execution flags. Running the installed Node binary directly resolved
that tooling issue; the final combined run above exited 0.

No production migration, deployment, historical balance adjustment or native
release was performed. The CI workflow is checked in as a working-tree change;
it has not yet run on GitHub. Native UI behavior, translation quality, full
Supabase migrations and multi-connection races remain unverified locally.

### Second repair milestone — 2026-11-04

Implemented atomic quick-match entry/cancellation/deal, durable request replay,
purchased-fund refunds and matching retention behavior. New client searches send
one request key across every automatic retry. Search cancellation waits for the
server, displays a failed cancellation, and keeps a match that already started.
Fill retries are bounded by the existing delayed timer and stop after cancellation;
late fill responses cannot reopen a departed room.

Implemented the approved disclosure policy: quick matches use visible, mute
computer identities, existing bot seats are backfilled to labelled, chat sender
labels identify bots, and setup/rules explain the unchanged six-rescue rule.
The store-listing draft includes the same explanation and removes stale cosmetic
counts. This updates repository copy only; no external listing was published.

Added failure/race regressions for funding, refunds, cancellation replay, stale
rosters, unfunded seats, pool separation, bot registration, free-rematch retention,
request-key reuse, lost cancellation races and late responses. Verification
results for the final combined run are recorded below when it completes.

### Second milestone verification — 2026-11-04

Verified on Node **22.23.4**:

- Engine: **114 passed**; bot: **41 passed**.
- Mobile: **987 passed** across 99 files.
- Edge: **275 passed**; PostgreSQL: **27 passed**.
- Final verified total: **1,444 passed**.
- Both workspace and Edge type checks passed.
- Generated shared builds match committed output; `git diff --check` passed.

The combined run passed with 985 mobile tests. A final review made the search
screen's cancellation intent explicit even if realtime had already activated the
match, and made an empty cancellation response fail visibly. Workspace type
checks and the entire mobile suite were rerun after that change: all 987 passed.
The engine, bot, server and database code were unchanged after their passing run.

No production deployment or external store-listing publication was performed.
The outstanding full Supabase migration/concurrency and native-device checks
remain release gates, as does coordinating the client request-key requirement.


### Dependency and shared-control follow-up — 2026-11-04

- Vitest upgraded to 4.1.12 in all three workspaces; compatible npm patches and
  Expo-recommended module patches applied. Remaining findings are tracked in
  [dependency-review.md](dependency-review.md).
- Both shared Button variants expose their label, button role and disabled state.
  Buttons and sheet close controls have at least a 44-point target; sheet titles
  can wrap alongside the close button and expose heading semantics.
- Muted Steel changed from #9BA3AF to #A7AFBB: calculated contrast against the
  base blue table improves from 4.08:1 to 4.69:1 (raised slate 7.39:1, lifted slate
  6.60:1). This does not certify every tinted, translucent or rendered surface.
- Native screen-reader focus, stacked modals, board token actions, large text,
  small-phone/tablet layout and Urdu direction are still unverified. The design
  pre-ship checklist remains open for these checks; no accessibility compliance
  claim is made.


### Third milestone verification — 2026-11-05

- Full combined suite: **1,444 passed** (114 engine, 41 bot, 987 mobile,
  275 Edge, 27 PostgreSQL).
- Workspace and Edge type checks passed on Node **22.23.4**.
- Expo dependency compatibility check passed after module patch alignment.
- iOS and Android production Hermes bundle exports passed locally.
- Generated shared builds match committed output; `git diff --check` passed.
- No release, OTA publication or production migration was performed. Native
  compilation/device testing, full Supabase concurrency/RLS checks and remaining
  dependency upgrades remain open; see [dependency review](dependency-review.md).


### Overlay isolation and dismissal — 2026-11-05

- Kept background screens mounted to preserve form/game state, while disabling
  their touch input and accessibility traversal whenever a sheet or confirmation
  is open. Invite banners now sit inside that background boundary.
- Only the top sheet accepts input or accessibility traversal; confirmations
  suppress all sheets. Host wrappers preserve each sheet's stable identity.
- Android Back resolves confirmation, then top sheet, then existing game/page
  navigation. Close requests invoke the owner's current callback and remain
  consumed if closure is deferred; the host never tears down owner state itself.
- Added VoiceOver Escape handling and confirmation title/button semantics.
  Dismissing an informational notice acknowledges it; destructive confirmation
  dismissal remains cancellation.
- Regression coverage exercises stacked dismissal, callback refresh, deferred
  closure, empty stacks and confirmation priority.
- Initial accessibility focus, focus restoration, first-launch overlays and
  native traversal/animation behavior remain device-validation work. See the
  expanded [release checklist](release-checklist.md). Implementation follows
  [React Native accessibility properties](https://reactnative.dev/docs/accessibility).

Verification: all **993 mobile tests** passed across 100 files; workspace type
checks and fresh iOS/Android production bundle exports passed. `git diff --check`
passed. Server/database code was unchanged in this milestone; those suites were
not rerun. No native-device accessibility certification or deployment occurred.


## SDK 58 verification — 2026-11-07

The SDK upgrade now passes workspace and Edge type checks, all 1,475 automated
tests, all 20 Expo Doctor checks, and production Hermes exports for both mobile
platforms. Skia paths now use the immutable-path API through builders; the
obsolete manual Metro monorepo overrides were removed. Native regeneration
includes the iOS scene lifecycle required by the installed simulator SDK.

The dependency audit is down to seven moderate affected-package entries, with
zero high or critical findings; see [dependency review](dependency-review.md).
Native compilation and on-device accessibility/payment checks are not yet
signed off. These local results do not constitute a production deployment or a
completed release checklist.


## Live-service update — 2026-11-15

The owner reports over 1,000 users. All earlier empty-production assumptions
are withdrawn. The new [live rollout gates](live-rollout.md) identify the
request-ID requirement as a breaking change for older matchmaking clients,
require a rehearsed feature-flag/migration sequence, and separate native/store
validation from server cutover. A read-only check still found production at
0073; no pending migrations or functions were deployed in this pass.

Both Android and Apple invite association files are now prepared locally using
owner-provided public signing identifiers. The website passed 71 tests and a
production build; the native iOS entitlement matches the AASA identity/domain.
Live hosting and signed-device routing remain unverified.


The SDK 58 native checks now pass for an Android arm64 Release APK and an iOS
arm64 Release simulator build after upgrading the ad library to 16.5.0. The
isolated iOS build reached onboarding, resolving the earlier startup failure.
Workspace types, 55 focused ad tests, and 71 website tests pass. No artifacts,
migrations or functions were published. See the live rollout gates for the
remaining compatibility, staging and signed-device requirements.
