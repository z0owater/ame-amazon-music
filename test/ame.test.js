// Run with: node --test test/
// Album data below is shaped like Amazon's real responses. Lyric text is made up.

const test = require("node:test");
const assert = require("node:assert/strict");
const ame = require("../ame-amazon-music.user.js");

function ldAlbum(positions, overrides = {}) {
	return {
		"@context": "https://schema.org",
		"@id": "https://music.amazon.co.jp/albums/B0CZPF5L2V",
		"@type": "MusicAlbum",
		byArtist: { "@type": "MusicGroup", name: "Album Artist" },
		datePublished: "2024-04-10T10:00Z",
		name: "Album Title",
		numTracks: positions.length,
		track: positions.map((position, i) => ({
			"@id": `https://music.amazon.co.jp/tracks/B0CZPF${(1000 + i).toString()}`,
			"@type": "MusicRecording",
			duration: "PT4M29S",
			inLanguage: "ja",
			isFamilyFriendly: true,
			name: `Track ${i + 1}`,
			position
		})),
		...overrides
	};
}

function lookupAlbum() {
	return {
		asin: "B0CZPF5L2V",
		globalAsin: "B0CZPF52BK",
		title: "Lookup Title",
		artist: { asin: "B003XSRE6O", name: "Album Artist" },
		primaryArtistName: "Album Artist",
		trackCount: 3,
		label: "Some Label",
		originalReleaseDate: 1712743200000, // 2024-04-10T10:00Z
		image: "https://m.media-amazon.com/images/I/abc.jpg",
		productDetails: { copyright: "(P) 2024 Some Label", label: "Some Label", primaryGenreName: "J-POP/General" },
		tracks: [
			{ asin: "B0CZPF1000", globalAsin: "G1", title: "One", discNum: 1, trackNum: "1", duration: 269, isrc: "JPU902400835", originalReleaseDate: 1712674800000, artist: { name: "Album Artist" }, songWriters: [ "A", "B" ], languagesOfPerformance: "ja", genreName: "J-POP/General", hasLyrics: true, parentalControls: { hasExplicitLanguage: false } },
			{ asin: "B0CZPF1001", globalAsin: "G2", title: "Two", discNum: 1, trackNum: "2", duration: 285, isrc: "JPPO01618586", originalReleaseDate: 1473951600000, artist: { name: "Album Artist feat. Guest" }, songWriters: [ "A" ], languagesOfPerformance: "ja", genreName: "J-POP/General", hasLyrics: false, parentalControls: { hasExplicitLanguage: true } },
			{ asin: "B0CZPF1002", globalAsin: "G3", title: "Three", discNum: 2, trackNum: "1", duration: 100, isrc: "", originalReleaseDate: 1712674800000, artist: { name: "Album Artist" }, songWriters: null, languagesOfPerformance: "ja", genreName: "J-POP/General", hasLyrics: true, parentalControls: { hasExplicitLanguage: false } }
		]
	};
}

function sampleAlbum() {
	return ame.buildAlbum({
		asin: "B0CZPF5L2V",
		origin: "https://music.amazon.co.jp",
		ld: ldAlbum([ 1, 2, 1 ]),
		lookup: ame.parseLookupAlbum(lookupAlbum()),
		header: { title: "Header Title", artist: "Header Artist", image: "" },
		footer: "ignored"
	});
}

const config = {
	deviceId: "device-id",
	deviceType: "device-type",
	sessionId: "session-id",
	customerId: "customer-id",
	marketplaceId: "marketplace-id",
	musicTerritory: "JP",
	displayLanguage: "ja_JP",
	version: "1.0.0",
	csrf: { token: "csrf-token", ts: "csrf-ts", rnd: "csrf-rnd" }
};

test("albumAsinFromPath finds only catalog album pages", () => {
	assert.equal(ame.albumAsinFromPath("/albums/B0CZPF5L2V"), "B0CZPF5L2V");
	assert.equal(ame.albumAsinFromPath("/albums/B0CZPF5L2V/"), "B0CZPF5L2V");
	assert.equal(ame.albumAsinFromPath("/tracks/B0CZPDWWYH"), null);
	assert.equal(ame.albumAsinFromPath("/artists/B00CIQM8BI/name"), null);
	assert.equal(ame.albumAsinFromPath("/my/albums/B0CZPF5L2V"), null);
	assert.equal(ame.albumAsinFromPath("/albums/short"), null);
});

test("asinFromUrl reads track links and absolute URLs", () => {
	assert.equal(ame.asinFromUrl("/tracks/B0CZPDWWYH"), "B0CZPDWWYH");
	assert.equal(ame.asinFromUrl("https://music.amazon.co.jp/tracks/B0H6W9ZSVT"), "B0H6W9ZSVT");
	assert.equal(ame.asinFromUrl("/tracks/B0CZPDWWYH?ref=x"), "B0CZPDWWYH");
	assert.equal(ame.asinFromUrl(undefined), null);
});

test("fullImageUrl strips the transforms seen on the site", () => {
	const master = "https://m.media-amazon.com/images/I/51eqUHf2+ZS.jpg";
	assert.equal(ame.fullImageUrl("https://m.media-amazon.com/images/I/51eqUHf2+ZS._UX250_FMwebp_QL85_.jpg"), master);
	assert.equal(ame.fullImageUrl("https://m.media-amazon.com/images/I/51eqUHf2+ZS._SX1920_SY1080_BL30_QL100_.jpg"), master);
	assert.equal(ame.fullImageUrl("https://m.media-amazon.com/images/I/51eqUHf2+ZS._SL500.jpg"), master);
	assert.equal(ame.fullImageUrl(master), master);
	assert.equal(ame.fullImageUrl("https://m.media-amazon.com/images/G/01/digital/music/x._UX250_.jpg"), "https://m.media-amazon.com/images/G/01/digital/music/x._UX250_.jpg");
	assert.equal(ame.fullImageUrl(""), "");
});

test("durations parse and format", () => {
	assert.equal(ame.parseIsoDuration("PT3M56S"), 236);
	assert.equal(ame.parseIsoDuration("PT1H2M3S"), 3723);
	assert.equal(ame.parseIsoDuration("PT"), null);
	assert.equal(ame.parseIsoDuration(""), null);
	assert.equal(ame.formatDuration(236), "3:56");
	assert.equal(ame.formatDuration(5), "0:05");
	assert.equal(ame.formatDuration(3723), "1:02:03");
	assert.equal(ame.formatDuration(null), "");
});

test("dateFromMs lands on the store's local date", () => {
	assert.equal(ame.dateFromMs(1712743200000), "2024-04-10"); // 10:00 UTC, as album dates come.
	assert.equal(ame.dateFromMs(1473951600000), "2016-09-16"); // Midnight in Japan, the 15th in UTC.
	assert.equal(ame.dateFromMs(Date.UTC(2024, 3, 10, 7)), "2024-04-10"); // Midnight in Los Angeles.
	assert.equal(ame.dateFromMs(Date.UTC(2024, 3, 9, 22)), "2024-04-10"); // Midnight in Berlin, the 9th in UTC.
	assert.equal(ame.dateFromMs(undefined), "");
	assert.equal(ame.dateFromMs(null), "");
});

test("chunk splits to the batch size, as the 25-track lyrics limit needs", () => {
	const items = Array.from({ length: 26 }, (_, i) => i);
	const chunks = ame.chunk(items, 25);
	assert.deepEqual(chunks.map(part => part.length), [ 25, 1 ]);
	assert.deepEqual(chunks.flat(), items);
	assert.deepEqual(ame.chunk([], 25), []);
});

test("parseLdAlbum derives discs from position resets", () => {
	// The positions of a real two-disc album on the site.
	const positions = [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 ];
	const album = ame.parseLdAlbum(ldAlbum(positions));

	assert.deepEqual([ album.tracks[11].disc, album.tracks[11].number ], [ 1, 12 ]);
	assert.deepEqual([ album.tracks[12].disc, album.tracks[12].number ], [ 2, 1 ]);
	assert.deepEqual([ album.tracks[25].disc, album.tracks[25].number ], [ 2, 14 ]);
	assert.equal(album.date, "2024-04-10");
});

test("parseLdAlbum handles several artists and explicit tracks", () => {
	const ld = ldAlbum([ 1, 2 ], { byArtist: [ { name: "A" }, { name: "B" } ] });
	ld.track[1].isFamilyFriendly = false;
	const album = ame.parseLdAlbum(ld);
	assert.equal(album.artist, "A, B");
	assert.equal(album.tracks[0].explicit, false);
	assert.equal(album.tracks[1].explicit, true);
});

test("findLdAlbum ignores other albums and broken blocks", () => {
	const wanted = JSON.stringify(ldAlbum([ 1 ]));
	const other = JSON.stringify(ldAlbum([ 1 ], { "@id": "https://music.amazon.co.jp/albums/B000000000" }));
	assert.equal(ame.findLdAlbum([ "{broken", other ], "B0CZPF5L2V"), null);
	assert.equal(ame.findLdAlbum([ "{broken", "null", other, wanted ], "B0CZPF5L2V")["@id"], "https://music.amazon.co.jp/albums/B0CZPF5L2V");
});

test("parseLookupAlbum normalizes the lookup response", () => {
	const album = ame.parseLookupAlbum(lookupAlbum());

	assert.equal(album.globalAsin, "B0CZPF52BK");
	assert.equal(album.label, "Some Label");
	assert.equal(album.copyright, "(P) 2024 Some Label");
	assert.equal(album.date, "2024-04-10");

	const [ one, two, three ] = album.tracks;
	assert.deepEqual([ one.disc, one.number ], [ 1, 1 ]);
	assert.deepEqual([ three.disc, three.number ], [ 2, 1 ]); // trackNum arrives as a string.
	assert.equal(two.isrc, "JPPO01618586");
	assert.equal(two.artist, "Album Artist feat. Guest");
	assert.equal(two.trackDate, "2016-09-16");
	assert.equal(two.explicit, true);
	assert.equal(two.hasLyrics, false);
	assert.deepEqual(one.composers, [ "A", "B" ]);
	assert.deepEqual(three.composers, []);
});

test("parseLookupAlbum survives missing fields", () => {
	const album = ame.parseLookupAlbum({ asin: "B0CZPF5L2V", tracks: [ { asin: "B0CZPF1000" } ] });
	assert.equal(album.title, "");
	assert.equal(album.date, "");
	assert.equal(album.tracks[0].disc, 1);
	assert.equal(album.tracks[0].number, 1);
	assert.equal(album.tracks[0].seconds, null);
	assert.equal(album.tracks[0].hasLyrics, false);
});

test("buildAlbum prefers lookup data and fills per-track artists", () => {
	const album = sampleAlbum();
	assert.equal(album.title, "Lookup Title");
	assert.equal(album.url, "https://music.amazon.co.jp/albums/B0CZPF5L2V");
	assert.equal(album.image, "https://m.media-amazon.com/images/I/abc.jpg");
	assert.equal(album.copyright, "(P) 2024 Some Label");
	assert.equal(album.isComplete, true);
	assert.equal(album.tracks[1].artist, "Album Artist feat. Guest");
	assert.equal(album.tracks[1].isrc, "JPPO01618586");
});

test("buildAlbum falls back to the page when the lookup fails", () => {
	const album = ame.buildAlbum({ asin: "B0CZPF5L2V", origin: "https://x", ld: ldAlbum([ 1, 2 ]), lookup: null, header: { title: "T", artist: "A", image: "https://m.media-amazon.com/images/I/abc._SX320_.jpg" }, footer: "(C) F" });
	assert.equal(album.title, "Album Title");
	assert.equal(album.copyright, "(C) F");
	assert.equal(album.image, "https://m.media-amazon.com/images/I/abc.jpg");
	assert.equal(album.tracks.length, 2);
	assert.equal(album.isComplete, true);
});

test("buildAlbum uses only the header when nothing else has loaded, and flags missing tracks", () => {
	const empty = ame.buildAlbum({ asin: "B0CZPF5L2V", origin: "https://x", ld: null, lookup: null, header: { title: "T", artist: "A", image: "" }, footer: "" });
	assert.equal(empty.title, "T");
	assert.equal(empty.artist, "A");
	assert.equal(empty.isComplete, false);

	const partial = ame.buildAlbum({ asin: "B0CZPF5L2V", origin: "https://x", ld: ldAlbum([ 1, 2 ], { numTracks: 5 }), lookup: null, header: null, footer: "" });
	assert.equal(partial.isComplete, false);
	assert.equal(partial.trackCount, 5);
});

test("albumRows and toTsv produce one clean line per track", () => {
	const flac = { codec: "flac", channels: 2, bitDepth: 24, sampleRate: 96000, bandwidth: 2000000, trackType: "HD" };
	const atmos = { codec: "ec-3", channels: 6, bitDepth: null, sampleRate: 48000, bandwidth: 770151, trackType: "3D" };
	const formats = new Map([ [ "B0CZPF1000", [ flac, atmos ] ], [ "B0CZPF1001", [] ] ]);
	const rows = ame.albumRows(sampleAlbum(), formats);

	assert.equal(rows[0].format, "flac 2ch 24bit 96kHz 2000kbps HD");
	assert.equal(rows[0].spatial, "ec-3 6ch 48kHz 770kbps 3D");
	assert.equal(rows[1].format, "[unavailable]");
	assert.equal(rows[2].format, "");
	assert.equal(rows[0].lyrics, "Yes");
	assert.equal(rows[1].lyrics, "");
	assert.equal(rows[1].explicit, "E");
	assert.equal(rows[0].composer, "A, B");
	assert.equal(rows[0].label, "Some Label");
	assert.equal(rows[2].disc, 2);

	const tsv = ame.toTsv([ [ "asin", "ASIN" ], [ "title", "Title" ] ], [ { asin: "A", title: "One\tTwo\nThree" } ]);
	assert.equal(tsv, "ASIN\tTitle\nA\tOne Two Three");
});

test("the table has a column for every row field", () => {
	const row = ame.albumRows(sampleAlbum(), new Map())[0];
	assert.deepEqual(ame.COLUMNS.map(([ key ]) => key).sort(), Object.keys(row).sort());
});

test("coverSearchUrl cleans release suffixes", () => {
	const url = new URL(ame.coverSearchUrl({ artist: "米津玄師", title: "Song - EP" }));
	assert.equal(url.hostname, "covers.musichoarders.xyz");
	assert.equal(url.searchParams.get("artist"), "米津玄師");
	assert.equal(url.searchParams.get("album"), "Song");

	assert.equal(ame.cleanReleaseTitle("Song [Explicit]"), "Song");
	assert.equal(ame.cleanReleaseTitle("Song (Explicit)"), "Song");
	assert.equal(ame.cleanReleaseTitle("夜鷹 - Yodaka"), "夜鷹 - Yodaka");
});

test("magicIsrcUrl numbers tracks across discs and skips missing ISRCs", () => {
	const url = new URL(ame.magicIsrcUrl(sampleAlbum()));
	assert.equal(url.hostname, "magicisrc.kepstin.ca");
	assert.equal(url.searchParams.get("isrc1"), "JPU902400835");
	assert.equal(url.searchParams.get("isrc2"), "JPPO01618586");
	assert.equal(url.searchParams.has("isrc3"), false);
});

test("guessScript and guessLanguage", () => {
	assert.equal(ame.guessScript("STRAY SHEEP カムパネルラ"), "Jpan");
	assert.equal(ame.guessScript("STRAY SHEEP 感電"), "Jpan");
	assert.equal(ame.guessScript("케이팝 Song"), "Kore");
	assert.equal(ame.guessScript("Plain Title 123 - (Live)"), "Latn");
	assert.equal(ame.guessScript("Привет"), "");
	assert.equal(ame.guessScript("123"), "");
	assert.equal(ame.guessLanguage([ { language: "ja" }, { language: "ja" }, { language: "en" } ]), "jpn");
	assert.equal(ame.guessLanguage([ { language: "xx" } ]), "");
});

test("buildSeedFields seeds label, discs, per-track artists and the streaming link", () => {
	const fields = new Map(ame.buildSeedFields(sampleAlbum()));

	assert.equal(fields.get("name"), "Lookup Title");
	assert.equal(fields.get("artist_credit.names.0.name"), "Album Artist");
	assert.equal(fields.get("labels.0.name"), "Some Label");
	assert.equal(fields.get("status"), "official");
	assert.equal(fields.get("language"), "jpn");
	assert.equal(fields.get("events.0.date.year"), "2024");
	assert.equal(fields.get("events.0.date.month"), "4");
	assert.equal(fields.get("events.0.date.day"), "10");

	assert.equal(fields.get("mediums.0.format"), "Digital Media");
	assert.equal(fields.get("mediums.1.format"), "Digital Media");
	assert.equal(fields.get("mediums.0.track.1.name"), "Two");
	assert.equal(fields.get("mediums.0.track.1.number"), "2");
	assert.equal(fields.get("mediums.0.track.1.length"), "285000");
	assert.equal(fields.get("mediums.0.track.1.artist_credit.names.0.name"), "Album Artist feat. Guest");
	assert.equal(fields.has("mediums.0.track.0.artist_credit.names.0.name"), false);
	assert.equal(fields.get("mediums.1.track.0.name"), "Three");

	assert.equal(fields.get("urls.0.url"), "https://music.amazon.co.jp/albums/B0CZPF5L2V");
	assert.equal(fields.get("urls.0.link_type"), "980");
	assert.match(fields.get("edit_note"), /Ame \(Amazon Music\)/);
});

test("buildSeedFields leaves out what it doesn't know", () => {
	const fields = new Map(ame.buildSeedFields({ title: "T", artist: "", date: "", label: "", url: "https://x", tracks: [ { disc: 1, number: 1, title: "t", seconds: null, artist: "", language: "" } ] }));
	assert.equal(fields.has("artist_credit.names.0.name"), false);
	assert.equal(fields.has("labels.0.name"), false);
	assert.equal(fields.has("events.0.date.year"), false);
	assert.equal(fields.has("mediums.0.track.0.length"), false);
	assert.equal(fields.has("language"), false);
});

test("regionLinks covers only stores that serve the player", () => {
	const links = ame.regionLinks("B0CZPF5L2V", "music.amazon.co.jp");
	assert.equal(links.length, 12);
	assert.ok(!links.some(link => /\.(ae|sa|eg)$/.test(link.host)));
	assert.equal(links.filter(link => link.isCurrent).length, 1);

	const byHost = new Map(links.map(link => [ link.host, link ]));
	assert.deepEqual([ byHost.get("music.amazon.co.jp").territory, byHost.get("music.amazon.co.jp").apiRegion ], [ "JP", "FE" ]);
	assert.deepEqual([ byHost.get("music.amazon.com").territory, byHost.get("music.amazon.com").apiRegion ], [ "US", "NA" ]);
	assert.deepEqual([ byHost.get("music.amazon.co.uk").territory, byHost.get("music.amazon.co.uk").apiRegion ], [ "GB", "EU" ]);
	assert.deepEqual([ byHost.get("music.amazon.com.au").territory, byHost.get("music.amazon.com.au").apiRegion ], [ "AU", "FE" ]);
});

test("regionLinks point at the regional edition once it's known", () => {
	const results = new Map([
		[ "music.amazon.de", { status: "full", asin: "B0CZPDQ495", available: 26, expected: 26 } ],
		[ "music.amazon.fr", { status: "partial", asin: "B000000001", available: 20, expected: 26 } ],
		[ "music.amazon.es", { status: "missing" } ],
		[ "music.amazon.it", { status: "error" } ],
		[ "music.amazon.in", { status: "checking" } ]
	]);
	const links = new Map(ame.regionLinks("B0CZPF5L2V", "music.amazon.co.jp", results).map(link => [ link.host, link ]));

	assert.equal(links.get("music.amazon.de").url, "https://music.amazon.de/albums/B0CZPDQ495");
	assert.equal(links.get("music.amazon.de").text, "26 tracks");
	assert.equal(links.get("music.amazon.fr").text, "20 of 26 tracks");
	assert.equal(links.get("music.amazon.es").text, "Not listed");
	assert.equal(links.get("music.amazon.es").url, "https://music.amazon.es/albums/B0CZPF5L2V");
	assert.equal(links.get("music.amazon.it").text, "Check failed");
	assert.equal(links.get("music.amazon.in").text, "Checking");
	assert.equal(links.get("music.amazon.com").text, "");
});

test("classifyStoreLookup tells full, partial and missing apart", () => {
	const album = (asin, count) => ({ albumList: [ { asin, tracks: Array.from({ length: count }, () => ({})) } ] });

	assert.deepEqual(ame.classifyStoreLookup(album("B0CZPDQ495", 2), 2), { status: "full", asin: "B0CZPDQ495", available: 2, expected: 2 });
	assert.deepEqual(ame.classifyStoreLookup(album("B0CZPDQ495", 1), 2), { status: "partial", asin: "B0CZPDQ495", available: 1, expected: 2 });
	assert.equal(ame.classifyStoreLookup(album("B0CZPDQ495", 3), 2).status, "full"); // A regional edition with a bonus track.

	// What a store really returns for an album it doesn't list.
	assert.deepEqual(ame.classifyStoreLookup({ albumList: [] }, 2), { status: "missing" });
	assert.deepEqual(ame.classifyStoreLookup({}, 2), { status: "missing" });
	assert.deepEqual(ame.classifyStoreLookup(null, 2), { status: "missing" });
	assert.deepEqual(ame.classifyStoreLookup({ albumList: [ { asin: "A" } ] }, 2), { status: "partial", asin: "A", available: 0, expected: 2 });
});

test("buildLookupRequest asks for tracks and lyric flags", () => {
	const body = ame.buildLookupRequest(config, "B0CZPF5L2V");
	assert.deepEqual(body.asins, [ "B0CZPF5L2V" ]);
	assert.deepEqual(body.features, [ "expandTracklist", "hasLyrics" ]);
	assert.equal(body.requestedContent, "FULL_CATALOG");
	assert.equal(body.customerId, "customer-id");
	assert.equal(body.musicTerritory, "JP");
	assert.equal(ame.buildLookupRequest({ ...config, customerId: "" }, "x").customerId, "");
});

test("buildLookupRequest for another store leaves out the account", () => {
	const body = ame.buildLookupRequest(config, "B0CZPF5L2V", "DE", "");
	assert.equal(body.musicTerritory, "DE");
	assert.equal(body.customerId, "");
	assert.doesNotMatch(JSON.stringify(body), /customer-id/);

	// This scope comes back empty for stores you aren't signed in to.
	assert.notEqual(body.requestedContent, "MUSIC_SUBSCRIPTION");
});

test("buildManifestRequest batches tracks and asks only for manifests", () => {
	const body = ame.buildManifestRequest(config, [ "A", "B" ], "request-id");
	assert.deepEqual(body.contentIdList, [ { identifier: "A", identifierType: "ASIN" }, { identifier: "B", identifierType: "ASIN" } ]);
	assert.equal(body.clientMetadata.clientRequestId, "request-id");
	assert.equal(body.customerInfo.territoryId, "JP");
	assert.equal(body.licenseChallenge, undefined);
});

test("buildManifestRequest follows the account's real plan, as the player does", () => {
	assert.equal(ame.buildManifestRequest({ ...config, tier: "UNLIMITED_HD" }, [ "A" ], "r").tryAsinSubstitution, true);
	assert.equal(ame.buildManifestRequest({ ...config, tier: "UNLIMITED" }, [ "A" ], "r").tryAsinSubstitution, false);
	assert.equal(ame.buildManifestRequest({ ...config, tier: "PRIME" }, [ "A" ], "r").tryAsinSubstitution, false);
	assert.equal(ame.buildManifestRequest(config, [ "A" ], "r").tryAsinSubstitution, false);
});

test("matchRowsToTracks goes by position when every row is rendered, and by title when not", () => {
	const tracks = [ { asin: "A", title: "One" }, { asin: "B", title: "Two" }, { asin: "C", title: "One" } ];

	// Rows can be labelled differently from the lookup's titles, so position wins when the counts agree.
	assert.deepEqual(ame.matchRowsToTracks([ "x", "y", "z" ], tracks).map(track => track.asin), [ "A", "B", "C" ]);

	// A partly rendered list, including a repeated title.
	assert.deepEqual(ame.matchRowsToTracks([ "Two" ], tracks).map(track => track.asin), [ "B" ]);
	assert.deepEqual(ame.matchRowsToTracks([ "One", "One" ], tracks).map(track => track.asin), [ "A", "C" ]);
	assert.deepEqual(ame.matchRowsToTracks([ "Missing" ], tracks), [ null ]);
	assert.deepEqual(ame.matchRowsToTracks([], tracks), []);
});

test("buildAlbum prefers the page's cover, which can be larger than the lookup's", () => {
	const album = ame.buildAlbum({
		asin: "B0CZPF5L2V",
		origin: "https://x",
		ld: null,
		lookup: ame.parseLookupAlbum(lookupAlbum()),
		header: { title: "", artist: "", image: "https://m.media-amazon.com/images/I/51lrQspujWL._UR512,512_.jpg" },
		footer: ""
	});
	assert.equal(album.image, "https://m.media-amazon.com/images/I/51lrQspujWL.jpg");
});

test("buildLyricsRequest lists every track with its territory", () => {
	const body = ame.buildLyricsRequest(config, [ "A", "B" ]);
	assert.deepEqual(body.trackAsinsAndMarketplaceList, [ { asin: "A", musicTerritory: "JP" }, { asin: "B", musicTerritory: "JP" } ]);
});

test("formatLrcTime uses milliseconds", () => {
	assert.equal(ame.formatLrcTime(0), "00:00.00");
	assert.equal(ame.formatLrcTime(22461), "00:22.46");
	assert.equal(ame.formatLrcTime(266604), "04:26.60");
	assert.equal(ame.formatLrcTime(65250), "01:05.25");
});

test("lyricsToLrc writes timestamps, tags and notices", () => {
	const lrc = ame.lyricsToLrc({
		lines: [
			{ startTime: 0, endTime: 12500, text: "first made-up line" },
			{ startTime: 12500, endTime: 65250, text: "second made-up line" },
			{ startTime: 65250, endTime: 70000, text: "" }
		],
		writers: [ "Writer A", "Writer B" ],
		copyrightNotices: [ "Made-up notice" ]
	}, { title: "T", artist: "A", album: "L" });

	assert.equal(lrc, [
		"[ti:T]",
		"[ar:A]",
		"[al:L]",
		"[au:Writer A, Writer B]",
		"[00:00.00]first made-up line",
		"[00:12.50]second made-up line",
		"[01:05.25]",
		"",
		"Made-up notice",
		""
	].join("\n"));
});

test("lyricsToLrc leaves untimed lyrics bare", () => {
	const lrc = ame.lyricsToLrc({ lines: [ { startTime: 0, text: "one" }, { startTime: 0, text: "two" } ] });
	assert.equal(lrc, "one\ntwo\n");
	assert.equal(ame.lyricsToLrc({ lines: [ { text: "one" } ] }), "one\n");
	assert.equal(ame.lyricsToLrc({}), "\n");
});

test("lyricsFileName uses disc and track and strips unsafe characters", () => {
	assert.equal(ame.lyricsFileName({ disc: 2, number: 1, title: "What? A/B" }), "2-01. What_ A_B.lrc");
	assert.equal(ame.lyricsFileName({ disc: 1, number: 12, title: "x".repeat(200) }).length, "1-12. ".length + 120 + ".lrc".length);
});

test("sanitizeFileName removes characters filesystems reject", () => {
	assert.equal(ame.sanitizeFileName(' a/b\\c:d*e?f"g<h>i|j. '), "a_b_c_d_e_f_g_h_i_j_");
});

test("formats rank like the player labels them, with spatial kept apart", () => {
	// The formats of a real track on the site.
	const formats = [
		{ codec: "opus", channels: 2, bitDepth: null, sampleRate: 48000, bandwidth: 325351, trackType: "SD" },
		{ codec: "opus", channels: 2, bitDepth: null, sampleRate: 48000, bandwidth: 165165, trackType: "LD" },
		{ codec: "ec-3", channels: 6, bitDepth: null, sampleRate: 48000, bandwidth: 770151, trackType: "3D" },
		{ codec: "ac-4.02.02.00", channels: 2, bitDepth: null, sampleRate: 48000, bandwidth: 259984, trackType: "3D" },
		{ codec: "flac", channels: 2, bitDepth: 16, sampleRate: 44100, bandwidth: 1045291, trackType: "HD" }
	].sort(ame.compareFormats);

	assert.deepEqual(formats.map(ame.formatLabel), [
		"flac 2ch 16bit 44.1kHz 1045kbps HD",
		"opus 2ch 48kHz 325kbps SD",
		"opus 2ch 48kHz 165kbps LD",
		"ec-3 6ch 48kHz 770kbps 3D",
		"ac-4.02.02.00 2ch 48kHz 260kbps 3D"
	]);

	const { best, spatial } = ame.summarizeFormats(formats);
	assert.equal(best.codec, "flac");
	assert.equal(spatial.codec, "ec-3");
});

test("summarizeFormats handles tracks with nothing or only spatial", () => {
	assert.deepEqual(ame.summarizeFormats(undefined), { best: null, spatial: null });
	assert.deepEqual(ame.summarizeFormats([]), { best: null, spatial: null });
	const onlySpatial = { codec: "ec-3", trackType: "3D" };
	assert.deepEqual(ame.summarizeFormats([ onlySpatial ]), { best: null, spatial: onlySpatial });
});

test("rowFormatText stays short enough for a track row", () => {
	const flac = { codec: "flac", channels: 2, bitDepth: 24, sampleRate: 96000, bandwidth: 2863000, trackType: "HD" };
	const opus = { codec: "opus", channels: 2, bitDepth: null, sampleRate: 48000, bandwidth: 325000, trackType: "SD" };
	const atmos = { codec: "ec-3", channels: 6, bitDepth: null, sampleRate: 48000, bandwidth: 770000, trackType: "3D" };
	const ac4 = { codec: "ac-4.02.02.00", channels: 2, bitDepth: null, sampleRate: 48000, bandwidth: 260000, trackType: "3D" };

	assert.equal(ame.rowFormatText([ flac, atmos ]), "flac 24bit 96kHz + ec-3");
	assert.equal(ame.rowFormatText([ opus ]), "opus 48kHz");
	assert.equal(ame.rowFormatText([ opus, ac4 ]), "opus 48kHz + ac-4");
	assert.equal(ame.rowFormatText([]), "[unavailable]");
});

test("a track with only spatial formats isn't reported as unavailable", () => {
	const atmos = { codec: "ec-3", channels: 6, bitDepth: null, sampleRate: 48000, bandwidth: 770000, trackType: "3D" };
	const asin = sampleAlbum().tracks[0].asin;

	assert.equal(ame.rowFormatText([ atmos ]), "ec-3");

	const row = ame.albumRows(sampleAlbum(), new Map([ [ asin, [ atmos ] ] ]))[0];
	assert.equal(row.format, "");
	assert.equal(row.spatial, "ec-3 6ch 48kHz 770kbps 3D");
});

test("createZip lays out a well-formed archive", () => {
	const zip = ame.createZip([ { name: "1-01. 曲.lrc", data: "made-up" }, { name: "b.lrc", data: "" } ]);
	const bytes = Buffer.concat(zip.parts.map(part => Buffer.from(part)));

	assert.equal(bytes.readUInt32LE(0), 0x04034B50);
	const end = bytes.length - 22;
	assert.equal(bytes.readUInt32LE(end), 0x06054B50);
	assert.equal(bytes.readUInt16LE(end + 10), 2);

	const centralOffset = bytes.readUInt32LE(end + 16);
	assert.equal(bytes.readUInt32LE(centralOffset), 0x02014B50);
	assert.equal(centralOffset + bytes.readUInt32LE(end + 12), end);
});
