export interface ChatGptAttachment {
	id: string;
	name?: string;
	mime_type?: string;
	mimeType?: string;
	size?: number;
	/** True for image pointers even when the export omits a MIME type. */
	isImage?: boolean;
}

export interface ChatGptMessage {
	id: string;
	author?: {
		role?: string;
	};
	recipient?: string;
	create_time?: number | null;
	content?: {
		content_type?: string;
		parts?: unknown[];
		text?: string;
		content?: string;
		language?: string;
	};
	metadata?: {
		attachments?: ChatGptAttachment[];
		is_visually_hidden_from_conversation?: boolean;
		[key: string]: unknown;
	};
}

export interface ChatGptMappingNode {
	id?: string;
	parent?: string | null;
	children?: string[];
	message?: ChatGptMessage | null;
}

export interface ChatGptConversation {
	id?: string;
	conversation_id?: string;
	title?: string;
	create_time?: number;
	update_time?: number;
	current_node?: string;
	mapping?: Record<string, ChatGptMappingNode>;
}
