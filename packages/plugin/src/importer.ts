import { promises as fs } from "node:fs";
import { join } from "node:path";
import { normalizePath, type Vault } from "obsidian";
import { createVaultTarget } from "./vault-target";
import type {
	ExportPathApi,
	ExportSource,
	ImportProgress,
	ImportResult,
	ImportTarget,
	VaultPathApi
} from "@obsidian-ai-history-importer/core";
import { importChatGptExport } from "@obsidian-ai-history-importer/chatgpt";
import { importClaudeExport } from "@obsidian-ai-history-importer/claude";
import type { ImporterPluginSettings } from "./settings";

type HistoryImportResult = ImportResult & { warnings?: string[] };

export async function importChatGptHistory(params: {
	vault: Vault;
	exportDirectory: string;
	settings: ImporterPluginSettings;
	onProgress?: (progress: ImportProgress) => void;
}): Promise<HistoryImportResult> {
	const { vault, exportDirectory, settings, onProgress } = params;

	const exportSource: ExportSource = {
		readText: (path) => fs.readFile(path, "utf8"),
		readBinary: async (path) => new Uint8Array(await fs.readFile(path)),
		listDir: async (dir) => {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			return entries.map((entry) => ({
				name: entry.name,
				path: join(dir, entry.name),
				isDirectory: entry.isDirectory(),
				isFile: entry.isFile()
			}));
		},
		exists: async (path) => {
			try {
				await fs.access(path);
				return true;
			} catch {
				return false;
			}
		}
	};

	const target: ImportTarget = createVaultTarget(vault);

	const exportPath: ExportPathApi = {
		join: (...parts) => join(...parts)
	};

	const vaultPath: VaultPathApi = {
		join: (...parts) => normalizePath(parts.filter(Boolean).join("/")),
		dirname: (path) => {
			const normalized = normalizePath(path);
			const index = normalized.lastIndexOf("/");
			return index <= 0 ? "" : normalized.slice(0, index);
		},
		normalize: (path) => normalizePath(path)
	};

	return importChatGptExport({
		options: {
			exportDir: exportDirectory,
			notesDirectory: settings.notesDirectory,
			attachmentsDirectory: settings.attachmentsDirectory,
			overwriteOnReimport: settings.overwriteOnReimport,
			customTemplatePath: settings.customTemplatePath,
			includeSystemMessages: settings.includeSystemMessages,
			includeHiddenMessages: settings.includeHiddenMessages,
			includeAllBranches: settings.includeAllBranches,
			excludeThoughts: settings.excludeThoughts,
			excludeToolCalls: settings.excludeToolCalls,
			excludeThoughtTime: settings.excludeThoughtTime,
			onProgress
		},
		source: exportSource,
		target,
		exportPath,
		vaultPath
	});
}

export async function importClaudeHistory(params: {
	vault: Vault;
	exportDirectory: string;
	settings: ImporterPluginSettings;
	onProgress?: (progress: ImportProgress) => void;
}): Promise<HistoryImportResult> {
	const { vault, exportDirectory, settings, onProgress } = params;

	const exportSource: ExportSource = {
		readText: (path) => fs.readFile(path, "utf8"),
		readBinary: async (path) => new Uint8Array(await fs.readFile(path)),
		listDir: async (dir) => {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			return entries.map((entry) => ({
				name: entry.name,
				path: join(dir, entry.name),
				isDirectory: entry.isDirectory(),
				isFile: entry.isFile()
			}));
		},
		exists: async (path) => {
			try {
				await fs.access(path);
				return true;
			} catch {
				return false;
			}
		}
	};

	const target: ImportTarget = createVaultTarget(vault);

	const exportPath: ExportPathApi = {
		join: (...parts) => join(...parts)
	};

	const vaultPath: VaultPathApi = {
		join: (...parts) => normalizePath(parts.filter(Boolean).join("/")),
		dirname: (path) => {
			const normalized = normalizePath(path);
			const index = normalized.lastIndexOf("/");
			return index <= 0 ? "" : normalized.slice(0, index);
		},
		normalize: (path) => normalizePath(path)
	};

	return importClaudeExport({
		options: {
			exportDir: exportDirectory,
			notesDirectory: settings.claudeNotesDirectory,
			attachmentsDirectory: settings.attachmentsDirectory,
			overwriteOnReimport: settings.overwriteOnReimport,
			customTemplatePath: settings.customTemplatePath,
			includeSystemMessages: settings.includeSystemMessages,
			excludeThinking: settings.excludeClaudeThinking,
			onProgress
		},
		source: exportSource,
		target,
		exportPath,
		vaultPath
	});
}
