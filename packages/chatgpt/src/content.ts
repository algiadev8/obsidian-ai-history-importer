import type { ChatGptAttachment, ChatGptMessage } from "./types";

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function partText(part: unknown): string | undefined {
	if (typeof part === "string") return part;
	const value = object(part);
	// Voice exports store the transcript in a typed object, not a string part.
	return typeof value?.text === "string" ? value.text : undefined;
}

export function collectContentStrings(message: ChatGptMessage): string[] {
	const content = message.content;
	if (!content) return [];
	const parts = Array.isArray(content.parts)
		? content.parts.map(partText).filter((part): part is string => part !== undefined)
		: [];
	return [
		...parts,
		...(typeof content.text === "string" ? [content.text] : []),
		...(typeof content.content === "string" ? [content.content] : [])
	];
}

export function extractMessageText(message: ChatGptMessage): string {
	const content = message.content;
	if (!content) return "";
	switch (content.content_type) {
		case "text":
		case "multimodal_text":
			return (content.parts ?? [])
				.map(partText)
				.filter((part): part is string => part !== undefined)
				.join("\n\n")
				.trim();
		case "code":
		case "execution_output":
			return typeof content.text === "string" ? content.text.trim() : "";
		case "reasoning_recap":
			return typeof content.content === "string" ? content.content.trim() : "";
		default:
			return JSON.stringify(content, null, 2);
	}
}

// Only accept exported file-service/sediment IDs. Never interpret arbitrary URLs
// or filesystem paths in a content part as local files to copy.
function pointerId(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return /^(?:file-service|sediment):\/\/([\w-]+)$/.exec(value)?.[1];
}

export function collectAttachments(message: ChatGptMessage): ChatGptAttachment[] {
	const attachments = new Map<string, ChatGptAttachment>();
	for (const attachment of message.metadata?.attachments ?? []) {
		if (attachment?.id) attachments.set(attachment.id, { ...attachment });
	}
	function visit(part: unknown): void {
		const value = object(part);
		if (!value) return;
		const id = pointerId(value.asset_pointer);
		if (id) {
			const current = attachments.get(id);
			attachments.set(id, {
				id,
				...(typeof value.size_bytes === "number" ? { size: value.size_bytes } : {}),
				...(value.content_type === "image_asset_pointer" ? { isImage: true } : {}),
				...current
			});
		}
		// Audio/video exports can nest asset pointers in a typed part.
		for (const child of Object.values(value)) {
			if (Array.isArray(child)) child.forEach(visit);
			else if (child && typeof child === "object") visit(child);
		}
	}
	for (const part of message.content?.parts ?? []) visit(part);
	return [...attachments.values()];
}

export function inferMimeType(name?: string): string | undefined {
	const extension = name?.split(".").pop()?.toLowerCase();
	return extension
		? {
				png: "image/png",
				jpg: "image/jpeg",
				jpeg: "image/jpeg",
				gif: "image/gif",
				webp: "image/webp",
				svg: "image/svg+xml",
				avif: "image/avif",
				bmp: "image/bmp",
				pdf: "application/pdf",
				mp3: "audio/mpeg",
				wav: "audio/wav",
				mp4: "video/mp4"
			}[extension]
		: undefined;
}
