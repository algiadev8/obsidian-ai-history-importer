import esbuild from "esbuild";
import {
	cpSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const pluginRoot = process.cwd();
const repoRoot = resolve(pluginRoot, "../..");
const vaultRoot = resolve(repoRoot, "vault");
const vaultConfigRoot = resolve(vaultRoot, ".obsidian");
const localPluginsRoot = resolve(vaultConfigRoot, "plugins");

const pkgPath = join(pluginRoot, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const manifestPath = resolve(pluginRoot, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const pluginId = manifest.id;

const banner = `/*\n${pkg.name} v${pkg.version}\n*/`;
const workspaceAliases = {
	"@obsidian-ai-history-importer/core": resolve(repoRoot, "packages/core/src"),
	"@obsidian-ai-history-importer/chatgpt": resolve(repoRoot, "packages/chatgpt/src"),
	"@obsidian-ai-history-importer/claude": resolve(repoRoot, "packages/claude/src")
};

const publishFiles = [
	{ from: "main.js", to: "main.js" },
	{ from: "manifest.json", to: "manifest.json" },
	{ from: "styles.css", to: "styles.css" }
];

function copyPublishFiles() {
	const targetPluginRoot = resolve(localPluginsRoot, pluginId);
	mkdirSync(targetPluginRoot, { recursive: true });

	for (const { from, to } of publishFiles) {
		const sourcePath = resolve(pluginRoot, from);
		if (!existsSync(sourcePath)) continue;
		const targetPath = resolve(targetPluginRoot, to);
		copyFileSync(sourcePath, targetPath);
	}
}

function ensureHotReloadPlugin() {
	const targetDir = resolve(localPluginsRoot, "hot-reload");
	const targetManifestPath = resolve(targetDir, "manifest.json");
	if (existsSync(targetManifestPath)) {
		return;
	}

	mkdirSync(localPluginsRoot, { recursive: true });

	const tempDir = mkdtempSync(join(tmpdir(), "hot-reload-"));
	try {
		execFileSync(
			"git",
			["clone", "--depth", "1", "https://github.com/pjeby/hot-reload", tempDir],
			{
				stdio: "inherit"
			}
		);

		mkdirSync(targetDir, { recursive: true });
		for (const fileName of ["main.js", "manifest.json", "styles.css"]) {
			const fromPath = resolve(tempDir, fileName);
			if (!existsSync(fromPath)) continue;
			copyFileSync(fromPath, resolve(targetDir, fileName));
		}

		const srcDir = resolve(tempDir, "src");
		if (existsSync(srcDir)) {
			cpSync(srcDir, resolve(targetDir, "src"), { recursive: true });
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

// Production and CI builds must not clone or install development plugins.
const watch = process.argv.includes("--watch");
if (watch) ensureHotReloadPlugin();

const ctx = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	format: "cjs",
	target: "es2018",
	sourcemap: "inline",
	banner: { js: banner },
	outfile: "main.js",
	alias: workspaceAliases,
	external: ["obsidian", "fs", "path", "node:fs", "node:path"],
	platform: "browser",
	plugins: [
		{
			name: "copy-publish-files",
			setup(build) {
				build.onEnd(() => copyPublishFiles());
			}
		}
	]
});

if (watch) {
	await ctx.watch();
	console.log("watching...");
} else {
	await ctx.rebuild();
	copyPublishFiles();
	await ctx.dispose();
}
