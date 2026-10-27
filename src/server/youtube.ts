import type { IncomingSource } from "./session-sources.ts";

/**
 * YouTube videos as sources: fetch the caption track, write it as a
 * markdown transcript with timestamped sections, and hand it to the normal
 * upload pipeline as an ordinary `.md` file. Captions only — no audio
 * transcription. Uses YouTube's keyless player endpoint, which is
 * unofficial: every failure surfaces as a readable error, never a
 * half-transcript.
 */

export class YoutubeError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.name = "YoutubeError";
		this.status = status;
	}
}

const ID = /^[A-Za-z0-9_-]{11}$/;
const SECTION_SECONDS = 300;
const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en" };
const USER_AGENT = "com.google.android.youtube/20.10.38 (Linux; U; Android 14)";

/** The video id in a YouTube link (watch, youtu.be, shorts, live, embed), or null. */
export function parseYoutubeId(input: string): string | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
	let id: string | null = null;
	if (host === "youtu.be") id = url.pathname.split("/")[1] ?? null;
	else if (host === "youtube.com" || host === "youtube-nocookie.com") {
		if (url.pathname === "/watch") id = url.searchParams.get("v");
		else {
			const m = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/]+)/);
			id = m?.[1] ?? null;
		}
	}
	return id && ID.test(id) ? id : null;
}

export interface CaptionTrack {
	baseUrl: string;
	languageCode: string;
	/** "asr" = auto-generated. */
	kind?: string;
}

/** Human-written English, then auto English, then the first track. */
export function pickCaptionTrack(tracks: readonly CaptionTrack[]): CaptionTrack | null {
	const english = (t: CaptionTrack) => t.languageCode.toLowerCase().startsWith("en");
	return (
		tracks.find((t) => english(t) && t.kind !== "asr") ??
		tracks.find((t) => english(t)) ??
		tracks.find((t) => t.kind !== "asr") ??
		tracks[0] ??
		null
	);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
		if (body[0] === "#") {
			const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[body.toLowerCase()] ?? whole;
	});
}

export interface CaptionLine {
	startSeconds: number;
	text: string;
}

/** Parse YouTube's timedtext XML (`<p t=ms>` or classic `<text start=s>`). */
export function parseCaptionXml(xml: string): CaptionLine[] {
	const lines: CaptionLine[] = [];
	const re = /<(p|text)\b([^>]*)>([\s\S]*?)<\/\1>/g;
	for (const m of xml.matchAll(re)) {
		const attrs = m[2] ?? "";
		const t = attrs.match(/\bt="(\d+)"/);
		const start = attrs.match(/\bstart="([\d.]+)"/);
		const startSeconds = t ? Number(t[1]) / 1000 : start ? Number(start[1]) : NaN;
		if (!Number.isFinite(startSeconds)) continue;
		const text = decodeEntities((m[3] ?? "").replace(/<[^>]+>/g, ""))
			.replace(/\s+/g, " ")
			.trim();
		if (text) lines.push({ startSeconds, text });
	}
	return lines;
}

export function formatTimestamp(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export interface TranscriptMeta {
	id: string;
	title: string;
	channel: string;
	language: string;
	auto: boolean;
}

/** The markdown source: header, then a `## start–end` section per ~5 minutes. */
export function transcriptMarkdown(meta: TranscriptMeta, lines: readonly CaptionLine[]): string {
	const sections = new Map<number, string[]>();
	for (const line of lines) {
		const index = Math.floor(line.startSeconds / SECTION_SECONDS);
		const bucket = sections.get(index);
		if (bucket) bucket.push(line.text);
		else sections.set(index, [line.text]);
	}
	const lastBucket = Math.max(...sections.keys());
	const out = [
		`# ${meta.title}`,
		"",
		`- Source: YouTube video transcript (captions only — no visuals)`,
		`- URL: https://www.youtube.com/watch?v=${meta.id}`,
		...(meta.channel ? [`- Channel: ${meta.channel}`] : []),
		`- Captions: ${meta.language}${meta.auto ? " (auto-generated, may contain errors)" : ""}`,
		"",
	];
	for (const index of [...sections.keys()].sort((a, b) => a - b)) {
		const from = index * SECTION_SECONDS;
		const end = index === lastBucket ? "end" : formatTimestamp(from + SECTION_SECONDS);
		out.push(`## ${formatTimestamp(from)}–${end}`, "", sections.get(index)!.join(" "), "");
	}
	return out.join("\n");
}

function fileStem(title: string): string {
	return title.replace(/['’]/g, "").replace(/[^\w.\- ()]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "video";
}

type Fetcher = typeof fetch;

/** Fetch a video's transcript as an uploadable `.md` source. */
export async function fetchYoutubeSource(input: string, fetcher: Fetcher = fetch): Promise<IncomingSource> {
	const id = parseYoutubeId(input);
	if (!id) throw new YoutubeError("That doesn't look like a YouTube video link.");
	let player: {
		playabilityStatus?: { status?: string; reason?: string };
		videoDetails?: { title?: string; author?: string };
		captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
	};
	try {
		const response = await fetcher(PLAYER_URL, {
			method: "POST",
			headers: { "content-type": "application/json", "user-agent": USER_AGENT },
			body: JSON.stringify({ context: { client: CLIENT }, videoId: id }),
			signal: AbortSignal.timeout(20_000),
		});
		if (!response.ok) throw new YoutubeError(`YouTube refused the request (${response.status}). Try again later.`, 502);
		player = await response.json();
	} catch (error) {
		if (error instanceof YoutubeError) throw error;
		throw new YoutubeError("Could not reach YouTube. Check the connection and try again.", 502);
	}
	const status = player.playabilityStatus?.status;
	if (status && status !== "OK") {
		throw new YoutubeError(`That video can't be read: ${player.playabilityStatus?.reason ?? status}.`, 422);
	}
	const track = pickCaptionTrack(player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
	if (!track) throw new YoutubeError("That video has no captions, so there is no transcript to read.", 422);
	let xml: string;
	try {
		const response = await fetcher(track.baseUrl, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
		if (!response.ok) throw new YoutubeError(`Could not download the captions (${response.status}).`, 502);
		xml = await response.text();
	} catch (error) {
		if (error instanceof YoutubeError) throw error;
		throw new YoutubeError("Could not download the captions. Try again.", 502);
	}
	const lines = parseCaptionXml(xml);
	if (lines.length === 0) throw new YoutubeError("The captions for that video were empty.", 422);
	const title = player.videoDetails?.title?.trim() || `YouTube ${id}`;
	const markdown = transcriptMarkdown(
		{ id, title, channel: player.videoDetails?.author?.trim() ?? "", language: track.languageCode, auto: track.kind === "asr" },
		lines,
	);
	return { name: `${fileStem(title)} (YouTube).md`, bytes: new TextEncoder().encode(markdown) };
}
