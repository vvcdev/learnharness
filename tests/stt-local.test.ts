/**
 * Unit tests — local dictation through Handy (owner, 2026-10-25:
 * src/server/stt-local.ts). The WAV header is what Handy's
 * --transcribe-file reads (16kHz mono linear16); engine selection is the
 * owner's auto rule (Handy if installed, else Deepgram if keyed, else none).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dictationEngine, pcmToWav, transcribeWithHandy } from "../src/server/stt-local.ts";

describe("pcmToWav — the header Handy reads", () => {
	it("wraps PCM in a 44-byte 16kHz mono 16-bit RIFF header", () => {
		const pcm = new Uint8Array([1, 2, 3, 4]);
		const wav = pcmToWav(pcm);
		const view = new DataView(wav.buffer);
		const ascii = (at: number, n: number) => String.fromCharCode(...wav.slice(at, at + n));
		assert.equal(wav.byteLength, 48);
		assert.equal(ascii(0, 4), "RIFF");
		assert.equal(view.getUint32(4, true), 40);
		assert.equal(ascii(8, 8), "WAVEfmt ");
		assert.equal(view.getUint16(20, true), 1); // PCM
		assert.equal(view.getUint16(22, true), 1); // mono
		assert.equal(view.getUint32(24, true), 16000);
		assert.equal(view.getUint32(28, true), 32000);
		assert.equal(view.getUint16(32, true), 2);
		assert.equal(view.getUint16(34, true), 16);
		assert.equal(ascii(36, 4), "data");
		assert.equal(view.getUint32(40, true), 4);
		assert.deepEqual([...wav.slice(44)], [1, 2, 3, 4]);
	});
});

describe("dictationEngine — the auto rule", () => {
	it("Handy wins whenever installed, key or not", () => {
		assert.equal(dictationEngine(true, true), "handy");
		assert.equal(dictationEngine(true, false), "handy");
	});

	it("Deepgram only without Handy and with a key; else none", () => {
		assert.equal(dictationEngine(false, true), "deepgram");
		assert.equal(dictationEngine(false, false), "none");
	});
});

describe("transcribeWithHandy — guards", () => {
	it("a missing binary is a 503, never a spawn", async () => {
		const r = await transcribeWithHandy(new Uint8Array(2), "/nonexistent/handy");
		assert.deepEqual(r, { ok: false, status: 503, message: "Handy is not installed" });
	});
});
