// ==UserScript==
// @name         Ame (Amazon Music)
// @namespace    ame-amazonmusic
// @version      0.2.0
// @description  Album info with ISRCs, store availability, format checks, lyrics export, full-size covers, and MH Covers and MusicBrainz links for the Amazon Music web player.
// @license      GPL-3.0-or-later
// @homepageURL  https://gitlab.com/SuperSaltyGamer/ame
// @run-at       document-end
// @grant        none
// @inject-into  page
// @match        https://music.amazon.com/*
// @match        https://music.amazon.co.jp/*
// @match        https://music.amazon.ca/*
// @match        https://music.amazon.com.mx/*
// @match        https://music.amazon.com.br/*
// @match        https://music.amazon.co.uk/*
// @match        https://music.amazon.de/*
// @match        https://music.amazon.fr/*
// @match        https://music.amazon.it/*
// @match        https://music.amazon.es/*
// @match        https://music.amazon.in/*
// @match        https://music.amazon.com.au/*
// ==/UserScript==

// An Amazon Music counterpart to Ame by SuperSaltyGamer (GPL-3.0): https://gitlab.com/SuperSaltyGamer/ame
// The feature set and the zip writer are derived from it.
//
// Requests only go to Amazon, and only when you press a button. They use the web player's own APIs and the
// session values the page already holds. Manifests are read for their format attributes and then discarded:
// this script doesn't fetch audio, request licenses or touch DRM.

(function () {
	"use strict";

	// Top-level domain, name, territory, and the regional path of the player's APIs.
	const REGIONS = [
		[ "co.jp", "Japan", "JP", "FE" ],
		[ "com", "United States", "US", "NA" ],
		[ "ca", "Canada", "CA", "NA" ],
		[ "com.mx", "Mexico", "MX", "NA" ],
		[ "com.br", "Brazil", "BR", "NA" ],
		[ "co.uk", "United Kingdom", "GB", "EU" ],
		[ "de", "Germany", "DE", "EU" ],
		[ "fr", "France", "FR", "EU" ],
		[ "it", "Italy", "IT", "EU" ],
		[ "es", "Spain", "ES", "EU" ],
		[ "in", "India", "IN", "EU" ],
		[ "com.au", "Australia", "AU", "FE" ]
	];

	const COLUMNS = [
		[ "asin", "ASIN" ],
		[ "disc", "Disc" ],
		[ "number", "Track" ],
		[ "duration", "Duration" ],
		[ "isrc", "ISRC" ],
		[ "albumDate", "Album Date" ],
		[ "trackDate", "Track Date" ],
		[ "language", "Language" ],
		[ "explicit", "Explicit" ],
		[ "format", "Best Format" ],
		[ "spatial", "Spatial" ],
		[ "lyrics", "Lyrics" ],
		[ "genre", "Genre" ],
		[ "composer", "Composer" ],
		[ "artist", "Artist" ],
		[ "title", "Title" ],
		[ "label", "Label" ],
		[ "copyright", "Copyright" ],
		[ "albumArtist", "Album Artist" ],
		[ "albumTitle", "Album Title" ]
	];

	const LANGUAGE_CODES = { ja: "jpn", en: "eng", ko: "kor", zh: "zho", de: "deu", fr: "fra", es: "spa", it: "ita", pt: "por", hi: "hin", ar: "ara" };
	const TRACK_TYPE_RANK = { HD: 3, SD: 2, LD: 1 };
	const SPATIAL_TRACK_TYPE = "3D";
	const MB_LINK_TYPE_STREAMING = 980;

	const TARGET_LOOKUP = "com.amazon.musicensembleservice.MusicEnsembleService.lookup";
	const TARGET_MANIFESTS = "com.amazon.digitalmusiclocator.DigitalMusicLocatorServiceExternal.getDashManifestsV2";
	const TARGET_LYRICS = "com.amazon.musicxray.MusicXrayService.getLyricsByTrackAsinBatch";

	const MANIFEST_BATCH_SIZE = 10;
	const LYRICS_BATCH_SIZE = 25; // The API rejects anything larger.
	const REQUEST_DELAY_MS = 300;

	// Parsing and formatting.

	function albumAsinFromPath(pathname) {
		const match = /^\/albums\/([A-Z0-9]{10})(?:\/|$)/.exec(pathname || "");
		return match ? match[1] : null;
	}

	function asinFromUrl(url) {
		const match = /\/([A-Z0-9]{10})(?:[/?#]|$)/.exec(url || "");
		return match ? match[1] : null;
	}

	// Cover URLs carry size and format transforms such as "._UX250_FMwebp_QL85_". Without them the CDN serves the master.
	function fullImageUrl(url) {
		if (!/media-amazon\.com\/images\/I\//.test(url || "")) return url || "";
		return url.replace(/\._[^/]*(\.[a-z0-9]+)$/i, "$1");
	}

	function parseIsoDuration(value) {
		const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value || "");
		if (!match || !(match[1] || match[2] || match[3])) return null;
		return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Math.round(Number(match[3] || 0));
	}

	function formatDuration(seconds) {
		if (seconds == null) return "";
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor(seconds / 60) % 60;
		const rest = (seconds % 60).toString().padStart(2, "0");
		return hours ? `${hours}:${minutes.toString().padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
	}

	// Release dates are stored as local midnight in the store's time zone, so the UTC date can be a day early.
	// Adding 12 hours lands on the right day for any zone between UTC-12 and UTC+12.
	function dateFromMs(ms) {
		if (!Number.isFinite(ms)) return "";
		return new Date(ms + 12 * 3600 * 1000).toISOString().slice(0, 10);
	}

	function sanitizeFileName(value) {
		return value
			.trim()
			.replace(/[/?<>\\:*|"\u0000-\u001f]/g, "_")
			.replace(/\.+$/, "_");
	}

	function cleanReleaseTitle(title) {
		return title
			.replace(/\s*[[(]explicit[\])]\s*$/i, "")
			.replace(/ - (?:Single|EP)$/i, "")
			.trim();
	}

	function chunk(items, size) {
		const chunks = [];
		for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
		return chunks;
	}

	// The page's LD+JSON has no disc field, but its track position restarts at 1 on every disc.
	function parseLdAlbum(ld) {
		const tracks = [];
		let disc = 1;
		let previous = 0;

		for (const track of ld.track || []) {
			const number = Number(track.position) || previous + 1;
			if (number <= previous) disc++;
			previous = number;

			tracks.push({
				asin: asinFromUrl(track["@id"] || track.url),
				disc,
				number,
				title: track.name || "",
				seconds: parseIsoDuration(track.duration),
				language: track.inLanguage || "",
				explicit: track.isFamilyFriendly === false
			});
		}

		return {
			title: ld.name || "",
			artist: [].concat(ld.byArtist || []).map(artist => artist.name).filter(Boolean).join(", "),
			date: (ld.datePublished || "").slice(0, 10),
			trackCount: Number(ld.numTracks) || tracks.length,
			tracks
		};
	}

	function findLdAlbum(scripts, asin) {
		for (const script of scripts) {
			try {
				const ld = JSON.parse(script);
				if (ld["@type"] === "MusicAlbum" && asinFromUrl(ld["@id"] || ld.url) === asin) return ld;
			} catch {
				// Not every LD+JSON block is ours to read.
			}
		}
		return null;
	}

	function parseLookupAlbum(album) {
		const details = album.productDetails || {};

		return {
			asin: album.asin,
			globalAsin: album.globalAsin || "",
			title: album.title || "",
			artist: album.artist?.name || album.primaryArtistName || "",
			date: dateFromMs(album.originalReleaseDate),
			trackCount: Number(album.trackCount) || (album.tracks || []).length,
			image: album.image || "",
			label: album.label || details.label || "",
			copyright: details.copyright || "",
			tracks: (album.tracks || []).map((track, index) => ({
				asin: track.asin,
				globalAsin: track.globalAsin || "",
				disc: Number(track.discNum) || 1,
				number: Number(track.trackNum) || index + 1,
				title: track.title || "",
				artist: track.artist?.name || track.primaryArtistName || "",
				seconds: Number.isFinite(track.duration) ? track.duration : null,
				isrc: track.isrc || "",
				trackDate: dateFromMs(track.originalReleaseDate),
				language: [].concat(track.languagesOfPerformance || []).join(", "),
				explicit: track.parentalControls?.hasExplicitLanguage === true,
				genre: track.genreName || "",
				composers: track.songWriters || [],
				hasLyrics: track.hasLyrics === true
			}))
		};
	}

	// Lookup data is the fuller source. The page's own LD+JSON keeps the table working if the lookup fails.
	function buildAlbum({ asin, origin, ld, lookup, header, footer }) {
		const parsed = ld ? parseLdAlbum(ld) : { title: "", artist: "", date: "", trackCount: 0, tracks: [] };
		const useLookup = lookup && lookup.tracks.length > 0;
		const tracks = useLookup ? lookup.tracks : parsed.tracks;
		const artist = lookup?.artist || parsed.artist || header?.artist || "";
		const trackCount = lookup?.trackCount || parsed.trackCount;

		return {
			asin,
			globalAsin: lookup?.globalAsin || "",
			url: `${origin}/albums/${asin}`,
			title: lookup?.title || parsed.title || header?.title || "",
			artist,
			date: parsed.date || lookup?.date || "",
			trackCount,
			isComplete: tracks.length > 0 && tracks.length >= trackCount,
			// The page's cover first: on one album it was 1400px, against 500px from the lookup.
			image: fullImageUrl(header?.image || lookup?.image || ""),
			label: lookup?.label || "",
			copyright: lookup?.copyright || footer || "",
			tracks: tracks.map(track => ({ ...track, artist: track.artist || artist }))
		};
	}

	function albumRows(album, formats) {
		return album.tracks.map(track => {
			const { best, spatial } = summarizeFormats(formats.get(track.asin));
			const checked = formats.has(track.asin);

			return {
				asin: track.asin || "",
				disc: track.disc,
				number: track.number,
				duration: formatDuration(track.seconds),
				isrc: track.isrc || "",
				albumDate: album.date,
				trackDate: track.trackDate || "",
				language: track.language || "",
				explicit: track.explicit ? "E" : "",
				format: best ? formatLabel(best) : (checked && !spatial ? "[unavailable]" : ""),
				spatial: spatial ? formatLabel(spatial) : "",
				lyrics: track.hasLyrics ? "Yes" : "",
				genre: track.genre || "",
				composer: (track.composers || []).join(", "),
				artist: track.artist,
				title: track.title,
				label: album.label,
				copyright: album.copyright,
				albumArtist: album.artist,
				albumTitle: album.title
			};
		});
	}

	// Rows on the signed-in page have no link to their track, so they're matched by position, or by title if only some are rendered.
	function matchRowsToTracks(rowTitles, tracks) {
		if (rowTitles.length === tracks.length) return tracks;

		const remaining = [ ...tracks ];
		return rowTitles.map(title => {
			const index = remaining.findIndex(track => track.title === title);
			return index >= 0 ? remaining.splice(index, 1)[0] : null;
		});
	}

	function toTsv(columns, rows) {
		const clean = value => String(value ?? "").replace(/[\t\r\n]+/g, " ");
		return [
			columns.map(([ , name ]) => name).join("\t"),
			...rows.map(row => columns.map(([ key ]) => clean(row[key])).join("\t"))
		].join("\n");
	}

	// Links out.

	function coverSearchUrl(album) {
		const params = new URLSearchParams();
		if (album.artist) params.set("artist", album.artist);
		params.set("album", cleanReleaseTitle(album.title));
		return `https://covers.musichoarders.xyz?${params}`;
	}

	function magicIsrcUrl(album) {
		const params = new URLSearchParams();
		album.tracks.forEach((track, index) => {
			if (track.isrc) params.set(`isrc${index + 1}`, track.isrc);
		});
		return `https://magicisrc.kepstin.ca/?${params}`;
	}

	function guessLanguage(tracks) {
		const counts = {};
		for (const track of tracks) {
			const code = LANGUAGE_CODES[track.language];
			if (code) counts[code] = (counts[code] || 0) + 1;
		}
		return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
	}

	function guessScript(text) {
		if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)) return "Jpan";
		if (/\p{Script=Hangul}/u.test(text)) return "Kore";
		if (/\p{Script=Latin}/u.test(text) && !/[^\p{Script=Latin}\P{L}]/u.test(text)) return "Latn";
		return "";
	}

	// See https://musicbrainz.org/doc/Development/Release_Editor_Seeding
	// This only fills in the release editor. You review and submit the edit there.
	function buildSeedFields(album) {
		const fields = [];
		const set = (key, value) => {
			if (value !== "" && value != null) fields.push([ key, String(value) ]);
		};

		set("name", album.title);
		set("artist_credit.names.0.name", album.artist);
		set("status", "official");
		set("language", guessLanguage(album.tracks));
		set("script", guessScript([ album.title, ...album.tracks.map(track => track.title) ].join(" ")));
		set("labels.0.name", album.label);

		const [ year, month, day ] = album.date.split("-").map(Number);
		if (year) set("events.0.date.year", year);
		if (month) set("events.0.date.month", month);
		if (day) set("events.0.date.day", day);

		const positions = {};
		for (const track of album.tracks) {
			const medium = track.disc - 1;
			if (positions[medium] == null) {
				positions[medium] = 0;
				set(`mediums.${medium}.format`, "Digital Media");
			}

			const prefix = `mediums.${medium}.track.${positions[medium]++}`;
			set(`${prefix}.name`, track.title);
			set(`${prefix}.number`, track.number);
			if (track.seconds != null) set(`${prefix}.length`, track.seconds * 1000);
			if (track.artist !== album.artist) set(`${prefix}.artist_credit.names.0.name`, track.artist);
		}

		set("urls.0.url", album.url);
		set("urls.0.link_type", MB_LINK_TYPE_STREAMING);
		set("edit_note", `Seeded from ${album.url} with the Ame (Amazon Music) userscript.`);
		return fields;
	}

	// Stores.

	function regionLinks(asin, currentHost, results) {
		return REGIONS.map(([ tld, name, territory, apiRegion ]) => {
			const host = `music.amazon.${tld}`;
			const result = results?.get(host);
			return {
				name,
				host,
				territory,
				apiRegion,
				url: `https://${host}/albums/${result?.asin || asin}`,
				isCurrent: host === currentHost,
				status: result?.status || "",
				text: regionStatusText(result)
			};
		});
	}

	function regionStatusText(result) {
		switch (result?.status) {
			case "checking": return "Checking";
			case "full": return `${result.available} tracks`;
			case "partial": return `${result.available} of ${result.expected} tracks`;
			case "missing": return "Not listed";
			case "error": return "Check failed";
			default: return "";
		}
	}

	// A store lists the album under its own ASIN if it has one, and returns nothing if it doesn't list it at all.
	function classifyStoreLookup(body, expected) {
		const album = body?.albumList?.[0];
		if (!album) return { status: "missing" };

		const available = (album.tracks || []).length;
		return { status: available >= expected ? "full" : "partial", asin: album.asin, available, expected };
	}

	// Request bodies. `config` is the page's own window.amznMusic.appConfig.

	// FULL_CATALOG on purpose. MUSIC_SUBSCRIPTION depends on the session cookies of that store's own site, so it wrongly
	// comes back empty for stores you aren't signed in to.
	function buildLookupRequest(config, asin, territory = config.musicTerritory, customerId = config.customerId || "") {
		return {
			asins: [ asin ],
			features: [ "expandTracklist", "hasLyrics" ],
			requestedContent: "FULL_CATALOG",
			deviceId: config.deviceId,
			deviceType: config.deviceType,
			musicTerritory: territory,
			customerId,
			languageLocale: config.displayLanguage
		};
	}

	// The same request the player makes when it starts a track. It only asks for substitution on an HD plan, and the
	// 24-bit formats aren't listed without it.
	function buildManifestRequest(config, asins, requestId) {
		return {
			deviceToken: { deviceTypeId: config.deviceType, deviceId: config.deviceId },
			appMetadata: { https: "true" },
			clientMetadata: { clientId: "WebCP", clientRequestId: requestId },
			customerId: config.customerId,
			contentIdList: asins.map(identifier => ({ identifier, identifierType: "ASIN" })),
			musicDashVersionList: [ "SIREN_KATANA" ],
			contentProtectionList: [ "TRACK_PSSH" ],
			tryAsinSubstitution: config.tier === "UNLIMITED_HD",
			customerInfo: { marketplaceId: config.marketplaceId, territoryId: config.musicTerritory },
			appInfo: { musicAgent: `Maestro/1.0 WebCP/${config.version}` }
		};
	}

	function buildLyricsRequest(config, asins) {
		return {
			trackAsinsAndMarketplaceList: asins.map(asin => ({ asin, musicTerritory: config.musicTerritory })),
			deviceId: config.deviceId,
			deviceType: config.deviceType,
			musicTerritory: config.musicTerritory,
			customerId: config.customerId,
			languageLocale: config.displayLanguage
		};
	}

	// Lyrics.

	function formatLrcTime(ms) {
		const minutes = Math.floor(ms / 60000).toString().padStart(2, "0");
		const seconds = Math.floor(ms / 1000 % 60).toString().padStart(2, "0");
		const hundredths = Math.floor(ms % 1000 / 10).toString().padStart(2, "0");
		return `${minutes}:${seconds}.${hundredths}`;
	}

	function lyricsToLrc(lyrics, meta = {}) {
		const lines = lyrics.lines || [];
		const isSynced = lines.some(line => line.startTime > 0);
		const writers = (lyrics.writers || []).filter(Boolean);

		const out = [];
		if (meta.title) out.push(`[ti:${meta.title}]`);
		if (meta.artist) out.push(`[ar:${meta.artist}]`);
		if (meta.album) out.push(`[al:${meta.album}]`);
		if (writers.length) out.push(`[au:${writers.join(", ")}]`);

		for (const line of lines) {
			const text = String(line.text ?? "");
			out.push(isSynced && Number.isFinite(line.startTime) ? `[${formatLrcTime(line.startTime)}]${text}` : text);
		}

		const notices = [].concat(lyrics.copyrightNotices || []).filter(Boolean);
		if (notices.length) out.push("", ...notices.map(String));

		return out.join("\n") + "\n";
	}

	function lyricsFileName(track) {
		const number = track.number.toString().padStart(2, "0");
		return sanitizeFileName(`${track.disc}-${number}. ${track.title.slice(0, 120)}`) + ".lrc";
	}

	// Formats. Only these attributes are kept from a manifest, using the same fields the player labels its own quality with.

	function compareFormats(a, b) {
		return (TRACK_TYPE_RANK[b.trackType] || 0) - (TRACK_TYPE_RANK[a.trackType] || 0) ||
			(b.bitDepth || 0) - (a.bitDepth || 0) ||
			(b.sampleRate || 0) - (a.sampleRate || 0) ||
			(b.bandwidth || 0) - (a.bandwidth || 0);
	}

	function formatLabel(format) {
		const parts = [ format.codec || "unknown" ];
		if (format.channels) parts.push(`${format.channels}ch`);
		if (format.bitDepth) parts.push(`${format.bitDepth}bit`);
		if (format.sampleRate) parts.push(`${format.sampleRate / 1000}kHz`);
		if (format.bandwidth) parts.push(`${Math.round(format.bandwidth / 1000)}kbps`);
		if (format.trackType) parts.push(format.trackType);
		return parts.join(" ");
	}

	function summarizeFormats(formats) {
		const list = formats || [];
		return {
			best: list.find(format => format.trackType !== SPATIAL_TRACK_TYPE) || null,
			spatial: list.find(format => format.trackType === SPATIAL_TRACK_TYPE) || null
		};
	}

	// Track rows have little room, so this leaves the rest to the row's tooltip and the table.
	function rowFormatText(formats) {
		const { best, spatial } = summarizeFormats(formats);
		const parts = [];

		if (best) {
			const stereo = [ (best.codec || "unknown").split(".")[0] ];
			if (best.bitDepth) stereo.push(`${best.bitDepth}bit`);
			if (best.sampleRate) stereo.push(`${best.sampleRate / 1000}kHz`);
			parts.push(stereo.join(" "));
		}
		if (spatial) parts.push((spatial.codec || "unknown").split(".")[0]);

		return parts.join(" + ") || "[unavailable]";
	}

	function parseDashFormats(manifest, parser) {
		const doc = parser.parseFromString(manifest.replace(/\n/g, "").replace(/\\"/g, "\""), "application/xml");
		if (doc.querySelector("parsererror")) return [];

		const seen = new Map();

		for (const representation of doc.querySelectorAll("Representation")) {
			const set = representation.parentElement;
			const nodes = [ ...representation.children, ...(set?.children || []) ];
			const attribute = name => representation.getAttribute(name) || set?.getAttribute(name) || "";
			const property = scheme => {
				const node = nodes.find(candidate => candidate.localName === "SupplementalProperty" && candidate.getAttribute("schemeIdUri") === scheme);
				return node?.getAttribute("value") || "";
			};

			const format = {
				codec: attribute("codecs"),
				channels: parseInt(nodes.find(candidate => candidate.localName === "AudioChannelConfiguration")?.getAttribute("value")) || null,
				bitDepth: parseInt(property("amz-music:bitDepth")) || null,
				sampleRate: parseInt(attribute("audioSamplingRate")) || null,
				bandwidth: parseInt(attribute("bandwidth")) || null,
				trackType: property("amz-music:trackType")
			};

			seen.set(formatLabel(format), format);
		}

		return Array.from(seen.values()).sort(compareFormats);
	}

	// Zip. Stored, not deflated: lyric files are small.

	const crcTable = new Uint32Array(256).map((_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
		return c >>> 0;
	});

	function crc32(bytes) {
		let c = 0xFFFFFFFF;
		for (const byte of bytes) c = crcTable[(c ^ byte) & 0xFF] ^ (c >>> 8);
		return (c ^ 0xFFFFFFFF) >>> 0;
	}

	function createZip(files) {
		const encoder = new TextEncoder();
		const u16 = value => [ value & 0xFF, (value >>> 8) & 0xFF ];
		const u32 = value => [ value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF ];
		const utf8Flag = 0x0800;

		const locals = [];
		const centrals = [];
		let offset = 0;

		for (const file of files) {
			const name = encoder.encode(file.name);
			const data = encoder.encode(file.data);
			const crc = crc32(data);
			const common = [ ...u16(20), ...u16(utf8Flag), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0) ];

			const local = [ new Uint8Array([ ...u32(0x04034B50), ...common ]), name, data ];
			const central = [ new Uint8Array([ ...u32(0x02014B50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset) ]), name ];

			locals.push(...local);
			centrals.push(...central);
			offset += local.reduce((size, part) => size + part.length, 0);
		}

		const centralSize = centrals.reduce((size, part) => size + part.length, 0);
		const end = new Uint8Array([ ...u32(0x06054B50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(centralSize), ...u32(offset), ...u16(0) ]);

		return { parts: [ ...locals, ...centrals, end ], type: "application/zip" };
	}

	const shared = {
		albumAsinFromPath, asinFromUrl, fullImageUrl, parseIsoDuration, formatDuration, dateFromMs, sanitizeFileName, cleanReleaseTitle, chunk,
		parseLdAlbum, findLdAlbum, parseLookupAlbum, buildAlbum, albumRows, matchRowsToTracks, toTsv, coverSearchUrl, magicIsrcUrl, guessLanguage, guessScript,
		buildSeedFields, regionLinks, regionStatusText, classifyStoreLookup, buildLookupRequest, buildManifestRequest,
		buildLyricsRequest, formatLrcTime, lyricsToLrc, lyricsFileName, compareFormats, formatLabel, summarizeFormats, rowFormatText, parseDashFormats, createZip,
		COLUMNS, REGIONS
	};

	if (typeof window === "undefined") {
		module.exports = shared;
		return;
	}

	// Everything below runs in the page.

	const STYLES = `
		/* Upsell ribbon: a call-to-action button and no inline links. Notices such as the Terms of Use ribbon carry links and stay visible. */
		music-notification-ribbon:has(music-button):not(:has(a, music-link)) { display: none !important; }

		#ame-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
		.ame-btn { appearance: none; background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .22); border-radius: 999px; color: #fff; cursor: pointer; font: inherit; font-size: 12px; line-height: 1; padding: 7px 12px; white-space: nowrap; }
		.ame-btn:hover { background: rgba(255, 255, 255, .2); }
		.ame-btn:focus-visible { outline: 2px solid #25d1da; outline-offset: 2px; }
		.ame-btn:disabled { cursor: default; opacity: .45; }

		#ame-dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483000; display: flex; flex-direction: column; max-height: 45vh; background: #0f1215; border-top: 2px solid #25d1da; color: #e8eaed; font: 12px/1.4 "Amazon Ember", system-ui, sans-serif; }
		#ame-dock-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; }
		#ame-dock-title { flex: 1 1 200px; min-width: 0; overflow: hidden; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
		#ame-dock-scroll { overflow: auto; }
		#ame-dock table { width: 100%; border-collapse: collapse; white-space: nowrap; }
		#ame-dock th { position: sticky; top: 0; padding: 4px 8px; background: #1a1f24; font-weight: 600; text-align: left; }
		#ame-dock td { padding: 3px 8px; border-top: 1px solid #23282d; }
		#ame-dock tbody tr:nth-child(even) td { background: #14181c; }
		#ame-dock td.ame-differs { text-decoration: underline; }
		#ame-dock a { color: #25d1da; }
		#ame-dock-empty { padding: 12px; }

		#ame-regions { position: fixed; z-index: 2147483001; max-height: 70vh; overflow: auto; width: 280px; padding: 10px; background: #0f1215; border: 1px solid #2c3339; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .6); color: #e8eaed; font: 12px/1.4 "Amazon Ember", system-ui, sans-serif; }
		#ame-regions p { margin: 0 0 8px; color: #9aa4ad; }
		#ame-regions .ame-btn { margin-bottom: 8px; }
		#ame-regions a { display: flex; justify-content: space-between; gap: 12px; padding: 4px 6px; border-radius: 4px; color: #e8eaed; text-decoration: none; }
		#ame-regions a:hover { background: #1a1f24; }
		#ame-regions a.ame-current { font-weight: 700; }
		#ame-regions a[data-status="full"] span:last-child { color: #25d1da; }
		#ame-regions a[data-status="partial"] span:last-child { color: #f5b942; }
		#ame-regions a[data-status="missing"], #ame-regions a[data-status="error"] { color: #7d8790; }

		.ame-format { display: block; margin-top: 2px; color: #9aa4ad; font-size: 11px; line-height: 1.2; white-space: nowrap; }
		[data-testid="Box,BadgeGroup"] .ame-format { display: inline-block; align-self: center; margin: 0 0 0 8px; }
	`;

	// The upsell parts of the album header live in its shadow root, out of reach of the page's styles.
	const HEADER_SHADOW_STYLES = `.upsellBadge, .upsell-container, p.unlimited { display: none !important; }`;

	const state = {
		asin: null,
		lookups: new Map(),
		lookupRequests: new Map(),
		formats: new Map(),
		regions: new Map(),
		formatJob: null,
		lyricsJob: null,
		lyricsLabel: null,
		regionJob: null,
		version: 0,
		dock: null,
		dockVersion: -1,
		regionsMenu: null
	};

	let headerSheet = null;
	const styledHeaders = new WeakSet();

	function el(tag, props = {}, children = []) {
		const element = document.createElement(tag);
		for (const [ key, value ] of Object.entries(props)) {
			if (key === "onClick") element.addEventListener("click", value);
			else if (key in element) element[key] = value;
			else element.setAttribute(key, value);
		}
		element.append(...children);
		return element;
	}

	function actionButton(text, onClick, title) {
		return el("button", { className: "ame-btn", type: "button", textContent: text, title: title || "", onClick });
	}

	function flashButton(button, text) {
		const original = button.dataset.label || button.textContent;
		button.dataset.label = original;
		button.textContent = text;
		setTimeout(() => {
			button.textContent = original;
			delete button.dataset.label;
		}, 2000);
	}

	function sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	function saveFile(parts, type, fileName) {
		const url = URL.createObjectURL(new Blob(parts, { type }));
		const link = el("a", { href: url, download: fileName, style: "display: none" });
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	}

	async function copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			const area = el("textarea", { value: text, style: "position: fixed; opacity: 0" });
			document.body.append(area);
			area.select();
			const copied = document.execCommand("copy");
			area.remove();
			return copied;
		}
	}

	function bump() {
		state.version++;
		scheduleSync();
	}

	// Requests.

	function session() {
		return window.amznMusic?.appConfig || null;
	}

	function playerApiHeaders(config, target) {
		return {
			"Content-Type": "application/json",
			"Content-Encoding": "amz-1.0",
			"X-Amz-Target": target,
			"csrf-token": config.csrf.token,
			"csrf-rnd": config.csrf.rnd,
			"csrf-ts": config.csrf.ts
		};
	}

	async function postPlayerApi(path, target, body) {
		const config = session();
		const response = await fetch(`/${config.siteRegion}/api/${path}`, {
			method: "POST",
			credentials: "include",
			headers: playerApiHeaders(config, target),
			body: JSON.stringify(body)
		});

		if (!response.ok) throw new Error(`${path} responded with ${response.status}.`);
		return response.json();
	}

	// One request per album, reused for the rest of the session.
	function ensureLookup(asin) {
		if (!state.lookupRequests.has(asin)) {
			state.lookupRequests.set(asin, postPlayerApi("muse/legacy/lookup", TARGET_LOOKUP, buildLookupRequest(session(), asin))
				.then(body => {
					const album = body?.albumList?.[0];
					state.lookups.set(asin, album ? parseLookupAlbum(album) : null);
				})
				.catch(err => {
					console.warn("[Ame] Album lookup failed:", err);
					state.lookups.set(asin, null);
				})
				.finally(bump));
		}
		return state.lookupRequests.get(asin);
	}

	// Sent to each store's own site, without cookies or your customer ID, so it doesn't involve your account.
	async function fetchRegionStatus(asin, link, expected) {
		try {
			const config = session();
			const response = await fetch(`https://${link.host}/${link.apiRegion}/api/muse/legacy/lookup`, {
				method: "POST",
				credentials: "omit",
				headers: playerApiHeaders(config, TARGET_LOOKUP),
				body: JSON.stringify(buildLookupRequest(config, asin, link.territory, ""))
			});

			if (!response.ok) return { status: "error" };
			return classifyStoreLookup(await response.json(), expected);
		} catch (err) {
			console.warn(`[Ame] Store check failed for ${link.host}:`, err);
			return { status: "error" };
		}
	}

	// Page state.

	// Signed-out visitors get a page built from music-* components. Signed-in ones get a newer React Native page with different markup.
	function currentHeader() {
		const classicEl = document.querySelector("#atf music-detail-header");
		if (classicEl) {
			// Properties, because this element doesn't always reflect them as attributes.
			return { hostEl: classicEl, slot: "icons", title: classicEl.headline || "", artist: classicEl.primaryText || "", image: classicEl.imageSrc || "" };
		}

		const metadataEl = document.querySelector("[data-testid='PageHeaderMetadata']");
		let hostEl = document.querySelector("[data-testid='IconButton,Toolbar_Play_Button']");
		if (!metadataEl || !hostEl) return null;

		while (hostEl && !hostEl.contains(metadataEl)) hostEl = hostEl.parentElement;
		if (!hostEl) return null;

		return {
			hostEl,
			slot: "",
			title: document.querySelector("[data-testid='PageHeaderMetadata_Headline']")?.textContent.trim() || "",
			artist: document.querySelector("[data-testid='PageHeaderMetadata_Primary']")?.textContent.trim() || "",
			image: document.querySelector("#atf img")?.src || ""
		};
	}

	function currentAlbum() {
		const asin = state.asin;
		const scripts = Array.from(document.querySelectorAll("script[type='application/ld+json']"), script => script.textContent);

		const footer = Array.from(document.querySelectorAll("#main_content .music-tertiary-text"), node => node.textContent)
			.find(text => /℗|©|\(P\)|\(C\)/i.test(text));

		return buildAlbum({
			asin,
			origin: location.origin,
			ld: findLdAlbum(scripts, asin),
			lookup: state.lookups.get(asin) || null,
			header: currentHeader(),
			footer
		});
	}

	// Toolbar.

	function createToolbar(slot) {
		const toolbarEl = el("div", { id: "ame-toolbar", slot }, [
			actionButton("Info", toggleDock, "Show the track table for this album, including ISRCs."),
			actionButton("Check Formats", checkFormats, "Find the formats available for every track on this album."),
			actionButton("Regions", toggleRegions, "See this album in other Amazon Music stores, and check where it's available."),
			actionButton("Full Cover", () => {
				const { image } = currentAlbum();
				if (image) open(image, "_blank", "noopener");
			}, "Open the full-size cover in a new tab. Right-clicking a cover also upgrades it for Save Image."),
			actionButton("Search Covers", () => {
				open(coverSearchUrl(currentAlbum()), "_blank", "noopener");
			}, "Search for this album on MH Covers."),
			actionButton("Seed MusicBrainz", seedMusicBrainz, "Open the MusicBrainz release editor with this album filled in. Nothing is saved until you submit it there.")
		]);

		toolbarEl.addEventListener("click", event => event.stopPropagation());
		return toolbarEl;
	}

	async function seedMusicBrainz() {
		await ensureLookup(state.asin);

		const album = currentAlbum();
		if (!album.tracks.length) return;

		const formEl = el("form", { method: "POST", action: "https://musicbrainz.org/release/add", target: "_blank", style: "display: none" });
		for (const [ name, value ] of buildSeedFields(album)) {
			formEl.append(el("input", { type: "hidden", name, value }));
		}

		document.body.append(formEl);
		formEl.submit();
		formEl.remove();
	}

	// Format check.

	async function checkFormats(event) {
		const button = event.currentTarget;
		const asin = state.asin;

		if (state.formatJob) return;
		if (!session()?.customerId) {
			flashButton(button, "Sign in first");
			return;
		}

		state.formatJob = asin;
		const label = button.textContent;

		try {
			await ensureLookup(asin);
			const trackAsins = currentAlbum().tracks.map(track => track.asin).filter(Boolean);
			let done = 0;

			for (const batch of chunk(trackAsins, MANIFEST_BATCH_SIZE)) {
				if (state.asin !== asin) break;
				button.textContent = `Checking ${done}/${trackAsins.length}`;

				const body = await postPlayerApi("dmls/", TARGET_MANIFESTS, buildManifestRequest(session(), batch, crypto.randomUUID()));
				const responses = new Map((body?.contentResponseList || []).map(response => [ response.contentIdentifier?.identifier || response.contentIdentifier, response ]));

				for (const trackAsin of batch) {
					const manifest = responses.get(trackAsin)?.manifest;
					state.formats.set(trackAsin, typeof manifest === "string" ? parseDashFormats(manifest, new DOMParser()) : []);
				}

				done += batch.length;
				bump();
				await sleep(REQUEST_DELAY_MS);
			}

			button.textContent = label;
		} catch (err) {
			console.warn("[Ame] Format check failed:", err);
			button.textContent = label;
			flashButton(button, "Check failed");
		} finally {
			state.formatJob = null;
		}
	}

	// Lyrics.

	// The label lives in state because the dock can re-render while this runs.
	function setLyricsLabel(text, clearAfterMs) {
		state.lyricsLabel = text;
		bump();
		if (clearAfterMs) setTimeout(() => setLyricsLabel(null), clearAfterMs);
	}

	async function downloadLyrics() {
		const asin = state.asin;

		if (state.lyricsJob) return;
		if (!session()?.customerId) {
			setLyricsLabel("Sign in first", 2000);
			return;
		}

		state.lyricsJob = asin;

		try {
			await ensureLookup(asin);
			const album = currentAlbum();
			const tracks = album.tracks.filter(track => track.asin && track.hasLyrics !== false);
			const files = [];
			let done = 0;

			for (const batch of chunk(tracks, LYRICS_BATCH_SIZE)) {
				if (state.asin !== asin) return;
				setLyricsLabel(`Fetching ${done}/${tracks.length}`);

				const body = await postPlayerApi("xray/", TARGET_LYRICS, buildLyricsRequest(session(), batch.map(track => track.asin)));
				const responses = new Map((body?.lyricsResponseList || []).map(response => [ response.trackAsinAndMarketplace?.asin, response ]));

				for (const track of batch) {
					const lyrics = responses.get(track.asin)?.lyrics;
					if (!lyrics?.lines?.length) continue;
					files.push({ name: lyricsFileName(track), data: lyricsToLrc(lyrics, { title: track.title, artist: track.artist, album: album.title }) });
				}

				done += batch.length;
				await sleep(REQUEST_DELAY_MS);
			}

			setLyricsLabel(null);

			if (!files.length) {
				setLyricsLabel("No lyrics found", 2000);
			} else if (files.length === 1) {
				saveFile([ files[0].data ], "text/plain;charset=utf-8", files[0].name);
			} else {
				const zip = createZip(files);
				saveFile(zip.parts, zip.type, sanitizeFileName(`Lyrics {${album.asin}}.zip`));
			}
		} catch (err) {
			console.warn("[Ame] Lyrics download failed:", err);
			setLyricsLabel("Download failed", 2000);
		} finally {
			state.lyricsJob = null;
		}
	}

	// Regions.

	function closeRegions() {
		state.regionsMenu?.remove();
		state.regionsMenu = null;
		removeEventListener("click", closeRegions);
	}

	function renderRegions() {
		if (!state.regionsMenu) return;

		const links = regionLinks(state.asin, location.hostname, state.regions.get(state.asin));
		const checkButton = state.regionsMenu.querySelector("button");
		const done = links.filter(link => link.status && link.status !== "checking").length;

		checkButton.disabled = !!state.regionJob;
		checkButton.textContent = state.regionJob ? `Checking ${done}/${links.length}` : "Check All Stores";

		state.regionsMenu.querySelector("#ame-regions-list").replaceChildren(...links.map(link => el("a", {
			href: link.url,
			target: "_blank",
			rel: "noopener",
			className: link.isCurrent ? "ame-current" : "",
			title: link.url
		}, [ el("span", { textContent: link.name }), el("span", { textContent: link.text }) ])));

		// A separate pass, because dataset can't be set through el().
		state.regionsMenu.querySelectorAll("#ame-regions-list a").forEach((linkEl, index) => {
			linkEl.dataset.status = links[index].status;
		});
	}

	async function checkRegions() {
		const asin = state.asin;
		if (state.regionJob) return;
		state.regionJob = asin;

		const results = new Map();
		state.regions.set(asin, results);
		renderRegions();

		try {
			await ensureLookup(asin);
			const expected = currentAlbum().trackCount;

			for (const link of regionLinks(asin, location.hostname)) {
				if (state.asin !== asin) break;

				results.set(link.host, { status: "checking" });
				renderRegions();

				results.set(link.host, await fetchRegionStatus(asin, link, expected));
				renderRegions();

				await sleep(REQUEST_DELAY_MS);
			}
		} finally {
			state.regionJob = null;
			renderRegions();
		}
	}

	function toggleRegions(event) {
		if (state.regionsMenu) {
			closeRegions();
			return;
		}

		state.regionsMenu = el("div", { id: "ame-regions" }, [
			el("p", { textContent: "Checking counts the tracks each store lists, which doesn't guarantee they play there. Links then go to that store's own edition." }),
			actionButton("Check All Stores", checkRegions, "Check every store for this album, without using your account."),
			el("div", { id: "ame-regions-list" })
		]);

		state.regionsMenu.addEventListener("click", clickEvent => clickEvent.stopPropagation());
		document.body.append(state.regionsMenu);
		renderRegions();

		const buttonRect = event.currentTarget.getBoundingClientRect();
		const menuRect = state.regionsMenu.getBoundingClientRect();
		state.regionsMenu.style.left = `${Math.max(8, Math.min(buttonRect.left, innerWidth - menuRect.width - 8))}px`;
		state.regionsMenu.style.top = `${Math.max(8, Math.min(buttonRect.bottom + 6, innerHeight - menuRect.height - 8))}px`;

		// Added after this click has finished bubbling, so that it doesn't close the menu straight away.
		setTimeout(() => addEventListener("click", closeRegions));
	}

	// Info dock.

	function closeDock() {
		state.dock?.remove();
		state.dock = null;
	}

	function toggleDock() {
		if (state.dock) {
			closeDock();
			return;
		}

		renderDock();
		ensureLookup(state.asin);
	}

	function renderDock() {
		const album = currentAlbum();
		const rows = albumRows(album, state.formats);
		const scrollTop = state.dock?.querySelector("#ame-dock-scroll")?.scrollTop || 0;
		const isLookupDone = state.lookups.has(album.asin);

		const discCount = rows.reduce((count, row) => Math.max(count, row.disc), 0);
		let title = `Album Info: ${album.title || album.asin}`;
		if (rows.length) title += ` (${rows.length} track${rows.length === 1 ? "" : "s"}${discCount > 1 ? `, ${discCount} discs` : ""})`;
		if (rows.length && !album.isComplete) title += ` (Incomplete: ${rows.length}/${album.trackCount})`;
		if (!isLookupDone) title += " (Loading details)";
		else if (!state.lookups.get(album.asin)) title += " (Details unavailable)";

		const copyButton = actionButton("Copy TSV", async () => {
			flashButton(copyButton, await copyText(toTsv(COLUMNS, rows)) ? "Copied" : "Copy failed");
		}, "Copy the table as tab-separated text.");

		const isrcButton = actionButton("ISRC2MB", () => {
			open(magicIsrcUrl(album), "_blank", "noopener");
		}, "Add these ISRCs to MusicBrainz with MagicISRC.");
		isrcButton.disabled = !album.tracks.some(track => track.isrc);

		const lyricsButton = actionButton(state.lyricsLabel || "Download Lyrics", downloadLyrics, "Download this album's lyrics as .lrc files. Requires signing in.");
		lyricsButton.disabled = !!state.lyricsJob || (isLookupDone && !!state.lookups.get(album.asin) && !album.tracks.some(track => track.hasLyrics));

		const jsonButton = actionButton("Download JSON", () => {
			const formats = Object.fromEntries(album.tracks.filter(track => state.formats.has(track.asin)).map(track => [ track.asin, state.formats.get(track.asin) ]));
			saveFile([ JSON.stringify({ ...album, formats }, null, "\t") ], "application/json", `${album.asin}.json`);
		}, "Download this album's metadata.");

		const tableEl = el("table", {}, [
			el("thead", {}, [ el("tr", {}, COLUMNS.map(([ , name ]) => el("th", { textContent: name }))) ]),
			el("tbody", {}, rows.map(row => el("tr", {}, COLUMNS.map(([ key ]) => {
				if (key === "asin" && row.asin) {
					return el("td", {}, [ el("a", { href: `/tracks/${row.asin}`, target: "_blank", rel: "noopener", textContent: row.asin }) ]);
				}

				const differs = key === "trackDate" && row.trackDate && row.trackDate !== row.albumDate;
				return el("td", { textContent: String(row[key] ?? ""), className: differs ? "ame-differs" : "" });
			}))))
		]);

		const dockEl = el("div", { id: "ame-dock" }, [
			el("div", { id: "ame-dock-head" }, [
				el("div", { id: "ame-dock-title", textContent: title, title }),
				isrcButton,
				lyricsButton,
				copyButton,
				jsonButton,
				actionButton("Close", closeDock)
			]),
			rows.length
				? el("div", { id: "ame-dock-scroll" }, [ tableEl ])
				: el("div", { id: "ame-dock-empty", textContent: "This album's track data hasn't loaded yet." })
		]);

		if (state.dock) state.dock.replaceWith(dockEl);
		else document.body.append(dockEl);

		state.dock = dockEl;
		state.dockVersion = state.version;

		const scrollEl = dockEl.querySelector("#ame-dock-scroll");
		if (scrollEl) scrollEl.scrollTop = scrollTop;
	}

	// Track rows.

	function trackRows() {
		const classicRows = Array.from(document.querySelectorAll("#main_content music-text-row[primary-href], #main_content music-image-row[primary-href]"));
		if (classicRows.length) {
			return classicRows.map(rowEl => ({
				rowEl,
				asin: asinFromUrl(rowEl.getAttribute("primary-href")),
				hostEl: rowEl.querySelector(".content .col1") || rowEl.querySelector(".content")
			}));
		}

		const rows = Array.from(document.querySelectorAll("[data-testid='ListItem,album-descriptive-row-item']"));
		const tracks = matchRowsToTracks(rows.map(rowEl => rowEl.getAttribute("aria-label") || ""), currentAlbum().tracks);

		return rows.map((rowEl, index) => ({
			rowEl,
			asin: tracks[index]?.asin,
			hostEl: rowEl.querySelector("[data-testid='Box,BadgeGroup']")
		}));
	}

	function annotateRows() {
		if (!state.formats.size) return;

		for (const { rowEl, asin, hostEl } of trackRows()) {
			const formats = state.formats.get(asin);
			let chipEl = rowEl.querySelector(".ame-format");

			if (!formats) {
				chipEl?.remove();
				continue;
			}

			const text = rowFormatText(formats);
			if (chipEl?.textContent === text) continue;

			if (!chipEl) {
				if (!hostEl) continue;
				chipEl = el("span", { className: "ame-format" });
				hostEl.append(chipEl);
			}

			chipEl.textContent = text;
			chipEl.title = formats.map(formatLabel).join("\n");
		}
	}

	// Sync. The player is a single-page app, so this runs on DOM changes rather than on page loads, and every step is safe to repeat.

	function sync() {
		const asin = albumAsinFromPath(location.pathname);

		if (asin !== state.asin) {
			state.asin = asin;
			closeDock();
			closeRegions();
		}

		// The signed-in page can reuse its header on other kinds of page, which would strand the toolbar there.
		if (!asin) document.querySelector("#ame-toolbar")?.remove();

		const header = asin ? currentHeader() : null;

		if (header) {
			const { hostEl, slot } = header;
			if (!hostEl.querySelector(":scope > #ame-toolbar")) hostEl.append(createToolbar(slot));

			if (hostEl.shadowRoot && !styledHeaders.has(hostEl)) {
				if (!headerSheet) {
					headerSheet = new CSSStyleSheet();
					headerSheet.replaceSync(HEADER_SHADOW_STYLES);
				}
				hostEl.shadowRoot.adoptedStyleSheets = [ ...hostEl.shadowRoot.adoptedStyleSheets, headerSheet ];
				styledHeaders.add(hostEl);
			}
		}

		annotateRows();

		if (state.dock && state.dockVersion !== state.version) renderDock();
		else if (state.dock && state.dock.querySelector("#ame-dock-empty") && currentAlbum().tracks.length) renderDock();
	}

	let syncTimer = 0;

	function scheduleSync() {
		if (syncTimer) return;
		syncTimer = setTimeout(() => {
			syncTimer = 0;
			try {
				sync();
			} catch (err) {
				console.warn("[Ame] Sync failed:", err);
			}
		}, 150);
	}

	// A cover's full-size URL is swapped in on right-click, so that Save Image gets the master rather than a resized copy.
	function upgradeImage(imgEl, src, rootEl) {
		const full = fullImageUrl(src);
		if (!full || imgEl?.src === full) return;

		for (const sourceEl of rootEl?.querySelectorAll("source") || []) sourceEl.srcset = full;

		if (imgEl) {
			imgEl.srcset = "";
			imgEl.src = full;
		}
	}

	if (window.__ameAmazon) return;
	window.__ameAmazon = { ...shared, state, currentAlbum, ensureLookup };

	document.head.append(el("style", { id: "ame-styles", textContent: STYLES }));

	addEventListener("mousedown", event => {
		if (event.button !== 2) return;
		const imageEl = event.composedPath().find(node => node.localName === "music-image");
		if (imageEl?.shadowRoot) {
			upgradeImage(imageEl.shadowRoot.querySelector("img"), imageEl.getAttribute("src"), imageEl.shadowRoot);
			return;
		}

		// On the signed-in page the cover is a plain image, often underneath other elements.
		const imgEl = document.elementsFromPoint(event.clientX, event.clientY).find(node => node.localName === "img");
		if (imgEl) upgradeImage(imgEl, imgEl.src);
	}, { capture: true, passive: true });

	new MutationObserver(scheduleSync).observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: [ "primary-href" ]
	});

	scheduleSync();
})();
