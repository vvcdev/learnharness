"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ImageIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { IMAGE_MAX_EDGE, MAX_IMAGE_BYTES, MAX_IMAGES_PER_SEND, type ImageRef } from "@/src/core";

/**
 * SHOW-YOUR-WORK IMAGES (owner 2026-10-26): photos and screenshots of the
 * learner's work on every thinking surface — the practice dock, quiz
 * "Your thinking", and the chat composer (through the paperclip). Three
 * ways in: the image button, ⌘V paste, drag-and-drop. Each image is
 * downscaled in the browser (long edge ≤ IMAGE_MAX_EDGE) and uploaded at
 * once; the send carries the refs. A model that cannot read images
 * greys the button out and paste/drop answer with a short notice.
 */

/** The session's image capability, provided by the chat page. */
export interface ImageInput {
	chatId: string | null;
	/** The session's model reads images. */
	enabled: boolean;
}

export const ImageInputContext = createContext<ImageInput>({ chatId: null, enabled: false });

export function useImageInput(): ImageInput {
	return useContext(ImageInputContext);
}

export const NO_VISION_NOTICE = "This model can't read images — pick a vision model to attach your work.";

/** The thumbnail/lightbox URL of a stored image. */
export function imageUrl(chatId: string, ref: ImageRef): string {
	return `/api/chats/${encodeURIComponent(chatId)}/images/${encodeURIComponent(ref.id)}`;
}

/** Is this File an image we try to attach (vs a lesson source)? */
export function isImageFile(file: File): boolean {
	return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(file.name);
}

/** Shrink to the long-edge cap and normalize the format: PNG stays PNG
 *  (screenshots keep crisp text), everything else becomes JPEG. A small
 *  image already in a supported format passes through untouched. */
export async function downscaleImage(file: File): Promise<File> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new Error(`Couldn't read ${file.name || "that image"} — try a PNG or JPEG.`);
	}
	const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	const supported = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
	if (scale === 1 && supported && file.size <= MAX_IMAGE_BYTES) {
		bitmap.close();
		return file;
	}
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Couldn't prepare the image.");
	const type = file.type === "image/png" ? "image/png" : "image/jpeg";
	if (type === "image/jpeg") {
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
	ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
	if (!blob) throw new Error("Couldn't prepare the image.");
	const stem = (file.name || "image").replace(/\.[^.]+$/, "");
	return new File([blob], `${stem}${type === "image/png" ? ".png" : ".jpg"}`, { type });
}

/** One image in a draft: uploading (no ref yet), ready, or failed. */
export interface DraftImage {
	key: string;
	name: string;
	preview: string;
	ref?: ImageRef;
}

/** A thinking surface's pending images — state + a ref mirror (the
 *  "nothing gets lost" law, like the voice notes). */
export function useImageDraft(input?: ImageInput) {
	// The chat page owns the provider, so its own composer draft passes
	// the capability in directly; every other surface reads the context.
	const context = useImageInput();
	const { chatId, enabled } = input ?? context;
	const [images, setImages] = useState<DraftImage[]>([]);
	const ref = useRef<DraftImage[]>([]);
	const [error, setError] = useState<string | null>(null);
	const set = useCallback((next: DraftImage[]) => {
		ref.current = next;
		setImages(next);
	}, []);

	const add = useCallback(
		async (files: readonly File[]) => {
			const picked = files.filter(isImageFile);
			if (picked.length === 0) return;
			if (!enabled || !chatId) {
				setError(NO_VISION_NOTICE);
				return;
			}
			const room = MAX_IMAGES_PER_SEND - ref.current.length;
			if (room <= 0) {
				setError(`Attach up to ${MAX_IMAGES_PER_SEND} images at a time.`);
				return;
			}
			setError(picked.length > room ? `Attach up to ${MAX_IMAGES_PER_SEND} images at a time.` : null);
			let prepared: File[];
			try {
				prepared = await Promise.all(picked.slice(0, room).map(downscaleImage));
			} catch (err) {
				setError(err instanceof Error ? err.message : "Couldn't prepare the image.");
				return;
			}
			const pending = prepared.map((file) => ({
				key: crypto.randomUUID(),
				name: file.name,
				preview: URL.createObjectURL(file),
			}));
			set([...ref.current, ...pending]);
			const body = new FormData();
			for (const file of prepared) body.append("file", file);
			const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/images`, { method: "POST", body }).catch(() => null);
			const payload = (await response?.json().catch(() => ({}))) as { images?: ImageRef[]; error?: string } | undefined;
			const keys = new Set(pending.map((p) => p.key));
			if (!response?.ok || !payload?.images || payload.images.length !== pending.length) {
				for (const p of pending) URL.revokeObjectURL(p.preview);
				set(ref.current.filter((d) => !keys.has(d.key)));
				setError(payload?.error || "Couldn't upload the image.");
				return;
			}
			const byKey = new Map(pending.map((p, i) => [p.key, payload.images![i]!]));
			set(ref.current.map((d) => (byKey.has(d.key) ? { ...d, ref: byKey.get(d.key) } : d)));
		},
		[chatId, enabled, set],
	);

	const remove = useCallback(
		(key: string) => {
			const gone = ref.current.find((d) => d.key === key);
			if (gone) URL.revokeObjectURL(gone.preview);
			set(ref.current.filter((d) => d.key !== key));
			setError(null);
		},
		[set],
	);

	const clear = useCallback(() => {
		for (const d of ref.current) URL.revokeObjectURL(d.preview);
		set([]);
		setError(null);
	}, [set]);

	/** The uploaded refs for the send (still-uploading images are skipped
	 *  — `uploading` gates the send buttons so that never happens). */
	const refs = useCallback((): ImageRef[] | undefined => {
		const out = ref.current.flatMap((d) => (d.ref ? [d.ref] : []));
		return out.length > 0 ? out : undefined;
	}, []);

	return {
		images,
		error,
		enabled,
		uploading: images.some((d) => !d.ref),
		add,
		remove,
		clear,
		refs,
		ref,
	};
}

export type ImageDraft = ReturnType<typeof useImageDraft>;

/** Paste + drag-and-drop handlers for a thinking surface's container.
 *  Only image files are claimed — pasted text and other drops fall
 *  through to their native behavior. */
export function imageDropHandlers(draft: ImageDraft) {
	const files = (list: DataTransfer | null) => Array.from(list?.files ?? []).filter(isImageFile);
	return {
		onPaste: (e: React.ClipboardEvent) => {
			const picked = files(e.clipboardData);
			if (picked.length === 0) return;
			e.preventDefault();
			void draft.add(picked);
		},
		onDragOver: (e: React.DragEvent) => {
			if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) e.preventDefault();
		},
		onDrop: (e: React.DragEvent) => {
			const picked = files(e.dataTransfer);
			if (picked.length === 0) return;
			e.preventDefault();
			void draft.add(picked);
		},
	};
}

/** The image button + hidden picker (practice dock, quiz thinking). */
export function ImageAttachButton({ draft, className }: { draft: ImageDraft; className?: string }) {
	const inputRef = useRef<HTMLInputElement>(null);
	const full = draft.images.length >= MAX_IMAGES_PER_SEND;
	return (
		<>
			<Hint label={draft.enabled ? "Attach images of your work" : NO_VISION_NOTICE}>
				<button
					type="button"
					data-testid="attach-images"
					aria-label="Attach images"
					aria-disabled={!draft.enabled || full}
					onClick={() => {
						if (draft.enabled && !full) inputRef.current?.click();
					}}
					className={cn(
						"flex size-9 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground transition-colors",
						draft.enabled && !full ? "hover:bg-accent hover:text-foreground" : "cursor-not-allowed opacity-40",
						className,
					)}
				>
					<ImageIcon className="size-4" />
				</button>
			</Hint>
			<input
				ref={inputRef}
				type="file"
				multiple
				accept="image/*"
				className="sr-only"
				tabIndex={-1}
				onChange={(event) => {
					const list = Array.from(event.target.files ?? []);
					event.target.value = "";
					void draft.add(list);
				}}
			/>
		</>
	);
}

/** The draft's thumbnails (× removes) and its one-line error. */
export function ImageDraftStrip({ draft, className }: { draft: ImageDraft; className?: string }) {
	if (draft.images.length === 0 && !draft.error) return null;
	return (
		<div data-testid="image-draft" className={cn("flex flex-col gap-1", className)}>
			{draft.images.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{draft.images.map((d) => (
						<div key={d.key} className="relative size-14 overflow-hidden rounded-[6px] border border-border bg-background">
							{/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
							<img src={d.preview} alt={d.name} className="size-full object-cover" />
							{!d.ref && (
								<div className="absolute inset-0 flex items-center justify-center bg-background/60">
									<LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
								</div>
							)}
							<button
								type="button"
								aria-label={`Remove ${d.name}`}
								onClick={() => draft.remove(d.key)}
								className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-background/90 text-muted-foreground hover:text-foreground"
							>
								<XIcon className="size-3" />
							</button>
						</div>
					))}
				</div>
			)}
			{draft.error && (
				<p role="alert" className="text-xs text-red-400">
					{draft.error}
				</p>
			)}
		</div>
	);
}

/** Sent images in the transcript: thumbnails, click → full-size lightbox. */
export function ImageThumbs({ images, className }: { images: readonly ImageRef[] | undefined; className?: string }) {
	const { chatId } = useImageInput();
	const [open, setOpen] = useState<number | null>(null);
	if (!chatId || !images || images.length === 0) return null;
	return (
		<>
			<div data-testid="image-thumbs" className={cn("flex flex-wrap gap-1.5", className)}>
				{images.map((ref, i) => (
					<button
						key={ref.id}
						type="button"
						aria-label={`View ${ref.name ?? "image"}`}
						onClick={() => setOpen(i)}
						className="size-16 cursor-zoom-in overflow-hidden rounded-[6px] border border-border bg-background"
					>
						{/* eslint-disable-next-line @next/next/no-img-element -- app-served upload */}
						<img src={imageUrl(chatId, ref)} alt={ref.name ?? "Your work"} loading="lazy" className="size-full object-cover" />
					</button>
				))}
			</div>
			{open !== null && (
				<ImageLightbox chatId={chatId} images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
			)}
		</>
	);
}

function ImageLightbox({
	chatId,
	images,
	index,
	onIndex,
	onClose,
}: {
	chatId: string;
	images: readonly ImageRef[];
	index: number;
	onIndex: (i: number) => void;
	onClose: () => void;
}) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			// Claimed in the capture phase: Esc closes the lightbox, never
			// the layered dismiss chain underneath.
			if (e.key === "Escape") onClose();
			else if (e.key === "ArrowRight" && index < images.length - 1) onIndex(index + 1);
			else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
			else return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [index, images.length, onClose, onIndex]);
	const ref = images[index]!;
	const overlay: ReactNode = (
		<div
			data-testid="image-lightbox"
			role="dialog"
			aria-label={ref.name ?? "Image"}
			onClick={onClose}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
		>
			{/* eslint-disable-next-line @next/next/no-img-element -- app-served upload */}
			<img
				src={imageUrl(chatId, ref)}
				alt={ref.name ?? "Your work"}
				onClick={(e) => e.stopPropagation()}
				className="max-h-full max-w-full rounded-md object-contain"
			/>
			{images.length > 1 && (
				<div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-ui text-xs text-white/80">
					{index + 1} / {images.length}
				</div>
			)}
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
			>
				<XIcon className="size-4" />
			</button>
		</div>
	);
	return createPortal(overlay, document.body);
}
