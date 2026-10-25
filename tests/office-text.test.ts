import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { extractOfficeText, isOfficeSourceExtension } from "../src/agent/tools/office-text.ts";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "office", "hello.docx");

describe("office text extraction", () => {
	it("recognizes Office extensions", () => {
		assert.equal(isOfficeSourceExtension(".docx"), true);
		assert.equal(isOfficeSourceExtension(".PPTX"), true);
		assert.equal(isOfficeSourceExtension(".pdf"), false);
	});

	it("extracts text from a Word document", async () => {
		const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
		const text = await extractOfficeText(bytes, "hello.docx");
		assert.match(text, /Hello from Word fixture/);
	});
});
