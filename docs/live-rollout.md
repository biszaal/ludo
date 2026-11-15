# Live rollout gates — 2026-11-15

The owner now reports over 1,000 users. The earlier assumption of an empty
production project is obsolete. No production migration, function deployment,
OTA publication or store submission was performed during this validation pass.
A read-only migration-history check on 2026-11-15 found production through 0073;
local 0074–0079 remain unapplied. Recheck immediately before a release.

## Release blockers

1. The proposed game function requires a matchmaking request ID. Installed
   clients without it receive “Update the app to start quick match safely.”
   Migration 0077 also isolates atomic rooms from legacy queues. This is a
   coordinated client/server cutover, not a compatible server patch. Do not
   deploy it while assuming existing clients keep working. Validate an explicit
   supported-client policy, store availability and adoption before cutover;
   otherwise implement and test a safe legacy protocol first. Generating a new
   server request key for each retry is not an idempotency solution.
2. Migration 0075 enables online Blitz before the later economy changes in a
   bulk push. Its own prerequisites require a mode-aware function already
   deployed and smoke-tested. Build a rehearsed migration/flag sequence in a
   disposable Supabase environment; do not run a blind production db push.
3. Native SDK 58 changes require new store binaries. The fingerprint runtime
   policy must remain intact. Never publish this bundle to SDK 56 clients by
   overriding runtime compatibility. Payments, account switching, reconnect,
   notifications, links and accessibility still need signed-device checks.
4. Fulfillment migration 0078 must precede its webhook; analytics migration
   0079 must precede the client consent setting. Replay real-shaped webhook
   fixtures in a test environment; do not send synthetic charges to production.

## Prepare evidence before rollout

- Record the exact release commit, native runtime, client/server versions and
  current production migration/config state. The current working tree contains
  multiple release concerns; review and stage them as separate release units.
- Rehearse the full migration chain and role permissions in disposable
  Supabase, including old/new client overlap and independent-session money races.
  Existing local SQL fixture tests do not replace this rehearsal.
- Record a recoverable backup and verify the recovery procedure. Review ledger
  reconciliation read-only first; never bulk-reset balances or completion flags.
- Establish baseline rates for successful matchmaking, cancellations, settlement
  failures, purchase delivery latency, webhook failures and crashes. Use existing
  operational data; product analytics remains strictly opt-in.
- Prepare the website invite changes independently. Preserve unrelated edits in
  the website repository. Check both /.well-known files return 200 JSON without
  redirects on the exact www host before signed-device link verification.

## Release and observe

Use internal testing first, then a small store rollout with a named operator
and an observation window covering match completion and delayed webhooks. Halt
expansion for new money-invariant violations, unexplained missing purchases,
crash regression or a material drop in successful matches. Set numerical
thresholds from the measured baseline rather than inventing them here.

Keep active matches and pending receipts recoverable during any entry-point
pause. Rehearse worker draining and resumption; an app-config switch alone does
not prove that old workers have stopped. Never restore the known non-atomic
money paths as a rollback. Prefer disabling affected new entry points and a
forward fix while preserving ledgers, receipt IDs and in-flight game state.

## Local evidence in this pass

The website passed all 71 tests and a production build. Android association
configuration uses the supplied Play signing fingerprint. iOS configuration
uses Team ID HG4G2ZMGV8, and native prebuild generated the associated-domain
entitlement. Both association files are included in the website build output.
These checks establish local preparation only; hosting, signing entitlements
and end-to-end device routing still need validation.


## Current validation limits

Workspace types pass. A fresh Expo Doctor check passed 18/20 checks: React
Native Directory returned an unexpected server response, and Expo now recommends
13 newer module versions than the bundle validated on 2026-11-07. The earlier
20/20 result remains historical evidence only. Review the newer patches as a
separate dependency change; do not update modules underneath a native build in
progress or treat the older compatibility result as current release sign-off.

Local native validation disables Sentry artifact upload for that invocation
because this machine has no upload token. Production source-map upload and
crash symbolication remain release gates. The iOS simulator build points at a
non-production placeholder backend and disables RevenueCat keys/Sentry DSN so
launch validation cannot create accounts or purchases in the live project.


Android compilation exposed an actual SDK-upgrade incompatibility in
react-native-google-mobile-ads 16.0.0: the Kotlin fullscreen module accesses
`currentActivity` through the removed module property. The upstream 16.5.0
source accesses it through `reactApplicationContext` instead. The local package is now pinned to 16.5.0; workspace types and 55 targeted ad
checks pass, and Android compilation passed the failing Kotlin source. The
package also updates the native Google Ads iOS dependency from 12.11.0 to
13.5.0. Native build and signed-device consent/display validation remain
required before this SDK bundle can be considered releasable. See the [upstream 16.5.0 source](https://github.com/invertase/react-native-google-mobile-ads/blob/v16.5.0/android/src/main/java/io/invertase/googlemobileads/ReactNativeGoogleMobileAdsFullScreenAdModule.kt).


## Native evidence — 2026-11-15

The iOS arm64 Release simulator build succeeded with the 16.5.0 ad library and
Google Ads iOS 13.5.0. The embedded bundle was checked for the placeholder
Supabase URL and absence of the production project URL before launch. On an
iPhone SE (3rd generation), iOS 27 simulator, the app reached the name-entry
screen and the OS tracking-permission dialog. The earlier scene-lifecycle
startup failure did not recur. The app was then terminated. This verifies
startup only: it does not verify gameplay, permissions choices, payments,
Universal Link routing or screen-reader traversal. The permission dialog
interrupting name entry is also a remaining onboarding UX review item.

Local evidence: `/tmp/ludo-ios-ads165.log` (BUILD SUCCEEDED),
`/tmp/ludo-sdk58-launch-settled.png` (first-launch screen). Temporary evidence
must be attached to a reviewed release record before it is relied on later.


Android arm64 Release assembly also succeeded (`BUILD SUCCESSFUL`, 1,090
Gradle tasks; `/tmp/ludo-android-ads165.log`). The local APK is generated at
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. It was not
installed, submitted or published, and is not evidence of Play signing or
verified-domain routing. Sentry upload was disabled for this local invocation.
R8 emitted warnings for the transitive Amazon Appstore SDK; signed-device
purchase/recovery checks remain necessary for the minified release build.

Current completed checks: both native builds; isolated iOS startup; all 71
website tests and production website build; workspace types; 55 targeted ad
tests; association-file/build/entitlement consistency; whitespace checks. Full
Supabase migration replay, mixed-client cutover rehearsal, signed-device
payment/link/accessibility testing and newer Expo patch review remain open.


## Publishing preparation — 2026-11-15

The invite website changes were isolated from unrelated local privacy edits,
passed all 71 tests and a production build, and were pushed in website PR #6:
https://github.com/biszaal/biszaaltech-wesbite/pull/6 . Live HTTP inspection
identified Netlify as the active host, so public/_headers was added to serve
both association files as JSON. Netlify's repository integration is building
the preview. This website release is independent of pending app/server changes.

The app/server fixes are being published as a draft source review, without
applying migrations, deploying functions, publishing an OTA or submitting store
binaries. Request-ID compatibility remains a blocker for the game cutover.
