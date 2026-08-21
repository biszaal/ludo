# Reaction sound provenance

Every reaction-emoji voice is recorded audio, normalized into the app's format
by `scripts/process-reaction-sfx.mjs` (mono, 44.1 kHz, 16-bit PCM, RMS matched
to −16 dB with peaks limited to −1 dBFS, so no reaction is louder than another).

Sources live in `assets/raw-reactions/<name>.<ext>` and are gitignored — refetch
them from the URLs below and re-run the script to rebuild any asset.

Only CC0 / public-domain sources are used, so the app carries no attribution
obligation. Anything under a share-alike or attribution licence must not be
added here without checking it against the store listing.

| Sound | Emoji | Licence | Author | Source |
|---|---|---|---|---|
| `laugh.wav` | 😂 Laughing | — | — | Supplied directly as a finished asset; no raw source. Never regenerate. |
| `gg.wav` | 🤝 Good game | CC0 | Sandermotions | https://commons.wikimedia.org/wiki/File:277021_sandermotions_applause-2.wav |
| `crying.wav` | 😭 Crying | _pending_ | | |
| `tease.wav` | 😜 Teasing | _pending_ | | |
| `angry.wav` | 😡 Angry | _pending_ | | |
| `shock.wav` | 😮 Shocked | _pending_ | | |
| `cheer.wav` | 🎉 Celebrating | _pending_ | | |
| `thumbs.wav` | 👍 Thumbs up | _pending_ | | |

Rows marked _pending_ still hold the old placeholder audio: `crying`, `tease`,
`angry`, `shock` and `cheer` are the retired synthesized voices, and `thumbs` is
a copy of `pop.wav`. They play correctly but do not yet sound like a human.
