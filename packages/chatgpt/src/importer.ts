import type {
	ExportPathApi,
	ExportSource,
	ImportOptions,
	ImportResult,
	ImportTarget,
	VaultPathApi
} from "@obsidian-ai-history-importer/core";
import { importConversationRecords } from "@obsidian-ai-history-importer/core";
import { parseChatGptConversations } from "./parser";
import { createAttachmentResolver, readAssetMetadata, type AttachmentIndexEntry } from "./assets";
import type { ChatGptConversation } from "./types";

export interface ChatGptImportOptions extends ImportOptions {
	exportDir: string;
	includeSystemMessages?: boolean;
	includeHiddenMessages?: boolean;
	excludeThoughts?: boolean;
	excludeToolCalls?: boolean;
	excludeThoughtTime?: boolean;
	attachmentScanDepth?: number;
	includeAllBranches?: boolean;
}

interface ExportManifestLogicalFile {
	files?: unknown;
}

interface ExportManifest {
	logical_files?: Record<string, ExportManifestLogicalFile>;
}

async function readConversationsFile(
	exportDir: string,
	source: ExportSource,
	exportPath: ExportPathApi
): Promise<ChatGptConversation[]> {
	const filePath = exportPath.join(exportDir, "conversations.json");
	if (await source.exists(filePath)) {
		const raw = await source.readText(filePath);
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			throw new Error("conversations.json is not an array");
		}
		return parsed as ChatGptConversation[];
	}

	const shardPaths = await resolveConversationShardPaths(exportDir, source, exportPath);
	if (shardPaths.length === 0) {
		throw new Error("Missing conversations.json");
	}

	const conversations: ChatGptConversation[] = [];
	for (const shardPath of shardPaths) {
		const raw = await source.readText(shardPath);
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			throw new Error(`${shardPath} is not an array`);
		}
		conversations.push(...(parsed as ChatGptConversation[]));
	}
	return conversations;
}

async function resolveConversationShardPaths(
	exportDir: string,
	source: ExportSource,
	exportPath: ExportPathApi
): Promise<string[]> {
	const manifestPath = exportPath.join(exportDir, "export_manifest.json");
	if (await source.exists(manifestPath)) {
		const raw = await source.readText(manifestPath);
		const parsed = JSON.parse(raw) as ExportManifest;
		const files = parsed.logical_files?.["conversations.json"]?.files;
		if (Array.isArray(files) && files.length > 0) {
			return files.map((file: unknown) => {
				if (typeof file !== "string" || !/^conversations-\d+\.json$/.test(file)) {
					throw new Error("Invalid conversation shard path in export_manifest.json");
				}
				return exportPath.join(exportDir, file);
			});
		}
	}

	const entries = await source.listDir(exportDir);
	return entries
		.filter((entry) => entry.isFile && /^conversations-\d+\.json$/.test(entry.name))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((entry) => entry.path);
}

async function buildAttachmentIndex(
	exportDir: string,
	source: ExportSource,
	maxDepth: number
): Promise<AttachmentIndexEntry[]> {
	const files: AttachmentIndexEntry[] = [];
	const stack: Array<{ dir: string; depth: number }> = [{ dir: exportDir, depth: 0 }];

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) break;
		const { dir, depth } = current;
		if (depth > maxDepth) continue;

		const entries = await source.listDir(dir);
		for (const entry of entries) {
			if (entry.name === "node_modules") continue;
			if (entry.isDirectory) {
				stack.push({ dir: entry.path, depth: depth + 1 });
				continue;
			}
			if (!entry.isFile) continue;
			if (entry.name.endsWith(":Zone.Identifier")) continue;
			files.push({ name: entry.name, path: entry.path });
		}
	}

	return files;
}

export async function importChatGptExport(params: {
	options: ChatGptImportOptions;
	source: ExportSource;
	target: ImportTarget;
	exportPath: ExportPathApi;
	vaultPath: VaultPathApi;
}): Promise<ImportResult & { warnings: string[] }> {
	const { options, source, target, exportPath, vaultPath } = params;
	const trimmedExportDir = options.exportDir.trim();
	if (!trimmedExportDir) {
		throw new Error("Export directory is empty");
	}

	const conversations = await readConversationsFile(trimmedExportDir, source, exportPath);
	const scanDepth = options.attachmentScanDepth ?? 6;
	if (!Number.isInteger(scanDepth) || scanDepth < 0)
		throw new Error("Invalid attachment scan depth");
	const warnings: string[] = [];
	const onWarning = (warning: string) => warnings.push(warning);
	const attachmentIndex = await buildAttachmentIndex(trimmedExportDir, source, scanDepth);
	const resolveAttachmentPath = createAttachmentResolver(attachmentIndex, onWarning);
	const resolveAttachmentMetadata = await readAssetMetadata(
		trimmedExportDir,
		source,
		exportPath,
		conversations
	);

	const parsed = parseChatGptConversations(conversations, {
		includeSystemMessages: options.includeSystemMessages,
		includeHiddenMessages: options.includeHiddenMessages,
		excludeThoughts: options.excludeThoughts,
		excludeToolCalls: options.excludeToolCalls,
		excludeThoughtTime: options.excludeThoughtTime,
		resolveAttachmentPath,
		resolveAttachmentMetadata,
		includeAllBranches: options.includeAllBranches,
		onWarning
	});

	const result = await importConversationRecords(parsed, options, {
		source,
		target,
		vaultPath
	});
	return { ...result, warnings };
}
