# Dependency review — 2026-11-07

The latest local npm audit reports seven affected package entries, all moderate,
with zero high or critical findings. These include parent packages and are not
seven unique advisories. The previous SDK 56 audit had 15 entries including
three high findings.

## Changes

- Upgraded Expo to SDK 58, React Native to 0.88.1, React to 19.3.0, and aligned
  native modules and React types with Expo's compatibility recommendations.
- Migrated Skia drawing construction to mutable PathBuilder instances, detaching
  immutable paths before rendering. Dice animation worklets still reuse paths.
- Regenerated ignored native projects to include the iOS scene lifecycle.
- Removed obsolete manual Metro workspace overrides following the
  [Expo monorepo migration guide](https://docs.expo.dev/guides/monorepos/).
- Added expo-system-ui so Android honors the configured interface style.
- All three workspaces use Vitest 4.1.12. npm 11 resolved the dependency tree
  after npm 10's internal installer error; a normal npm ci then succeeded.

## Open advisories and exposure

The two vulnerable leaf packages below account for all seven entries. Expo CLI,
Expo fingerprinting, and Sentry bundler plugins are the affected consumers.
The inspected paths are build/development tooling; this does not prove that all
production paths are unaffected. No forced downgrade or cross-major override
was applied just to suppress the audit.

### glob (moderate)

Expo configuration, fingerprinting, Metro configuration and updates tooling traverse local files.

Mobile/build owner: upgrade supported Expo tooling; use bounded CI jobs and trusted project trees. These mitigations reduce exposure; they do not fix the dependency.

[Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)

### minimatch (moderate)

Expo fingerprinting and glob pattern matching in build tooling.

Mobile/build owner: upgrade supported Expo tooling; avoid untrusted patterns and use bounded CI jobs. These mitigations reduce exposure; they do not fix the dependency.

[minimatch has potential denial of service via globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249)

## Verification completed — 2026-11-07

- Full test run: 1,475 passed (engine 114, bot 41, mobile 1,006, Edge 275,
  PostgreSQL 39), including payment fulfillment and analytics consent tests.
- Workspace and Edge TypeScript checks passed on Node 22.23.4.
- Expo install compatibility check passed; Expo Doctor passed all 20 checks.
- Production Hermes bundles exported successfully for both iOS and Android.
- Native prebuild succeeded and generated SceneDelegate plus the scene manifest.

Native compilation and simulator launch remain pending validation. The first
SDK 58 iOS dependency install failed downloading Sentry's GitHub release asset
with a network timeout. Android compilation is being checked separately.
No SDK 58 build, OTA bundle or database migration has been published.


## Follow-up — 2026-11-15

A fresh audit after pinning react-native-google-mobile-ads to 16.5.0 reports
six moderate affected entries and zero high/critical entries. Workspace types
and 55 focused ad tests pass. This package update fixes the Kotlin activity
access encountered during SDK 58 compilation and requires Google Ads iOS
13.5.0 plus User Messaging Platform 3.1.0. Native build/device validation remains
open; see [live rollout gates](live-rollout.md). The earlier 20/20 Expo Doctor
result is historical: today's check found 13 newer recommended module versions
and a React Native Directory metadata-service error (18/20 checks passed).


Both native Release builds subsequently passed with ad-library 16.5.0 (Android
arm64 APK, iOS arm64 simulator). The isolated iOS build launched to name entry
on an iPhone SE simulator. This does not replace signed-device payment, consent,
link or accessibility checks; no native artifact was published.
