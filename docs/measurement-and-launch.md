# Measurement and launch preparation

Owner decision, 2026-11-06: use Supabase for optional product analytics.
The public destination is https://www.biszaaltech.com/games/ludo, with the
existing iOS and Android listings linked from that page.

## Event contract

Collection defaults off. Settings enables it only after the server records
consent. The server checks consent on every write and serializes withdrawal
with collection. Opt-out deletes that account's event history; a failed
withdrawal displays a retry action. Account switching disables local collection.
No offline event backlog is retained. Event failure cannot block gameplay.

Stored fields: Supabase account ID, constrained event name, deduplication key,
and server timestamp. No chat content, display names, email, advertising ID,
location or arbitrary attributes are sent. Data is account-linked, not anonymous.
Rows expire after 90 days and are deleted with account deletion.

Events: session_started, match_started, match_completed, matchmaking_cancelled,
reconnect, invite_shared, invite_joined, purchase_delivered,
rewarded_ad_delivered. Match start/completion keys currently count each room
once per account: rematches sharing the room are not separate analytical matches.
The session event is best effort; unauthenticated startup or settings hydration
can omit it. These limitations must be accounted for before using retention or
completion figures for spending decisions.

Use scripts/operations/product-metrics.sql for cohort and event counts. Run it
in UTC. Report opted-in sample size and cohort maturity alongside D1/D7; never
present this selected population as whole-product retention. Financial delivery
monitoring must use the authoritative receipt/ledger, not optional analytics.

## Launch experiment

Hypothesis: friends who receive a clear room invitation can install/open Ludo
and reach their friend's table with less help than code-only sharing.
Audience: a small recruited group of friend pairs, with consent to observation.
Measure: successful joins / invitations attempted, time to table, failure reason,
and first-game completion. Run a usability round before acquisition spending.
Stop and repair if links misroute, joins debit incorrectly, or participants
cannot recover an expired room. Do not invent targets or baseline results.

Before publishing, review screenshots from the shipping native build, reconcile
store catalog counts with source, and update privacy/store disclosures for these
optional account-linked analytics. The website repository has an invite view
prepared locally; it has not been published by this task.

## HTTPS routing

Shared links use /games/ludo?room=ABCD. The landing page preserves the room code,
disables its automatic store redirect for invitations, provides an explicit
Open room button using ludobiszaal://join/ABCD, and keeps both store links.
No deferred deep-link service is used: after installation, players enter the
visible code manually. Native URL parsing allows only the owned HTTPS host and
supported app schemes, with exactly one valid four-character room code.

Automatic verified app opening additionally requires Apple team/application
association and the Google Play app-signing certificate fingerprints. Those
identifiers must be verified from signing configuration before deploying the
website's .well-known association files; debug fingerprints are not substitutes.


## Android association prepared — 2026-11-08

The app now declares an auto-verified HTTPS intent for the exact path
`https://www.biszaaltech.com/games/ludo`. The website repository contains
`public/.well-known/assetlinks.json` for `com.biszaal.mobile` with the Play
app-signing SHA-256 fingerprint provided by the owner, plus an explicit Vercel
route and JSON content type. This is prepared locally, not yet published or
verified on a Play-signed installation. No debug certificate was substituted.

Apple setup was prepared on 2026-11-15 using owner-provided Team ID
`HG4G2ZMGV8`. The app declares `applinks:www.biszaaltech.com`; the website's
AASA file associates `HG4G2ZMGV8.com.biszaal.mobile` with `/games/ludo` and a
four-character room query value. Other marketing URLs stay on the website.
The manual website-to-app scheme link remains the fallback until both files
are published and platform verification passes on signed installations.
