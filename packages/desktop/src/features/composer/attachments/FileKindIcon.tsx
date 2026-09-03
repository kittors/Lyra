/**
 * The icon for a kind of file.
 *
 * One per family rather than one per extension: a `.mov` and a `.mp4` are the same thing to the
 * person looking at the list, and forty icons that differ in ways nobody can name is worse than
 * eleven that are instantly readable. Colour carries as much of it as the shape — the conventions
 * are old enough to be automatic (Word blue, Excel green, PDF red), and following them means the
 * list is scannable without reading a single filename.
 */

import {
	File,
	FileArchive,
	FileAudio,
	FileImage,
	FileSpreadsheet,
	FileText,
	FileType,
	FileVideo,
	Presentation,
	Binary,
} from "lucide-react";
import type { FileKind } from "./file-kind.ts";

const ICONS: Record<FileKind, typeof File> = {
	image: FileImage,
	video: FileVideo,
	audio: FileAudio,
	pdf: FileText,
	word: FileText,
	excel: FileSpreadsheet,
	powerpoint: Presentation,
	archive: FileArchive,
	font: FileType,
	binary: Binary,
	text: File,
};

/**
 * The colour each family is expected to be.
 *
 * Deliberately the familiar ones. Nobody has to learn that a red page is a PDF.
 */
const TONES: Record<FileKind, string> = {
	image: "text-[#8b5cf6]",
	video: "text-[#ec4899]",
	audio: "text-[#f59e0b]",
	pdf: "text-[#ef4444]",
	word: "text-[#2b7cd3]",
	excel: "text-[#16a34a]",
	powerpoint: "text-[#ea580c]",
	archive: "text-[#a16207]",
	font: "text-[#0ea5e9]",
	binary: "text-ink-faint",
	text: "text-ink-muted",
};

export function FileKindIcon({ kind, size = 14 }: { kind: FileKind; size?: number }) {
	const Icon = ICONS[kind];
	return <Icon size={size} strokeWidth={1.8} className={`shrink-0 ${TONES[kind]}`} />;
}
