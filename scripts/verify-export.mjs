// Local, offline integration check. Never writes to the source export or seed vault.
// Usage: node scripts/verify-export.mjs --export /extracted/export --output /new/empty/vault
// Optional: --seed /existing/vault --all-branches --expect-count 1313
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const args = process.argv.slice(2);
const option = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const exportDir = option("--export");
const output = option("--output");
if (!exportDir || !output)
	throw new Error("Supply --export and --output (a new or empty directory)");
const sourceRoot = path.resolve(exportDir),
	outputRoot = path.resolve(output);
const seed = option("--seed") && path.resolve(option("--seed"));
if (
	outputRoot === sourceRoot ||
	sourceRoot.startsWith(outputRoot + path.sep) ||
	outputRoot.startsWith(sourceRoot + path.sep)
)
	throw new Error("Export and output must be disjoint");
if (
	seed &&
	(outputRoot === seed ||
		seed.startsWith(outputRoot + path.sep) ||
		outputRoot.startsWith(seed + path.sep))
)
	throw new Error("Seed and output must be disjoint");
const exists = async (p) => {
	try {
		await fs.access(p);
		return true;
	} catch (e) {
		if (e.code === "ENOENT") return false;
		throw e;
	}
};
if ((await exists(outputRoot)) && (await fs.readdir(outputRoot)).length)
	throw new Error("Output directory is not empty");
await fs.mkdir(outputRoot, { recursive: true });
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundled = await build({
	entryPoints: [path.join(repo, "packages/chatgpt/src/index.ts")],
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false
});
const module = { exports: {} };
runInNewContext(bundled.outputFiles[0].text, {
	module,
	exports: module.exports,
	require: createRequire(import.meta.url),
	console,
	Buffer,
	TextEncoder,
	TextDecoder,
	setTimeout,
	clearTimeout
});
const { importChatGptExport } = module.exports;
const source = {
	readText: (p) => fs.readFile(p, "utf8"),
	readBinary: async (p) => new Uint8Array(await fs.readFile(p)),
	exists,
	listDir: async (dir) =>
		(await fs.readdir(dir, { withFileTypes: true })).map((e) => ({
			name: e.name,
			path: path.join(dir, e.name),
			isFile: e.isFile(),
			isDirectory: e.isDirectory()
		}))
};
const targetPath = (p) => {
	const resolved = path.resolve(outputRoot, p);
	if (!resolved.startsWith(outputRoot + path.sep)) throw new Error("Unsafe target path");
	return resolved;
};
async function filesUnder(root) {
	const result = [];
	if (!(await exists(root))) return result;
	for (const e of await fs.readdir(root, { withFileTypes: true })) {
		const p = path.join(root, e.name);
		if (e.isDirectory()) result.push(...(await filesUnder(p)));
		else if (e.isFile()) result.push(p);
	}
	return result.sort();
}
const target = {
	listMarkdownFiles: async () =>
		(await filesUnder(outputRoot))
			.filter((p) => p.endsWith(".md"))
			.map((p) => ({ path: path.relative(outputRoot, p).split(path.sep).join("/") })),
	readText: (p) => fs.readFile(targetPath(p), "utf8"),
	readBinary: async (p) => new Uint8Array(await fs.readFile(targetPath(p))),
	writeText: (p, s) => fs.writeFile(targetPath(p), s),
	writeBinary: (p, b) => fs.writeFile(targetPath(p), b),
	createFolder: (p) => fs.mkdir(targetPath(p), { recursive: true }),
	exists: (p) => exists(targetPath(p))
};
const vaultPath = {
	join: (...p) => p.filter(Boolean).join("/").normalize("NFC"),
	normalize: (p) => p.normalize("NFC").replace(/\/{2,}/g, "/"),
	dirname: (p) => (path.posix.dirname(p) === "." ? "" : path.posix.dirname(p))
};
const options = {
	exportDir: sourceRoot,
	notesDirectory: "AI Chat History/ChatGPT",
	attachmentsDirectory: "AI Chat History/Attachments",
	overwriteOnReimport: true,
	excludeThoughts: true,
	excludeToolCalls: true,
	excludeThoughtTime: true,
	includeAllBranches: args.includes("--all-branches")
};
if (seed) {
	for (const folder of [options.notesDirectory, options.attachmentsDirectory]) {
		const from = path.join(seed, folder);
		if (await exists(from))
			await fs.cp(from, path.join(outputRoot, folder), { recursive: true });
	}
}
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function snapshot() {
	const data = {};
	for (const p of await filesUnder(outputRoot))
		data[path.relative(outputRoot, p)] = hash(await fs.readFile(p));
	return data;
}
const params = { source, target, options, vaultPath, exportPath: { join: path.join } };
const first = await importChatGptExport(params);
assert.equal(first.errors.length, 0, JSON.stringify(first.errors));
const before = await snapshot();
const second = await importChatGptExport(params);
assert.equal(second.errors.length, 0, JSON.stringify(second.errors));
assert.deepEqual(await snapshot(), before, "Overwrite reimport changed file contents or paths");
const third = await importChatGptExport({
	...params,
	options: { ...options, overwriteOnReimport: false }
});
assert.equal(third.errors.length, 0, JSON.stringify(third.errors));
assert.deepEqual(await snapshot(), before, "Skip reimport changed files");

const notes = new Map();
for (const { path: p } of await target.listMarkdownFiles()) {
	const s = await target.readText(p);
	const id = /^ai_conversation_id: (.+)$/m.exec(s);
	if (!id) continue;
	const key = JSON.parse(id[1]);
	assert.ok(!notes.has(key), "Duplicate note identity");
	notes.set(key, { p, s });
}
if (option("--expect-count")) assert.equal(notes.size, Number(option("--expect-count")));
const manifestPath = path.join(sourceRoot, "export_manifest.json");
const manifest = (await exists(manifestPath))
	? JSON.parse(await source.readText(manifestPath))
	: {};
const shardNames = (await exists(path.join(sourceRoot, "conversations.json")))
	? ["conversations.json"]
	: (manifest.logical_files?.["conversations.json"]?.files ??
		(await fs.readdir(sourceRoot)).filter((n) => /^conversations-\d+\.json$/.test(n)).sort());
const conversations = [];
for (const n of shardNames)
	conversations.push(...JSON.parse(await source.readText(path.join(sourceRoot, n))));
const assetFiles = await filesUnder(sourceRoot);
let transcripts = 0,
	pointerAssets = 0,
	attachmentLinks = 0;
for (const c of conversations) {
	const mapping = c.mapping ?? {};
	let selected = [];
	if (options.includeAllBranches || !mapping[c.current_node]) selected = Object.values(mapping);
	else {
		let k = c.current_node;
		const seen = new Set();
		while (k && mapping[k] && !seen.has(k)) {
			seen.add(k);
			selected.push(mapping[k]);
			k = mapping[k].parent;
		}
	}
	const note = notes.get(c.id ?? c.conversation_id);
	for (const n of selected) {
		const m = n.message;
		if (!m || m.metadata?.is_visually_hidden_from_conversation) continue;
		for (const part of m.content?.parts ?? []) {
			if (!part || typeof part !== "object") continue;
			if (part.content_type === "audio_transcription" && typeof part.text === "string") {
				assert.ok(note?.s.includes(part.text.trim()), "Lost voice transcript");
				transcripts++;
			}
			if (
				part.content_type === "image_asset_pointer" &&
				typeof part.asset_pointer === "string"
			) {
				const id = part.asset_pointer.split("://")[1];
				const file = assetFiles.find((p) => path.basename(p) === id + ".dat");
				if (!file) continue;
				assert.ok(note, "Lost image-only conversation");
				const expected = hash(await fs.readFile(file));
				let matched = false;
				for (const link of note.s.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
					if (!link[1].startsWith(options.attachmentsDirectory + "/")) continue;
					if (hash(await fs.readFile(targetPath(link[1]))) === expected) {
						matched = true;
						break;
					}
				}
				assert.ok(matched, `Lost image pointer ${id}`);
				pointerAssets++;
			}
		}
	}
}
const sourceHashes = new Set();
for (const p of assetFiles.filter((p) => p.endsWith(".dat")))
	sourceHashes.add(hash(await fs.readFile(p)));
let binaryCount = 0;
for (const p of await filesUnder(path.join(outputRoot, options.attachmentsDirectory))) {
	assert.ok(
		sourceHashes.has(hash(await fs.readFile(p))),
		"Attachment does not match any source bytes"
	);
	binaryCount++;
}
for (const { s } of notes.values())
	for (const link of s.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
		if (link[1].startsWith(options.attachmentsDirectory + "/")) {
			assert.ok(await exists(targetPath(link[1])), "Broken attachment link");
			attachmentLinks++;
		}
	}
const result = {
	sourceConversations: conversations.length,
	notes: notes.size,
	first,
	overwriteReimport: second,
	skipReimport: third,
	verifiedVoiceTranscripts: transcripts,
	verifiedImagePointers: pointerAssets,
	attachmentFiles: binaryCount,
	verifiedAttachmentLinks: attachmentLinks,
	idempotent: true,
	includeAllBranches: options.includeAllBranches
};
await fs.writeFile(
	path.join(outputRoot, "verification-result.json"),
	JSON.stringify(result, null, 2) + "\n"
);
console.log(JSON.stringify(result, null, 2));
