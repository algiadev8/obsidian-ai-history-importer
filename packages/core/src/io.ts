export interface DirectoryEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	isFile: boolean;
}

export interface ExportSource {
	readText(path: string): Promise<string>;
	readBinary(path: string): Promise<Uint8Array>;
	listDir(path: string): Promise<DirectoryEntry[]>;
	exists(path: string): Promise<boolean>;
}

export interface ImportTarget {
	listMarkdownFiles(): Promise<Array<{ path: string }>>;
	readText(path: string): Promise<string>;
	/** Needed to safely reuse existing attachments without trusting filenames. */
	readBinary?(path: string): Promise<Uint8Array>;
	writeText(path: string, content: string): Promise<void>;
	writeBinary(path: string, data: Uint8Array): Promise<void>;
	createFolder(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
}

export interface ExportPathApi {
	join(...parts: string[]): string;
}

export interface VaultPathApi {
	join(...parts: string[]): string;
	dirname(path: string): string;
	normalize(path: string): string;
}
