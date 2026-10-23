// Leave room for collision suffixes on filesystems with a 255-byte component limit.
const MAX_FILE_NAME_BYTES = 240;
const RESERVED = /[<>:"/\\|?*[\]#^]/g;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

function utf8Length(input: string): number {
	return new TextEncoder().encode(input).length;
}

function truncate(input: string, maxBytes: number, maxCharacters = Infinity): string {
	let result = "";
	let bytes = 0;
	let characters = 0;
	for (const char of input) {
		const size = utf8Length(char);
		if (bytes + size > maxBytes || characters >= maxCharacters) break;
		result += char;
		bytes += size;
		characters += 1;
	}
	return result.replace(/[. ]+$/g, "");
}

function extnameFromPath(filePath: string): string {
	const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
	const base = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
	const dotIndex = base.lastIndexOf(".");
	if (dotIndex <= 0) return "";
	return base.slice(dotIndex);
}

export function sanitizeFileName(input: string): string {
	const cleaned = input
		.normalize("NFC")
		// APFS can reject unassigned code points with EILSEQ (real export U+4E7C2).
		// Only the filename is sanitized; the original title stays in the note body.
		.replace(/[\p{Cc}\p{Cs}\p{Cn}]/gu, " ")
		.replace(RESERVED, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[. ]+$/g, "");
	const safe = cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "untitled";
	return WINDOWS_RESERVED.test(safe) ? `_${safe}` : safe;
}

// A bounded fallback for unusually long identifiers. Ordinary IDs are retained in full,
// with reversible escaping so punctuation cannot collapse distinct identities.
function fingerprint(input: string): string {
	// Synchronous SHA-256 keeps filename helpers browser-compatible without Node
	// crypto or an asynchronous public API. JSON encoding also preserves lone
	// surrogate identity instead of TextEncoder replacing it with U+FFFD.
	const data = new TextEncoder().encode(JSON.stringify(input));
	const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
	padded.set(data);
	padded[data.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000));
	view.setUint32(padded.length - 4, data.length * 8);
	const constants = [
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
		0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
		0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
		0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
		0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
		0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
		0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
		0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
		0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
		0xc67178f2
	];
	const hashes = [
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
		0x5be0cd19
	];
	const rotate = (word: number, bits: number) => (word >>> bits) | (word << (32 - bits));
	const words = new Int32Array(64);
	for (let offset = 0; offset < padded.length; offset += 64) {
		for (let i = 0; i < 16; i += 1) words[i] = view.getInt32(offset + i * 4);
		for (let i = 16; i < 64; i += 1) {
			const x = words[i - 15];
			const y = words[i - 2];
			words[i] =
				words[i - 16] +
				(rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) +
				words[i - 7] +
				(rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
		}
		let [a, b, c, d, e, f, g, h] = hashes;
		for (let i = 0; i < 64; i += 1) {
			const t1 =
				(h +
					(rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
					((e & f) ^ (~e & g)) +
					constants[i] +
					words[i]) |
				0;
			const t2 =
				((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) |
				0;
			h = g;
			g = f;
			f = e;
			e = (d + t1) | 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) | 0;
		}
		[a, b, c, d, e, f, g, h].forEach((word, i) => {
			hashes[i] = (hashes[i] + word) | 0;
		});
	}
	return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}

function identitySegment(input: string): string {
	// Escape uppercase too, so case-insensitive filesystems cannot merge IDs.
	const escaped = Array.from(input, (char) =>
		/^[a-z0-9_-]$/.test(char) ? char : `~${char.codePointAt(0)!.toString(16)}~`
	).join("");
	return escaped.length > 128 ? `id-${fingerprint(input)}` : escaped || "~empty~";
}

function formatDateSegment(value?: string): string | undefined {
	if (!value) return undefined;
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return undefined;
	const yyyy = String(parsed.getUTCFullYear()).padStart(4, "0");
	const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(parsed.getUTCDate()).padStart(2, "0");
	const hh = String(parsed.getUTCHours()).padStart(2, "0");
	const min = String(parsed.getUTCMinutes()).padStart(2, "0");
	return `${yyyy}${mm}${dd}${hh}${min}`;
}

export function buildConversationFileName(
	title: string,
	conversationId: string,
	createdAt?: string
): string {
	const datePrefix = formatDateSegment(createdAt) ?? "unknown";
	const suffix = `-${identitySegment(conversationId)}.md`;
	const budget = MAX_FILE_NAME_BYTES - utf8Length(`${datePrefix}-${suffix}`);
	const base = truncate(sanitizeFileName(title), budget, 80) || "untitled";
	return `${datePrefix}-${base}${suffix}`;
}

export function buildAttachmentFileName(
	originalName: string | undefined,
	sourcePath: string,
	attachmentId: string,
	identityNamespace?: string
): string {
	const original = sanitizeFileName(originalName || "attachment");
	const originalExt = extnameFromPath(original);
	// Keep extensions short; an arbitrary path suffix is not a trustworthy extension.
	const ext = truncate(
		sanitizeFileName(originalExt || extnameFromPath(sourcePath) || "").replace(
			/^untitled$/,
			""
		),
		20
	);
	const stem = originalExt ? original.slice(0, -originalExt.length) : original;
	const namespace = identityNamespace === undefined ? "" : `${fingerprint(identityNamespace)}-`;
	const suffix = `--${namespace}${identitySegment(attachmentId)}${ext}`;
	const base =
		truncate(sanitizeFileName(stem), MAX_FILE_NAME_BYTES - utf8Length(suffix)) || "attachment";
	return `${base}${suffix}`;
}

export function isImageMimeType(mimeType?: string): boolean {
	return typeof mimeType === "string" && mimeType.startsWith("image/");
}
