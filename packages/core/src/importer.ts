import { DEFAULT_MARKDOWN_TEMPLATE, renderConversationMarkdown } from "./template";
import type { ConversationRecord } from "./types";
import { buildAttachmentFileName, buildConversationFileName, isImageMimeType } from "./path-utils";
import type { ExportSource, ImportTarget, VaultPathApi } from "./io";

export interface ImportOptions {
	notesDirectory: string;
	attachmentsDirectory: string;
	overwriteOnReimport: boolean;
	customTemplatePath?: string;
	onProgress?: (progress: ImportProgress) => void;
}

export interface ImportResult {
	imported: number;
	overwritten: number;
	skipped: number;
	errors: string[];
}

export interface ImportProgress {
	total: number;
	current: number;
	imported: number;
	overwritten: number;
	skipped: number;
	status?: "imported" | "overwritten" | "skipped" | "error";
	conversationId?: string;
	title?: string;
}

export interface ImportContext {
	source: ExportSource;
	target: ImportTarget;
	vaultPath: VaultPathApi;
}

function normalizeVaultPath(vaultPath: VaultPathApi, input: string): string {
	// Reject traversal before normalization can hide it. Configured directories may
	// contain subfolders, but must always stay relative to the vault root.
	const path = input.trim().replace(/\\/g, "/");
	if (path.startsWith("/") || /^[a-z]:/i.test(path) || path.split("/").includes("..")) {
		throw new Error(`Unsafe vault path: ${input}`);
	}
	return vaultPath
		.normalize(
			path
				.split("/")
				.filter((part) => part && part !== ".")
				.join("/")
		)
		.replace(/\/$/, "");
}

async function ensureVaultFolder(
	target: ImportTarget,
	vaultPath: VaultPathApi,
	dirPath: string
): Promise<void> {
	const normalized = normalizeVaultPath(vaultPath, dirPath);
	if (!normalized) return;
	const parts = normalized.split("/").filter((part) => part && part !== ".");
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await target.exists(current))) await target.createFolder(current);
	}
}

function frontmatterValue(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.startsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return typeof parsed === "string" ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	if (trimmed.startsWith("'")) {
		return trimmed.endsWith("'") ? trimmed.slice(1, -1).replace(/''/g, "'") : undefined;
	}
	return trimmed.replace(/\s+#.*$/, "");
}

function extractIdentity(markdown: string): { id: string; source?: string } | undefined {
	const block = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
	if (block === undefined) return;
	const idLine = /^ai_conversation_id:[ \t]*(.*)$/m.exec(block)?.[1];
	if (idLine === undefined) return;
	const id = frontmatterValue(idLine);
	if (id === undefined) return;
	const sourceLine = /^ai_source:[ \t]*(.*)$/m.exec(block)?.[1];
	const source = sourceLine === undefined ? undefined : frontmatterValue(sourceLine);
	// A malformed source is not a legacy note and must not be treated as a match.
	if (sourceLine !== undefined && source === undefined) return;
	return { id, source };
}

function identityKey(source: string | undefined, id: string): string {
	return JSON.stringify([source ?? null, id]);
}

type NoteIndex = Map<string, string>;

async function indexExistingNotes(
	target: ImportTarget,
	vaultPath: VaultPathApi,
	notesDirectory: string
): Promise<NoteIndex> {
	const index: NoteIndex = new Map();
	const root = normalizeVaultPath(vaultPath, notesDirectory);
	// The current public target API lists the vault, but only notes in the configured
	// subtree are read, and the list/read pass runs once for the entire import.
	for (const file of await target.listMarkdownFiles()) {
		const path = normalizeVaultPath(vaultPath, file.path);
		if (root && !path.startsWith(`${root}/`)) continue;
		const identity = extractIdentity(await target.readText(path));
		if (!identity) continue;
		const key = identityKey(identity.source, identity.id);
		if (!index.has(key)) index.set(key, path);
	}
	return index;
}

async function ensureUniqueVaultPath(target: ImportTarget, initialPath: string): Promise<string> {
	if (!(await target.exists(initialPath))) return initialPath;
	const base = initialPath.replace(/\.md$/, "");
	let i = 2;
	while (true) {
		const candidate = `${base}-${i}.md`;
		if (!(await target.exists(candidate))) return candidate;
		i += 1;
	}
}

async function loadTemplate(
	target: ImportTarget,
	vaultPath: VaultPathApi,
	options: ImportOptions
): Promise<string> {
	const customPath = options.customTemplatePath?.trim();
	if (!customPath) return DEFAULT_MARKDOWN_TEMPLATE;
	const normalized = normalizeVaultPath(vaultPath, customPath);
	if (!normalized) throw new Error("Custom template path is empty");
	return target.readText(normalized);
}

async function mergeConversationAttachments(
	conversation: ConversationRecord,
	options: ImportOptions,
	context: ImportContext
): Promise<void> {
	const attachmentsRoot = normalizeVaultPath(context.vaultPath, options.attachmentsDirectory);
	const copiedById = new Map<string, string>();
	const equalBytes = (a: Uint8Array, b: Uint8Array) =>
		a.length === b.length && a.every((byte, i) => byte === b[i]);
	for (const message of conversation.messages) {
		for (const attachment of message.attachments) {
			if (!attachment.sourcePath) continue;
			const attachmentKey = JSON.stringify([attachment.id, attachment.sourcePath]);
			let targetRelativePath = copiedById.get(attachmentKey);
			if (!targetRelativePath) {
				const fileName = buildAttachmentFileName(
					attachment.name,
					attachment.sourcePath,
					attachment.id,
					identityKey(conversation.source, conversation.conversationId)
				);
				targetRelativePath = normalizeVaultPath(
					context.vaultPath,
					context.vaultPath.join(attachmentsRoot, fileName)
				);
				const data = await context.source.readBinary(attachment.sourcePath);
				const initialPath = targetRelativePath;
				const dot = fileName.lastIndexOf(".");
				const base = dot > 0 ? initialPath.slice(0, -(fileName.length - dot)) : initialPath;
				const ext = dot > 0 ? fileName.slice(dot) : "";
				let suffix = 2;
				while (await context.target.exists(targetRelativePath)) {
					if (!context.target.readBinary)
						throw new Error(
							"Target cannot verify an existing attachment (readBinary is required)"
						);
					if (equalBytes(data, await context.target.readBinary(targetRelativePath)))
						break;
					// An existing path is never permission to overwrite unrelated data,
					// including when the same exported ID was reused with different bytes.
					targetRelativePath = `${base}-${suffix++}${ext}`;
				}
				if (!(await context.target.exists(targetRelativePath))) {
					await ensureVaultFolder(
						context.target,
						context.vaultPath,
						context.vaultPath.dirname(targetRelativePath)
					);
					await context.target.writeBinary(targetRelativePath, data);
				}
				copiedById.set(attachmentKey, targetRelativePath);
			}
			attachment.vaultPath = targetRelativePath;
			attachment.obsidianLink = isImageMimeType(attachment.mimeType)
				? `![[${targetRelativePath}]]`
				: `[[${targetRelativePath}]]`;
		}
	}
}

export async function importConversationRecords(
	conversations: ConversationRecord[],
	options: ImportOptions,
	context: ImportContext
): Promise<ImportResult> {
	const template = await loadTemplate(context.target, context.vaultPath, options);
	const notesDirectory = normalizeVaultPath(context.vaultPath, options.notesDirectory);
	// Validate both roots even if the first record has no attachments.
	normalizeVaultPath(context.vaultPath, options.attachmentsDirectory);
	const index = await indexExistingNotes(context.target, context.vaultPath, notesDirectory);
	const errors: string[] = [];
	let imported = 0;
	let skipped = 0;
	let overwritten = 0;
	const total = conversations.length;

	for (const conversation of conversations) {
		let status: ImportProgress["status"] | undefined;
		try {
			const key = identityKey(conversation.source, conversation.conversationId);
			const legacyKey = identityKey(undefined, conversation.conversationId);
			const existingPath = index.get(key) ?? index.get(legacyKey);
			if (existingPath && !options.overwriteOnReimport) {
				skipped += 1;
				status = "skipped";
				continue;
			}
			const requestedPath = normalizeVaultPath(
				context.vaultPath,
				context.vaultPath.join(
					notesDirectory,
					buildConversationFileName(
						conversation.title,
						conversation.conversationId,
						conversation.createdAt
					)
				)
			);
			// An occupied filename alone is never proof of identity.
			const finalPath =
				existingPath ?? (await ensureUniqueVaultPath(context.target, requestedPath));
			await mergeConversationAttachments(conversation, options, context);
			const markdown = renderConversationMarkdown(conversation, template);
			await ensureVaultFolder(
				context.target,
				context.vaultPath,
				context.vaultPath.dirname(finalPath)
			);
			await context.target.writeText(finalPath, markdown);
			index.set(key, finalPath);
			if (existingPath === index.get(legacyKey)) index.delete(legacyKey);
			if (existingPath) {
				overwritten += 1;
				status = "overwritten";
			} else {
				imported += 1;
				status = "imported";
			}
		} catch (error) {
			errors.push(
				`${conversation.conversationId}: ${error instanceof Error ? error.message : String(error)}`
			);
			status = "error";
		} finally {
			options.onProgress?.({
				total,
				current: imported + overwritten + skipped + errors.length,
				imported,
				overwritten,
				skipped,
				status: status ?? "error",
				conversationId: conversation.conversationId,
				title: conversation.title
			});
		}
	}
	return { imported, overwritten, skipped, errors };
}
