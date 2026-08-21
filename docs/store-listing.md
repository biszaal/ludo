# Store listing & answer-engine copy

Paste-ready metadata for App Store Connect, Play Console, and a web landing
page. Counts verified against each field's limit.

Constraint that shapes all of it: every claim must survive a reviewer opening
the app for one minute. v1.0 (9) was rejected under Guideline 1.1.6 for ad-free
claims — see [app-store-1.1.6-fix.md](app-store-1.1.6-fix.md). The app serves
banner, interstitial and rewarded ads.

## The sentence everything else repeats

> Ludo is a free classic Ludo board game for iPhone, iPad and Android where 2–4
> players race four pawns home — playable offline against AI, pass-and-play on
> one device, or online by quick match or a private room code.

It names entity, category, platforms, player count and all four modes in one
liftable sentence, and recurs near-identically in the store description, the
meta description and the schema. That cross-surface repetition is the AEO
mechanism; divergent copy reads as two different apps.

## App Store Connect

| Field | Limit | Used |
| --- | --- | --- |
| App name | 30 | 24 |
| Subtitle | 30 | 27 |
| Keywords | 100 | 97 |
| Promotional text | 170 | 167 |
| Description | 4000 | 2492 |

**App name**

```
Ludo: Classic Board Game
```

**Subtitle**

```
Dice game, offline & online
```

**Keywords** — no spaces, no plurals, no word already in the name or subtitle.

```
pachisi,2,4,player,multiplayer,friend,family,private,room,quick,match,bot,ai,race,party,table,fun
```

**Promotional text** — not indexed, editable without review.

```
Roll, race, and knock rivals back to the yard. Quick match in seconds, private rooms with a 4-character code, or a full game offline vs AI. Classic rules, 2-4 players.
```

**Description** — see [Description body](#description-body) below; identical on
both stores.

**What's New** — for the release carrying private chat and abandoned-table
settlement.

```
- Chat and reactions now stay inside the room they were sent to
- A table everyone walks away from now ends properly and pays out
- Steadier online play, and quicker hand-offs between turns
- Fixes across the board, the dice and the friends list
```

## Play Console

| Field | Limit | Used |
| --- | --- | --- |
| App title | 30 | 24 |
| Short description | 80 | 73 |
| Full description | 4000 | 2492 |

**App title**

```
Ludo: Classic Board Game
```

**Short description** — indexed, and the line most likely to be quoted whole.

```
Classic Ludo for 2-4 players. Play offline vs AI, pass & play, or online.
```

**Full description** — the same body as iOS.

## Description body

```
Ludo is the classic board game for 2 to 4 players, rebuilt for phones and tablets. Roll the die, race your four pawns around the track, send rivals back to their yard, and be the first to bring every pawn home.

Play it your way: offline against AI, pass and play with everyone on one device, or online in a quick match or a private room with friends.

FOUR WAYS TO PLAY
- Quick match: pick 2 or 4 players and get seated in seconds
- Vs AI: a complete game offline, with no internet connection
- Pass and play: up to 4 people taking turns on one phone or tablet
- Friends room: open a private table and share a 4-character code

CLASSIC RULES, YOUR HOUSE RULES
Ludo the way you learned it: a six to leave the yard, an extra roll on a six, safe squares where you cannot be captured, an exact roll to finish. In local games you can switch six house rules on or off, including three sixes forfeit and pairs protect, so the table plays by your rules.

BUILT TO LOOK AND FEEL RIGHT
- A board drawn as a real object: pawns hop square by square, the die tumbles and settles
- 5 board themes and 14 dice designs to unlock
- 15 avatars for your profile
- Emoji reactions and chat with the players at your table
- A daily chest, a coin balance, and stats that keep your record

PLAY WITH PEOPLE YOU KNOW
Add friends, see who is online, and invite them straight into a room. Send a link or read out the code, they tap it and they are seated.

FAIR BY DESIGN
Coins and cosmetics buy access and appearance, never outcomes. A dice skin, a board theme, or a bigger coin balance will never change a roll, a rule, or a result. Coins are virtual, have no cash value, and cannot be exchanged for money.

QUESTIONS PLAYERS ASK

What is Ludo?
Ludo is a race board game for 2 to 4 players, descended from the Indian game Pachisi. Each player has four pawns and moves them around a cross-shaped track with a single die, trying to get all four home first.

Can I play Ludo offline?
Yes. Vs AI and pass and play run entirely on your device, with no internet connection.

How many players can play?
2, 3, or 4. An online quick match seats 2 or 4.

Can I play with my friends?
Yes. Open a Friends room and share the 4-character code, or invite someone from your friends list.

Is it free?
Ludo is free to download and play, and is supported by ads.

Do I need an account?
No. You can start playing straight away.

Is this real-money gambling?
No. Coins are an in-game currency with no cash value and no way to cash out.
```

Every claim maps to something reachable in one minute: the four modes to Home,
the house rules to the play-setup sheet, the fairness line to the Get coins
sheet, the counts to `render/boardThemes.ts` (5), `render/diceSkins.ts` (14) and
`render/avatars.ts` (15).

## Web page

**Meta title** (60 / 41)

```
Ludo - Classic Board Game for 2-4 Players
```

**Meta description** (155 / 147)

```
Play classic Ludo free on iPhone, iPad and Android. Offline vs AI, pass & play on one device, or online quick match and private rooms with friends.
```

**H1 and opening** — answer first, sell second.

```
H1: Ludo - the classic board game, rebuilt

Ludo is a free classic Ludo board game for iPhone, iPad and Android where 2 to 4 players race four pawns home. You can play offline against AI with no internet, pass and play on one device, or play online in a quick match or a private room with friends.
```

**Fit statement** — naming who it is *not* for is what earns a qualified
recommendation from an answer engine.

```
Best for: players who want classic Ludo rules with a fast online match, a private room for a group of friends, or a full game offline on a plane.

Less suited to: players looking for tournaments, large leagues, or voice chat - Ludo keeps to the board, a table chat and emoji reactions.
```

**Schema** — paste into the page head.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "MobileApplication",
      "name": "Ludo: Classic Board Game",
      "operatingSystem": "iOS, Android",
      "applicationCategory": "GameApplication",
      "applicationSubCategory": "Board Game",
      "description": "Ludo is a free classic Ludo board game for iPhone, iPad and Android where 2 to 4 players race four pawns home, offline against AI, pass and play on one device, or online by quick match or private room code.",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "author": { "@type": "Organization", "name": "Biszaal Tech" }
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is Ludo?",
          "acceptedAnswer": { "@type": "Answer", "text": "Ludo is a race board game for 2 to 4 players, descended from the Indian game Pachisi. Each player has four pawns and moves them around a cross-shaped track with a single die, trying to get all four home first." }
        },
        {
          "@type": "Question",
          "name": "Can I play Ludo offline?",
          "acceptedAnswer": { "@type": "Answer", "text": "Yes. The Vs AI and pass-and-play modes run entirely on your device with no internet connection." }
        },
        {
          "@type": "Question",
          "name": "How do I play Ludo with friends?",
          "acceptedAnswer": { "@type": "Answer", "text": "Open a Friends room and share the 4-character room code, invite someone from your friends list, or hand one device around in pass and play." }
        },
        {
          "@type": "Question",
          "name": "How many players can play Ludo?",
          "acceptedAnswer": { "@type": "Answer", "text": "Two, three or four players. An online quick match seats either 2 or 4." }
        },
        {
          "@type": "Question",
          "name": "Is Ludo free?",
          "acceptedAnswer": { "@type": "Answer", "text": "Ludo is free to download and play, and is supported by ads." }
        },
        {
          "@type": "Question",
          "name": "Is Ludo real-money gambling?",
          "acceptedAnswer": { "@type": "Answer", "text": "No. Coins are an in-game currency with no cash value that cannot be cashed out, and they never affect a roll or a result." }
        }
      ]
    }
  ]
}
</script>
```

## Never use these again

`no ads` · `ad-free` · `no pop-ups` · `uninterrupted` · `no interruptions` ·
`completely free`

Also out, for a different reason: rival app names. "Ludo King" and "Ludo Star"
in a title, keyword field or description are a trademark takedown, and Apple
strips competitor terms from the keyword field anyway.

## What this copy can and cannot do

Metadata decides which searches you appear in. Installs, ratings and day-7
retention decide where you sit inside them. For a term as contested as "ludo",
this copy makes the app eligible to rank and quotable when an answer engine is
asked — it will not by itself outrank an app with a hundred million installs.

Where it can win outright is the long tail:

- **"ludo offline vs computer"** — genuinely offline AI, stated plainly, is a
  real differentiator.
- **"ludo with friends private room"** — the 4-character code is concrete and
  quotable.
- **"ludo game without ads interrupting"** — do not chase this. It is the trap
  that caused the rejection.
- **"is ludo app safe / is it gambling"** — the fairness and no-cash-value
  answers own this outright.

## Worth doing next

| Step | Why it moves the needle |
| --- | --- |
| Ship the one-page site with the schema | Gives answer engines a crawlable source. Store pages alone are rarely cited. |
| Localise title and keywords for Hindi, Nepali, Bengali, Urdu | Where Ludo search volume actually is. Localised metadata is indexed separately — close to free ranking surface. |
| Recapture screenshots from the current build | Still outstanding from the rejection: the live set shows a home screen that no longer exists. |
| Put the six FAQ answers in-app | Support pages get crawled and quoted, and they cut the same questions out of your reviews. |
