import nunjucks from "nunjucks";
import type { ConversationRecord } from "./types";
import { demoteHeadings } from "./heading-demote";

export const DEFAULT_MARKDOWN_TEMPLATE =
	`---
ai_source: {{ conversation.source | dump }}
ai_conversation_id: {{ conversation.conversationId | dump }}
ai_import_key: {{ conversation.importKey | dump }}
created_at: {{ (conversation.createdAt or '') | dump }}
updated_at: {{ (conversation.updatedAt or '') | dump }}
---

# {{ conversation.title }}

{% for message in conversation.messages %}
## {{ message.role | roleTitle(conversation.source) }}{% if message.createdAt %} ({{ message.createdAt }}){% endif %}
{% if message.metadata.nodeId %}
Branch: {{ message.metadata.branch }} · Node: {{ message.metadata.nodeId }} · Parent: {{ message.metadata.parentNodeId or 'root' }}
{% endif %}

{{ message.content | trim | demoteHeadings(2) }}
{% if message.attachments.length > 0 %}

### Attachments
{% for attachment in message.attachments %}
- {% if attachment.obsidianLink %}{{ attachment.obsidianLink }}{% else %}` +
	"`{{ attachment.id }}`" +
	`{% endif %}
{% endfor %}
{% endif %}

{% endfor %}
`;

let env: nunjucks.Environment | null = null;

function getEnvironment(): nunjucks.Environment {
	if (env) return env;
	env = new nunjucks.Environment(undefined, {
		autoescape: false,
		trimBlocks: true,
		lstripBlocks: true
	});
	env.addFilter("roleTitle", (role: string, source?: string) => {
		switch (role) {
			case "user":
				return "User";
			case "assistant":
				return source === "claude" ? "Claude" : "ChatGPT";
			case "system":
				return "System";
			case "tool":
				return "Tool";
			default:
				return role;
		}
	});
	env.addFilter("demoteHeadings", (content: string, offset: number) =>
		demoteHeadings(content, offset)
	);
	return env;
}

export function renderConversationMarkdown(
	conversation: ConversationRecord,
	template: string = DEFAULT_MARKDOWN_TEMPLATE
): string {
	let rendered = getEnvironment().renderString(template, { conversation });
	// Identity is importer-owned metadata, even with a custom body template.
	// Otherwise a renamed conversation silently creates duplicates on every import.
	if (template !== DEFAULT_MARKDOWN_TEMPLATE) {
		const identity = `ai_source: ${JSON.stringify(conversation.source)}\nai_conversation_id: ${JSON.stringify(conversation.conversationId)}\nai_import_key: ${JSON.stringify(conversation.importKey)}`;
		const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(rendered);
		if (frontmatter) {
			const other = frontmatter[1]
				.split(/\r?\n/)
				.filter((line) => !/^ai_(?:source|conversation_id|import_key):/.test(line))
				.join("\n");
			rendered = `---\n${identity}${other ? "\n" + other : ""}\n---\n${rendered.slice(frontmatter[0].length)}`;
		} else rendered = `---\n${identity}\n---\n\n${rendered}`;
	}
	return rendered.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
