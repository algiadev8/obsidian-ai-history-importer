import { describe, expect, it } from "vitest";
import {
	buildAttachmentFileName,
	buildConversationFileName,
	sanitizeFileName
} from "../src/path-utils";

const bytes = (value: string) => new TextEncoder().encode(value).length;

describe("safe identity-based filenames", () => {
	it("retains full conversation IDs rather than their first eight characters", () => {
		const first = buildConversationFileName("title", "12345678-aaaa");
		const second = buildConversationFileName("title", "12345678-bbbb");
		expect(first).toContain("12345678-aaaa");
		expect(first).not.toBe(second);
	});

	it("does not collapse IDs containing path separators, punctuation, or literal escapes", () => {
		const ids = [
			"a/b",
			"a\\b",
			"a b",
			"a~2f~b",
			"a:b",
			"a?b",
			"a#b",
			"a[b]",
			"a.b",
			"ab",
			"AB",
			"Ab",
			""
		];
		expect(
			new Set(ids.map((id) => buildConversationFileName("same", id).toLowerCase())).size
		).toBe(ids.length);
		for (const id of ids) {
			expect(buildConversationFileName("same", id)).not.toMatch(/[/\\<>:"|?*[\]#^]/);
		}
	});

	it("truncates a supplementary title at the 80-character boundary without splitting a surrogate", () => {
		const title = `${"a".repeat(79)}😀tail`;
		const filename = buildConversationFileName(title, "id");
		expect(filename).toBe(`unknown-${"a".repeat(79)}😀-id.md`);
		expect(
			new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(filename))
		).toBe(filename);
		expect(filename).not.toContain("\ufffd");
	});

	it("obeys the UTF-8 byte budget with Japanese and supplementary titles", () => {
		for (const title of ["日本語".repeat(100), "😀".repeat(100), "a".repeat(500)]) {
			const filename = buildConversationFileName(
				title,
				"12345678-abcd-efgh-ijkl-123456789012",
				"2024-01-01"
			);
			expect(bytes(filename)).toBeLessThanOrEqual(240);
			expect(filename).not.toMatch(/[\ud800-\udfff]/u);
			expect(filename.endsWith("12345678-abcd-efgh-ijkl-123456789012.md")).toBe(true);
		}
	});

	it("removes an unassigned code point rejected by APFS", () => {
		expect(
			buildConversationFileName("論文リスト\u{4E7C2}", "12345678-1234-1234-1234-123456789abc")
		).toBe("unknown-論文リスト-12345678-1234-1234-1234-123456789abc.md");
		expect(sanitizeFileName("😀音声")).toBe("😀音声");
	});

	it("normalizes names to NFC and removes traversal, Windows stems, and wiki syntax", () => {
		expect(sanitizeFileName("Cafe\u0301")).toBe("Café");
		for (const stem of ["CON", "con.txt", "NUL", "aux.jpg", "COM1", "LPT9", "COM¹.txt"]) {
			expect(sanitizeFileName(stem).startsWith("_")).toBe(true);
		}
		for (const name of [
			"../..",
			"..",
			".",
			"file. ",
			"[[a#b^c|d]]",
			"a\u0000b",
			"bad\ud800name"
		]) {
			const sanitized = sanitizeFileName(name);
			expect(sanitized).not.toMatch(/[/\\<>:"|?*[\]#^\p{Cc}]/u);
			expect(sanitized).not.toMatch(/[. ]$/);
			expect(sanitized).not.toBe("..");
		}
	});

	it("gives same-name attachments stable distinct per-ID names and preserves extensions", () => {
		const first = buildAttachmentFileName("photo.jpg", "/export/a", "full-id-a");
		expect(first).toBe("photo--full-id-a.jpg");
		expect(first).not.toBe(buildAttachmentFileName("photo.jpg", "/export/b", "full-id-b"));
		expect(first).toBe(buildAttachmentFileName("photo.jpg", "/export/a", "full-id-a"));
		expect(buildAttachmentFileName("photo", "/export/a.png", "id")).toBe("photo--id.png");
	});

	it("handles very long Japanese attachment names within the UTF-8 component budget", () => {
		const filename = buildAttachmentFileName(
			`${"添付資料😀".repeat(200)}.png`,
			"/export/a",
			"file-12345678-abcd-efgh-ijkl-123456789012",
			"chatgpt:conversation"
		);
		expect(bytes(filename)).toBeLessThanOrEqual(240);
		expect(filename.endsWith("file-12345678-abcd-efgh-ijkl-123456789012.png")).toBe(true);
		expect(filename).not.toMatch(/[\ud800-\udfff]/u);
	});

	it.each([
		["namespace", "c664670b10d6de79c5aa1711e1d470907125878fa14bbb52c356482498e6aab6"],
		["", "12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126"],
		["a".repeat(100), "9391a07725c98cf85690b4a992a923ca96c7026e9291ef811844d9868734f4e3"],
		["日本語😀", "65b627706f0810fff978c9d1c160d453cdc523d2465be9ae2cfdd91cdf349b77"]
	])("uses standard SHA-256 for namespace %s", (namespace, expected) => {
		expect(buildAttachmentFileName("file.png", "", "id", namespace)).toBe(
			`file--${expected}-id.png`
		);
	});

	it("bounds hostile IDs and extensions without losing stable distinctions", () => {
		const ids = ["x".repeat(2000), `${"x".repeat(1999)}y`];
		for (const id of ids) {
			expect(bytes(buildConversationFileName("😀".repeat(100), id))).toBeLessThanOrEqual(240);
			expect(
				bytes(buildAttachmentFileName(`name.${"a".repeat(500)}`, "", id, "namespace"))
			).toBeLessThanOrEqual(240);
		}
		expect(buildConversationFileName("same", ids[0])).not.toBe(
			buildConversationFileName("same", ids[1])
		);
	});
});
