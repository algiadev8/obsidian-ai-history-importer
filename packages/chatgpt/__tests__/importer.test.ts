import { describe, expect, it } from "vitest";
import type {
	ExportPathApi,
	ExportSource,
	ImportTarget,
	VaultPathApi
} from "@obsidian-ai-history-importer/core";
import { importChatGptExport } from "../src";

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

function createExportPathApi(): ExportPathApi {
	return {
		join: (...parts) => parts.filter(Boolean).join("/").replace(/\/+/g, "/")
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

	return { target, files };
}

function buildConversationJson(attachmentId: string) {
	return JSON.stringify([
		{
			id: "c1",
			title: "attachments",
			current_node: "n1",
			mapping: {
				n1: {
					id: "n1",
					parent: null,
					children: [],
					message: {
						id: "m1",
						author: { role: "assistant" },
						content: { content_type: "text", parts: ["hi"] },
						metadata: {
							attachments: [
								{ id: attachmentId, name: "photo.jpg", mime_type: "image/jpeg" }
							]
						}
					}
				}
			}
		}
	]);
}

describe("asset recovery and manifest validation", () => {
	async function run(
		textFiles: Map<string, string>,
		binaryFiles = new Map<string, Uint8Array>()
	) {
		const entries = [...binaryFiles.keys()].map((path) => ({
			path,
			name: path.split("/").pop()!,
			isFile: true,
			isDirectory: false
		}));
		const { target, files } = createImportTarget();
		const result = await importChatGptExport({
			options: {
				exportDir: "/export",
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: true
			},
			source: createExportSource(textFiles, binaryFiles, new Map([["/export", entries]])),
			target,
			exportPath: createExportPathApi(),
			vaultPath: createVaultPathApi()
		});
		return { result, files };
	}
	it("recovers a metadata-free image using pointer and asset-name map", async () => {
		const data = JSON.parse(buildConversationJson("unused"));
		delete data[0].mapping.n1.message.metadata;
		data[0].mapping.n1.message.content = {
			content_type: "multimodal_text",
			parts: [
				{ content_type: "image_asset_pointer", asset_pointer: "file-service://file-img" }
			]
		};
		const { result, files } = await run(
			new Map([
				["/export/conversations.json", JSON.stringify(data)],
				[
					"/export/conversation_asset_file_names.json",
					JSON.stringify({ "file-img.dat": "画像.png" })
				]
			]),
			new Map([["/export/file-img.dat", new Uint8Array([1, 2, 3])]])
		);
		expect(result.imported).toBe(1);
		expect(result.warnings).toEqual([]);
		const binaryPath = [...files.keys()].find((path) => path.startsWith("attachments/"))!;
		expect(binaryPath).toMatch(/\.png$/);
		const note = [...files.values()].find((e) => e.kind === "text")!;
		expect(note.content).toContain(`![[${binaryPath}]]`);
	});
	it("recovers exact library origins without attaching unrelated library files", async () => {
		const data = JSON.parse(buildConversationJson("unused"));
		delete data[0].mapping.n1.message.metadata;
		const { result, files } = await run(
			new Map([
				["/export/conversations.json", JSON.stringify(data)],
				[
					"/export/library_files.json",
					JSON.stringify([
						{
							file_id: "file_doc",
							file_name: "report.pdf",
							origination_thread_id: "c1",
							origination_message_id: "m1"
						},
						{
							file_id: "file_other",
							file_name: "other.pdf",
							origination_thread_id: "different",
							origination_message_id: "m1"
						}
					])
				]
			]),
			new Map([
				["/export/file_doc.dat", new Uint8Array([1])],
				["/export/file_other.dat", new Uint8Array([2])]
			])
		);
		expect(result.imported).toBe(1);
		expect([...files.keys()].filter((p) => p.startsWith("attachments/"))).toHaveLength(1);
		expect([...files.keys()].join()).toContain("file_doc");
	});
	it("reports absent or ambiguous assets rather than guessing a binary", async () => {
		const { result, files } = await run(
			new Map([["/export/conversations.json", buildConversationJson("file-aaa")]]),
			new Map([
				["/export/file-aaa-one.png", new Uint8Array([1])],
				["/export/file-aaa-two.png", new Uint8Array([2])]
			])
		);
		expect(result.warnings).toEqual(["Ambiguous exported attachment: file-aaa"]);
		expect([...files.keys()].some((p) => p.startsWith("attachments/"))).toBe(false);
		const missing = await run(
			new Map([["/export/conversations.json", buildConversationJson("file-missing")]])
		);
		expect(missing.result.warnings).toEqual(["Missing exported attachment: file-missing"]);
	});
	it.each([
		"../secret.json",
		"/secret.json",
		"C:\\secret.json",
		"conversations-000.json/../../secret"
	])("rejects manifest traversal: %s", async (file) => {
		await expect(
			run(
				new Map([
					[
						"/export/export_manifest.json",
						JSON.stringify({
							logical_files: { "conversations.json": { files: [file] } }
						})
					]
				])
			)
		).rejects.toThrow("Invalid conversation shard path");
	});
});

describe("importChatGptExport", () => {
	it("imports sharded conversations listed in export manifest", async () => {
		const exportDir = "/export";
		const manifestPath = "/export/export_manifest.json";
		const firstShardPath = "/export/conversations-000.json";
		const secondShardPath = "/export/conversations-001.json";
		const textFiles = new Map([
			[
				manifestPath,
				JSON.stringify({
					logical_files: {
						"conversations.json": {
							files: ["conversations-000.json", "conversations-001.json"],
							sharded: true
						}
					}
				})
			],
			[firstShardPath, buildConversationJson("file-aaa")],
			[
				secondShardPath,
				JSON.stringify([
					{
						id: "c2",
						title: "second shard",
						current_node: "n1",
						mapping: {
							n1: {
								id: "n1",
								parent: null,
								children: [],
								message: {
									id: "m1",
									author: { role: "user" },
									content: { content_type: "text", parts: ["from shard two"] },
									metadata: { attachments: [] }
								}
							}
						}
					}
				])
			]
		]);

		const source = createExportSource(textFiles, new Map(), new Map());
		const { target, files } = createImportTarget();
		const result = await importChatGptExport({
			options: {
				exportDir,
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: false
			},
			source,
			target,
			exportPath: createExportPathApi(),
			vaultPath: createVaultPathApi()
		});

		expect(result.imported).toBe(2);
		const markdownContents = [...files.entries()]
			.filter(([path]) => path.endsWith(".md"))
			.map(([, entry]) => (entry as { kind: "text"; content: string }).content);
		expect(markdownContents.join("\n")).toContain("hi");
		expect(markdownContents.join("\n")).toContain("from shard two");
	});

	it("imports conversations and resolves attachments by id prefix", async () => {
		const exportDir = "/export";
		const filePath = "/export/file-aaa-photo.jpg";
		const conversationsPath = "/export/conversations.json";

		const textFiles = new Map([[conversationsPath, buildConversationJson("file-aaa")]]);
		const binaryFiles = new Map([[filePath, new Uint8Array([1, 2, 3])]]);
		const entriesByDir = new Map([
			[
				exportDir,
				[
					{
						name: "file-aaa-photo.jpg",
						path: filePath,
						isDirectory: false,
						isFile: true
					}
				]
			]
		]);

		const source = createExportSource(textFiles, binaryFiles, entriesByDir);
		const { target, files } = createImportTarget();
		const result = await importChatGptExport({
			options: {
				exportDir,
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: false
			},
			source,
			target,
			exportPath: createExportPathApi(),
			vaultPath: createVaultPathApi()
		});

		expect(result.imported).toBe(1);
		const attachmentPath = [...files.keys()].find(
			(path) => path.startsWith("attachments/") && path.endsWith(".jpg")
		)!;
		expect(attachmentPath).toContain("file-aaa");
		const notePath = [...files.keys()].find((path) => path.endsWith(".md"))!;
		const content = (files.get(notePath) as { kind: "text"; content: string }).content;
		expect(content).toContain(`![[${attachmentPath}]]`);
	});

	it("respects attachment scan depth", async () => {
		const exportDir = "/export";
		const nestedDir = "/export/nested";
		const filePath = "/export/nested/file-bbb-photo.jpg";
		const conversationsPath = "/export/conversations.json";

		const textFiles = new Map([[conversationsPath, buildConversationJson("file-bbb")]]);
		const binaryFiles = new Map([[filePath, new Uint8Array([4])]]);
		const entriesByDir = new Map([
			[
				exportDir,
				[
					{
						name: "nested",
						path: nestedDir,
						isDirectory: true,
						isFile: false
					}
				]
			],
			[
				nestedDir,
				[
					{
						name: "file-bbb-photo.jpg",
						path: filePath,
						isDirectory: false,
						isFile: true
					}
				]
			]
		]);

		const source = createExportSource(textFiles, binaryFiles, entriesByDir);
		const { target, files } = createImportTarget();
		const result = await importChatGptExport({
			options: {
				exportDir,
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: false,
				attachmentScanDepth: 0
			},
			source,
			target,
			exportPath: createExportPathApi(),
			vaultPath: createVaultPathApi()
		});

		expect(result.imported).toBe(1);
		expect(files.has("attachments/photo.jpg")).toBe(false);
		const notePath = [...files.keys()].find((path) => path.endsWith(".md"))!;
		const content = (files.get(notePath) as { kind: "text"; content: string }).content;
		expect(content).toContain("`file-bbb`");
	});

	it("filters system and hidden messages by default", async () => {
		const exportDir = "/export";
		const conversationsPath = "/export/conversations.json";
		const data = JSON.stringify([
			{
				id: "c2",
				title: "roles",
				current_node: "n2",
				mapping: {
					n1: {
						id: "n1",
						parent: null,
						children: ["n2"],
						message: {
							id: "m1",
							author: { role: "system" },
							content: { content_type: "text", parts: ["system"] },
							metadata: { attachments: [] }
						}
					},
					n2: {
						id: "n2",
						parent: "n1",
						children: [],
						message: {
							id: "m2",
							author: { role: "assistant" },
							content: { content_type: "text", parts: ["visible"] },
							metadata: {
								is_visually_hidden_from_conversation: true,
								attachments: []
							}
						}
					}
				}
			}
		]);

		const source = createExportSource(
			new Map([[conversationsPath, data]]),
			new Map(),
			new Map()
		);
		const { target, files } = createImportTarget();
		const result = await importChatGptExport({
			options: {
				exportDir,
				notesDirectory: "notes",
				attachmentsDirectory: "attachments",
				overwriteOnReimport: false
			},
			source,
			target,
			exportPath: createExportPathApi(),
			vaultPath: createVaultPathApi()
		});

		expect(result.imported).toBe(0);
		expect(files.size).toBe(0);
	});
});
