import type {
	ConversationAttachment,
	ConversationMessage,
	ConversationRecord
} from "@obsidian-ai-history-importer/core";
import type {
	ChatGptAttachment,
	ChatGptConversation,
	ChatGptMappingNode,
	ChatGptMessage
} from "./types";

import {
	collectAttachments,
	collectContentStrings,
	extractMessageText,
	inferMimeType
} from "./content";
import { selectNodes } from "./branches";

const SKIPPED_CONTENT_TYPES = new Set(["user_editable_context"]);

export interface ParseOptions {
	includeSystemMessages?: boolean;
	includeHiddenMessages?: boolean;
	excludeThoughts?: boolean;
	excludeToolCalls?: boolean;
	excludeThoughtTime?: boolean;
	resolveAttachmentPath?: AttachmentPathResolver;
	resolveAttachmentMetadata?: (attachment: ChatGptAttachment) => ChatGptAttachment;
	/** Opt in to retaining every branch, with parent metadata on each message. */
	includeAllBranches?: boolean;
	onWarning?: (warning: string) => void;
}

function toIsoDate(value?: number | null): string | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const date = new Date(value * 1000);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getMessageTimestamp(message: ConversationMessage): number | undefined {
	if (!message.createdAt) return undefined;
	const timestamp = Date.parse(message.createdAt);
	return Number.isNaN(timestamp) ? undefined : timestamp;
}

function getConversationCreatedAt(messages: ConversationMessage[]): string | undefined {
	const timestamps = messages
		.map((message) => getMessageTimestamp(message))
		.filter((timestamp): timestamp is number => typeof timestamp === "number");
	if (timestamps.length === 0) return undefined;
	return new Date(Math.min(...timestamps)).toISOString();
}

function getConversationUpdatedAt(messages: ConversationMessage[]): string | undefined {
	const timestamps = messages
		.map((message) => getMessageTimestamp(message))
		.filter((timestamp): timestamp is number => typeof timestamp === "number");
	if (timestamps.length === 0) return undefined;
	return new Date(Math.max(...timestamps)).toISOString();
}

function isToolCallMessage(message: ChatGptMessage): boolean {
	if (message.author?.role !== "assistant") return false;
	const recipient = message.recipient ?? message.metadata?.recipient;
	// JSON keys alone are not provenance: an ordinary answer can contain
	// "time", "open", or even "search_query". Keep ambiguous content losslessly.
	return (
		(typeof recipient === "string" && recipient.length > 0 && recipient !== "all") ||
		(Array.isArray(message.metadata?.tool_calls) && message.metadata.tool_calls.length > 0)
	);
}

function isThoughtTimeMessage(message: ChatGptMessage): boolean {
	if (message.author?.role !== "assistant") return false;
	if (message.content?.content_type === "reasoning_recap") return true;
	const contents = collectContentStrings(message).map((content) => content.trim());
	if (contents.length !== 1) return false;
	const [only] = contents;
	const duration = String.raw`(?:\d+(?:\.\d+)?\s*(?:h|m|s|時間|分|秒)\s*)+`;
	return new RegExp(
		`^(?:(?:思考時間|Thought time)[:：]\\s*${duration}|(?:Thought|Worked) for\\s+${duration}|${duration}考えました)[.!。]?$`,
		"i"
	).test(only);
}

export type AttachmentPathResolver = (attachment: ChatGptAttachment) => string | undefined;

function mapAttachment(
	attachment: ChatGptAttachment,
	resolveAttachmentPath: AttachmentPathResolver
): ConversationAttachment {
	const sourcePath = resolveAttachmentPath(attachment);
	return {
		id: attachment.id,
		name: attachment.name,
		mimeType:
			attachment.mime_type ??
			attachment.mimeType ??
			inferMimeType(attachment.name) ??
			(attachment.isImage ? "image/*" : undefined),
		sizeBytes: attachment.size,
		sourcePath
	};
}

function mapMessage(
	node: ChatGptMappingNode,
	resolveAttachmentPath: AttachmentPathResolver,
	includeSystemMessages: boolean,
	includeHiddenMessages: boolean,
	excludeThoughts: boolean,
	excludeToolCalls: boolean,
	excludeThoughtTime: boolean,
	resolveMetadata: NonNullable<ParseOptions["resolveAttachmentMetadata"]>
): ConversationMessage | null {
	const message = node.message;
	if (!message?.id) return null;
	const role = message.author?.role ?? "unknown";
	if (!includeSystemMessages && role === "system") return null;
	if (SKIPPED_CONTENT_TYPES.has(message.content?.content_type ?? "")) return null;
	if (excludeThoughts && message.content?.content_type === "thoughts") return null;
	if (!includeHiddenMessages && message.metadata?.is_visually_hidden_from_conversation)
		return null;
	if (excludeToolCalls && isToolCallMessage(message)) return null;
	if (excludeThoughtTime && isThoughtTimeMessage(message)) return null;

	const attachments = collectAttachments(message)
		.map(resolveMetadata)
		.map((attachment) => mapAttachment(attachment, resolveAttachmentPath));

	return {
		id: message.id,
		role: role as ConversationMessage["role"],
		createdAt: toIsoDate(message.create_time ?? undefined),
		content: extractMessageText(message),
		contentType: message.content?.content_type,
		attachments
	};
}

export function parseChatGptConversations(
	conversations: ChatGptConversation[],
	options: ParseOptions
): ConversationRecord[] {
	const includeSystemMessages = options.includeSystemMessages ?? false;
	const includeHiddenMessages = options.includeHiddenMessages ?? false;
	const excludeThoughts = options.excludeThoughts ?? false;
	const excludeToolCalls = options.excludeToolCalls ?? false;
	const excludeThoughtTime = options.excludeThoughtTime ?? false;
	const resolveAttachmentPath = options.resolveAttachmentPath ?? (() => undefined);
	const resolveMetadata = options.resolveAttachmentMetadata ?? ((attachment) => attachment);
	const seenConversationKeys = new Set<string>();

	const output: ConversationRecord[] = [];
	for (const conversation of conversations) {
		const conversationId = conversation.id ?? conversation.conversation_id;
		if (!conversationId) continue;

		const importKey = `chatgpt:${conversationId}`;
		if (seenConversationKeys.has(importKey)) continue;
		seenConversationKeys.add(importKey);

		const { nodes, currentIds } = selectNodes(
			conversation,
			options.includeAllBranches,
			options.onWarning
		);
		const messages = nodes
			.map(([nodeId, node]) => {
				const message = mapMessage(
					node,
					resolveAttachmentPath,
					includeSystemMessages,
					includeHiddenMessages,
					excludeThoughts,
					excludeToolCalls,
					excludeThoughtTime,
					resolveMetadata
				);
				if (message && options.includeAllBranches)
					message.metadata = {
						nodeId,
						parentNodeId: node.parent ?? null,
						branch: currentIds.has(nodeId) ? "current" : "alternate"
					};
				return message;
			})
			.filter((message): message is ConversationMessage => Boolean(message))
			.filter((message) => message.content.length > 0 || message.attachments.length > 0);

		if (messages.length === 0) continue;

		output.push({
			source: "chatgpt",
			conversationId,
			importKey,
			title:
				(conversation.title || "Untitled conversation").trim() || "Untitled conversation",
			createdAt: getConversationCreatedAt(messages) ?? toIsoDate(conversation.create_time),
			updatedAt: getConversationUpdatedAt(messages) ?? toIsoDate(conversation.update_time),
			messages
		});
	}

	return output;
}
