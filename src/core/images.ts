/**
 * LEARNER IMAGES (show-your-work images, owner 2026-10-26): photos and
 * screenshots of the learner's work, attached to a chat message, a
 * practice thinking submission, or a quiz answer's thinking. The record
 * holds REFS only — the bytes live beside the chat (server/chat-images.ts)
 * and are loaded into the model's view at the wire (toLlmMessages'
 * loadImage option). Pure, browser-safe.
 *
 * LIFETIME (owner ruling): in practice, an image stays visible to the
 * model until the problem (or MCQ) it rode is concluded — after that the
 * wire carries a short placeholder instead. In teaching chat it stays for
 * the whole session (compaction summarizes it away like everything else).
 */

/** One stored image, as the record references it. */
export interface ImageRef {
	/** The stored file name inside the chat's image folder. */
	id: string;
	mimeType: ImageMimeType;
	/** The learner's original file name (display only). */
	name?: string;
}

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** Max images per send (owner ruling). */
export const MAX_IMAGES_PER_SEND = 10;
/** The client downscales to this long edge before upload (owner ruling). */
export const IMAGE_MAX_EDGE = 2000;
/** Per-image upload cap after downscaling. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_ID = /^img_[A-Za-z0-9]+_[A-Za-z0-9]+\.(png|jpg|webp|gif)$/;

export function isImageId(id: unknown): id is string {
	return typeof id === "string" && IMAGE_ID.test(id);
}

export function isImageMimeType(mime: unknown): mime is ImageMimeType {
	return typeof mime === "string" && (IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

/** The file extension a stored image of this type gets. */
export function imageExtension(mime: ImageMimeType): string {
	return mime === "image/jpeg" ? ".jpg" : `.${mime.slice("image/".length)}`;
}

/** Validate an input's image list: well-formed refs only, capped. Absent,
 *  empty, or malformed → undefined (never a 400 — a bad ref just drops). */
export function parseImageRefs(value: unknown): ImageRef[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const refs: ImageRef[] = [];
	for (const v of value) {
		if (typeof v !== "object" || v === null) continue;
		const { id, mimeType, name } = v as Record<string, unknown>;
		if (!isImageId(id) || !isImageMimeType(mimeType)) continue;
		refs.push({ id, mimeType, ...(typeof name === "string" && name ? { name: name.slice(0, 200) } : {}) });
		if (refs.length === MAX_IMAGES_PER_SEND) break;
	}
	return refs.length > 0 ? refs : undefined;
}

/** The wire's stand-in for an image the model no longer sees (expired,
 *  missing on disk, or no loader — token estimates, tests). */
export function imagePlaceholder(ref: ImageRef, reason: "expired" | "missing"): string {
	const label = ref.name ? `image "${ref.name}"` : "image";
	return reason === "expired"
		? `[${label}: removed after the problem concluded]`
		: `[${label}: not available]`;
}

/** The section label the model reads ahead of attached images. */
export const IMAGES_LABEL = "Attached images of the learner's work";
