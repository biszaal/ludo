# Ludo project handover — 2026-11-15

This note records the reliability, product, validation and publishing work completed in this conversation. It distinguishes implementation from deployment. Older planning documents contain chronological status entries; use this note and the dated follow-ups in `docs/live-rollout.md` when reading those earlier entries.

## 1. Current status

| Area | Status |
| --- | --- |
| Ludo invitation website | Published and verified on the production domain |
| Apple and Android association files | Published; exact live URLs verified for JSON content, identities and absence of redirects |
| App/server implementation | Committed and pushed in a draft pull request |
| Automated CI for the published app/server commit | Passed, including PostgreSQL concurrency checks |
| Native compilation | Android arm64 Release APK and iOS arm64 Release simulator build passed |
| iOS startup | Reached name entry and the tracking-permission dialog on an iPhone SE simulator using an isolated backend configuration |
| Production database changes | Not applied by this work; last read-only migration check found production through 0073 |
| Production game/payment functions | Not deployed by this work |
| Mobile store release / OTA | No new store binary or OTA update published |
| End-to-end signed-device validation | Still required |

The owner initially reported no users, then reported over 1,000 users. The later instruction governs release decisions: preserve existing accounts, purchases, balances, matches and installed clients. There has been no historical balance rewrite, bulk reset or production test charge as part of this work.

## 2. What was changed and why

### A. Game funding, settlement and rematches

**Problem:** Charging seats or paying winners through separate operations can leave a partially completed financial action when a request fails. Marking a result complete before all credits/statistics succeed can prevent recovery.

**Implemented:** Service-only database transactions for staked-room activation and finished-game settlement. The transactions validate game state and participants, apply money movements and completion flags together, preserve retry keys and roll back incomplete work. Rematches must settle the preceding result before replacing it. Recovery/retention logic preserves unsettled work. Bots do not fund or receive human payouts.

**Saved in:**

- `supabase/migrations/0076_atomic_game_economy.sql`
- `supabase/functions/game/deal.ts`, `finish.ts`, `tick.ts`, `turn.ts`, `room.ts`
- `supabase/functions/game/economy.test.ts`
- `scripts/tests/economy.test.mjs`

**Status:** Implemented and tested in the draft source release; production cutover remains pending.

### B. Quick-match charging, retries and cancellation

**Problem:** A lost response, a repeated search or cancellation racing game start can otherwise create another charge, refund the wrong funding bucket or forfeit a match that just started.

**Implemented:** Atomic room/seat/funding creation with durable request records, account/pool/game locking, request-ID replay protection, and cancellation/refund transactions. Earned and purchased funds are restored to their corresponding buckets. The client retains the same request ID across retries and waits for the server's cancellation outcome. An already-started match is returned to the client instead of automatically forfeited by a waiting-room cancellation. Room-code joins cannot bypass funded quick-match entry. Membership checks protect game-state responses.

**Saved in:**

- `supabase/migrations/0077_atomic_quick_match.sql`
- `supabase/functions/game/quick.ts`, `room.ts`, `index.ts`
- `apps/mobile/src/net/api.ts`
- `apps/mobile/src/store/onlineStore.ts`
- `apps/mobile/src/components/QuickMatchSearch.tsx`
- `supabase/functions/game/quickAtomic.test.ts`
- `apps/mobile/__tests__/quickMatch.test.ts`

**Release blocker:** The proposed server requires a request ID; older installed apps do not send one and would receive an update message. This cannot be silently deployed across the current user base. A supported-client strategy and a rehearsed cutover are still needed.

### C. Purchase identity, fulfillment and recovery

**Problem:** The payment SDK could be configured without being attached to the correct app account. A balance increase does not prove a purchase arrived: unrelated rewards can increase the balance, and spending can hide a legitimate purchase credit. Older receipt status rows alone also do not prove that credit succeeded.

**Implemented:**

- Purchase authorization requires confirmed RevenueCat identity matching the current app user; stale identity completions cannot authorize another account.
- Atomic server fulfillment commits the grant and verified receipt together, checks transaction ownership/product conflicts and handles duplicate delivery idempotently.
- The client journals transaction ID, product and owning account; checks that exact verified receipt; and retries pending receipts on wallet/shop refresh.
- Wallet/account-generation guards prevent old asynchronous results from replacing the new account's state.
- Refund, transfer and related review events are durably recorded and deduplicated before acknowledgment.

**Saved in:**

- `supabase/migrations/0078_purchase_fulfillment.sql`
- `supabase/functions/rc-webhook/index.ts`
- `apps/mobile/src/lib/purchases.ts`, `purchaseJournal.ts`, `auth.ts`
- `apps/mobile/src/store/walletStore.ts`
- `apps/mobile/src/net/api.ts`
- `apps/mobile/__tests__/purchaseIdentity.test.ts`, `purchaseDelivery.test.ts`, `purchaseJournal.test.ts`
- `scripts/tests/purchases.test.mjs`
- `docs/purchase-recovery.md`

**Limits:** Automatic refund clawback and entitlement transfer are not implemented. A crash/storage failure between checkout and journaling can require support lookup. Store transaction-ID behavior must be checked on both signed platforms. No synthetic purchases were sent to production.

### D. Ad consent and privacy controls

**Problem:** A consent-service failure must not become permission to request ads, and players need access to privacy choices where the SDK requires it.

**Implemented:** Consult the SDK's cached `canRequestAds` verdict when consent collection fails; unknown stays false. Added privacy-options access and associated state/error handling.

**Saved in:**

- `apps/mobile/src/lib/ads/consent.ts`, `provider.ts`
- `apps/mobile/src/screens/SettingsScreen.tsx`
- `apps/mobile/__tests__/adsConsent.test.ts`, `adsPrivacy.test.ts`

**Limits:** Consent and ad presentation still require signed-device testing. The simulator showed the tracking-permission dialog over name entry, which remains an onboarding UX review item.

### E. Honest bot presentation and dice rules

**Decision:** Preserve assisted dice, label computer opponents, and explain the existing rule rather than changing gameplay silently.

**Implemented:** BOT labels/disclosure, labelled computer identities, bot muting/no simulated player chat, and matching rule copy in quick-match setup and How to Play. The copy explains that humans and bots use the same assistance: approximately 44% chance of a six after six qualifying stuck turns, 72% after seven, and 100% after eight or more; a six or a legal-move roll resets the count. Purchases do not change these odds.

**Saved in:**

- `supabase/functions/game/bots.ts` and migration `0077`
- `apps/mobile/src/components/QuickSetupSheet.tsx`
- `apps/mobile/src/screens/HowToPlayScreen.tsx`, `OnlineGameScreen.tsx`
- `apps/mobile/src/i18n/locales/`
- `docs/store-listing.md`

**Limits:** Historical bot-profile cleanup, translation review and native presentation checks are not certified complete.

### F. Accessibility, overlays and localization

**Problem:** Small controls, hidden canvas interactions and overlapping sheets can make the app difficult or impossible to use with a screen reader. ASCII-only name filtering excludes supported writing systems.

**Implemented:**

- Accessible labels, roles, disabled states and minimum 44-point targets for key controls.
- Better muted-text contrast.
- Only the active top overlay remains accessible/interactable; confirmation priority and Back/Escape behavior were improved.
- A screen-reader board mode exposes individual pawn controls with position/move labels instead of relying solely on coordinate taps.
- Dice labels, status announcements and localized game-clock labels.
- Unicode display-name normalization/filtering and code-point counting consistent with the intended server length limit.
- New copy across English, Nepali, Hindi, Bengali, Urdu, Spanish and Brazilian Portuguese.

**Saved in:**

- `apps/mobile/src/components/Button.tsx`, `Sheet.tsx`, `SheetHost.tsx`, `ConfirmDialog.tsx`, `OverlayBackground.tsx`, `ScreenStack.tsx`
- `apps/mobile/src/components/Board.tsx`, `Dice.tsx`, `GameView.tsx`, `GameControls.tsx`, `ChooseNameScreen.tsx`
- `apps/mobile/src/lib/useScreenReader.ts`, `dismissTopOverlay.ts`, `displayName.ts`
- `apps/mobile/src/store/sheetHost.ts`, `profileStore.ts`
- `apps/mobile/src/theme.ts` and `src/i18n/locales/`

**Limits:** Real VoiceOver/TalkBack traversal, initial focus/return focus, Urdu/RTL and large-text review remain open. This is not a completed accessibility certification. Display names were improved; a separate username/handle model was not introduced.

### G. Optional Supabase analytics and launch planning

**Decision:** Use the existing Supabase project with explicit player opt-in.

**Implemented:** Default-off consent setting, server consent enforcement, constrained event names, idempotent event keys, deletion of history on opt-out, 90-day retention configuration and account-switch protection. No persistent offline event backlog is kept, and event failures do not block gameplay. Events cover sessions, match starts/completions/cancellations, reconnects, invitation activity and confirmed purchase/ad delivery.

**Why:** Provide evidence for retention, invitation usability and completion decisions while keeping collection optional. These are account-linked events, not anonymous analytics.

**Saved in:**

- `supabase/migrations/0079_opt_in_analytics.sql`
- `apps/mobile/src/lib/analytics.ts`
- `apps/mobile/src/store/settingsStore.ts`, `src/screens/SettingsScreen.tsx`, `src/net/api.ts`, `App.tsx`
- `apps/mobile/__tests__/analytics.test.ts`, `scripts/tests/analytics.test.mjs`
- `scripts/operations/product-metrics.sql`
- `docs/measurement-and-launch.md`

**Limits:** Collection is not deployed. Session events can be omitted during unauthenticated startup/settings hydration; room-based match keys do not count rematches separately. Opted-in cohorts must not be presented as whole-product retention. No paid campaign, fabricated baseline, completed marketing experiment or store-disclosure submission is claimed.

### H. Invitations and the published website

**Problem:** Code-only invitations required extra explanation, and an automatic store redirect could interrupt a player who already had a room invitation.

**Implemented:** Share URLs such as `https://www.biszaaltech.com/games/ludo?room=ABCD`; strict app-side URL/code parsing; preservation of the room code on the website; suppression of automatic store redirection for valid invites; explicit Open room and store options; and manual-code fallback after installation.

**App files:** `apps/mobile/src/lib/invite.ts`, `inviteLinks.ts`, `apps/mobile/app.json`, locale files and `apps/mobile/__tests__/inviteLinks.test.ts`.

**Website repository:** `/Users/bishalaryal/Documents/Github/biszaal-tech-website`.

**Website files:**

- `src/pages/LudoLanding.tsx`
- `src/pages/LudoLanding.test.tsx`
- `public/.well-known/apple-app-site-association`
- `public/.well-known/assetlinks.json`
- `public/_headers` — JSON content types for the actual Netlify host
- `vercel.json` — equivalent prepared routing/header configuration for Vercel

The app configuration uses bundle/package ID `com.biszaal.mobile`, owner-provided Apple Team ID `HG4G2ZMGV8`, and the owner-provided Google Play app-signing SHA-256 fingerprint. Debug fingerprints were not substituted.

**Published:** Website PR [#6](https://github.com/biszaal/biszaaltech-wesbite/pull/6), merged commit `902c19175cff23806cfbc802fb8615428e529c30`. The Netlify preview passed before merge. Production checks verified both exact association URLs return HTTP 200, `application/json`, expected identities and no redirects; the live invite page's JavaScript includes the room-opening implementation.

**Live URLs:**

- https://www.biszaaltech.com/games/ludo
- https://www.biszaaltech.com/.well-known/apple-app-site-association
- https://www.biszaaltech.com/.well-known/assetlinks.json

**Limits:** Publishing the association files does not add link support to already-installed binaries. Automatic HTTPS opening still needs a matching signed native release and device verification. No deferred deep-link provider was added; after a fresh installation, manual room-code entry remains the fallback.

Unrelated website edits to `src/App.tsx` and the privacy-policy files were preserved and excluded from the isolated release.

### I. SDK upgrade and native build repairs

**Problem:** The old native build failed to launch on the installed iOS simulator SDK because the scene lifecycle was required. Dependency and drawing-API compatibility also needed attention.

**Implemented:** Expo SDK 56 → 58, React Native 0.88.1 and React 19.3.0, aligned native dependencies/types, Skia 2.14 immutable paths built through `PathBuilder`, regenerated native projects with the iOS scene lifecycle, simplified Metro to supported automatic workspace resolution, and added `expo-system-ui`.

Android compilation exposed incompatible activity access in ad-library 16.0.0. Upgrading to 16.5.0 fixed it; iOS dependencies moved to Google Ads 13.5.0 and User Messaging Platform 3.1.0. Existing SDK fingerprint runtime compatibility was retained.

**Saved in:** Root/mobile `package.json`, `package-lock.json`, `apps/mobile/eas.json`, `metro.config.js`, `AGENTS.md`, and Skia-rendering components including `Board.tsx`, `Dice.tsx`, `DieCube.tsx`, `HowToPlayDiagrams.tsx`, `PlayerChip.tsx`, `TableBackground.tsx`.

**Validation:** Both Release builds passed. The iOS simulator bundle was checked for a placeholder backend and absence of the production project URL before launch, reached onboarding, and was then terminated. Local source-map uploads were disabled only for those build invocations because upload credentials were unavailable.

**Limits:** SDK 58 requires new native binaries. It must not be forced onto SDK 56 clients through an incompatible OTA. Current signed-device/store testing and production crash-symbolication validation remain required. The last audit reported six moderate findings and no high/critical findings; a later Expo Doctor check was 18/20 because newer module recommendations had appeared and the package-metadata service returned an error.

### J. Organization, testing and CI

**Implemented:** Extracted game controls and focused helpers for analytics, purchase journaling, consent, invite parsing and display names. Added transactional SQL tests, reusable economy schema fixtures, real PostgreSQL concurrency checks, a GitHub verification workflow, setup documentation and release/recovery plans.

**Why:** Keep critical behavior reviewable, prove money invariants under failure/retry, and prevent successful local builds from being mistaken for production readiness. This was targeted extraction, not a complete rearchitecture of large state stores/components.

**Saved in:**

- `.github/workflows/verify.yml`
- `scripts/test-postgres-concurrency.mjs`
- `scripts/tests/` and `scripts/tests/helpers/economySchema.mjs`
- `apps/mobile/src/components/GameControls.tsx` and the focused helpers above
- `README.md`, `docs/remediation-plan.md`, `docs/release-checklist.md`, `docs/live-rollout.md`

The hosted CI initially exposed two bot timing issues. The 300-game Blitz simulation now has an explicit 60-second timeout, CPU-budget tests use process CPU usage, and bot files run serially to avoid competing benchmarks. The win-rate and CPU thresholds were not relaxed.

## 3. Verification evidence

| Check | Recorded result / scope |
| --- | --- |
| Prior full automated suite | 1,475 tests: engine 114, bot 41, mobile 1,006, Edge 275, PostgreSQL 39 |
| Real PostgreSQL concurrency | 30 scenarios using independent sessions in an isolated temporary cluster |
| Focused ad tests after dependency update | 55 passed |
| Bot tests after CI timing repair | All 41 passed locally |
| Isolated website release | All 71 tests and production build passed |
| Android | arm64 Release APK compiled successfully; no device gameplay/payment check claimed |
| iOS | arm64 Release simulator build passed and onboarding rendered on iPhone SE, iOS 27 |
| Published app/server CI | Green at commit `73137dbaf2c377fd632c4edb0ab864958893bb37` |
| Website deployment | Preview checks passed; production page and both association files verified |

Green CI: https://github.com/biszaal/ludo/actions/runs/43705602841 . The workflow includes clean dependency installation, package builds, Edge/workspace type checks, the full test command, isolated PostgreSQL concurrency tests and generated-output consistency. It does not certify full Supabase migration replay or signed native journeys.

## 4. Where the work is saved

### Main app/server repository

- Local root: `/Users/bishalaryal/Documents/Github/ludo`
- GitHub: https://github.com/biszaal/ludo
- Release branch: `release/reliability-fixes-20261115`
- Draft PR: https://github.com/biszaal/ludo/pull/2
- Implementation commit: `7dcef3e`
- CI/test repair commit: `73137db`
- The draft includes the pre-existing local Blitz/Frenzy feature commits in addition to this reliability work. It is not merged into production/master.

### Website

- Local root: `/Users/bishalaryal/Documents/Github/biszaal-tech-website`
- GitHub: https://github.com/biszaal/biszaaltech-wesbite
- Merged release: https://github.com/biszaal/biszaaltech-wesbite/pull/6
- Production commit: `902c19175cff23806cfbc802fb8615428e529c30`
- Isolated release checkout used for deployment: `/tmp/ludo-invite-release-20261115`

The original website checkout still contains its preserved local edits and can be behind the merged remote commit. Use the PR/commit to identify exactly what went live.

### Documentation map

| Document | Purpose |
| --- | --- |
| `docs/project-handover-2026-11-15.md` | This consolidated note |
| `docs/remediation-plan.md` | Audit-driven stages, acceptance criteria and chronological progress |
| `docs/live-rollout.md` | Live-user compatibility risks, rollout gates and deployment evidence |
| `docs/release-checklist.md` | Per-release staging, native and cutover checks |
| `docs/purchase-recovery.md` | Receipt recovery, review queue, operator procedure and limitations |
| `docs/measurement-and-launch.md` | Consent/event contract, cohort caveats and invitation experiment |
| `docs/dependency-review.md` | Dependency changes, audit exposure and validation history |
| `docs/store-listing.md` | Updated product/disclosure copy |

This handover note is newly saved locally. It is not part of the already-published PR head unless separately committed/pushed.

### Temporary build evidence

- Android APK: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- iOS simulator app: `/tmp/ludo-sdk58-native/Build/Products/Release-iphonesimulator/Ludo.app`
- iOS build log: `/tmp/ludo-ios-ads165.log`
- Android build log: `/tmp/ludo-android-ads165.log`
- iOS onboarding screenshot: `/tmp/ludo-sdk58-launch-settled.png`
- Publishing record: `/tmp/ludo-published-20261115.json`

Generated native/build directories and `/tmp` evidence are not durable source-control records and may disappear. Source commits, merged PRs and hosted CI are the durable references. The APK is a local validation artifact, not a published Play release.

## 5. What remains before the mobile/server production release

1. Resolve the older-client matchmaking compatibility policy or implement/test a safe transition protocol.
2. Rehearse the full pending migration sequence in disposable Supabase. In particular, 0075 enables online Blitz and must not activate it before the mode-aware server is ready; avoid a blind bulk push of 0074–0079.
3. Verify backups/recovery, ledger reconciliation, active-game handling and worker draining against the live-user rollout plan.
4. Test signed iOS/Android payment identity, checkout, delayed delivery, restore/recovery, account switching, consent, notifications, reconnect and links.
5. Complete VoiceOver/TalkBack, focus, large-text, small-phone/tablet and Urdu/RTL review; address onboarding prompt timing.
6. Review the newer Expo patch recommendations and remaining moderate dependency findings; verify source-map upload and crash symbolication in the release environment.
7. Review privacy/store disclosures before enabling optional analytics; account for measurement gaps before using retention figures for spending decisions.
8. Define refund/transfer support policy and operations; automatic clawback is still outside the implemented workflow.
9. Release through internal testing and a monitored staged store rollout after the gates pass.

## 6. Scope boundary for newer local edits

At handover inspection, additional uncommitted edits existed in `supabase/functions/game/economy.ts`, `rematchVote.test.ts`, `room.ts`, `social.ts`, plus a new `accountHygiene.test.ts`. They were not part of the published PR head `73137db` or its green CI evidence. They were left untouched while preparing this note. Assess them separately before treating the current working tree as the verified release commit.
