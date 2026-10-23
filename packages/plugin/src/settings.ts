export interface ImporterPluginSettings {
	notesDirectory: string;
	claudeNotesDirectory: string;
	attachmentsDirectory: string;
	customTemplatePath: string;
	includeSystemMessages: boolean;
	includeHiddenMessages: boolean;
	includeAllBranches: boolean;
	excludeThoughts: boolean;
	excludeToolCalls: boolean;
	excludeThoughtTime: boolean;
	excludeClaudeThinking: boolean;
	overwriteOnReimport: boolean;
}

export const DEFAULT_SETTINGS: ImporterPluginSettings = {
	notesDirectory: "AI Chat History/ChatGPT",
	claudeNotesDirectory: "AI Chat History/Claude",
	attachmentsDirectory: "AI Chat History/Attachments",
	customTemplatePath: "",
	includeSystemMessages: false,
	includeHiddenMessages: false,
	includeAllBranches: false,
	excludeThoughts: true,
	excludeToolCalls: true,
	excludeThoughtTime: true,
	excludeClaudeThinking: true,
	overwriteOnReimport: true
};
