# Release checklist

Use a separate completed copy per release. Record commit, environment, tester,
date, result and evidence link for each check. A blank check is unverified.
This repository patch has **not** been deployed by the implementation task.
As of 2026-11-15 the owner reports over 1,000 users. Treat all existing accounts,
wallets, purchases, rooms and installed clients as live production data.
Follow [the live rollout gates](live-rollout.md) before any production release.

## Local / CI

- [ ] Supported Node version selected (22.13+ on 22.x, or 24.3+).
- [ ] Clean checkout, `npm ci`, `npm run typecheck:edge`, `npm run typecheck`, `npm test` pass.
- [ ] Generated engine/bot builds match committed output.
- [ ] Dependency findings have an owner and a tested upgrade or documented exposure assessment.

## Database staging

- [ ] Replay every migration in a disposable Supabase instance.
- [ ] Verify anon/authenticated roles cannot call economy RPCs or write wallets.
- [ ] Run failure and concurrency scenarios from the remediation plan.
- [ ] Verify payout split, purchased-fund rollback and bot exclusion against ledger rows.
- [ ] Verify a rematch records a second result and cannot erase a failed settlement.
- [ ] Verify cron dispatch receives 200 responses and unsettled-result backlog drains.
- [ ] Verify retention keeps unpaid/unrecorded results.
- [ ] Race entry/entry (same user and different users), entry/cancel, cancel/deal and bot-fill/human-entry with independent database sessions.
- [ ] Replay a paid search after cancellation and after game retention; neither may charge again.
- [ ] Check earned/purchased refund buckets and a free rematch aged into retention.
- [ ] Confirm room-code joins cannot bypass paid entry and nonparticipants cannot read a match via bot-fill/cancel.

## Native staging

- [ ] Fresh install, first match, background/reconnect and cold-start recovery pass.
- [ ] Guest, saved account, account switch and deleted-account flows pass.
- [ ] RevenueCat sandbox identity, checkout, cancellation, restore and delayed-credit flows pass.
- [ ] Ad consent failure, cached consent and privacy-choice editing pass.
- [ ] Small phone, tablet, text scaling and Urdu layout reviewed.
- [ ] With VoiceOver/TalkBack, open one sheet, then a second: only the top sheet is reachable; closing it restores access to the first without losing its form state.
- [ ] Open a confirmation above a sheet: underlying sheet, screen, dock and invite banner cannot be focused or tapped; Back/Escape cancels only the confirmation.
- [ ] Android Back closes the top sheet before navigating or showing a game-leave prompt, including while its owner defers closure during a save.
- [ ] VoiceOver Escape dismisses sheets/confirmations; verify initial focus and return to the invoking control on real devices (automatic focus placement/restoration is not implemented).
- [ ] Verify overlay entry/exit animations and first-launch/loading overlays on a small phone and tablet.
- [ ] New translations and support/recovery copy reviewed.
- [ ] Verify BOT badges, mute computer opponents, disclosure before entry and exact assisted-dice rules on small devices.
- [ ] Exercise cancellation with a lost response, an offline device and a match starting concurrently.

## Invite links

- [ ] Publish the Ludo invite landing page and Android association file on www.biszaaltech.com.
- [ ] Verify `https://www.biszaaltech.com/.well-known/assetlinks.json` returns the expected JSON with HTTP 200, JSON content type and no redirect.
- [ ] Install a Play-signed build containing the new HTTPS intent filter; verify the domain with `adb shell pm get-app-links com.biszaal.mobile` and open a real room invitation.
- [ ] Verify missing-app store links and manual room-code fallback, plus expired-room handling.
- [ ] Publish the prepared Apple association file for HG4G2ZMGV8.com.biszaal.mobile and test iOS Universal Links on a signed installation. Local configuration is prepared; device verification remains open.

## Production cutover

- [ ] Record database backup/recovery point and exact client/server versions.
- [ ] Reconcile historical room-stake attempts and payout flags; document any manual adjustment separately.
- [ ] Prepare/release the compatible native client that sends matchmaking request keys; confirm the installed-client upgrade policy.
- [ ] Drain/pause staked friend-room starts and legacy quick queues so old workers cannot charge during cutover.
- [ ] Recheck linked migration history. Last read-only inspection had production at 0073; pending local changes are 0074–0079.
- [ ] Plan the 0075 feature-flag gate explicitly: it enables online Blitz and must not become visible before the mode-aware game function is deployed and smoke-tested. Do not blindly push all pending migrations while entry points are active.
- [ ] Apply the mode schema (0074) and atomic economy/quick-match changes (0076/0077) with the coordinated game-function cutover; reconcile the intervening 0075 flag migration in the reviewed rollout procedure.
- [ ] Apply purchase fulfillment (0078) before deploying the matching RevenueCat webhook. Verify receipt replay, delayed delivery and the operator review queue.
- [ ] Apply opt-in analytics (0079) before exposing the client setting. Verify opt-out deletes history and the retention job is installed.
- [ ] Verify older clients receive the explicit quick-match update message, and updated clients can search/cancel/retry.
- [ ] Verify old queue claims exclude new atomic rooms, and the durable request/entry records have an archival capacity plan.
- [ ] Verify a controlled low-stake room: funding, finish, payout and statistics match ledger totals.
- [ ] Confirm cron auth, webhook auth, SSV callback configuration and error reporting.
- [ ] Release the native build only after sandbox checks pass.
- [ ] Assign an operator to monitor failed settlements, backlog age, purchase delivery and crashes.

If a gate fails, keep the affected entry point disabled and forward-fix. Rolling
back to the old debit/refund or pre-credit completion-flag implementation would
restore a known defect. Do not bulk-reset flags or issue refunds without ledger
reconciliation. Remaining concurrency/native validation, dependency upgrades and
product improvements are tracked in [the remediation plan](remediation-plan.md).
