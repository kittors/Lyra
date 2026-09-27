/**
 * A README, parsed into a tree — never into HTML.
 *
 * `features/plugins/Readme.tsx` turns this tree into React elements, and that pair is the whole
 * security argument: a README comes from a repository anybody can submit to the market, and it is
 * shown here one click from being installed. Nothing here produces markup from a string, so nothing in a README can become
 * an element the renderer did not choose to make. URLs are the one thing that passes through, and
 * every one of them goes through `resolveUrl` first.
 *
 * The coverage is what READMEs in this catalogue actually use, measured rather than guessed: nested
 * and task lists, fences inside list items, GitHub's alert blocks, pipe tables with escaped pipes,
 * reference links, escapes, entities, bare URLs — and a lot of HTML. `<details>` folds, centred
 * `<div>`s and `<p>`s, `<picture>` with a dark variant, `<table>` layouts whose cells hold markdown,
 * `<kbd>`, `<sup>`, `<br>`. The HTML is interpreted into the same tree as the markdown around it;
 * a tag that means nothing here is dropped and its text kept. What a README must never do is show
 * its own source — a `<details>` or a `**` on the page is a rendering bug, not the author's intent.
 *
 * Plain TypeScript with no DOM, so the tests exercise exactly what ships.
 *
 * The market's web page reads READMEs with the same parser — Lyra-Registry's
 * `packages/web/src/lib/markdown.ts`, which this is a copy of. A README that renders one way on the
 * site and another in the app is one catalogue telling two stories, so a fix here belongs there too.
 */

/** Where a README's relative links point: its repository, and the directory it sits in. */
export interface Base {
	/** `owner/name` on GitHub. */
	repo: string;
	/** The README's directory within the repository, without slashes at either end. */
	dir: string;
}

type Align = "left" | "center" | "right";

export type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

interface ImageSource {
	media: string;
	srcSet: string;
}

export type Inline =
	| { type: "text"; value: string }
	| { type: "code"; value: string }
	| { type: "strong" | "em" | "del" | "kbd" | "sup" | "sub" | "mark"; children: Inline[] }
	| { type: "link"; href: string; internal: boolean; title?: string; children: Inline[] }
	| {
			type: "image";
			src: string;
			alt: string;
			title?: string;
			width?: string;
			height?: string;
			/** A badge sits in a row of badges at text height; anything else is a picture. */
			badge: boolean;
			round: boolean;
			/** `<picture>` sources, for a README that ships a dark-theme variant. */
			sources?: ImageSource[];
	  }
	| { type: "break" };

interface ListItem {
	/** A task list item: ticked or not. Undefined for an ordinary item. */
	checked?: boolean;
	children: Block[];
}

interface GridCell {
	header: boolean;
	align?: Align;
	width?: string;
	children: Block[];
}

export type Block =
	| { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; align?: Align; children: Inline[] }
	| { type: "paragraph"; align?: Align; children: Inline[] }
	| { type: "code"; lang: string; value: string }
	| { type: "quote"; children: Block[] }
	| { type: "alert"; kind: AlertKind; children: Block[] }
	| { type: "list"; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
	| { type: "table"; align: (Align | undefined)[]; head: Inline[][]; rows: Inline[][][] }
	/** An HTML `<table>`: a layout more often than data, with markdown inside its cells. */
	| { type: "grid"; align?: Align; rows: GridCell[][] }
	| { type: "details"; open: boolean; summary: Inline[]; children: Block[] }
	/** A centred (or right-aligned) `<div>`, `<p>` or `<center>` and everything in it. */
	| { type: "group"; align: Align; children: Block[] }
	| { type: "rule" };

export interface ParseOptions {
	base?: Base;
}

interface Context {
	base?: Base;
	defs: Map<string, { href: string; title?: string }>;
	slugs: Map<string, number>;
	/** Characters scanned looking for emphasis that closes; see `WORK_LIMIT`. */
	work: number;
}

/** Deeper than any real document nests; past it, text stays text. Bounds the recursion on hostile input. */
const MAX_DEPTH = 24;

/**
 * How far, in total, one document may be scanned looking for emphasis to close. A real README uses
 * a sliver of it; twenty thousand unmatched asterisks would otherwise cost seconds, and past the
 * budget the rest are simply asterisks.
 */
const WORK_LIMIT = 2_000_000;

// ── Entry points ─────────────────────────────────────────────────────

export function parseMarkdown(source: string, options: ParseOptions = {}): Block[] {
	const context: Context = { base: options.base, defs: new Map(), slugs: new Map(), work: 0 };
	const lines = collectDefinitions(prepare(source), context);
	return parseBlocks(lines, context, 0);
}

/**
 * One line of markdown as plain text — for a card, a title, anywhere a README's syntax would be
 * noise. `**Fast** \`grep\`` becomes `Fast grep`.
 */
export function plainText(source: string): string {
	const context: Context = { defs: new Map(), slugs: new Map(), work: 0 };
	return textOf(parseInline(source, context, 0, false)).replace(/\s+/g, " ").trim();
}

/** Where a GitHub repository's README resolves its relative links; nothing for any other host. */
export function githubBase(repository: string, dir?: string): Base | undefined {
	const match = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(repository.trim());
	if (!match) return undefined;
	return { repo: `${match[1]}/${match[2]}`, dir: (dir ?? "").replace(/^\/+|\/+$/g, "") };
}

/**
 * A heading's anchor, the way GitHub writes it: lower case, punctuation and symbols dropped
 * (CJK kept), spaces to hyphens. In-page links in READMEs are written against GitHub's anchors, so
 * matching its algorithm is what makes `[How it works](#how-it-works)` land.
 */
export function slugify(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
		.replace(/ /g, "-");
}

/** The plain text of inline content: what a screen reader, a slug or an `alt` needs. */
function textOf(nodes: readonly Inline[]): string {
	let out = "";
	for (const node of nodes) {
		if (node.type === "text" || node.type === "code") out += node.value;
		else if (node.type === "image") out += node.alt;
		else if (node.type === "break") out += " ";
		else out += textOf(node.children);
	}
	return out;
}

// ── URLs ─────────────────────────────────────────────────────────────

/**
 * A URL we are willing to put on the page, or null.
 *
 * Absolute http(s) and mail links pass; `#anchor` passes as an in-page link. A path relative to the
 * README resolves against its repository — the page for a link, the raw bytes for an image, which
 * is what GitHub does. Any other scheme (`javascript:`, `data:`, `file:`) is refused, which is the
 * reason this function exists. So is a relative path that climbs out of the repository.
 */
export function resolveUrl(raw: string, base: Base | undefined, kind: "link" | "image"): { href: string; internal: boolean } | null {
	let url = raw.trim().replace(/^<|>$/g, "");
	// A control character inside a URL (`java\nscript:`) is how a scheme is smuggled past a check.
	if (!url || hasControl(url)) return null;
	if (url.startsWith("#")) return kind === "link" ? { href: url, internal: true } : null;
	if (url.startsWith("//")) url = `https:${url}`;
	if (/^https?:\/\//i.test(url)) {
		// A picture linked by its GitHub page rather than its bytes: the page is HTML, not an image.
		if (kind === "image") url = url.replace(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\//i, "https://github.com/$1/$2/raw/");
		return { href: url, internal: false };
	}
	if (/^mailto:/i.test(url)) return kind === "link" ? { href: url, internal: false } : null;
	// Any other scheme. Checked before the relative case, so `javascript:x` is never a filename.
	if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
	if (!base) return null;

	const hashAt = url.indexOf("#");
	const hash = hashAt >= 0 ? url.slice(hashAt) : "";
	const path = (hashAt >= 0 ? url.slice(0, hashAt) : url).replace(/\?.*$/, "");
	const resolved = joinPath(url.startsWith("/") ? "" : base.dir, path);
	if (resolved === null) return null;
	return kind === "image"
		? { href: `https://raw.githubusercontent.com/${base.repo}/HEAD/${resolved}`, internal: false }
		: { href: `https://github.com/${base.repo}/blob/HEAD/${resolved}${hash}`, internal: false };
}

function hasControl(text: string): boolean {
	for (let index = 0; index < text.length; index++) {
		if (text.charCodeAt(index) < 0x20 || text.charCodeAt(index) === 0x7f) return true;
	}
	return false;
}

/** `dir` + `path` with `.` and `..` settled; null if the result would leave the repository. */
function joinPath(dir: string, path: string): string | null {
	const parts: string[] = [];
	for (const segment of `${dir}/${path}`.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (!parts.length) return null;
			parts.pop();
			continue;
		}
		parts.push(segment);
	}
	return parts.join("/") + (path.endsWith("/") && parts.length ? "/" : "");
}

// ── Preparing the source ─────────────────────────────────────────────

function prepare(source: string): string[] {
	let text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	// YAML front matter, as a SKILL.md opens with: metadata for a loader, not prose for a reader.
	if (/^---\n[\w-]+:/.test(text)) {
		const end = text.indexOf("\n---", 4);
		if (end > 0 && /^\n---[ \t]*(\n|$)/.test(text.slice(end, end + 8))) text = text.slice(text.indexOf("\n", end + 1) + 1);
	}
	return text.split("\n").map(expandLeadingTabs);
}

/** Leading tabs to spaces, to the next multiple of four — indentation is compared in spaces. */
function expandLeadingTabs(line: string): string {
	if (!line.includes("\t")) return line;
	let out = "";
	let column = 0;
	let index = 0;
	for (; index < line.length; index++) {
		const char = line[index];
		if (char === " ") {
			out += " ";
			column += 1;
		} else if (char === "\t") {
			const width = 4 - (column % 4);
			out += " ".repeat(width);
			column += width;
		} else break;
	}
	return out + line.slice(index);
}

const DEFINITION = /^ {0,3}\[([^\]]{1,200})\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/;

/** `[label]: url` lines, taken out of the text and kept for the links that refer to them. */
function collectDefinitions(lines: string[], context: Context): string[] {
	let fence: string | null = null;
	return lines.map((line, index) => {
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence) {
			if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = null;
			return line;
		}
		if (marker) {
			fence = marker;
			return line;
		}
		const match = DEFINITION.exec(line);
		const previous = lines[index - 1] ?? "";
		// A definition cannot interrupt a paragraph; there, this is just text with a colon in it.
		if (!match || (previous.trim() && !DEFINITION.test(previous))) return line;
		const label = normaliseLabel(match[1] ?? "");
		if (!context.defs.has(label)) {
			const title = match[3] ?? match[4] ?? match[5];
			context.defs.set(label, { href: match[2] ?? "", ...(title ? { title } : {}) });
		}
		return "";
	});
}

function normaliseLabel(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase();
}

// ── Blocks ───────────────────────────────────────────────────────────

const FENCE = /^(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const ATX = /^(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

/** Elements that open a block of HTML and may interrupt a paragraph. */
const BLOCK_TAGS = new Set(
	"address article aside blockquote center details dialog dd div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p picture pre section summary table tbody td tfoot th thead tr ul video audio iframe script style textarea source".split(
		" ",
	),
);

/** Inline elements. Only tags on one of these two lists are treated as tags; `Array<T>` stays text. */
const INLINE_TAGS = new Set(
	"a abbr b bdi bdo br cite code data del dfn em font i img ins kbd mark q rp rt ruby s samp small span strike strong sub sup time tt u var wbr g-emoji".split(" "),
);

/** Containers whose contents are markdown in their own right, even across blank lines. */
const CONTAINER_TAGS = new Set(["details", "div", "p", "center", "section", "article", "figure", "table"]);

function isBlank(line: string | undefined): boolean {
	return line === undefined || line.trim() === "";
}

function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

function tagAt(text: string): { closing: boolean; name: string } | null {
	const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>]|$)/.exec(text);
	if (!match) return null;
	const name = (match[2] ?? "").toLowerCase();
	return BLOCK_TAGS.has(name) || INLINE_TAGS.has(name) ? { closing: match[1] === "/", name } : null;
}

function parseBlocks(lines: string[], context: Context, depth: number): Block[] {
	if (depth > MAX_DEPTH) {
		const text = lines.join(" ").trim();
		return text ? [{ type: "paragraph", children: [{ type: "text", value: text }] }] : [];
	}
	const out: Block[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (isBlank(line)) {
			index += 1;
			continue;
		}
		const indent = indentOf(line);

		// Four spaces in, at the start of a block: indented code.
		if (indent >= 4) {
			const body: string[] = [];
			while (index < lines.length && (isBlank(lines[index]) || indentOf(lines[index] ?? "") >= 4)) {
				body.push((lines[index] ?? "").slice(4));
				index += 1;
			}
			while (body.length && !body[body.length - 1]?.trim()) body.pop();
			out.push({ type: "code", lang: "", value: body.join("\n") });
			continue;
		}

		const text = line.slice(indent);

		const fence = FENCE.exec(text);
		if (fence) {
			const marker = fence[1] ?? "```";
			const body: string[] = [];
			index += 1;
			while (index < lines.length) {
				const next = lines[index] ?? "";
				const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(next);
				if (close && close[1]?.[0] === marker[0] && (close[1]?.length ?? 0) >= marker.length) {
					index += 1;
					break;
				}
				// A fence indented inside a list keeps its content's own indentation, minus the fence's.
				body.push(next.slice(Math.min(indent, indentOf(next))));
				index += 1;
			}
			out.push({ type: "code", lang: (fence[2] ?? "").replace(/[{}].*$/, "").toLowerCase(), value: body.join("\n") });
			continue;
		}

		if (text.startsWith("<")) {
			const next = html(lines, index, text, context, depth, out);
			if (next !== null) {
				index = next;
				continue;
			}
		}

		const atx = ATX.exec(text);
		if (atx) {
			out.push(heading((atx[1] ?? "#").length, atx[2] ?? "", context));
			index += 1;
			continue;
		}

		if (THEMATIC.test(text)) {
			out.push({ type: "rule" });
			index += 1;
			continue;
		}

		if (text.startsWith(">")) {
			index = blockquote(lines, index, context, depth, out);
			continue;
		}

		if (listMarker(line)) {
			index = list(lines, index, context, depth, out);
			continue;
		}

		if (text.includes("|") && DELIMITER_ROW.test(lines[index + 1] ?? "")) {
			const table = pipeTable(lines, index, context);
			if (table) {
				out.push(table.block);
				index = table.next;
				continue;
			}
		}

		index = paragraph(lines, index, context, out);
	}

	return out;
}

function heading(level: number, source: string, context: Context, align?: Align): Block {
	const children = parseInline(source.trim(), context, 0, false);
	const slug = slugify(textOf(children)) || "section";
	const seen = context.slugs.get(slug) ?? 0;
	context.slugs.set(slug, seen + 1);
	return {
		type: "heading",
		level: Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6,
		id: seen ? `${slug}-${seen}` : slug,
		...(align ? { align } : {}),
		children,
	};
}

/** Whether a line starts a block that ends a paragraph above it without a blank line between. */
function interrupts(line: string): boolean {
	const indent = indentOf(line);
	if (indent >= 4) return false;
	const text = line.slice(indent);
	if (FENCE.test(text) || ATX.test(text) || text.startsWith(">") || THEMATIC.test(text)) return true;
	const tag = tagAt(text);
	if (tag && BLOCK_TAGS.has(tag.name)) return true;
	if (text.startsWith("<!--")) return true;
	const marker = listMarker(line);
	// An ordered item interrupts only when it starts at 1 — "2019. was a year" is prose.
	return marker !== null && marker.content.trim() !== "" && (!marker.ordered || marker.start === 1);
}

function paragraph(lines: string[], start: number, context: Context, out: Block[]): number {
	const body: string[] = [lines[start] ?? ""];
	let index = start + 1;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (isBlank(line)) break;
		const setext = SETEXT.exec(line);
		if (setext) {
			out.push(heading(setext[1]?.[0] === "=" ? 1 : 2, body.join(" "), context));
			return index + 1;
		}
		if (interrupts(line)) break;
		// A table's header row is the line before its delimiter row, so the paragraph stops above it.
		if (line.includes("|") && DELIMITER_ROW.test(lines[index + 1] ?? "")) break;
		body.push(line);
		index += 1;
	}
	const children = parseInline(body.map((line) => line.trimStart()).join("\n").trimEnd(), context, 0, false);
	if (children.length) out.push({ type: "paragraph", children });
	return index;
}

const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(.*)$/i;

function blockquote(lines: string[], start: number, context: Context, depth: number, out: Block[]): number {
	const body: string[] = [];
	let index = start;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		const indent = indentOf(line);
		const text = line.slice(indent);
		if (indent < 4 && text.startsWith(">")) {
			body.push(text.slice(1).replace(/^ /, ""));
			index += 1;
			continue;
		}
		// A lazy line: prose that carries on without its `>`, as people write when they wrap by hand.
		if (!isBlank(line) && body.length && !isBlank(body[body.length - 1]) && !interrupts(line)) {
			body.push(line);
			index += 1;
			continue;
		}
		break;
	}

	const alert = ALERT.exec((body[0] ?? "").trim());
	if (alert) {
		const rest = alert[2]?.trim() ? [alert[2].trim(), ...body.slice(1)] : body.slice(1);
		out.push({ type: "alert", kind: (alert[1] ?? "note").toLowerCase() as AlertKind, children: parseBlocks(rest, context, depth + 1) });
	} else {
		out.push({ type: "quote", children: parseBlocks(body, context, depth + 1) });
	}
	return index;
}

interface Marker {
	ordered: boolean;
	/** The bullet character, or the delimiter after an ordered number. */
	symbol: string;
	start: number;
	/** Where the item's content begins, in columns from the line's start. */
	contentIndent: number;
	content: string;
}

function listMarker(line: string): Marker | null {
	const indent = indentOf(line);
	if (indent >= 4) return null;
	const text = line.slice(indent);
	const bullet = /^([-*+])([ \t]+|$)/.exec(text);
	if (bullet) {
		if (THEMATIC.test(text)) return null;
		const spaces = (bullet[2] ?? "").length;
		const gap = spaces === 0 || spaces > 4 ? 1 : spaces;
		return { ordered: false, symbol: bullet[1] ?? "-", start: 1, contentIndent: indent + 1 + gap, content: text.slice(1 + Math.min(spaces, gap)) };
	}
	const ordered = /^(\d{1,9})([.)])([ \t]+|$)/.exec(text);
	if (ordered) {
		const width = (ordered[1] ?? "").length + 1;
		const spaces = (ordered[3] ?? "").length;
		const gap = spaces === 0 || spaces > 4 ? 1 : spaces;
		return {
			ordered: true,
			symbol: ordered[2] ?? ".",
			start: Number(ordered[1]),
			contentIndent: indent + width + gap,
			content: text.slice(width + Math.min(spaces, gap)),
		};
	}
	return null;
}

function list(lines: string[], start: number, context: Context, depth: number, out: Block[]): number {
	const first = listMarker(lines[start] ?? "");
	if (!first) return start + 1;
	const block: Extract<Block, { type: "list" }> = { type: "list", ordered: first.ordered, start: first.start, tight: true, items: [] };
	let index = start;

	while (index < lines.length) {
		const marker = listMarker(lines[index] ?? "");
		if (!marker || marker.ordered !== first.ordered || marker.symbol !== first.symbol) break;

		const body: string[] = [marker.content];
		index += 1;
		while (index < lines.length) {
			const line = lines[index] ?? "";
			if (isBlank(line)) {
				body.push("");
				index += 1;
				continue;
			}
			if (indentOf(line) >= marker.contentIndent) {
				body.push(line.slice(marker.contentIndent));
				index += 1;
				continue;
			}
			// A lazy continuation of the item's last paragraph, not indented because nobody does.
			const previous = body[body.length - 1];
			if (!isBlank(previous) && !interrupts(line) && !listMarker(line) && !/^ {0,3}(```|~~~)/.test(previous ?? "")) {
				body.push(line.trimStart());
				index += 1;
				continue;
			}
			break;
		}

		// Blank lines at the end belong between items, not to this one — and make the list loose.
		let trailing = 0;
		while (body.length > 1 && !body[body.length - 1]?.trim()) {
			body.pop();
			trailing += 1;
		}
		const nextMarker = listMarker(lines[index] ?? "");
		if (trailing && nextMarker && nextMarker.ordered === first.ordered && nextMarker.symbol === first.symbol) block.tight = false;

		let checked: boolean | undefined;
		const task = /^\[([ xX])\][ \t]+/.exec(body[0] ?? "");
		if (task) {
			checked = task[1] !== " ";
			body[0] = (body[0] ?? "").slice(task[0].length);
		}

		const children = parseBlocks(body, context, depth + 1);
		// Two blocks in one item with a blank line between them: a loose list, spaced as paragraphs.
		if (children.length > 1 && hasInnerBlank(body)) block.tight = false;
		block.items.push({ ...(checked !== undefined ? { checked } : {}), children });
	}

	out.push(block);
	return index;
}

/** A blank line between two of an item's own lines — outside any fence. */
function hasInnerBlank(body: string[]): boolean {
	let fence = false;
	for (let index = 1; index < body.length - 1; index++) {
		const line = body[index] ?? "";
		if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
		if (!fence && !line.trim() && indentOf(body[index + 1] ?? "") === 0 && !listMarker(body[index + 1] ?? "")) return true;
	}
	return false;
}

function splitRow(line: string): string[] {
	let text = line.trim();
	if (text.startsWith("|")) text = text.slice(1);
	if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
	const cells: string[] = [];
	let cell = "";
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "\\" && text[index + 1] === "|") {
			cell += "|";
			index += 1;
			continue;
		}
		if (char === "|") {
			cells.push(cell.trim());
			cell = "";
			continue;
		}
		cell += char;
	}
	cells.push(cell.trim());
	return cells;
}

function pipeTable(lines: string[], start: number, context: Context): { block: Block; next: number } | null {
	const head = splitRow(lines[start] ?? "");
	const delimiters = splitRow(lines[start + 1] ?? "");
	if (head.length !== delimiters.length) return null;
	const align = delimiters.map((cell): Align | undefined => {
		const left = cell.startsWith(":");
		const right = cell.endsWith(":");
		return left && right ? "center" : right ? "right" : left ? "left" : undefined;
	});
	const rows: Inline[][][] = [];
	let index = start + 2;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		if (isBlank(line) || interrupts(line) || !line.includes("|")) break;
		const cells = splitRow(line);
		rows.push(head.map((_, column) => parseInline(cells[column] ?? "", context, 0, false)));
		index += 1;
	}
	return {
		block: { type: "table", align, head: head.map((cell) => parseInline(cell, context, 0, false)), rows },
		next: index,
	};
}

// ── HTML, at block level ─────────────────────────────────────────────

/**
 * A line that starts with HTML: a comment, a container, or a block of tags and text.
 *
 * Returns the index to carry on from, or null when the line only looked like HTML — `<3` and
 * `<T>` start prose, and fall through to be a paragraph.
 */
function html(lines: string[], start: number, text: string, context: Context, depth: number, out: Block[]): number | null {
	if (text.startsWith("<!--")) {
		let index = start;
		while (index < lines.length && !(lines[index] ?? "").includes("-->")) index += 1;
		if (index >= lines.length) return lines.length;
		const closing = lines[index] ?? "";
		const rest = closing.slice(closing.indexOf("-->") + 3);
		if (rest.trim()) {
			lines[index] = rest;
			return index;
		}
		return index + 1;
	}

	const tag = tagAt(text);
	if (!tag) return null;

	if (tag.closing) {
		// A stray closing tag — the end of a container opened somewhere this parse did not see.
		const rest = text.replace(/^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/, "");
		if (rest.trim() && rest !== text) {
			lines[start] = rest;
			return start;
		}
		if (rest !== text) return start + 1;
	}

	if (tag.name === "script" || tag.name === "style" || tag.name === "textarea" || tag.name === "pre") {
		const joined = lines.slice(start).join("\n");
		const closeAt = joined.search(new RegExp(`</${tag.name}\\s*>`, "i"));
		const end = closeAt < 0 ? joined.length : joined.indexOf(">", closeAt) + 1;
		if (tag.name === "pre") {
			const inner = joined.slice(joined.indexOf(">") + 1, closeAt < 0 ? joined.length : closeAt);
			out.push({ type: "code", lang: "", value: decodeEntities(inner.replace(/<[^>]*>/g, "")).replace(/^\n|\n$/g, "") });
		}
		return afterOffset(lines, start, joined, end);
	}

	if (!tag.closing && CONTAINER_TAGS.has(tag.name)) {
		const joined = lines.slice(start, start + 4000).join("\n");
		const open = new RegExp(`^<${tag.name}\\b([^>]*)>`, "i").exec(joined);
		if (open) {
			const close = matchClose(joined, open[0].length, tag.name);
			if (close) {
				const attrs = open[1] ?? "";
				const inner = joined.slice(open[0].length, close.start);
				out.push(...container(tag.name, attrs, inner, context, depth));
				return afterOffset(lines, start, joined, close.end);
			}
		}
	}

	// Anything else: HTML until a blank line, interpreted into blocks.
	const body: string[] = [];
	let index = start;
	while (index < lines.length && !isBlank(lines[index])) {
		body.push(lines[index] ?? "");
		index += 1;
	}
	out.push(...htmlBlocks(body.join("\n"), context, depth));
	return index;
}

/**
 * The line to resume at after `offset` characters of `joined` (the lines from `start` on) were
 * consumed. Whatever is left on that line is put back to be parsed.
 */
function afterOffset(lines: string[], start: number, joined: string, offset: number): number {
	const consumed = joined.slice(0, offset);
	const line = start + (consumed.match(/\n/g)?.length ?? 0);
	const column = offset - (consumed.lastIndexOf("\n") + 1);
	const rest = (lines[line] ?? "").slice(column);
	if (rest.trim()) {
		lines[line] = rest;
		return line;
	}
	return line + 1;
}

/** The closing tag that matches an opening one, counting nested tags of the same name. */
function matchClose(text: string, from: number, name: string): { start: number; end: number } | null {
	const pattern = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
	pattern.lastIndex = from;
	let depth = 1;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		if (match[0].endsWith("/>")) continue;
		depth += match[1] ? -1 : 1;
		if (depth === 0) return { start: match.index, end: match.index + match[0].length };
	}
	return null;
}

function container(name: string, attrs: string, inner: string, context: Context, depth: number): Block[] {
	if (depth > MAX_DEPTH) return [];
	if (name === "details") {
		const summary = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i.exec(inner);
		const body = summary ? inner.slice(summary[0].length) : inner;
		const title = summary ? parseInline((summary[1] ?? "").replace(/\s+/g, " ").trim(), context, depth + 1, false) : [];
		return [
			{
				type: "details",
				open: /(?:^|\s)open(?:\s|=|$)/i.test(attrs),
				// No `<summary>`: left empty, and the renderer supplies the word in the interface's language.
				summary: title.length ? trimInline(title) : [],
				children: parseBlocks(dedent(body).split("\n"), context, depth + 1),
			},
		];
	}
	if (name === "table") {
		const grid = htmlTable(inner, attrs, context, depth);
		return grid ? [grid] : parseBlocks(dedent(inner).split("\n"), context, depth + 1);
	}
	const children = parseBlocks(dedent(inner).split("\n"), context, depth + 1);
	const align = name === "center" ? "center" : alignOf(attrs);
	return align && align !== "left" ? [{ type: "group", align, children }] : children;
}

function alignOf(attrs: string): Align | undefined {
	const value = /\balign\s*=\s*["']?(left|center|right)/i.exec(attrs)?.[1] ?? /text-align\s*:\s*(left|center|right)/i.exec(attrs)?.[1];
	return value ? (value.toLowerCase() as Align) : undefined;
}

function htmlTable(inner: string, attrs: string, context: Context, depth: number): Block | null {
	const rows: GridCell[][] = [];
	const rowPattern = /<tr\b[^>]*>/gi;
	for (let row = rowPattern.exec(inner); row; row = rowPattern.exec(inner)) {
		const rowEnd = matchClose(inner, row.index + row[0].length, "tr");
		const rowInner = inner.slice(row.index + row[0].length, rowEnd ? rowEnd.start : inner.length);
		const cells: GridCell[] = [];
		const cellPattern = /<(td|th)\b([^>]*)>/gi;
		for (let cell = cellPattern.exec(rowInner); cell; cell = cellPattern.exec(rowInner)) {
			const name = (cell[1] ?? "td").toLowerCase();
			const cellEnd = matchClose(rowInner, cell.index + cell[0].length, name);
			const cellInner = rowInner.slice(cell.index + cell[0].length, cellEnd ? cellEnd.start : rowInner.length);
			const width = sizeOf(attribute(cell[2] ?? "", "width"));
			const align = alignOf(cell[2] ?? "");
			cells.push({
				header: name === "th",
				...(align ? { align } : {}),
				...(width ? { width } : {}),
				children: parseBlocks(dedent(cellInner).split("\n"), context, depth + 1),
			});
			cellPattern.lastIndex = cellEnd ? cellEnd.end : rowInner.length;
		}
		if (cells.length) rows.push(cells);
		rowPattern.lastIndex = rowEnd ? rowEnd.end : inner.length;
	}
	if (!rows.length) return null;
	const align = alignOf(attrs);
	return { type: "grid", ...(align ? { align } : {}), rows };
}

/**
 * HTML indented for its own readability, not as a code block: strip the common indent.
 *
 * `<div align="center">` followed by its images four spaces in is how READMEs are written, and
 * read as markdown those four spaces would make a code block of raw tags. The first line is left
 * out of the measure when it sits on the opening tag's own line — it has no indent to share.
 */
function dedent(text: string): string {
	const lines = text.split("\n").map(expandLeadingTabs);
	const from = lines.length > 1 && lines[0]?.trim() ? 1 : 0;
	const indents = lines.slice(from).filter((line) => line.trim()).map(indentOf);
	const common = indents.length ? Math.min(...indents) : 0;
	if (!common) return lines.join("\n");
	return lines.map((line, index) => (index < from ? line : line.slice(Math.min(common, indentOf(line))))).join("\n");
}

/**
 * A block of HTML as blocks: headings, rules, lists and quotes where it has them, paragraphs of its
 * inline content everywhere else. A `<p align="center">` keeps its alignment.
 */
function htmlBlocks(source: string, context: Context, depth: number): Block[] {
	const text = source.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
	const out: Block[] = [];
	const align = alignOf(/^\s*<(?:p|div|center)\b([^>]*)>/i.exec(text)?.[1] ?? "") ?? (/^\s*<center\b/i.test(text) ? "center" : undefined);
	// Containers too: `<br/>` on one line and a centred `<div>` on the next are one block of HTML.
	const pattern = /<(h[1-6]|hr|ul|ol|blockquote|table|pre|details|div|center|section|figure|p)\b([^>]*)>/gi;
	let last = 0;

	const flush = (chunk: string) => {
		const children = parseInline(chunk.trim(), context, depth + 1, false);
		if (!textOf(children).trim() && !children.some((node) => node.type === "image" || node.type === "link")) return;
		out.push({ type: "paragraph", ...(align && align !== "left" ? { align } : {}), children: trimInline(children) });
	};

	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		flush(text.slice(last, match.index));
		const name = (match[1] ?? "").toLowerCase();
		const attrs = match[2] ?? "";
		const openEnd = match.index + match[0].length;
		if (name === "hr") {
			out.push({ type: "rule" });
			last = openEnd;
			pattern.lastIndex = openEnd;
			continue;
		}
		const close = matchClose(text, openEnd, name);
		const inner = text.slice(openEnd, close ? close.start : text.length);
		last = close ? close.end : text.length;
		pattern.lastIndex = last;

		if (name.startsWith("h")) {
			out.push(heading(Number(name.slice(1)), inner.replace(/\s+/g, " "), context, alignOf(attrs) ?? (align && align !== "left" ? align : undefined)));
		} else if (name === "ul" || name === "ol") {
			const items: ListItem[] = [];
			const itemPattern = /<li\b[^>]*>([\s\S]*?)(?=<li\b|$)/gi;
			for (let item = itemPattern.exec(inner); item; item = itemPattern.exec(inner)) {
				const children = parseInline((item[1] ?? "").replace(/<\/li\s*>/gi, "").trim(), context, depth + 1, false);
				if (children.length) items.push({ children: [{ type: "paragraph", children }] });
			}
			if (items.length) out.push({ type: "list", ordered: name === "ol", start: 1, tight: true, items });
		} else if (name === "blockquote") {
			out.push({ type: "quote", children: htmlBlocks(inner, context, depth + 1) });
		} else if (name === "pre") {
			out.push({ type: "code", lang: "", value: decodeEntities(inner.replace(/<[^>]*>/g, "")).replace(/^\n|\n$/g, "") });
		} else {
			out.push(...container(name, attrs, inner, context, depth + 1));
		}
	}
	flush(text.slice(last));
	return out;
}

/** Leading and trailing breaks and spaces, which an HTML paragraph collects from its line layout. */
function trimInline(nodes: Inline[]): Inline[] {
	const out = [...nodes];
	while (out[0]?.type === "break" || (out[0]?.type === "text" && !out[0].value.trim())) out.shift();
	while (out[out.length - 1]?.type === "break" || (out[out.length - 1]?.type === "text" && !(out[out.length - 1] as { value: string }).value.trim())) out.pop();
	const first = out[0];
	if (first?.type === "text") out[0] = { type: "text", value: first.value.trimStart() };
	const last = out[out.length - 1];
	if (last?.type === "text") out[out.length - 1] = { type: "text", value: last.value.trimEnd() };
	return out;
}

// ── Inline ───────────────────────────────────────────────────────────

const SCAN_LIMIT = 6000;

const PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

function isCjk(char: string | undefined): boolean {
	return char !== undefined && /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(char);
}

function runLength(text: string, at: number, char: string): number {
	let end = at;
	while (text[end] === char) end += 1;
	return end - at;
}

/**
 * The next run of exactly `length` of `char` at or after `from`, or -1.
 *
 * Looks a bounded distance ahead: a code span or an emphasis longer than that is not one, and an
 * unbounded search repeated for every unmatched backtick is quadratic on a hostile README.
 */
function findRun(text: string, from: number, char: string, length: number): number {
	const limit = from + SCAN_LIMIT;
	let index = text.indexOf(char, from);
	while (index >= 0 && index < limit) {
		const run = runLength(text, index, char);
		if (run === length) return index;
		index = text.indexOf(char, index + run);
	}
	return -1;
}

function appendText(out: Inline[], value: string): void {
	const last = out[out.length - 1];
	if (last?.type === "text") last.value += value;
	else out.push({ type: "text", value });
}

function parseInline(source: string, context: Context, depth: number, inLink: boolean): Inline[] {
	if (depth > MAX_DEPTH) return source ? [{ type: "text", value: decodeEntities(source) }] : [];
	const out: Inline[] = [];
	let text = "";
	const flush = () => {
		if (text) appendText(out, text);
		text = "";
	};
	let index = 0;

	while (index < source.length) {
		const char = source[index] ?? "";

		if (char === "\\") {
			const next = source[index + 1];
			if (next === "\n") {
				flush();
				out.push({ type: "break" });
				index += 2;
				while (source[index] === " ") index += 1;
				continue;
			}
			if (next !== undefined && PUNCTUATION.includes(next)) {
				text += next;
				index += 2;
				continue;
			}
			text += char;
			index += 1;
			continue;
		}

		if (char === "`") {
			const run = runLength(source, index, "`");
			const close = findRun(source, index + run, "`", run);
			if (close < 0) {
				text += "`".repeat(run);
				index += run;
				continue;
			}
			flush();
			let code = source.slice(index + run, close).replace(/\n/g, " ");
			if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
			out.push({ type: "code", value: code });
			index = close + run;
			continue;
		}

		if (char === "\n") {
			if (/ {2,}$/.test(text)) {
				text = text.replace(/ +$/, "");
				flush();
				out.push({ type: "break" });
			} else {
				text = text.replace(/ +$/, "");
				let next = index + 1;
				while (source[next] === " ") next += 1;
				const before = text ? text[text.length - 1] : lastChar(out);
				// Two lines of Chinese join without a space; a space between them reads as a typo.
				if (!(isCjk(before) && isCjk(source[next]))) text += " ";
			}
			index += 1;
			while (source[index] === " ") index += 1;
			continue;
		}

		if (char === "<") {
			const auto = /^<((?:https?|ftp):\/\/[^\s<>]+|mailto:[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/i.exec(source.slice(index, index + 2048));
			if (auto) {
				const target = auto[1] ?? "";
				const url = resolveUrl(target.includes("@") && !/^[a-z]+:/i.test(target) ? `mailto:${target}` : target, context.base, "link");
				flush();
				if (url && !inLink) out.push({ type: "link", href: url.href, internal: false, children: [{ type: "text", value: target }] });
				else appendText(out, target);
				index += auto[0].length;
				continue;
			}
			const tag = inlineHtml(source, index, context, depth, inLink);
			if (tag) {
				flush();
				for (const node of tag.nodes) {
					if (node.type === "text") appendText(out, node.value);
					else out.push(node);
				}
				index = tag.end;
				continue;
			}
			text += char;
			index += 1;
			continue;
		}

		if (char === "!" && source[index + 1] === "[") {
			const image = linkAt(source, index + 1, context, depth, true, inLink);
			if (image) {
				flush();
				out.push(...image.nodes);
				index = image.end;
				continue;
			}
			text += char;
			index += 1;
			continue;
		}

		if (char === "[") {
			const link = linkAt(source, index, context, depth, false, inLink);
			if (link) {
				flush();
				for (const node of link.nodes) {
					if (node.type === "text") appendText(out, node.value);
					else out.push(node);
				}
				index = link.end;
				continue;
			}
			text += char;
			index += 1;
			continue;
		}

		if (char === "*" || char === "_" || char === "~") {
			const emphasis = emphasisAt(source, index, char, context, depth, inLink);
			if (emphasis) {
				flush();
				out.push(emphasis.node);
				index = emphasis.end;
				continue;
			}
			const run = runLength(source, index, char);
			text += source.slice(index, index + run);
			index += run;
			continue;
		}

		if (char === "&") {
			const entity = /^&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/.exec(source.slice(index, index + 40));
			const decoded = entity ? decodeEntity(entity[1] ?? "") : null;
			if (entity && decoded !== null) {
				text += decoded;
				index += entity[0].length;
				continue;
			}
			text += char;
			index += 1;
			continue;
		}

		if ((char === "h" || char === "w") && !inLink && boundaryBefore(source[index - 1])) {
			const url = bareUrl(source, index);
			if (url) {
				flush();
				out.push({ type: "link", href: url.href, internal: false, children: [{ type: "text", value: url.text }] });
				index += url.text.length;
				continue;
			}
		}

		text += char;
		index += 1;
	}

	flush();
	return out;
}

function lastChar(out: Inline[]): string | undefined {
	const last = out[out.length - 1];
	if (!last) return undefined;
	const text = last.type === "text" || last.type === "code" ? last.value : textOf([last]);
	return text[text.length - 1];
}

function boundaryBefore(char: string | undefined): boolean {
	return char === undefined || !/[A-Za-z0-9/.@=:_-]/.test(char);
}

/**
 * A bare URL, as GitHub links them. Stops at the first non-ASCII character — a URL followed straight
 * by Chinese prose is common, and the prose is not part of the address — and gives back trailing
 * punctuation and any `)` it did not open.
 */
function bareUrl(source: string, at: number): { href: string; text: string } | null {
	const match = /^(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/.exec(source.slice(at, at + 2048));
	if (!match) return null;
	let text = match[0];
	for (;;) {
		const trimmed = text.replace(/[?!.,:;*_~'"]+$/, "");
		const open = (trimmed.match(/\(/g) ?? []).length;
		const close = (trimmed.match(/\)/g) ?? []).length;
		const next = trimmed.endsWith(")") && close > open ? trimmed.slice(0, -1) : trimmed;
		if (next === text) break;
		text = next;
	}
	if (!/^(?:https?:\/\/|www\.)[A-Za-z0-9-]+\.[A-Za-z0-9]/.test(text) && !/^https?:\/\/localhost/.test(text)) return null;
	const href = text.startsWith("www.") ? `https://${text}` : text;
	return /^https?:\/\//i.test(href) ? { href, text } : null;
}

function emphasisAt(
	source: string,
	at: number,
	char: string,
	context: Context,
	depth: number,
	inLink: boolean,
): { node: Inline; end: number } | null {
	const run = runLength(source, at, char);
	if (char === "~" ? run !== 2 : run > 3) return null;
	if (context.work > WORK_LIMIT) return null;
	const after = source[at + run];
	if (after === undefined || /\s/.test(after)) return null;
	// `snake_case_name` is a name, not emphasis.
	if (char === "_" && /[\p{L}\p{N}]/u.test(source[at - 1] ?? "")) return null;

	let index = at + run;
	const limit = Math.min(source.length, at + SCAN_LIMIT);
	/*
	 * Runs of a different length opened inside, still waiting to close. `**bold *and italic***` ends
	 * in one run of three that closes the inner `*` and then this `**`; counting what is open inside
	 * is how that run is read as both, while `*a **b** c*` still pairs its `**`s with each other.
	 */
	const open = [0, 0, 0, 0];
	while (index < limit) {
		const current = source[index];
		if (current === "\\") {
			index += 2;
			continue;
		}
		if (current === "`") {
			const ticks = runLength(source, index, "`");
			const close = findRun(source, index + ticks, "`", ticks);
			index = close < 0 ? index + ticks : close + ticks;
			continue;
		}
		// A link's destination is an address; an asterisk in it closes nothing.
		if (current === "]" && source[index + 1] === "(") {
			const close = source.indexOf(")", index);
			index = close < 0 ? index + 1 : close + 1;
			continue;
		}
		if (current === char) {
			const length = runLength(source, index, char);
			const before = source[index - 1];
			const next = source[index + length];
			const rightFlanking = before !== undefined && !/\s/.test(before);
			const leftFlanking = next !== undefined && !/\s/.test(next);
			const wordAfter = char === "_" && next !== undefined && /[\p{L}\p{N}]/u.test(next);
			const inner = length - run;
			let closeAt = -1;
			if (length === run && rightFlanking && !wordAfter && index > at + run) closeAt = index;
			else if (inner > 0 && inner < 3 && rightFlanking && !wordAfter && (open[inner] ?? 0) > 0) closeAt = index + inner;
			else if (length !== run && length < 4) {
				if (leftFlanking && !rightFlanking) open[length] = (open[length] ?? 0) + 1;
				else if (rightFlanking && !leftFlanking && (open[length] ?? 0) > 0) open[length] = (open[length] ?? 0) - 1;
			}
			if (closeAt >= 0) {
				index = closeAt;
				const children = parseInline(source.slice(at + run, index), context, depth + 1, inLink);
				const node: Inline =
					char === "~"
						? { type: "del", children }
						: run === 1
							? { type: "em", children }
							: run === 2
								? { type: "strong", children }
								: { type: "strong", children: [{ type: "em", children }] };
				return { node, end: index + run };
			}
			index += length;
			continue;
		}
		index += 1;
	}
	context.work += index - at;
	return null;
}

/** The `]` that closes the `[` at `start`, skipping code spans, escapes and nested brackets. */
function matchBracket(source: string, start: number): number {
	let depth = 0;
	for (let index = start; index < source.length && index - start < 4000; index++) {
		const char = source[index];
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (char === "`") {
			const ticks = runLength(source, index, "`");
			const close = findRun(source, index + ticks, "`", ticks);
			index = (close < 0 ? index + ticks : close + ticks) - 1;
			continue;
		}
		if (char === "[") depth += 1;
		else if (char === "]") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return -1;
}

/** `(url "title")` after a link's text; balanced parentheses in the URL are allowed. */
function destination(source: string, at: number): { url: string; title?: string; end: number } | null {
	let index = at;
	const skip = () => {
		while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
	};
	skip();
	let url: string;
	if (source[index] === "<") {
		const close = source.indexOf(">", index);
		if (close < 0 || source.slice(index, close).includes("\n")) return null;
		url = source.slice(index + 1, close);
		index = close + 1;
	} else {
		const start = index;
		let depth = 0;
		while (index < source.length) {
			const char = source[index] ?? "";
			if (char === "\\" && index + 1 < source.length) {
				index += 2;
				continue;
			}
			if (/\s/.test(char)) break;
			if (char === "(") depth += 1;
			else if (char === ")") {
				if (depth === 0) break;
				depth -= 1;
			}
			index += 1;
		}
		url = source.slice(start, index).replace(/\\([!-/:-@[-`{-~])/g, "$1");
	}
	skip();
	let title: string | undefined;
	const quote = source[index];
	if (quote === '"' || quote === "'" || quote === "(") {
		const close = source.indexOf(quote === "(" ? ")" : quote, index + 1);
		if (close < 0) return null;
		title = source.slice(index + 1, close);
		index = close + 1;
		skip();
	}
	if (source[index] !== ")") return null;
	return { url, ...(title !== undefined ? { title } : {}), end: index + 1 };
}

/**
 * A link or an image starting at the `[` at `start`: inline `[text](url)`, or a reference to a
 * `[label]: url` definition. Null when it is neither, and the bracket is only text.
 */
function linkAt(
	source: string,
	start: number,
	context: Context,
	depth: number,
	image: boolean,
	inLink: boolean,
): { nodes: Inline[]; end: number } | null {
	const close = matchBracket(source, start);
	if (close < 0) return null;
	const label = source.slice(start + 1, close);
	let href: string | undefined;
	let title: string | undefined;
	let end = close + 1;

	if (source[end] === "(") {
		const target = destination(source, end + 1);
		if (target) {
			href = target.url;
			title = target.title;
			end = target.end;
		}
	}
	if (href === undefined) {
		let reference = label;
		if (source[end] === "[") {
			const referenceEnd = source.indexOf("]", end + 1);
			if (referenceEnd > 0 && referenceEnd - end < 200) {
				reference = source.slice(end + 1, referenceEnd) || label;
				const found = context.defs.get(normaliseLabel(reference));
				if (found) end = referenceEnd + 1;
			}
		}
		const found = context.defs.get(normaliseLabel(reference));
		if (!found) return null;
		href = found.href;
		title = found.title;
	}

	if (image) {
		const alt = textOf(parseInline(label, context, depth + 1, true));
		const url = resolveUrl(href, context.base, "image");
		// An image that cannot be shown shows nothing; its alt text alone, mid-sentence, reads as a glitch.
		if (!url) return { nodes: [], end };
		return { nodes: [imageNode(url.href, alt, title ? { title } : {})], end };
	}

	const children = parseInline(label, context, depth + 1, true);
	const url = resolveUrl(href, context.base, "link");
	// A link we will not follow keeps its text. Inside another link, links cannot nest.
	if (!url || inLink) return { nodes: children, end };
	return {
		nodes: [{ type: "link", href: url.href, internal: url.internal, ...(title ? { title } : {}), children: children.length ? children : [{ type: "text", value: href }] }],
		end,
	};
}

/**
 * A badge — the row of status pictures most READMEs open with. It sits at text height in a row;
 * anything else is a picture and gets the column's width.
 */
function isBadge(src: string): boolean {
	return /(?:img\.shields\.io|badgen\.net|badge\.fury\.io|\/badge(?:s)?[/.?]|badge\.svg|deepwiki\.com\/badge|codecov\.io|travis-ci\.|circleci\.com|coveralls\.io|flat\.badgen|awesome\.re\/badge|forthebadge\.com|skillsmp\.com\/badge|star-history\.com\/svg)/i.test(src);
}

/**
 * Whether the author sized a picture past text height themselves — and is taken at their word.
 * Trendshift's badge is written `width="250" height="55"`; drawn at a badge's 20px it was unreadable.
 */
function sizedLarge(width: string | undefined, height: string | undefined): boolean {
	const px = (value: string | undefined) => (value && !value.endsWith("%") ? Number.parseFloat(value) : Number.NaN);
	return px(height) > 32 || px(width) > 160;
}

function imageNode(src: string, alt: string, extra: { title?: string; width?: string; height?: string; round?: boolean; sources?: ImageSource[] }): Inline {
	return {
		type: "image",
		src,
		alt,
		...(extra.title ? { title: extra.title } : {}),
		...(extra.width ? { width: extra.width } : {}),
		...(extra.height ? { height: extra.height } : {}),
		badge: isBadge(src) && !/star-history/i.test(src) && !sizedLarge(extra.width, extra.height),
		round: extra.round ?? false,
		...(extra.sources?.length ? { sources: extra.sources } : {}),
	};
}

// ── HTML, inline ─────────────────────────────────────────────────────

/**
 * The tag starting at `at`, read by hand rather than by one regular expression: attribute values
 * hold `>` inside quotes, and a pattern general enough for that backtracks badly on a malformed tag.
 */
function readTag(source: string, at: number): { closing: boolean; name: string; attrs: string; end: number } | null {
	const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])/.exec(source.slice(at, at + 64));
	if (!head) return null;
	const start = at + head[0].length;
	const limit = Math.min(source.length, start + 16384);
	let quote: string | null = null;
	for (let index = start; index < limit; index++) {
		const char = source[index];
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === ">") {
			return { closing: head[1] === "/", name: (head[2] ?? "").toLowerCase(), attrs: source.slice(start, index).replace(/\/\s*$/, ""), end: index + 1 };
		} else if (char === "<") return null;
	}
	return null;
}

function attribute(attrs: string, name: string): string | undefined {
	const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i").exec(attrs);
	const value = match ? (match[1] ?? match[2] ?? match[3]) : undefined;
	return value === undefined ? undefined : decodeEntities(value);
}

/** A width or height we will put in a style: a number of pixels or a percentage, nothing else. */
function sizeOf(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const match = /^\s*(\d{1,4})(px|%)?\s*$/i.exec(value);
	if (!match) return undefined;
	return match[2] === "%" ? `${Math.min(100, Number(match[1]))}%` : `${match[1]}`;
}

function htmlImage(attrs: string, context: Context, sources?: ImageSource[]): Inline | null {
	const raw = attribute(attrs, "src") ?? attribute(attrs, "data-src");
	const url = raw ? resolveUrl(raw, context.base, "image") : null;
	if (!url) return null;
	const width = sizeOf(attribute(attrs, "width"));
	const height = sizeOf(attribute(attrs, "height"));
	const title = attribute(attrs, "title");
	return imageNode(url.href, attribute(attrs, "alt") ?? "", {
		...(title ? { title } : {}),
		...(width ? { width } : {}),
		...(height ? { height } : {}),
		round: /border-radius\s*:\s*50%/i.test(attribute(attrs, "style") ?? ""),
		...(sources ? { sources } : {}),
	});
}

/** A `<source>` we can keep: a colour-scheme query and addresses that pass `resolveUrl`. */
function pictureSource(attrs: string, context: Context): ImageSource | null {
	const media = attribute(attrs, "media")?.trim() ?? "";
	if (!/^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i.test(media)) return null;
	const candidates = (attribute(attrs, "srcset") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
	const resolved: string[] = [];
	for (const candidate of candidates) {
		const [address, descriptor] = candidate.split(/\s+/, 2);
		const url = address ? resolveUrl(address, context.base, "image") : null;
		if (!url || (descriptor && !/^\d+(?:\.\d+)?[wx]$/.test(descriptor))) return null;
		resolved.push(descriptor ? `${url.href} ${descriptor}` : url.href);
	}
	return resolved.length ? { media: media.toLowerCase().replace(/\s+/g, " "), srcSet: resolved.join(", ") } : null;
}

const WRAPPERS: Record<string, "strong" | "em" | "del" | "kbd" | "sup" | "sub" | "mark"> = {
	b: "strong",
	strong: "strong",
	i: "em",
	em: "em",
	cite: "em",
	dfn: "em",
	var: "em",
	del: "del",
	s: "del",
	strike: "del",
	kbd: "kbd",
	sup: "sup",
	sub: "sub",
	mark: "mark",
};

/**
 * A tag inside a line of text. The ones that mean something here become nodes; any other known
 * tag is dropped and its content carries on as text. A comment disappears whole.
 */
function inlineHtml(source: string, at: number, context: Context, depth: number, inLink: boolean): { nodes: Inline[]; end: number } | null {
	if (source.startsWith("<!--", at)) {
		const close = source.indexOf("-->", at + 4);
		return { nodes: [], end: close < 0 ? source.length : close + 3 };
	}
	const tag = readTag(source, at);
	if (!tag) return null;
	const { name, attrs, end } = tag;
	if (!BLOCK_TAGS.has(name) && !INLINE_TAGS.has(name)) return null;
	if (tag.closing) return { nodes: [], end };

	if (name === "br") return { nodes: [{ type: "break" }], end };
	if (name === "img") {
		const image = htmlImage(attrs, context);
		return { nodes: image ? [image] : [], end };
	}
	if (name === "script" || name === "style" || name === "textarea") {
		const close = matchClose(source, end, name);
		return { nodes: [], end: close ? close.end : source.length };
	}
	if (name === "picture") {
		const close = matchClose(source, end, "picture");
		const inner = source.slice(end, close ? close.start : source.length);
		const sources = [...inner.matchAll(/<source\b([^>]*)>/gi)]
			.map((found) => pictureSource(found[1] ?? "", context))
			.filter((found): found is ImageSource => found !== null);
		const img = /<img\b([^>]*)>/i.exec(inner);
		const image = img ? htmlImage(img[1] ?? "", context, sources) : null;
		return { nodes: image ? [image] : [], end: close ? close.end : source.length };
	}

	const wrapper = WRAPPERS[name];
	if (name === "a" || name === "code" || name === "tt" || name === "samp" || wrapper) {
		const close = matchClose(source, end, name);
		if (!close) return { nodes: [], end };
		const inner = source.slice(end, close.start);
		if (name === "code" || name === "tt" || name === "samp") {
			return { nodes: [{ type: "code", value: decodeEntities(inner.replace(/<[^>]*>/g, "")) }], end: close.end };
		}
		const children = parseInline(inner, context, depth + 1, inLink || name === "a");
		if (name === "a") {
			const href = attribute(attrs, "href");
			const url = href ? resolveUrl(href, context.base, "link") : null;
			return { nodes: url && !inLink ? [{ type: "link", href: url.href, internal: url.internal, children }] : children, end: close.end };
		}
		return { nodes: wrapper ? [{ type: wrapper, children }] : children, end: close.end };
	}

	// `<span>`, `<font>`, `<p>`, `<div>`, `<summary>`… — the tag goes, what it held stays.
	return { nodes: [], end };
}

// ── Entities ─────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
	nbsp: "\u00a0",
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	copy: "©",
	reg: "®",
	trade: "™",
	hellip: "…",
	mdash: "—",
	ndash: "–",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	laquo: "«",
	raquo: "»",
	middot: "·",
	bull: "•",
	times: "×",
	divide: "÷",
	larr: "←",
	rarr: "→",
	uarr: "↑",
	darr: "↓",
	harr: "↔",
	check: "✓",
	deg: "°",
	plusmn: "±",
	para: "¶",
	sect: "§",
	euro: "€",
	pound: "£",
	yen: "¥",
	cent: "¢",
	ensp: "\u2002",
	emsp: "\u2003",
	thinsp: "\u2009",
	zwj: "\u200d",
	zwnj: "\u200c",
};

function decodeEntity(body: string): string | null {
	if (body.startsWith("#")) {
		const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
		if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\uFFFD";
		return String.fromCodePoint(code);
	}
	return NAMED[body] ?? NAMED[body.toLowerCase()] ?? null;
}

function decodeEntities(text: string): string {
	return text.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body: string) => decodeEntity(body) ?? whole);
}
