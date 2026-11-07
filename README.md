# Ame (Amazon Music)

A userscript for the Amazon Music web player, based on the Apple Music edition of [Ame](https://gitlab.com/SuperSaltyGamer/ame) by SuperSaltyGamer. It runs on all 12 regional Amazon Music sites, such as `music.amazon.com` and `music.amazon.co.jp`.

It only reads metadata. It doesn't download audio, request playback licenses or touch DRM.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net) or [Violentmonkey](https://violentmonkey.github.io).
2. **In Chrome, Brave, Edge and other Chromium browsers:** open the extensions page (`chrome://extensions` or `brave://extensions`), click **Details** on the userscript manager and turn on **Allow User Scripts**. Without it the manager installs scripts but never runs them. Firefox doesn't need this.
3. Open [`ame-amazon-music.user.js`](https://github.com/z0owater/ame-amazon-music/raw/main/ame-amazon-music.user.js) and accept the install prompt.
4. Open an album page. The buttons appear under the play button.

## Features

| Button | What it does | Sign-in needed |
| --- | --- | --- |
| **Info** | Opens a table of every track: ASIN, disc, track, duration, ISRC, album and track dates, language, explicit flag, genre, composer, artist, label and copyright. Track dates that differ from the album's are underlined. From the table you can copy it as TSV, download it as JSON, or send the ISRCs to [MagicISRC](https://magicisrc.kepstin.ca) with **ISRC2MB**. | No |
| **Download Lyrics** (in the Info table) | Saves timed `.lrc` files, zipped when there's more than one. Lyrics are licensed, so keep them for personal use. | Yes |
| **Check Formats** | Lists every format of every track, such as `flac 2ch 24bit 96kHz`. The best stereo and spatial formats show on each track row and in the table. Hover a row's label for the full list. | Yes |
| **Regions** | Links to the album in all 12 stores. **Check All Stores** counts the tracks each store lists and links to that store's own edition. EU stores can only be checked from an EU store's site, because EU sites refuse requests from other sites. | No |
| **Full Cover** | Opens the cover without Amazon's resizing. Right-clicking any cover does the same, so Save Image gets the full size. | No |
| **Search Covers** | Searches for the album on [MH Covers](https://covers.musichoarders.xyz). | No |
| **Seed MusicBrainz** | Opens the MusicBrainz release editor with the title, artist, label, date, discs, tracks, lengths, guest credits and streaming link filled in. Release type is left blank because Amazon calls singles albums too. Nothing is saved until you submit it. | No |

It also hides the upsell ribbon and the upsell parts of the album header. Ribbons with links in them, such as Terms of Use notices, stay.

## What it sends

Nothing until you press a button. Requests go only to Amazon. MH Covers, MusicBrainz and MagicISRC open only when you click their buttons.

| Button | Request | Uses your session |
| --- | --- | --- |
| Info, Seed MusicBrainz | One metadata lookup per album, reused until you reload | Yes |
| Check Formats | The player's own manifest request, 10 tracks at a time. Only the format attributes are kept. | Yes |
| Download Lyrics | The player's own lyrics request, 25 tracks at a time | Yes |
| Check All Stores | One metadata lookup per store | No. Sent without cookies or your customer ID. |

Requests are 300 ms apart. These are private Amazon APIs, so they can change or stop working without notice, and heavy use could get an account noticed.

## Differences from Ame

| Ame (Apple Music) | Here |
| --- | --- |
| UPC column | Not available. None of Amazon's responses include one. |
| "Fully available" in a storefront | "Listed". The check counts the tracks a store lists, which doesn't prove they play there. |
| Release quality badges | Not added. Amazon's signed-in page already shows `ULTRA HD` and `ATMOS`. |
| Copy authorization token | Left out. Apple's is a public developer token. Amazon's credentials are your own. |
| Preview queue fix when logged out | Left out. Signed-out playback on Amazon goes to a sign-in prompt. |
| Ctrl+A in search, selectable metadata | Not needed. Both already work on Amazon. |

## Tested

Checked on 7 November 2026 with version 0.2.1. Amazon serves signed-in and signed-out visitors different pages, so they're listed separately.

- **Firefox 159, Tampermonkey 5.5.0:** installed and in use.
- **Brave 1.99, Tampermonkey 5.5.1:** the script doesn't run until **Allow User Scripts** is on (Install, step 2).
- **Signed in on an Unlimited HD account, Japanese store, Chromium 152 with the script injected:** every button, on a 16-track album and a single. Check Formats labelled every track row, Download Lyrics saved a zip of 16 timed `.lrc` files, Full Cover and right-click both gave the 1400×1400 cover, and the toolbar followed in-app navigation.
- **Signed out, Japanese and UK stores, same setup:** every button. Check Formats and Download Lyrics refuse and send nothing.
- **Store check:** all 12 stores from the UK store, and the 6 non-EU stores from the Japanese one.
- Downloads and new tabs were checked by the file or URL they produced, not opened.
- In windows narrower than about 600px, the format label on track rows gets cut off. Its tooltip and the Info table show it in full.
- **Not tested:** Violentmonkey, plans below Unlimited HD, an album that some stores don't list, and upsell removal on the signed-in page (this account had no upsells to remove).

## Development

```bash
node --test
```

The tests cover parsing, disc numbering, seeding, store checks, LRC output and the zip writer.

## License

GPL-3.0-or-later, like Ame. See `LICENSE`.
