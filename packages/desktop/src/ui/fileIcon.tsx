import {
	Braces,
	FileArchive,
	FileAudio,
	FileCode,
	FileImage,
	FileJson,
	FileLock,
	FileSpreadsheet,
	FileTerminal,
	FileText,
	FileType,
	FileVideo,
	Folder,
	FolderOpen,
	GitBranch,
	Hash,
	Palette,
	Settings,
	type LucideIcon,
} from "lucide-react";

/**
 * What a file looks like in a list.
 *
 * Colour is the point. A tree of forty identically grey rows is read line by line; the same
 * tree with the TypeScript blue, the JSON amber and the Markdown slate is read at a glance,
 * because the eye finds the group before it reads any name.
 *
 * The hues follow the conventions people already have from editors — TS blue, JS yellow, Rust
 * rust — rather than anything invented here. A palette nobody recognises is just decoration.
 *
 * Every colour is given for both themes: a mid-tone that reads on white is muddy on near-black
 * and vice versa.
 */
export interface FileLook {
	Icon: LucideIcon;
	/** Tailwind-free: applied inline, since these are outside the theme's derived scale. */
	light: string;
	dark: string;
}

const NEUTRAL: FileLook = { Icon: FileText, light: "#8a8d90", dark: "#7e8184" };

/** Whole-name matches win over extensions — `package.json` is not just another JSON file. */
const BY_NAME: Record<string, FileLook> = {
	"package.json": { Icon: Braces, light: "#8b5a2b", dark: "#cb9a63" },
	"package-lock.json": { Icon: FileLock, light: "#8a8d90", dark: "#7e8184" },
	"pnpm-lock.yaml": { Icon: FileLock, light: "#8a8d90", dark: "#7e8184" },
	"yarn.lock": { Icon: FileLock, light: "#8a8d90", dark: "#7e8184" },
	"pnpm-workspace.yaml": { Icon: Settings, light: "#b0632a", dark: "#e0955c" },
	"tsconfig.json": { Icon: Settings, light: "#2f74c0", dark: "#63a6e8" },
	"tsconfig.base.json": { Icon: Settings, light: "#2f74c0", dark: "#63a6e8" },
	dockerfile: { Icon: FileCode, light: "#1d63ed", dark: "#6f9bf0" },
	makefile: { Icon: FileTerminal, light: "#7d6b3f", dark: "#bda878" },
	".gitignore": { Icon: GitBranch, light: "#d1533a", dark: "#e8836b" },
	".gitattributes": { Icon: GitBranch, light: "#d1533a", dark: "#e8836b" },
	".env": { Icon: FileLock, light: "#9a7d16", dark: "#d8bd4e" },
	"readme.md": { Icon: FileText, light: "#3d7cc9", dark: "#7fb1e8" },
	"license": { Icon: FileText, light: "#9a7d16", dark: "#d8bd4e" },
};

const BY_EXTENSION: Record<string, FileLook> = {
	// TypeScript / JavaScript
	ts: { Icon: FileCode, light: "#2f74c0", dark: "#63a6e8" },
	tsx: { Icon: FileCode, light: "#2f74c0", dark: "#63a6e8" },
	mts: { Icon: FileCode, light: "#2f74c0", dark: "#63a6e8" },
	cts: { Icon: FileCode, light: "#2f74c0", dark: "#63a6e8" },
	js: { Icon: FileCode, light: "#b8951a", dark: "#e6c85a" },
	jsx: { Icon: FileCode, light: "#b8951a", dark: "#e6c85a" },
	mjs: { Icon: FileCode, light: "#b8951a", dark: "#e6c85a" },
	cjs: { Icon: FileCode, light: "#b8951a", dark: "#e6c85a" },

	// Data
	json: { Icon: FileJson, light: "#b0761c", dark: "#e2ab55" },
	jsonc: { Icon: FileJson, light: "#b0761c", dark: "#e2ab55" },
	yaml: { Icon: FileCode, light: "#7b52ab", dark: "#b48ede" },
	yml: { Icon: FileCode, light: "#7b52ab", dark: "#b48ede" },
	toml: { Icon: FileCode, light: "#7d6b3f", dark: "#bda878" },
	xml: { Icon: FileCode, light: "#5f8a3a", dark: "#9dc873" },
	csv: { Icon: FileSpreadsheet, light: "#2f7d4f", dark: "#6fc191" },
	sql: { Icon: FileSpreadsheet, light: "#b0632a", dark: "#e0955c" },

	// Web
	html: { Icon: FileCode, light: "#c1502a", dark: "#ec8a63" },
	htm: { Icon: FileCode, light: "#c1502a", dark: "#ec8a63" },
	css: { Icon: Palette, light: "#2f74c0", dark: "#63a6e8" },
	scss: { Icon: Palette, light: "#c04277", dark: "#ec84b0" },
	sass: { Icon: Palette, light: "#c04277", dark: "#ec84b0" },
	less: { Icon: Palette, light: "#2b4c8c", dark: "#7d9ce0" },
	vue: { Icon: FileCode, light: "#2f9268", dark: "#6fce9f" },
	svelte: { Icon: FileCode, light: "#c1502a", dark: "#ec8a63" },

	// Other languages
	py: { Icon: FileCode, light: "#2f6fa8", dark: "#6fa8dc" },
	rs: { Icon: FileCode, light: "#a3562a", dark: "#dd9160" },
	go: { Icon: FileCode, light: "#1c7d8e", dark: "#5ec4d6" },
	java: { Icon: FileCode, light: "#a8442a", dark: "#e08668" },
	kt: { Icon: FileCode, light: "#7b52ab", dark: "#b48ede" },
	rb: { Icon: FileCode, light: "#a8242a", dark: "#e06d72" },
	php: { Icon: FileCode, light: "#5b6ba8", dark: "#98a6e0" },
	swift: { Icon: FileCode, light: "#c1502a", dark: "#ec8a63" },
	c: { Icon: FileCode, light: "#4a6f9c", dark: "#8fb2dd" },
	h: { Icon: FileCode, light: "#4a6f9c", dark: "#8fb2dd" },
	cpp: { Icon: FileCode, light: "#2f74c0", dark: "#63a6e8" },
	hpp: { Icon: FileCode, light: "#2f74c0", dark: "#63a6e8" },
	cs: { Icon: FileCode, light: "#4a8a3a", dark: "#8ccb73" },
	sh: { Icon: FileTerminal, light: "#4a7d4a", dark: "#8cc48c" },
	bash: { Icon: FileTerminal, light: "#4a7d4a", dark: "#8cc48c" },
	zsh: { Icon: FileTerminal, light: "#4a7d4a", dark: "#8cc48c" },

	// Prose
	md: { Icon: FileText, light: "#3d7cc9", dark: "#7fb1e8" },
	mdx: { Icon: FileText, light: "#3d7cc9", dark: "#7fb1e8" },
	txt: NEUTRAL,

	// Media
	png: { Icon: FileImage, light: "#2f9268", dark: "#6fce9f" },
	jpg: { Icon: FileImage, light: "#2f9268", dark: "#6fce9f" },
	jpeg: { Icon: FileImage, light: "#2f9268", dark: "#6fce9f" },
	gif: { Icon: FileImage, light: "#2f9268", dark: "#6fce9f" },
	webp: { Icon: FileImage, light: "#2f9268", dark: "#6fce9f" },
	avif: { Icon: FileImage, light: "#2f9268", dark: "#6fce9f" },
	bmp: { Icon: FileImage, light: "#2f9268", dark: "#6fce9f" },
	ico: { Icon: FileImage, light: "#2f9268", dark: "#6fce9f" },
	svg: { Icon: FileImage, light: "#b0761c", dark: "#e2ab55" },
	mp4: { Icon: FileVideo, light: "#7b52ab", dark: "#b48ede" },
	webm: { Icon: FileVideo, light: "#7b52ab", dark: "#b48ede" },
	mov: { Icon: FileVideo, light: "#7b52ab", dark: "#b48ede" },
	mkv: { Icon: FileVideo, light: "#7b52ab", dark: "#b48ede" },
	avi: { Icon: FileVideo, light: "#7b52ab", dark: "#b48ede" },
	mp3: { Icon: FileAudio, light: "#c04277", dark: "#ec84b0" },
	wav: { Icon: FileAudio, light: "#c04277", dark: "#ec84b0" },
	flac: { Icon: FileAudio, light: "#c04277", dark: "#ec84b0" },
	ogg: { Icon: FileAudio, light: "#c04277", dark: "#ec84b0" },
	m4a: { Icon: FileAudio, light: "#c04277", dark: "#ec84b0" },

	// Bundles and binaries
	zip: { Icon: FileArchive, light: "#8a6f3a", dark: "#c9ab6f" },
	tar: { Icon: FileArchive, light: "#8a6f3a", dark: "#c9ab6f" },
	gz: { Icon: FileArchive, light: "#8a6f3a", dark: "#c9ab6f" },
	tgz: { Icon: FileArchive, light: "#8a6f3a", dark: "#c9ab6f" },
	rar: { Icon: FileArchive, light: "#8a6f3a", dark: "#c9ab6f" },
	"7z": { Icon: FileArchive, light: "#8a6f3a", dark: "#c9ab6f" },
	pdf: { Icon: FileType, light: "#b8342a", dark: "#e87d72" },
	woff: { Icon: Hash, light: "#7b52ab", dark: "#b48ede" },
	woff2: { Icon: Hash, light: "#7b52ab", dark: "#b48ede" },
	ttf: { Icon: Hash, light: "#7b52ab", dark: "#b48ede" },
	otf: { Icon: Hash, light: "#7b52ab", dark: "#b48ede" },
};

const DIRECTORY: FileLook = { Icon: Folder, light: "#6f8ab0", dark: "#93aed6" };
const DIRECTORY_OPEN: FileLook = { Icon: FolderOpen, light: "#6f8ab0", dark: "#93aed6" };

export function lookFor(name: string, isDirectory: boolean, expanded = false): FileLook {
	if (isDirectory) return expanded ? DIRECTORY_OPEN : DIRECTORY;

	const lower = name.toLowerCase();
	const byName = BY_NAME[lower];
	if (byName) return byName;

	// `.d.ts` and `.tar.gz` mean something the last segment alone does not.
	if (lower.endsWith(".d.ts")) return { Icon: FileCode, light: "#4a7d9c", dark: "#8fbcdd" };
	if (lower.endsWith(".tar.gz")) return BY_EXTENSION.gz;

	const dot = lower.lastIndexOf(".");
	// A leading dot is the whole name (`.env`), not an extension.
	if (dot <= 0) return NEUTRAL;
	return BY_EXTENSION[lower.slice(dot + 1)] ?? NEUTRAL;
}

/** Resolve to the hex that reads against the current theme. */
export function iconColour(look: FileLook): string {
	return document.documentElement.classList.contains("dark") ? look.dark : look.light;
}
