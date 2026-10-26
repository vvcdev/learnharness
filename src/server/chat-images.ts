import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import {
	imageExtension,
	isImageId,
	isImageMimeType,
	MAX_IMAGE_BYTES,
	MAX_IMAGES_PER_SEND,
	type ImageMimeType,
	type ImageRef,
} from "../core/images.ts";

/**
 * THE CHAT IMAGE STORE (show-your-work images, owner 2026-10-26): the
 * bytes of every image the learner attaches live in
 * data/chat-images/<chatId>/<img id>; the record holds refs only. Saved
 * at attach time (the composer uploads as soon as an image is picked),
 * read at the wire (loadChatImage, the agent's convertToLlm) and by the
 * thumbnail route, removed with the session.
 */

const CHAT_ID = /^[A-Za-z0-9_-]+$/;

function chatImagesDir(chatId: string, root = PATHS.data): string {
	if (!CHAT_ID.test(chatId)) throw new Error("Invalid chat id");
	return path.join(root, "chat-images", chatId);
}

function mintImageId(mime: ImageMimeType): string {
	return `img_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}${imageExtension(mime)}`;
}

export interface IncomingImage {
	name: string;
	mimeType: string;
	bytes: Uint8Array;
}

export type SaveImagesResult = { ok: true; images: ImageRef[] } | { ok: false; status: number; error: string };

/** Validate and write a batch of images for one chat. All-or-nothing:
 *  any bad file refuses the batch before anything is written. */
export function saveChatImages(chatId: string, files: readonly IncomingImage[], root = PATHS.data): SaveImagesResult {
	if (files.length === 0) return { ok: false, status: 400, error: "Choose an image to attach." };
	if (files.length > MAX_IMAGES_PER_SEND) {
		return { ok: false, status: 400, error: `Attach up to ${MAX_IMAGES_PER_SEND} images at a time.` };
	}
	for (const file of files) {
		if (!isImageMimeType(file.mimeType)) return { ok: false, status: 400, error: "Attach a PNG, JPEG, WebP, or GIF image." };
		if (file.bytes.byteLength === 0) return { ok: false, status: 400, error: "That image is empty." };
		if (file.bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, status: 400, error: "Each image must be 10 MB or smaller." };
	}
	const dir = chatImagesDir(chatId, root);
	fs.mkdirSync(dir, { recursive: true });
	const images: ImageRef[] = [];
	for (const file of files) {
		const mimeType = file.mimeType as ImageMimeType;
		const id = mintImageId(mimeType);
		fs.writeFileSync(path.join(dir, id), file.bytes);
		const name = (file.name.split(/[/\\]/).pop() ?? "").slice(0, 200);
		images.push({ id, mimeType, ...(name ? { name } : {}) });
	}
	return { ok: true, images };
}

/** One stored image's bytes, or null (bad id, missing file). */
export function readChatImage(chatId: string, imageId: string, root = PATHS.data): Uint8Array | null {
	if (!isImageId(imageId) || !CHAT_ID.test(chatId)) return null;
	try {
		return new Uint8Array(fs.readFileSync(path.join(chatImagesDir(chatId, root), imageId)));
	} catch {
		return null;
	}
}

/** The wire loader (toLlmMessages' loadImage): base64 + the ref's type. */
export function chatImageLoader(chatId: string, root = PATHS.data): (ref: ImageRef) => { data: string; mimeType: string } | null {
	return (ref) => {
		const bytes = readChatImage(chatId, ref.id, root);
		return bytes ? { data: Buffer.from(bytes).toString("base64"), mimeType: ref.mimeType } : null;
	};
}

/** The mime type a stored id was saved as (from its extension). */
export function chatImageMimeType(imageId: string): ImageMimeType | null {
	if (!isImageId(imageId)) return null;
	const ext = imageId.slice(imageId.lastIndexOf("."));
	return ext === ".jpg" ? "image/jpeg" : (`image/${ext.slice(1)}` as ImageMimeType);
}

/** Remove every image of a deleted session. */
export function removeChatImages(chatId: string, root = PATHS.data): void {
	if (!CHAT_ID.test(chatId)) return;
	fs.rmSync(chatImagesDir(chatId, root), { recursive: true, force: true });
}
