import { describe, expect, it } from "vitest";
import { parseChatGptConversations } from "../src";
import type { ChatGptConversation, ChatGptMessage } from "../src/types";

function conversation(messages: Partial<ChatGptMessage>[]): ChatGptConversation {
	return {
		id: "c1",
		current_node: `n${messages.length - 1}`,
		mapping: Object.fromEntries(
			messages.map((m, i) => [
				`n${i}`,
				{
					id: `n${i}`,
					parent: i ? `n${i - 1}` : null,
					message: { id: `m${i}`, author: { role: "assistant" }, ...m }
				}
			])
		)
	};
}

const text = (value: string, role = "assistant"): Partial<ChatGptMessage> => ({
	author: { role },
	content: { content_type: "text", parts: [value] }
});

describe("real-export regression cases", () => {
	it("keeps a voice-only conversation and transcripts in mixed parts in source order", () => {
		const c = conversation([
			{
				author: { role: "user" },
				content: {
					content_type: "multimodal_text",
					parts: [{ content_type: "audio_transcription", text: "歌を歌ってください" }]
				}
			},
			{
				content: {
					content_type: "multimodal_text",
					parts: [
						"before",
						{ content_type: "audio_transcription", text: "返答" },
						"after"
					]
				}
			}
		]);
		const [record] = parseChatGptConversations([c], {});
		expect(record.messages.map((m) => m.content)).toEqual([
			"歌を歌ってください",
			"before\n\n返答\n\nafter"
		]);
	});

	it("retains pointer-only images and nested audio pointers, deduplicating metadata", () => {
		const c = conversation([
			{
				content: {
					content_type: "multimodal_text",
					parts: [
						{
							content_type: "image_asset_pointer",
							asset_pointer: "file-service://file-img",
							size_bytes: 42
						},
						{
							content_type: "image_asset_pointer",
							asset_pointer: "file-service://file-img"
						},
						{
							content_type: "audio",
							audio: { asset_pointer: "sediment://file_audio" }
						},
						{ asset_pointer: "file:///etc/passwd" }
					]
				},
				metadata: {
					attachments: [{ id: "file-img", name: "photo.jpg", mimeType: "image/jpeg" }]
				}
			}
		]);
		const [record] = parseChatGptConversations([c], {
			resolveAttachmentPath: (a) => `/export/${a.id}.dat`
		});
		expect(record.messages).toHaveLength(1);
		expect(record.messages[0].attachments).toMatchObject([
			{
				id: "file-img",
				name: "photo.jpg",
				mimeType: "image/jpeg",
				sourcePath: "/export/file-img.dat"
			},
			{ id: "file_audio", sourcePath: "/export/file_audio.dat" }
		]);
	});

	it("enriches pointer names and MIME types before resolving the path", () => {
		const c = conversation([
			{
				content: {
					content_type: "multimodal_text",
					parts: [
						{
							content_type: "image_asset_pointer",
							asset_pointer: "file-service://file-img"
						}
					]
				}
			}
		]);
		const [record] = parseChatGptConversations([c], {
			resolveAttachmentMetadata: (a) => ({ ...a, name: "元画像.png" }),
			resolveAttachmentPath: (a) => `/export/${a.name}`
		});
		expect(record.messages[0].attachments[0]).toMatchObject({
			name: "元画像.png",
			mimeType: "image/png",
			sourcePath: "/export/元画像.png"
		});
	});

	it.each([
		"思考時間: 4m 58s",
		"Thought time: 2s",
		"Thought for 3m 32s",
		"Worked for 1m 57s",
		"33s考えました",
		"1m 6s考えました",
		"2分30秒考えました"
	])("excludes timing-only assistant messages: %s", (value) => {
		const [record] = parseChatGptConversations([conversation([text(value), text("keep")])], {
			excludeThoughtTime: true
		});
		expect(record.messages.map((m) => m.content)).toEqual(["keep"]);
	});

	it("excludes reasoning_recap by type but keeps user examples and assistant explanations", () => {
		const [record] = parseChatGptConversations(
			[
				conversation([
					{
						content: {
							content_type: "reasoning_recap",
							content: "New localized timing format"
						}
					},
					text("33s考えました", "user"),
					text("Thought time: 2s\n\nHere is the answer"),
					text('{"time": 10}', "user")
				])
			],
			{ excludeThoughtTime: true, excludeToolCalls: true }
		);
		expect(record.messages).toHaveLength(3);
	});

	it("only filters tool-routed messages, never ordinary assistant JSON answers", () => {
		const [record] = parseChatGptConversations(
			[
				conversation([
					text('{"time":10,"open":true,"answer":"keep"}'),
					{ ...text('{"search_query":[]}'), recipient: "all" },
					{ ...text("print(1)"), recipient: "python" },
					{ ...text('{"search_query":[]}'), metadata: { recipient: "web.run" } },
					{ ...text("call"), metadata: { tool_calls: [{ id: "call" }] } }
				])
			],
			{ excludeToolCalls: true }
		);
		expect(record.messages.map((m) => m.content)).toEqual([
			'{"time":10,"open":true,"answer":"keep"}',
			'{"search_query":[]}'
		]);
	});

	it("preserves timing and recaps with the exclusion disabled", () => {
		const [record] = parseChatGptConversations(
			[
				conversation([
					{ content: { content_type: "reasoning_recap", content: "33s考えました" } },
					text("Thought for 2s")
				])
			],
			{}
		);
		expect(record.messages).toHaveLength(2);
	});

	it("guards cycles and missing parents without hanging or discarding valid content", () => {
		const c = conversation([text("first"), text("second")]);
		c.mapping!.n0.parent = "n1";
		const warnings: string[] = [];
		expect(
			parseChatGptConversations([c], { onWarning: (w) => warnings.push(w) })[0].messages
		).toHaveLength(2);
		expect(warnings[0]).toContain("Cycle");
		c.mapping!.n0.parent = "missing";
		warnings.length = 0;
		expect(
			parseChatGptConversations([c], { onWarning: (w) => warnings.push(w) })[0].messages
		).toHaveLength(2);
		expect(warnings[0]).toContain("Missing parent");
	});

	it("keeps the current path by default and every branch with parent metadata when enabled", () => {
		const c = conversation([text("root"), text("current")]);
		c.mapping!.alternate = {
			id: "alternate",
			parent: "n0",
			message: { id: "m-alt", ...text("alternate") }
		};
		expect(parseChatGptConversations([c], {})[0].messages.map((m) => m.content)).toEqual([
			"root",
			"current"
		]);
		const messages = parseChatGptConversations([c], { includeAllBranches: true })[0].messages;
		expect(messages.map((m) => m.content)).toEqual(["root", "current", "alternate"]);
		expect(messages[2].metadata).toEqual({
			nodeId: "alternate",
			parentNodeId: "n0",
			branch: "alternate"
		});
	});

	it("orders fallback nodes parent-first regardless of JSON key order", () => {
		const c = conversation([text("root"), text("leaf")]);
		c.current_node = "unknown";
		c.mapping = { n1: c.mapping!.n1, n0: c.mapping!.n0 };
		expect(parseChatGptConversations([c], {})[0].messages.map((m) => m.content)).toEqual([
			"root",
			"leaf"
		]);
	});

	it.each([NaN, Infinity, -Infinity, 1e100])("ignores invalid timestamps: %s", (create_time) => {
		const [record] = parseChatGptConversations(
			[conversation([{ ...text("keep"), create_time }])],
			{}
		);
		expect(record.messages[0].createdAt).toBeUndefined();
	});
});
