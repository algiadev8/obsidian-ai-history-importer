import type { ExportPathApi, ExportSource } from "@obsidian-ai-history-importer/core";
import type { ChatGptAttachment, ChatGptConversation } from "./types";
import type { AttachmentPathResolver } from "./parser";
import { inferMimeType } from "./content";

export interface AttachmentIndexEntry {
	name: string;
	path: string;
}

interface LibraryFile {
	file_id?: string;
	file_name?: string;
	mime_type?: string;
	file_size_bytes?: number;
	origination_thread_id?: string;
	origination_message_id?: string;
}

export async function readAssetMetadata(
	exportDir: string,
	source: ExportSource,
	exportPath: ExportPathApi,
	conversations: ChatGptConversation[]
): Promise<(attachment: ChatGptAttachment) => ChatGptAttachment> {
	const namesPath = exportPath.join(exportDir, "conversation_asset_file_names.json");
	const names: unknown = (await source.exists(namesPath))
		? JSON.parse(await source.readText(namesPath))
		: {};
	const byId = new Map<string, ChatGptAttachment>();
	if (names && typeof names === "object" && !Array.isArray(names)) {
		for (const [fileName, name] of Object.entries(names)) {
			if (typeof name !== "string" || !fileName.endsWith(".dat")) continue;
			const id = fileName.slice(0, -4);
			byId.set(id, { id, name, mime_type: inferMimeType(name) });
		}
	}
	const libraryPath = exportPath.join(exportDir, "library_files.json");
	if (await source.exists(libraryPath)) {
		const library: unknown = JSON.parse(await source.readText(libraryPath));
		if (!Array.isArray(library)) throw new Error("library_files.json is not an array");
		const origins = new Map<
			string,
			Map<string, NonNullable<ChatGptConversation["mapping"]>[string]>
		>();
		for (const c of conversations) {
			const id = c.id ?? c.conversation_id;
			if (id)
				origins.set(
					id,
					new Map(
						Object.values(c.mapping ?? {})
							.filter((n) => n.message)
							.map((n) => [n.message!.id, n])
					)
				);
		}
		for (const value of library as LibraryFile[]) {
			if (!value || typeof value.file_id !== "string") continue;
			const attachment: ChatGptAttachment = {
				id: value.file_id,
				name: typeof value.file_name === "string" ? value.file_name : undefined,
				mime_type: typeof value.mime_type === "string" ? value.mime_type : undefined,
				size: typeof value.file_size_bytes === "number" ? value.file_size_bytes : undefined
			};
			byId.set(attachment.id, { ...byId.get(attachment.id), ...attachment });
			// Recover only files with an exact exported conversation AND message
			// origin. Do not guess association by basename or attach the whole library.
			const node = origins
				.get(value.origination_thread_id ?? "")
				?.get(value.origination_message_id ?? "");
			if (node?.message) {
				const metadata = (node.message.metadata ??= {});
				const attachments = (metadata.attachments ??= []);
				if (!attachments.some((a) => a.id === attachment.id)) attachments.push(attachment);
			}
		}
	}
	return (attachment) => {
		const metadata = byId.get(attachment.id);
		return {
			...attachment,
			name: attachment.name ?? metadata?.name,
			mime_type: attachment.mime_type ?? attachment.mimeType ?? metadata?.mime_type,
			size: attachment.size ?? metadata?.size
		};
	};
}

export function createAttachmentResolver(
	files: AttachmentIndexEntry[],
	onWarning?: (warning: string) => void
): AttachmentPathResolver {
	const cache = new Map<string, string | undefined>();
	return (attachment) => {
		if (cache.has(attachment.id)) return cache.get(attachment.id);
		const exact = files.filter(
			(entry) => entry.name === attachment.id || entry.name === attachment.id + ".dat"
		);
		const candidates = exact.length
			? exact
			: files.filter(
					(entry) =>
						entry.name.startsWith(attachment.id) &&
						["-", "."].includes(entry.name[attachment.id.length])
				);
		const path = candidates.length === 1 ? candidates[0].path : undefined;
		if (!path)
			onWarning?.(
				`${candidates.length ? "Ambiguous" : "Missing"} exported attachment: ${attachment.id}`
			);
		cache.set(attachment.id, path);
		return path;
	};
}
