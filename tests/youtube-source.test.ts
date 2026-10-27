/**
 * YouTube videos as sources (2026-10-26): link parsing, caption-track
 * choice, caption XML → timestamped markdown, and the fetch flow with a
 * mocked network — the result is an ordinary `.md` upload.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	fetchYoutubeSource,
	formatTimestamp,
	parseCaptionXml,
	parseYoutubeId,
	pickCaptionTrack,
	transcriptMarkdown,
	YoutubeError,
} from "../src/server/youtube.ts";
import { scopeKindFor } from "../src/core/source-scope.ts";
import { lessonSourceError } from "../src/core/lesson-sources.ts";

const ID = "GCKc1LX6swg";

describe("parseYoutubeId", () => {
	it("reads watch, short, shorts, live, and embed links", () => {
		for (const url of [
			`https://www.youtube.com/watch?v=${ID}&t=30s`,
			`https://youtu.be/${ID}?si=x`,
			`https://m.youtube.com/watch?v=${ID}`,
			`https://www.youtube.com/shorts/${ID}`,
			`https://www.youtube.com/live/${ID}`,
			`https://www.youtube.com/embed/${ID}`,
		]) assert.equal(parseYoutubeId(url), ID, url);
	});
	it("rejects other sites, bad ids, and non-urls", () => {
		for (const url of ["https://example.com/watch?v=" + ID, "https://www.youtube.com/watch?v=short", "not a url", "javascript:alert(1)", "https://youtube.com/"]) {
			assert.equal(parseYoutubeId(url), null, url);
		}
	});
});

describe("captions", () => {
	it("prefers human English, then auto English, then a human other, then anything", () => {
		const t = (languageCode: string, kind?: string) => ({ baseUrl: `u-${languageCode}-${kind ?? "h"}`, languageCode, kind });
		assert.equal(pickCaptionTrack([t("en", "asr"), t("de"), t("en")])?.baseUrl, "u-en-h");
		assert.equal(pickCaptionTrack([t("de"), t("en", "asr")])?.baseUrl, "u-en-asr");
		assert.equal(pickCaptionTrack([t("de", "asr"), t("fr")])?.baseUrl, "u-fr-h");
		assert.equal(pickCaptionTrack([t("de", "asr")])?.baseUrl, "u-de-asr");
		assert.equal(pickCaptionTrack([]), null);
	});
	it("parses both timedtext shapes and decodes entities", () => {
		const v3 = '<timedtext format="3"><body><p t="1200" d="2000">It&#39;s a &amp; b\nline</p><p t="5000"><s>no</s> <s>tags</s></p></body></timedtext>';
		assert.deepEqual(parseCaptionXml(v3), [
			{ startSeconds: 1.2, text: "It's a & b line" },
			{ startSeconds: 5, text: "no tags" },
		]);
		assert.deepEqual(parseCaptionXml('<transcript><text start="3.5" dur="1">hi &quot;you&quot;</text></transcript>'), [{ startSeconds: 3.5, text: 'hi "you"' }]);
	});
	it("formats timestamps", () => {
		assert.equal(formatTimestamp(0), "0:00");
		assert.equal(formatTimestamp(65), "1:05");
		assert.equal(formatTimestamp(3725), "1:02:05");
	});
});

describe("transcriptMarkdown", () => {
	it("writes a header and one heading per five minutes, last open-ended", () => {
		const md = transcriptMarkdown(
			{ id: ID, title: "Sleep", channel: "A Better Mind", language: "en", auto: true },
			[
				{ startSeconds: 0, text: "one" },
				{ startSeconds: 10, text: "two" },
				{ startSeconds: 310, text: "three" },
			],
		);
		assert.match(md, /^# Sleep\n/);
		assert.match(md, /URL: https:\/\/www\.youtube\.com\/watch\?v=GCKc1LX6swg/);
		assert.match(md, /Captions: en \(auto-generated/);
		assert.match(md, /## 0:00–5:00\n\none two\n/);
		assert.match(md, /## 5:00–end\n\nthree\n/);
	});
});

describe("fetchYoutubeSource", () => {
	const xml = '<timedtext><body><p t="0">hello</p><p t="2000">world</p></body></timedtext>';
	function fakeFetch(player: unknown, captions = xml, captionStatus = 200): typeof fetch {
		return (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/youtubei/v1/player")) return Response.json(player);
			return new Response(captions, { status: captionStatus });
		}) as typeof fetch;
	}
	const playable = {
		playabilityStatus: { status: "OK" },
		videoDetails: { title: "You Don't Need 8 Hours", author: "A Better Mind" },
		captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "https://yt.test/c", languageCode: "en" }] } },
	};

	it("returns an ordinary scopable .md source", async () => {
		const source = await fetchYoutubeSource(`https://youtu.be/${ID}`, fakeFetch(playable));
		assert.equal(source.name, "You Dont Need 8 Hours (YouTube).md");
		assert.equal(scopeKindFor(source.name), "sections");
		assert.equal(lessonSourceError(source.name, source.bytes.byteLength, 0), null);
		assert.match(new TextDecoder().decode(source.bytes), /hello world/);
	});
	it("gives readable errors", async () => {
		await assert.rejects(fetchYoutubeSource("https://example.com", fakeFetch(playable)), /doesn't look like a YouTube/);
		await assert.rejects(
			fetchYoutubeSource(`https://youtu.be/${ID}`, fakeFetch({ ...playable, captions: undefined })),
			(e: unknown) => e instanceof YoutubeError && /no captions/.test(e.message) && e.status === 422,
		);
		await assert.rejects(
			fetchYoutubeSource(`https://youtu.be/${ID}`, fakeFetch({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm your age" } })),
			/Sign in to confirm your age/,
		);
		await assert.rejects(fetchYoutubeSource(`https://youtu.be/${ID}`, fakeFetch(playable, "<timedtext></timedtext>")), /empty/);
		await assert.rejects(fetchYoutubeSource(`https://youtu.be/${ID}`, (async () => { throw new Error("offline"); }) as typeof fetch), /Could not reach YouTube/);
	});
});
