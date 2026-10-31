# Ame (Amazon Music)

A userscript for the Amazon Music web player, modelled on the Apple Music edition of [Ame](https://gitlab.com/SuperSaltyGamer/ame) by SuperSaltyGamer. It works on `music.amazon.com`, `music.amazon.co.jp` and the 10 other regional stores.

It handles metadata only. It doesn't download audio, request playback licenses or touch DRM.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io) or [Tampermonkey](https://www.tampermonkey.net).
2. Create a new script in the extension and paste in the contents of `ame-amazon-music.user.js`.
3. Open an album page. The toolbar appears under the play buttons.

## Features

| Feature | How to use it | Sign-in needed |
| --- | --- | --- |
| **Album info table** | **Info** shows ASIN, disc, track, duration, ISRC, album and track dates, language, explicit flag, genre, composer, artist, label and copyright. Copy it as TSV or download it as JSON. Track dates that differ from the album's are underlined. | No |
| **Format check** | **Check Formats** lists every format for every track, such as `flac 2ch 24bit 96kHz`. The best stereo and spatial formats appear on each row and in the table, with the full list in the tooltip. | Yes |
| **Store check** | **Regions**, then **Check All Stores**, counts the tracks each of the 12 stores lists, and links to that store's own edition. | No |
| **Lyrics** | **Download Lyrics** in the table saves timed `.lrc` files, zipped if there are several. Lyrics are licensed text, so these are for your own use. | Yes |
| **Full-size cover** | **Full Cover** opens the master image. Right-clicking a cover swaps in the master, so Save Image gets the full size. | No |
| **Cover search** | **Search Covers** searches for the album on [MH Covers](https://covers.musichoarders.xyz). | No |
| **MusicBrainz** | **Seed MusicBrainz** opens the release editor with the title, artist, label, date, discs, tracks, lengths, guest credits and streaming link filled in. Release type isn't set, because Amazon labels singles as albums too. Nothing is saved until you submit it there. **ISRC2MB** in the table sends the ISRCs to [MagicISRC](https://magicisrc.kepstin.ca). | No |
| **Upsell removal** | Hides the upsell ribbon and the upsell parts of the album header. Ribbons with inline links, such as Terms of Use notices, stay visible. | No |

## What it sends, and when

Nothing runs until you press a button. Requests go only to Amazon, except when you choose to open MH Covers, MusicBrainz or MagicISRC.

| Button | Request | Uses your session |
| --- | --- | --- |
| Info, Seed MusicBrainz | One metadata lookup per album, reused for the session. | Yes |
| Check Formats | The player's own manifest request, for up to 10 tracks at a time. Only the format attributes are kept. | Yes |
| Download Lyrics | The player's own lyrics request, for up to 25 tracks at a time. | Yes |
| Check All Stores | One metadata lookup per store. | No: sent without cookies or your customer ID |

Requests are spaced 300ms apart. They use the session values the page already holds, and they run on your account. These are private Amazon APIs that the player, or in the lookup's case an older player, relies on, so they can change or disappear without notice. Heavy automated use could also draw attention to an account, so this script only acts when you ask it to.

## Differences from Ame

| Ame (Apple Music) | Here |
| --- | --- |
| UPC column | **Not available.** No response I found contains one. |
| "Fully available" in a storefront | **"Listed".** The check counts the tracks a store lists, which doesn't prove they play there. Telling those apart needs an account in each country. |
| Release quality badges | **Not added.** Amazon's signed-in page already shows `ULTRA HD` and `ATMOS` badges. |
| Copy authorization token | **Left out on purpose.** Apple's is a public developer token. Amazon's session credentials are your own. |
| Fix for the preview queue when logged out | **Left out.** Signed-out playback on Amazon goes to a sign-in prompt, so there's no queue to fix. |
| Fix for Ctrl+A in search, selectable metadata | **Not needed.** Both already work on Amazon. |

Amazon serves signed-in visitors a different page from signed-out ones, so the script handles both.

## Testing

```bash
node --test test/
```

The unit tests cover parsing, disc numbering, seeding, store checks, LRC output and the zip writer.

## Status

Tested on the live site in Chromium, with the script injected into the page rather than installed through a userscript manager. Downloads, clipboard writes, new tabs and the MusicBrainz form were intercepted during testing, so those last steps haven't run for real.

- **Signed out, in the Indian store, on the current build:** every button. Format check and lyrics correctly refuse and send nothing.
- **Signed in, on an Unlimited HD account in the Japanese store:** album table, format check, store check, lyrics, covers, seeding fields and in-app navigation. These ran on builds just before the current one, whose only later change is a shorter format label on track rows.
- **Store check:** "Not listed" was cross-checked on one real album, which India's store does send to its home page.
- **Not tested:** Firefox, a userscript manager install, plans below Unlimited HD, a real album with only some tracks in a store, and upsell removal on the signed-in page.

## License

GPL-3.0-or-later, the same family as Ame. See `LICENSE`.
