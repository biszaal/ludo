# App Store rejection — Guideline 1.1.6 (submission 2d2809ac)

Apple rejected v1.0 (9) because the screenshots claim the app is ad-free:

> - Play without any Ads
> - No ads • No pop-ups

The app is not ad-free. It ships AdMob banners on Home and Lobby, an
end-of-match interstitial, opt-in rewarded video, and an ATT prompt at cold
start — all enabled by default (`src/store/configStore.ts`, `src/lib/ads/`).
The claim is straightforwardly false, and Apple noted that a disclaimer in the
description would not fix it.

**No code change is involved.** A full-history search (`git log --all -S "No ads"`,
`-S "pop-ups"`, `-S "Play without"`) finds no such string ever committed — the
claims live only in App Store Connect.

## What has to change

1. **Screenshots** — regenerate without any ad-free claim (prompt below).
2. **The rest of the metadata** — Apple's note is explicit that the screenshots
   alone are not the issue. Scrub "no ads", "ad-free", "no pop-ups",
   "uninterrupted", "no interruptions" from the **description, promotional text,
   subtitle and keywords** too.
3. **Recapture from the current build.** The rejected screenshots show an
   outdated home screen (the old list-style "Play vs AI / Pass & play / Create a
   room" layout) that no longer exists. Review happens on an iPad Air 11" M3, so
   a reviewer comparing screenshots to the running app sees a different product
   — a rejection risk on its own, separate from 1.1.6.

## Claims that are safe to use

Each is verifiable by a reviewer in under a minute:

| Claim | Where it's true |
| --- | --- |
| Play offline vs AI — no internet needed | Home → Vs AI, local engine + bot |
| Pass & play on one device | Home → Pass & play |
| Private rooms — share a 4-letter code | Home → Friends room |
| Quick match in seconds, 2 or 4 players | Home → PLAY |
| Coins never change how a game plays | Shown in-app on the Get coins sheet |
| Classic Ludo rules, 2–4 players | How to play |

Avoid anything about ads, pop-ups, interruptions, or "completely free".

---

## Prompt for Claude design

> Rework the App Store screenshot set for **Ludo** (iOS). Apple reviews on an
> iPad Air 11-inch (M3), and the iPad set is the one that was rejected.
>
> **Must remove.** Apple rejected the current set under Guideline 1.1.6
> (misleading content) for these claims. Delete them entirely — do not soften,
> qualify, or footnote them:
> - the headline "No ads. No pop-ups. Just play."
> - the green ✓ pill "No ads · No pop-ups"
> - "Play without any Ads"
> - any other wording implying the app is ad-free, uninterrupted, or free of
>   pop-ups.
>
> The app genuinely serves banner ads on the home and lobby screens, a
> full-screen interstitial after a match, opt-in rewarded video, and an App
> Tracking Transparency prompt on first launch. Every claim in the set has to
> survive a reviewer opening the app and looking.
>
> **Replace with these, one per screenshot** — all verifiable in the shipped
> build:
> 1. "The classic board game, beautifully rebuilt"
> 2. "Play offline vs AI — no internet needed"
> 3. "Pass & play on one device"
> 4. "Private rooms — share a 4-letter code"
> 5. "Quick match in seconds, 2 or 4 players"
> 6. "Coins never change how a game plays"
>
> **Also fix:** the current screenshots show an **outdated home screen** that no
> longer matches the build. Recapture from the current UI — dark navy table
> background with a subtle star pattern, coin and gem pills top-left with the
> daily-bonus chest tile beneath them, avatar and settings buttons top-right, the
> 3D board diorama centred with pawns and a die resting around it, a large light
> PLAY button reading "Quick match · 100" below it, then a row of three tiles
> (Vs AI / Pass & play / Friends room) above a Shop / Friends / Account / How to
> play tab bar.
>
> **Keep:** the existing visual language — deep navy background, rounded device
> frame with the screen inset, bold white display headline above the device,
> generous margins. Portrait iPad, one clear message per screenshot, headline
> legible at App Store thumbnail size.
