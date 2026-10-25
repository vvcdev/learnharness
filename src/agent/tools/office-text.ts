import { parseOfficeAsync } from "officeparser";

/** Office Open XML + OpenDocument extensions the teacher can extract text from. */
export const OFFICE_SOURCE_EXTENSIONS = [
	".docx",
	".pptx",
	".xlsx",
	".odt",
	".odp",
	".ods",
] as const;

const OFFICE = new Set<string>(OFFICE_SOURCE_EXTENSIONS);

export function isOfficeSourceExtension(ext: string): boolean {
	return OFFICE.has(ext.toLowerCase());
}

/** Pull plain text out of a Word / PowerPoint / Excel / OpenDocument file. */
export async function extractOfficeText(bytes: Uint8Array, fileName: string): Promise<string> {
	const text = await parseOfficeAsync(Buffer.from(bytes), {
		newlineDelimiter: "\n",
		ignoreNotes: false,
		outputErrorToConsole: false,
	});
	const trimmed = (text ?? "").trim();
	if (!trimmed) throw new Error(`No readable text in ${fileName}.`);
	return trimmed;
}
