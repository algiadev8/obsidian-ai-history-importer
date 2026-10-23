import { describe, expect, it } from "vitest";
import { renderConversationMarkdown } from "../src";
import type { ConversationRecord } from "../src";

describe("renderConversationMarkdown", () => {
	it("retains custom frontmatter while owning and escaping identity fields", () => {
		const conversation: ConversationRecord = {
			source: "chatgpt",
			conversationId: 'id"\\nnext',
			importKey: 'chatgpt:id"\\nnext',
			title: "Title",
			messages: []
		};
		const template =
			'---\ntags: [chat]\nai_conversation_id: "wrong"\nai_source: "wrong"\n---\n# Custom';
		const output = renderConversationMarkdown(conversation, template);
		expect(output).toContain("tags: [chat]");
		expect(output).toContain("# Custom");
		expect(output).not.toContain('ai_source: "wrong"');
		expect(JSON.parse(/^ai_conversation_id: (.+)$/m.exec(output)![1])).toBe(
			conversation.conversationId
		);
		const normal = renderConversationMarkdown(conversation);
		expect(JSON.parse(/^ai_conversation_id: (.+)$/m.exec(normal)![1])).toBe(
			conversation.conversationId
		);
	});
	it("renders the default markdown template", () => {
		const conversation: ConversationRecord = {
			source: "chatgpt",
			conversationId: "c1",
			importKey: "chatgpt:c1",
			title: "Sample chat",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:10:00.000Z",
			messages: [
				{
					id: "m1",
					role: "user",
					content: "hello",
					attachments: []
				},
				{
					id: "m2",
					role: "assistant",
					content: "world",
					attachments: [{ id: "f1", obsidianLink: "[[files/a.txt]]" }]
				}
			]
		};

		const output = renderConversationMarkdown(conversation);
		expect(output).toContain("# Sample chat");
		expect(output).toContain("## User");
		expect(output).toContain("## ChatGPT");
		expect(output).toContain("[[files/a.txt]]");
		expect(output).toContain('ai_import_key: "chatgpt:c1"');
	});

	it("renders Claude assistant role for claude conversations", () => {
		const conversation: ConversationRecord = {
			source: "claude",
			conversationId: "c2",
			importKey: "claude:c2",
			title: "Claude chat",
			createdAt: "2026-01-02T00:00:00.000Z",
			updatedAt: "2026-01-02T00:10:00.000Z",
			messages: [
				{
					id: "m1",
					role: "assistant",
					content: "hello from Claude",
					attachments: []
				}
			]
		};

		const output = renderConversationMarkdown(conversation);
		expect(output).toContain("## Claude");
		expect(output).toContain('ai_import_key: "claude:c2"');
	});

	it("demotes headings inside message content via the default template", () => {
		const conversation: ConversationRecord = {
			source: "chatgpt",
			conversationId: "c3",
			importKey: "chatgpt:c3",
			title: "Heading collision",
			messages: [
				{
					id: "m1",
					role: "assistant",
					content: "# inner heading\n\nbody",
					attachments: []
				}
			]
		};

		const output = renderConversationMarkdown(conversation);
		expect(output).toContain("### inner heading");
		expect(output).not.toMatch(/(?:^|\n)# inner heading/);
	});
});
