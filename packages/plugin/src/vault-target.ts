import { normalizePath, TFile, TFolder, type Vault } from "obsidian";
import type { ImportTarget } from "@obsidian-ai-history-importer/core";

/** Check Vault's result: adapter.write can succeed while reconciliation returns null. */
function requireCreatedFile(file: TFile | null, path: string): void {
	if (!(file instanceof TFile) || file.path !== normalizePath(path)) {
		throw new Error(`Vault did not register the created file: ${path}`);
	}
}

export function createVaultTarget(vault: Vault): ImportTarget {
	return {
		listMarkdownFiles: async () =>
			vault.getMarkdownFiles().map((file) => ({ path: file.path })),
		readText: async (path) => {
			const file = vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`Missing file: ${path}`);
			return vault.read(file);
		},
		readBinary: async (path) => {
			const file = vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`Missing attachment: ${path}`);
			return new Uint8Array(await vault.readBinary(file));
		},
		writeText: async (path, content) => {
			const existing = vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) await vault.modify(existing, content);
			else if (existing) throw new Error(`A folder occupies the note path: ${path}`);
			else requireCreatedFile(await vault.create(path, content), path);
		},
		writeBinary: async (path, data) => {
			const buffer = new Uint8Array(data).buffer;
			const existing = vault.getAbstractFileByPath(path);
			if (existing instanceof TFile) await vault.modifyBinary(existing, buffer);
			else if (existing) throw new Error(`A folder occupies the attachment path: ${path}`);
			else requireCreatedFile(await vault.createBinary(path, buffer), path);
		},
		createFolder: async (path) => {
			const existing = vault.getAbstractFileByPath(path);
			if (existing && !(existing instanceof TFolder))
				throw new Error(`A file occupies the folder path: ${path}`);
			if (!existing) await vault.createFolder(path);
		},
		exists: async (path) => Boolean(vault.getAbstractFileByPath(path))
	};
}
