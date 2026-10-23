import { describe, expect, it } from "vitest";
import type { ConversationRecord } from "../src";
import type { ExportSource, ImportTarget, VaultPathApi } from "../src";
import { importConversationRecords } from "../src";
import { buildAttachmentFileName, buildConversationFileName } from "../src/path-utils";

type FileEntry = { kind: "text"; content: string } | { kind: "binary"; content: Uint8Array };

function createVaultPathApi(): VaultPathApi {
	return {
		join: (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/"),
		dirname: (path) => {
			const normalized = path.replace(/\/+/g, "/");
			const index = normalized.lastIndexOf("/");
			return index <= 0 ? "" : normalized.slice(0, index);
		},
		normalize: (path) => path.replace(/\/+/g, "/").replace(/\/$/, "")
	};
}

function createExportSource(
	textFiles: Map<string, string>,
	binaryFiles: Map<string, Uint8Array>,
	entriesByDir: Map<
		string,
		Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }>
	>
): ExportSource {
	return {
		readText: async (path) => {
			const value = textFiles.get(path);
			if (value === undefined) throw new Error(`Missing text: ${path}`);
			return value;
		},
		readBinary: async (path) => {
			const value = binaryFiles.get(path);
			if (!value) throw new Error(`Missing binary: ${path}`);
			return value;
		},
		listDir: async (path) => entriesByDir.get(path) ?? [],
		exists: async (path) =>
			textFiles.has(path) || binaryFiles.has(path) || entriesByDir.has(path)
	};
}

function createImportTarget() {
	const files = new Map<string, FileEntry>();
	const folders = new Set<string>();

	const target: ImportTarget = {
		listMarkdownFiles: async () =>
			[...files.keys()].filter((path) => path.endsWith(".md")).map((path) => ({ path })),
		readText: async (path) => {
			const entry = files.get(path);
			if (!entry || entry.kind !== "text") throw new Error(`Missing text: ${path}`);
			return entry.content;
		},
		readBinary: async (path) => {
			const entry = files.get(path);
			if (!entry) throw new Error(`Missing binary: ${path}`);
			return entry.kind === "binary"
				? entry.content
				: new TextEncoder().encode(entry.content);
		},
		writeText: async (path, content) => {
			files.set(path, { kind: "text", content });
		},
		writeBinary: async (path, data) => {
			files.set(path, { kind: "binary", content: data });
		},
		createFolder: async (path) => {
			folders.add(path);
		},
		exists: async (path) => files.has(path) || folders.has(path)
	};

	return { target, files, folders };
}

function baseConversation(overrides?: Partial<ConversationRecord>): ConversationRecord {
	return {
		source: "chatgpt",
		conversationId: "conv-12345678",
		importKey: "chatgpt:conv-12345678",
		title: "Hello world",
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-01T00:00:10.000Z",
		messages: [],
		...overrides
	};
}

describe("importConversationRecords", () => {
	it("writes a new note using the default template", async () => {
		const { target, files } = createImportTarget();
		const exportSource = createExportSource(new Map(), new Map(), new Map());
		const vaultPath = createVaultPathApi();
		const progressCalls: Array<{
			current: number;
			imported: number;
			skipped: number;
			conversationId?: string;
			title?: string;
		}> = [];

		const records = [
			baseConversation({
				title: "My Chat",
				messages: [
					{
						id: "m1",
						role: "user",
						content: "hello",
						attachments: []
					}
				]
			})
		];

		const result = await importConversationRecords(
			records,
			{
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: false,
				onProgress: (progress) => {
					progressCalls.push({ ...progress });
				}
			},
			{ source: exportSource, target, vaultPath }
		);

		expect(result.imported).toBe(1);
		expect(result.overwritten).toBe(0);
		expect(progressCalls).toHaveLength(1);
		expect(progressCalls[0]?.current).toBe(1);
		expect(progressCalls[0]?.imported).toBe(1);
		expect(progressCalls[0]?.overwritten).toBe(0);
		expect(progressCalls[0]?.skipped).toBe(0);
		expect(progressCalls[0]?.conversationId).toBe("conv-12345678");
		expect(progressCalls[0]?.title).toBe("My Chat");
		const [path] = [...files.keys()];
		expect(path).toBe("notes/202401010000-My Chat-conv-12345678.md");
		const content = (files.get(path) as { kind: "text"; content: string }).content;
		expect(content).toContain('ai_conversation_id: "conv-12345678"');
		expect(content).toContain("# My Chat");
	});

	it("skips when a note already exists and overwrite is false", async () => {
		const { target, files } = createImportTarget();
		const exportSource = createExportSource(new Map(), new Map(), new Map());
		const vaultPath = createVaultPathApi();
		const existingPath = "notes/202401010000-Hello world-conv-123.md";
		const existing = '---\nai_conversation_id: "conv-12345678"\n---\nexisting';
		files.set(existingPath, { kind: "text", content: existing });
		const progressCalls: Array<{ current: number; skipped: number }> = [];

		const result = await importConversationRecords(
			[baseConversation()],
			{
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: false,
				onProgress: (progress) => {
					progressCalls.push({ current: progress.current, skipped: progress.skipped });
				}
			},
			{ source: exportSource, target, vaultPath }
		);

		expect(result.skipped).toBe(1);
		expect(result.overwritten).toBe(0);
		expect(progressCalls).toHaveLength(1);
		expect(progressCalls[0]?.current).toBe(1);
		expect(progressCalls[0]?.skipped).toBe(1);
		expect((files.get(existingPath) as { kind: "text"; content: string }).content).toBe(
			existing
		);
	});

	it("updates an existing note that matches conversation id", async () => {
		const { target, files } = createImportTarget();
		const exportSource = createExportSource(new Map(), new Map(), new Map());
		const vaultPath = createVaultPathApi();
		const existingPath = "notes/old-name.md";
		files.set(existingPath, {
			kind: "text",
			content: `---\nai_conversation_id: "conv-12345678"\n---\nOld`
		});

		const result = await importConversationRecords(
			[baseConversation({ title: "Renamed" })],
			{
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: true
			},
			{ source: exportSource, target, vaultPath }
		);

		expect(result.imported).toBe(0);
		expect(result.overwritten).toBe(1);
		const updated = files.get(existingPath) as { kind: "text"; content: string };
		expect(updated.content).toContain("# Renamed");
	});

	it("copies attachments and renders obsidian links", async () => {
		const { target, files } = createImportTarget();
		const binary = new Uint8Array([1, 2, 3]);
		const exportSource = createExportSource(
			new Map(),
			new Map([["/export/file-aaa-photo.jpg", binary]]),
			new Map()
		);
		const vaultPath = createVaultPathApi();

		const records = [
			baseConversation({
				messages: [
					{
						id: "m1",
						role: "assistant",
						content: "see",
						attachments: [
							{
								id: "file-aaa",
								name: "photo.jpg",
								mimeType: "image/jpeg",
								sourcePath: "/export/file-aaa-photo.jpg"
							}
						]
					}
				]
			})
		];

		const result = await importConversationRecords(
			records,
			{
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: false
			},
			{ source: exportSource, target, vaultPath }
		);

		expect(result.imported).toBe(1);
		const attachmentPath = `attachments/${buildAttachmentFileName("photo.jpg", "/export/file-aaa-photo.jpg", "file-aaa", JSON.stringify(["chatgpt", "conv-12345678"]))}`;
		expect(files.has(attachmentPath)).toBe(true);
		const notePath = [...files.keys()].find((path) => path.startsWith("notes/"))!;
		const content = (files.get(notePath) as { kind: "text"; content: string }).content;
		expect(content).toContain(`![[${attachmentPath}]]`);
	});

	it("loads a custom template from the vault", async () => {
		const { target, files } = createImportTarget();
		files.set("template.md", { kind: "text", content: "TITLE={{ conversation.title }}" });
		const exportSource = createExportSource(new Map(), new Map(), new Map());
		const vaultPath = createVaultPathApi();

		const result = await importConversationRecords(
			[baseConversation({ title: "Custom" })],
			{
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: false,
				customTemplatePath: "template.md"
			},
			{ source: exportSource, target, vaultPath }
		);

		expect(result.imported).toBe(1);
		const notePath = [...files.keys()].find((path) => path.startsWith("notes/"))!;
		const content = (files.get(notePath) as { kind: "text"; content: string }).content;
		expect(content.trim()).toMatch(/TITLE=Custom$/);
		expect(content).toContain('ai_conversation_id: "conv-12345678"');
	});
});

const standardOptions = {
	notesDirectory: "notes",
	attachmentsDirectory: "attachments",
	overwriteOnReimport: true
};

function withAttachments(id = "conv-12345678", attachmentIds = ["a", "b"]): ConversationRecord {
	return baseConversation({
		conversationId: id,
		messages: [
			{
				id: "m",
				role: "user",
				content: "assets",
				attachments: attachmentIds.map((id) => ({
					id,
					name: "photo.jpg",
					mimeType: "image/jpeg",
					sourcePath: `/export/${id}`
				}))
			}
		]
	});
}

function fixture() {
	const vault = createImportTarget();
	const source = createExportSource(
		new Map(),
		new Map([
			["/export/a", new Uint8Array([1])],
			["/export/b", new Uint8Array([2])]
		]),
		new Map()
	);
	return { ...vault, context: { source, target: vault.target, vaultPath: createVaultPathApi() } };
}

function noteContent(files: Map<string, FileEntry>, path: string): string {
	const file = files.get(path);
	if (!file || file.kind !== "text") throw new Error(`Missing note: ${path}`);
	return file.content;
}

describe("import identity and side-effect regressions", () => {
	it("keeps full IDs distinct even with equal first eight characters and identical titles", async () => {
		const { files, context } = fixture();
		const records = [
			baseConversation({ conversationId: "12345678-first" }),
			baseConversation({ conversationId: "12345678-second" })
		];
		const first = await importConversationRecords(records, standardOptions, context);
		expect(first).toEqual({ imported: 2, overwritten: 0, skipped: 0, errors: [] });
		const paths = [...files.keys()];
		expect(paths).toHaveLength(2);
		expect(paths.some((path) => path.includes("12345678-first"))).toBe(true);
		expect(paths.some((path) => path.includes("12345678-second"))).toBe(true);
		const again = await importConversationRecords(records, standardOptions, context);
		expect(again.overwritten).toBe(2);
		expect([...files.keys()]).toEqual(paths);
	});

	it.each([true, false])(
		"never overwrites or skips an unrelated occupied filename (overwrite=%s)",
		async (overwriteOnReimport) => {
			const { files, context } = fixture();
			const record = baseConversation();
			const path = `notes/${buildConversationFileName(record.title, record.conversationId, record.createdAt)}`;
			files.set(path, { kind: "text", content: "Unrelated personal note" });
			const result = await importConversationRecords(
				[record],
				{ ...standardOptions, overwriteOnReimport },
				context
			);
			expect(result).toEqual({ imported: 1, overwritten: 0, skipped: 0, errors: [] });
			expect(noteContent(files, path)).toBe("Unrelated personal note");
			expect(files.size).toBe(2);
			const again = await importConversationRecords(
				[record],
				{ ...standardOptions, overwriteOnReimport },
				context
			);
			expect(again[overwriteOnReimport ? "overwritten" : "skipped"]).toBe(1);
			expect(files.size).toBe(2);
		}
	);

	it("never overwrites an occupied note carrying a different full conversation ID", async () => {
		const { files, context } = fixture();
		const record = baseConversation();
		const requested = `notes/${buildConversationFileName(record.title, record.conversationId, record.createdAt)}`;
		const unrelated =
			'---\nai_source: "chatgpt"\nai_conversation_id: "conv-12345678-other"\n---\nkeep';
		files.set(requested, { kind: "text", content: unrelated });
		const result = await importConversationRecords([record], standardOptions, context);
		expect(result.imported).toBe(1);
		expect(noteContent(files, requested)).toBe(unrelated);
	});

	it("treats dot as the vault root and reimports its matching note in place", async () => {
		const { files, context } = fixture();
		const options = { ...standardOptions, notesDirectory: "." };
		await importConversationRecords([baseConversation()], options, context);
		const paths = [...files.keys()];
		const result = await importConversationRecords([baseConversation()], options, context);
		expect(result.overwritten).toBe(1);
		expect([...files.keys()]).toEqual(paths);
	});

	it("prefers a source-specific match over a no-source legacy duplicate", async () => {
		const { files, context } = fixture();
		const legacy = '---\nai_conversation_id: "conv-12345678"\n---\nlegacy';
		files.set("notes/legacy.md", { kind: "text", content: legacy });
		files.set("notes/current.md", {
			kind: "text",
			content: '---\nai_source: "chatgpt"\nai_conversation_id: "conv-12345678"\n---\ncurrent'
		});
		const result = await importConversationRecords(
			[baseConversation()],
			standardOptions,
			context
		);
		expect(result.overwritten).toBe(1);
		expect(noteContent(files, "notes/legacy.md")).toBe(legacy);
		expect(noteContent(files, "notes/current.md")).toContain("# Hello world");
	});

	it("does not overwrite a note with the same ID belonging to a different source", async () => {
		const { files, context } = fixture();
		const first = baseConversation({ source: "claude" });
		await importConversationRecords([first], standardOptions, context);
		const path = [...files.keys()][0];
		const content = noteContent(files, path);
		const result = await importConversationRecords(
			[baseConversation()],
			standardOptions,
			context
		);
		expect(result.imported).toBe(1);
		expect(noteContent(files, path)).toBe(content);
		expect(files.size).toBe(2);
	});

	it("prefers the matching renamed legacy path even if the proposed path is occupied", async () => {
		const { files, context } = fixture();
		const record = baseConversation();
		const requested = `notes/${buildConversationFileName(record.title, record.conversationId, record.createdAt)}`;
		files.set(requested, { kind: "text", content: "unrelated" });
		files.set("notes/manually renamed.md", {
			kind: "text",
			content: "---\r\nai_conversation_id: 'conv-12345678'\r\n---\r\nold"
		});
		const result = await importConversationRecords([record], standardOptions, context);
		expect(result.overwritten).toBe(1);
		expect(noteContent(files, requested)).toBe("unrelated");
		expect(noteContent(files, "notes/manually renamed.md")).toContain("# Hello world");
		expect(files.size).toBe(2);
	});

	it("indexes once per import and never reads or overwrites notes outside notesDirectory", async () => {
		const { files, context } = fixture();
		files.set("elsewhere/match.md", {
			kind: "text",
			content: '---\nai_conversation_id: "conv-12345678"\n---\nprivate'
		});
		files.set("notes-other/private.md", { kind: "text", content: "private" });
		let lists = 0;
		const reads: string[] = [];
		const list = context.target.listMarkdownFiles;
		const read = context.target.readText;
		context.target.listMarkdownFiles = async () => {
			lists += 1;
			return list();
		};
		context.target.readText = async (path) => {
			reads.push(path);
			return read(path);
		};
		const result = await importConversationRecords(
			[baseConversation(), baseConversation({ conversationId: "other" })],
			standardOptions,
			context
		);
		expect(result.imported).toBe(2);
		expect(lists).toBe(1);
		expect(reads).toEqual([]);
		expect(noteContent(files, "elsewhere/match.md")).toContain("private");
	});

	it("copies same-name different-ID attachments separately and reimports idempotently", async () => {
		const { files, context } = fixture();
		const record = withAttachments();
		await importConversationRecords([record], standardOptions, context);
		const binaries = [...files.entries()].filter(([, file]) => file.kind === "binary");
		expect(binaries).toHaveLength(2);
		expect(binaries.map(([, file]) => Array.from(file.content as Uint8Array))).toEqual([
			[1],
			[2]
		]);
		const before = [...files.keys()];
		const result = await importConversationRecords(
			[withAttachments()],
			standardOptions,
			context
		);
		expect(result.overwritten).toBe(1);
		expect([...files.keys()]).toEqual(before);
		const note = noteContent(
			files,
			before.find((path) => path.startsWith("notes/"))!
		);
		for (const [path] of binaries) expect(note).toContain(`![[${path}]]`);
	});

	it("namespaces equal attachment IDs across conversations and sources", async () => {
		const { files, context } = fixture();
		const records = [
			withAttachments("first", ["a"]),
			withAttachments("second", ["a"]),
			{ ...withAttachments("first", ["a"]), source: "claude" }
		];
		const result = await importConversationRecords(records, standardOptions, context);
		expect(result.imported).toBe(3);
		expect([...files.values()].filter((file) => file.kind === "binary")).toHaveLength(3);
	});

	it("copies repeated attachment IDs only once and renders the same link", async () => {
		const { files, context } = fixture();
		const record = withAttachments("conv", ["a", "a"]);
		record.messages.push({ ...record.messages[0], id: "m2" });
		let reads = 0;
		const read = context.source.readBinary;
		context.source.readBinary = async (path) => {
			reads += 1;
			return read(path);
		};
		await importConversationRecords([record], standardOptions, context);
		expect(reads).toBe(1);
		expect([...files.values()].filter((file) => file.kind === "binary")).toHaveLength(1);
		const links = record.messages.flatMap((message) =>
			message.attachments.map((attachment) => attachment.obsidianLink)
		);
		expect(new Set(links).size).toBe(1);
	});

	it("skips before attachment reads, folder creation, writes, or record mutation", async () => {
		const { files, folders, context } = fixture();
		files.set("notes/renamed.md", {
			kind: "text",
			content: '---\nai_conversation_id: "conv-12345678"\n---\nkeep'
		});
		const record = withAttachments();
		const original = JSON.stringify(record);
		context.source.readBinary = async () => {
			throw new Error("must not read");
		};
		context.target.writeBinary = async () => {
			throw new Error("must not write");
		};
		context.target.writeText = async () => {
			throw new Error("must not write");
		};
		const result = await importConversationRecords(
			[record],
			{ ...standardOptions, overwriteOnReimport: false },
			context
		);
		expect(result).toEqual({ imported: 0, overwritten: 0, skipped: 1, errors: [] });
		expect(JSON.stringify(record)).toBe(original);
		expect(folders.size).toBe(0);
		expect(files.size).toBe(1);
	});

	it("updates the in-memory identity index for repeated records and custom templates", async () => {
		const { files, context } = fixture();
		files.set("custom.md", { kind: "text", content: "{{ conversation.title }}" });
		const result = await importConversationRecords(
			[baseConversation(), baseConversation()],
			{
				...standardOptions,
				overwriteOnReimport: false,
				customTemplatePath: "custom.md"
			},
			context
		);
		expect(result).toEqual({ imported: 1, overwritten: 0, skipped: 1, errors: [] });
	});

	it("preserves old bytes when the same attachment ID is reused with changed data", async () => {
		const { files, context } = fixture();
		await importConversationRecords([withAttachments("conv", ["a"])], standardOptions, context);
		const originalPaths = [...files.keys()];
		context.source.readBinary = async () => new Uint8Array([99]);
		const changed = await importConversationRecords(
			[withAttachments("conv", ["a"])],
			standardOptions,
			context
		);
		expect(changed.errors).toEqual([]);
		const binaries = [...files.values()].filter((file) => file.kind === "binary");
		expect(binaries.map((file) => [...(file.content as Uint8Array)])).toEqual([[1], [99]]);
		const after = [...files.keys()];
		await importConversationRecords([withAttachments("conv", ["a"])], standardOptions, context);
		expect([...files.keys()]).toEqual(after);
		expect(after).toEqual(expect.arrayContaining(originalPaths));
	});

	it("keeps custom template identities across separate imports and title changes", async () => {
		const { files, context } = fixture();
		files.set("custom.md", { kind: "text", content: "TITLE={{ conversation.title }}" });
		const options = { ...standardOptions, customTemplatePath: "custom.md" };
		await importConversationRecords([baseConversation()], options, context);
		const before = [...files.keys()];
		const result = await importConversationRecords(
			[baseConversation({ title: "New title" })],
			options,
			context
		);
		expect(result.overwritten).toBe(1);
		expect([...files.keys()]).toEqual(before);
	});

	it.each(["../outside", "/absolute", "C:\\outside", "notes/../../outside"])(
		"rejects unsafe vault directory %s",
		async (notesDirectory) => {
			const { files, context } = fixture();
			await expect(
				importConversationRecords(
					[baseConversation()],
					{ ...standardOptions, notesDirectory },
					context
				)
			).rejects.toThrow("Unsafe vault path");
			expect(files.size).toBe(0);
		}
	);
});
