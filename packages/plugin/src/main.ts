import { Notice, Plugin } from "obsidian";
import { importChatGptHistory, importClaudeHistory } from "./importer";
import { DEFAULT_SETTINGS, type ImporterPluginSettings } from "./settings";
import { ImporterSettingTab } from "./settings-tab";
import { promptExportDirectory } from "./ui/export-directory-modal";

interface PersistedData {
	settings?: Partial<ImporterPluginSettings>;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizePersistedData(raw: unknown): PersistedData {
	if (!isObject(raw)) return {};
	const data: PersistedData = {};
	if (isObject(raw.settings)) {
		data.settings = raw.settings as Partial<ImporterPluginSettings>;
	}
	return data;
}

export default class ImporterPlugin extends Plugin {
	settings: ImporterPluginSettings = { ...DEFAULT_SETTINGS };
	private importing = false;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ImporterSettingTab(this.app, this));

		this.addCommand({
			id: "import-chatgpt-history",
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			name: "Import ChatGPT history",
			callback: async () => {
				await this.runImport("chatgpt");
			}
		});

		this.addCommand({
			id: "import-claude-history",
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			name: "Import Claude history",
			callback: async () => {
				await this.runImport("claude");
			}
		});
	}

	async runImport(source: "chatgpt" | "claude"): Promise<void> {
		if (this.importing) {
			new Notice("An import is already running.");
			return;
		}
		this.importing = true;
		type UpdatableNotice = Notice & { setMessage: (message: string) => void; hide: () => void };
		let notice: UpdatableNotice | undefined;

		try {
			const exportDirectory = await promptExportDirectory(this.app, "");
			if (!exportDirectory) {
				return;
			}

			const lastUpdate = { time: 0 };
			const updateNotice = (text: string): void => {
				if (!notice) {
					notice = new Notice(text, 0) as UpdatableNotice;
					return;
				}
				notice.setMessage(text);
			};

			const runImport = source === "claude" ? importClaudeHistory : importChatGptHistory;
			const result = await runImport({
				vault: this.app.vault,
				exportDirectory,
				settings: this.settings,
				onProgress: (progress) => {
					const now = Date.now();
					if (now - lastUpdate.time < 10 && progress.current !== progress.total) {
						return;
					}
					lastUpdate.time = now;
					const title = progress.title ? `: ${progress.title}` : "";
					const statusLabel =
						progress.status === "overwritten"
							? "Overwriting"
							: progress.status === "skipped"
								? "Skipping"
								: "Importing";
					updateNotice(`${statusLabel} ${progress.current}/${progress.total}${title}`);
				}
			});
			await this.saveSettings();

			if (notice) {
				notice.hide();
			}
			if (result.warnings?.length) {
				console.warn("[obsidian-ai-history-importer] import warnings", result.warnings);
				new Notice(
					`Import has ${result.warnings.length} warnings. See the developer console for details.`,
					15000
				);
			}
			if (result.errors.length > 0) {
				new Notice(
					`Import finished: imported=${result.imported}, overwritten=${result.overwritten}, skipped=${result.skipped}, errors=${result.errors.length}`,
					10000
				);
				console.error("[obsidian-ai-history-importer] import errors", result.errors);
			} else {
				new Notice(
					`Import finished: imported=${result.imported}, overwritten=${result.overwritten}, skipped=${result.skipped}`
				);
			}
		} catch (error) {
			if (notice) {
				notice.hide();
			}
			new Notice(
				`Import failed: ${error instanceof Error ? error.message : String(error)}`,
				12000
			);
			console.error("[obsidian-ai-history-importer] import failed", error);
		} finally {
			this.importing = false;
		}
	}

	async loadSettings(): Promise<void> {
		const raw = normalizePersistedData(await this.loadData());
		this.settings = {
			...DEFAULT_SETTINGS,
			...(raw?.settings ?? {})
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData({
			settings: this.settings
		});
	}
}
