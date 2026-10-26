/**
 * Local dictation through Handy (owner, 2026-10-25): the desktop's
 * installed Handy app (handy.computer) ships a headless batch path —
 * `handy --transcribe-file <wav> --json` — that runs the SAME model the
 * user already downloaded and selected in Handy (no --model flag: the app
 * follows Handy's own choice). Audio stays on the machine.
 *
 * Engine selection is automatic (owner): Handy whenever its binary exists,
 * else Deepgram when its key is set, else none.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { keyValue } from "./keys.ts";

export const HANDY_BIN = "/Applications/Handy.app/Contents/MacOS/handy";

/** The rate the pcm-capture worklet produces (linear16 mono). */
const SAMPLE_RATE = 16000;

/** Model load + transcription; generous so a long dictation still lands. */
const HANDY_TIMEOUT_MS = 120_000;

export type DictationEngine = "handy" | "deepgram" | "none";

export function handyInstalled(bin = HANDY_BIN): boolean {
	return fs.existsSync(bin);
}

export function dictationEngine(
	hasHandy: boolean = handyInstalled(),
	hasDeepgramKey: boolean = Boolean(keyValue("DEEPGRAM_API_KEY")),
): DictationEngine {
	if (hasHandy) return "handy";
	if (hasDeepgramKey) return "deepgram";
	return "none";
}

/** Wrap raw linear16 mono PCM in a 44-byte RIFF/WAVE header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
	const wav = new Uint8Array(44 + pcm.byteLength);
	const view = new DataView(wav.buffer);
	const ascii = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) wav[at + i] = s.charCodeAt(i);
	};
	ascii(0, "RIFF");
	view.setUint32(4, 36 + pcm.byteLength, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	view.setUint32(16, 16, true); // fmt chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	ascii(36, "data");
	view.setUint32(40, pcm.byteLength, true);
	wav.set(pcm, 44);
	return wav;
}

export type HandyTranscribeResult =
	| { ok: true; text: string }
	| { ok: false; status: number; message: string };

/** Transcribe one dictation run's PCM with Handy's selected model. */
export async function transcribeWithHandy(pcm: Uint8Array, bin = HANDY_BIN): Promise<HandyTranscribeResult> {
	if (!handyInstalled(bin)) return { ok: false, status: 503, message: "Handy is not installed" };
	if (pcm.byteLength === 0) return { ok: true, text: "" };

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-dictation-"));
	const file = path.join(dir, "run.wav");
	try {
		fs.writeFileSync(file, pcmToWav(pcm));
		// stdout carries ONLY the JSON line; Handy's logs go to stderr.
		const stdout = await new Promise<string>((resolve, reject) => {
			execFile(
				bin,
				["--transcribe-file", file, "--json"],
				{ timeout: HANDY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
				(err, out) => (err ? reject(err) : resolve(out)),
			);
		});
		const data = JSON.parse(stdout.trim()) as { text?: unknown };
		return { ok: true, text: typeof data.text === "string" ? data.text.trim() : "" };
	} catch {
		return { ok: false, status: 502, message: "Handy transcription failed" };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
