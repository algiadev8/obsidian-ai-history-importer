import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

class TFile {
	constructor(path) {
		this.path = path;
	}
}
class TFolder {
	constructor(path) {
		this.path = path;
	}
}
const bundled = await build({
	entryPoints: ["src/vault-target.ts"],
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
	external: ["obsidian"]
});
const module = { exports: {} };
runInNewContext(bundled.outputFiles[0].text, {
	module,
	exports: module.exports,
	Uint8Array,
	require: () => ({ TFile, TFolder, normalizePath: (path) => path.normalize("NFC") })
});
const { createVaultTarget } = module.exports;
const vault = (overrides) => ({ getAbstractFileByPath: () => null, ...overrides });

test("does not count a null or wrong-path Vault create result as success", async () => {
	for (const result of [null, new TFile("wrong.md")]) {
		const target = createVaultTarget(
			vault({ create: async () => result, createBinary: async () => result })
		);
		await assert.rejects(target.writeText("note.md", "body"), /did not register/);
		await assert.rejects(
			target.writeBinary("asset.dat", new Uint8Array([1])),
			/did not register/
		);
	}
});
test("accepts a normalized supplementary Unicode path returned by the Vault", async () => {
	const path = "論文リスト\u{4E7C2}.md";
	await createVaultTarget(vault({ create: async () => new TFile(path) })).writeText(path, "body");
});
test("does not overwrite a folder as a file or accept a file as a folder", async () => {
	const target = createVaultTarget(vault({ getAbstractFileByPath: (path) => new TFolder(path) }));
	await assert.rejects(target.writeText("folder", "body"), /folder occupies/);
	await assert.rejects(target.writeBinary("folder", new Uint8Array()), /folder occupies/);
	await assert.rejects(
		createVaultTarget(vault({ getAbstractFileByPath: (path) => new TFile(path) })).createFolder(
			"file"
		),
		/file occupies/
	);
});
test("propagates disk errors", async () => {
	await assert.rejects(
		createVaultTarget(
			vault({
				create: async () => {
					throw new Error("disk full");
				}
			})
		).writeText("x.md", "body"),
		/disk full/
	);
});
test("uses uncached reads and copies just the supplied Uint8Array slice", async () => {
	let bytes;
	const file = new TFile("note.md");
	const target = createVaultTarget(
		vault({
			getAbstractFileByPath: () => file,
			read: async () => "current",
			modifyBinary: async (_file, data) => {
				bytes = [...new Uint8Array(data)];
			}
		})
	);
	assert.equal(await target.readText("note.md"), "current");
	await target.writeBinary("note.md", new Uint8Array([0, 1, 2, 3]).subarray(1, 3));
	assert.deepEqual(bytes, [1, 2]);
});
