/** Minimal typings for the yauzl calls src/server/source-scope.ts makes. */
declare module "yauzl" {
	import type { Readable } from "node:stream";
	export interface Entry {
		fileName: string;
	}
	export interface ZipFile {
		readEntry(): void;
		openReadStream(entry: Entry, cb: (err: Error | null, stream: Readable) => void): void;
		close(): void;
		on(event: "entry", cb: (entry: Entry) => void): this;
		on(event: "end", cb: () => void): this;
		on(event: "error", cb: (err: Error) => void): this;
	}
	export function fromBuffer(buffer: Buffer, options: { lazyEntries: boolean }, cb: (err: Error | null, zip: ZipFile) => void): void;
}
