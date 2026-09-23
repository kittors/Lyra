/**
 * Text as it was meant, without the byte-order mark some Windows tools put in front of it.
 *
 * Notepad's "UTF-8 with BOM" and PowerShell 5.1's `Set-Content -Encoding UTF8` both begin the file
 * with U+FEFF, and `readFile(path, "utf8")` keeps it. `JSON.parse` then fails on the first
 * character, and a Markdown file no longer starts with `---` — two failures whose messages say
 * nothing about a BOM, for a file that looks perfectly fine in every editor.
 */
export function withoutBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
