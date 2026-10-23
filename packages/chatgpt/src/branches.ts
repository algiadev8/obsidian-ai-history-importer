import type { ChatGptConversation, ChatGptMappingNode } from "./types";

export function selectNodes(
	conversation: ChatGptConversation,
	includeAllBranches = false,
	onWarning?: (warning: string) => void
): { nodes: Array<[string, ChatGptMappingNode]>; currentIds: Set<string> } {
	const mapping = conversation.mapping ?? {};
	const current = conversation.current_node;
	const currentIds = new Set<string>();
	const ordered: Array<[string, ChatGptMappingNode]> = [];
	function ancestors(start: string): void {
		const chain: Array<[string, ChatGptMappingNode]> = [];
		const seen = new Set<string>();
		let id: string | null | undefined = start;
		while (id && !currentIds.has(id)) {
			if (seen.has(id)) {
				onWarning?.(
					`Cycle in conversation ${conversation.id ?? conversation.conversation_id}: ${id}`
				);
				break;
			}
			seen.add(id);
			const node: ChatGptMappingNode | undefined = mapping[id];
			if (!node) {
				onWarning?.(
					`Missing parent node in conversation ${conversation.id ?? conversation.conversation_id}: ${id}`
				);
				break;
			}
			chain.push([id, node]);
			id = node.parent;
		}
		for (const entry of chain.reverse()) {
			currentIds.add(entry[0]);
			ordered.push(entry);
		}
	}
	if (current && mapping[current]) ancestors(current);
	else {
		// Older exports have no current_node. Preserve all nodes in parent-first
		// order rather than relying on arbitrary JSON object insertion order.
		if (current)
			onWarning?.(
				`Missing current node in conversation ${conversation.id ?? conversation.conversation_id}: ${current}`
			);
		for (const id of Object.keys(mapping)) ancestors(id);
	}
	const selectedIds = new Set(currentIds);
	if (includeAllBranches) for (const id of Object.keys(mapping)) ancestors(id);
	return { nodes: ordered, currentIds: selectedIds };
}
