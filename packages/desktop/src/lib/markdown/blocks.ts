/**
 * Markdown, as blocks.
 *
 * Split out from the renderer next door because this is the part that can be wrong. Which lines
 * form a table and which are a sentence about tables is a question with an answer; how a table is
 * drawn is a matter of taste. Only the first kind is testable, and `--experimental-strip-types`
 * cannot load `.tsx` — so the answerable half lives in a file the test runner can import.
 */

export type Block =
	| { kind: "heading"; level: number; text: string; align?: Align }
	| { kind: "paragraph"; text: string }
	| { kind: "code"; lang: string; code: string }
	| { kind: "list"; ordered: boolean; items: ListItem[] }
	| { kind: "quote"; text: string }
	| { kind: "rule" }
	| { kind: "table"; header: string[]; rows: string[][]; align: Align[] }
	| { kind: "math"; tex: string }
	| { kind: "details"; summary: string; children: Block[] }
	/** A block-level HTML element — a `<div align="center">` and the blocks inside it. */
	| { kind: "html"; align: Align | null; children: Block[] };

/** A column's alignment, from the colons in the separator row. */
export type Align = "left" | "center" | "right";

export interface ListItem {
	text: string;
	children: Block[];
	/** Present only for `- [ ]` / `- [x]`; a bullet that is not a task has none. */
	checked?: boolean;
}

export function parseMarkdown(source: string): Block[] {
	return parseBlocks(source.replace(/\r\n/g, "\n").split("\n"));
}

export function parseBlocks(lines: string[]): Block[] {
	const blocks: Block[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) {
			i++;
			continue;
		}

		/*
		 * Fenced code, with either fence character.
		 *
		 * An unterminated fence runs to the end rather than swallowing nothing, which is the state a
		 * code block is in for as long as it is still streaming in.
		 */
		const fence = /^\s*(```+|~~~+)(\S*)\s*$/.exec(line);
		if (fence) {
			const marker = fence[1][0];
			const lang = fence[2] ?? "";
			const code: string[] = [];
			i++;
			while (i < lines.length && !new RegExp(`^\\s*${marker === "`" ? "```" : "~~~"}+\\s*$`).test(lines[i]))
				code.push(lines[i++]);
			i++;
			blocks.push({ kind: "code", lang, code: code.join("\n") });
			continue;
		}

		/*
		 * A formula on its own lines.
		 *
		 * Block level rather than inline because it is centred and given its own vertical space —
		 * the author put it on its own line to say it is a statement, not a phrase.
		 */
		if (/^\s*\$\$/.test(line)) {
			const single = /^\s*\$\$(.+?)\$\$\s*$/.exec(line);
			if (single) {
				blocks.push({ kind: "math", tex: single[1].trim() });
				i++;
				continue;
			}
			const tex: string[] = [line.replace(/^\s*\$\$/, "")];
			i++;
			while (i < lines.length && !/\$\$\s*$/.test(lines[i])) tex.push(lines[i++]);
			if (i < lines.length) tex.push(lines[i++].replace(/\$\$\s*$/, ""));
			blocks.push({ kind: "math", tex: tex.join("\n").trim() });
			continue;
		}

		/*
		 * A `<details>` block, which on GitHub is how long logs get folded away.
		 *
		 * Worth recognising here rather than leaving to the inline pass: its contents are blocks —
		 * usually a fenced log — and the summary is a control, not a sentence.
		 */
		if (/^\s*<details[\s>]/i.test(line)) {
			const { block, next } = parseDetails(lines, i);
			blocks.push(block);
			i = next;
			continue;
		}

		/*
		 * A block-level HTML element, which is how a README says everything Markdown cannot.
		 *
		 * Left to the inline pass these were transparent: the tag went, the contents stayed, and
		 * `<p align="center">` around a logo drew a left-aligned logo. Worse, the newlines *inside*
		 * the element were still read as Markdown line breaks, so three badges written one per line
		 * — the ordinary way a badge row is typed — came out as three stacked links.
		 *
		 * Both follow from treating a container as prose. Recognised here it is a container: the
		 * alignment survives, and the contents are parsed as blocks with HTML's own whitespace rule.
		 */
		if (htmlBlockAt(line)) {
			const { block, next } = parseHtmlBlock(lines, i);
			blocks.push(block);
			i = next;
			continue;
		}

		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
			i++;
			continue;
		}

		if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
			blocks.push({ kind: "rule" });
			i++;
			continue;
		}

		if (/^\s*>\s?/.test(line)) {
			const quoted: string[] = [];
			while (i < lines.length && /^\s*>\s?/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ""));
			blocks.push({ kind: "quote", text: quoted.join("\n") });
			continue;
		}

		if (isTableStart(lines, i)) {
			const header = splitRow(line);
			const align = alignOf(lines[i + 1]);
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
			blocks.push({ kind: "table", header, rows, align });
			continue;
		}

		if (isListLine(line)) {
			const { list, next } = parseList(lines, i, indentOf(line));
			blocks.push(list);
			i = next;
			continue;
		}

		/*
		 * A paragraph runs until something else starts.
		 *
		 * A table counts as starting something, which is not true of Markdown generally but is true
		 * of the dialect people write: a sentence introducing a table, then the table on the very
		 * next line with no blank between, is the ordinary way it gets typed.
		 */
		const paragraph: string[] = [];
		while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) && !isTableStart(lines, i))
			paragraph.push(lines[i++]);
		if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
		else i++;
	}

	return blocks;
}

function isBlockStart(line: string): boolean {
	return (
		/^\s*(```|~~~)/.test(line) ||
		/^#{1,6}\s/.test(line) ||
		/^\s*>\s?/.test(line) ||
		/^\s*(---|\*\*\*|___)\s*$/.test(line) ||
		/^\s*\$\$/.test(line) ||
		/^\s*<details[\s>]/i.test(line) ||
		htmlBlockAt(line) !== null ||
		isListLine(line)
	);
}

/**
 * The HTML elements that are containers rather than phrasing.
 *
 * Kept short on purpose. `<span>` and `<kbd>` belong to the inline pass — pulling them up here
 * would break a sentence in half around one — and anything not on this list keeps the behaviour it
 * had. `h1`–`h6` are containers too, but they become headings rather than boxes; see below.
 */
const BLOCK_TAGS = new Set(["div", "p", "center", "section", "article", "figure", "figcaption", "main", "aside", "header", "footer"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** The element opening this line, if the line opens one. */
function htmlBlockAt(line: string): { name: string; attrs: string; from: number } | null {
	const open = /^\s*<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/.exec(line);
	if (!open) return null;
	const name = open[1].toLowerCase();
	if (!BLOCK_TAGS.has(name) && !HEADING_TAGS.has(name)) return null;
	return { name, attrs: open[2] ?? "", from: open[0].length };
}

/**
 * One block-level element, its contents parsed as blocks.
 *
 * The close is found by depth, the same way `<details>` finds its own, so a `<div>` inside a `<div>`
 * does not end the outer one early. An element left unclosed takes the rest of the document rather
 * than being dropped — a README that opens `<div align="center">` and never closes it still means
 * "centre everything below here", and that is what GitHub shows.
 */
function parseHtmlBlock(lines: string[], start: number): { block: Block; next: number } {
	const open = htmlBlockAt(lines[start]);
	if (!open) return { block: { kind: "paragraph", text: lines[start] }, next: start + 1 };

	const { name, attrs } = open;
	const opener = new RegExp(`<${name}(?:\\s[^<>]*)?>`, "gi");
	const closer = new RegExp(`</${name}\\s*>`, "gi");

	let depth = 0;
	let end = lines.length - 1;
	let closed = false;
	for (let i = start; i < lines.length; i++) {
		depth += lines[i].match(opener)?.length ?? 0;
		depth -= lines[i].match(closer)?.length ?? 0;
		if (depth <= 0) {
			end = i;
			closed = true;
			break;
		}
	}

	const body = lines.slice(start, end + 1).join("\n").slice(open.from);
	const inner = closed ? body.replace(new RegExp(`</${name}\\s*>\\s*$`, "i"), "") : body;
	const align = alignAttr(attrs);

	/*
	 * A heading is a heading, not a box with a heading in it.
	 *
	 * `<h1 align="center">` is how a README titles itself, and rendering it as a container holding a
	 * paragraph would put body text where the document's title goes — wrong size, wrong weight, and
	 * invisible to anything reading the outline.
	 */
	if (HEADING_TAGS.has(name)) {
		const level = Number(name[1]);
		return { block: { kind: "heading", level, text: collapse(inner), ...(align ? { align } : {}) }, next: end + 1 };
	}

	return { block: { kind: "html", align, children: htmlChildren(inner) }, next: end + 1 };
}

/**
 * What is inside a container, read as blocks — but with HTML's whitespace rule, not Markdown's.
 *
 * This is the whole reason a badge row worked on GitHub and not here. Three `<a><img></a>` written
 * one per line are three inline elements separated by whitespace: HTML collapses that to a space
 * and lays them out in a row. Markdown reads the same newlines as line breaks and stacks them. The
 * contents of an HTML element follow HTML, so each paragraph inside one is folded onto a line —
 * an author who wants a break inside a container has `<br>`, which still works.
 */
function htmlChildren(inner: string): Block[] {
	return parseBlocks(inner.split("\n")).map((block) =>
		block.kind === "paragraph" ? { ...block, text: collapse(block.text) } : block,
	);
}

function collapse(text: string): string {
	return text.replace(/\s*\n\s*/g, " ").trim();
}

/** `align="center"`, or the same thing said in a `style` attribute. */
function alignAttr(attrs: string): Align | null {
	const raw = /(?:^|\s)align\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
	const value = (raw?.[2] ?? raw?.[3] ?? raw?.[4] ?? "").trim().toLowerCase();
	if (value === "center" || value === "middle") return "center";
	if (value === "right") return "right";
	if (value === "left") return "left";

	const style = /(?:^|\s)style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
	const styled = /text-align\s*:\s*(left|center|right)/i.exec(style?.[2] ?? style?.[3] ?? "");
	return (styled?.[1]?.toLowerCase() as Align | undefined) ?? null;
}

/**
 * A table: a header row, then a row of dashes.
 *
 * The only block that cannot be recognised from its own first line — a line of pipes is a table
 * header or an ordinary sentence depending entirely on what comes next. One function because two
 * copies of that lookahead is two places for the rule to drift.
 */
function isTableStart(lines: string[], i: number): boolean {
	return lines[i].includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]);
}

function isListLine(line: string): boolean {
	return /^\s*([-*+]|\d+[.)])\s+/.test(line);
}

function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

/** Parse one list level; deeper-indented lines recurse into the current item's children. */
function parseList(lines: string[], start: number, baseIndent: number): { list: Block; next: number } {
	const first = /^\s*(\d+)[.)]\s+/.exec(lines[start]);
	const ordered = first !== null;
	const items: ListItem[] = [];
	let i = start;

	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) {
			// A blank line only ends the list when the next content is not part of it.
			const lookahead = lines[i + 1];
			if (!lookahead || (!isListLine(lookahead) && indentOf(lookahead) <= baseIndent)) break;
			i++;
			continue;
		}

		const indent = indentOf(line);
		if (indent < baseIndent || !isListLine(line)) {
			if (indent > baseIndent && items.length > 0) {
				/*
				 * Something indented under the previous bullet.
				 *
				 * A wrapped sentence folds into that item's own text — it is one sentence, and making
				 * it a paragraph would open block spacing inside the bullet.
				 *
				 * Anything that starts a block does not fold. A table written under a bullet used to
				 * be appended to that same string and then handed to the inline renderer, which is
				 * why its pipes and dashes came out raw. From the first such line the rest of the
				 * item is read as blocks, shifted left to its own margin so the nested parse sees
				 * column zero.
				 */
				if (isBlockStart(line) || isTableStart(lines, i)) {
					const nested: string[] = [];
					while (i < lines.length) {
						const next = lines[i];
						if (next.trim()) {
							if (indentOf(next) <= baseIndent) break;
							// Never past a line's own indent, or a shallower line loses its first characters.
							nested.push(next.slice(Math.min(indent, indentOf(next))));
							i++;
							continue;
						}
						// A blank line stays inside the item only if more of the item follows it.
						const after = lines[i + 1];
						if (!after?.trim() || indentOf(after) <= baseIndent) break;
						nested.push("");
						i++;
					}
					items[items.length - 1].children.push(...parseBlocks(nested));
					continue;
				}

				items[items.length - 1].text += `\n${line.trim()}`;
				i++;
				continue;
			}
			break;
		}

		if (indent > baseIndent) {
			const nested = parseList(lines, i, indent);
			if (items.length > 0) items[items.length - 1].children.push(nested.list);
			i = nested.next;
			continue;
		}

		const marker = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
		const body = marker?.[1] ?? line.trim();

		/*
		 * `- [ ]` is a checkbox, not a bullet whose text begins with a bracket.
		 *
		 * A pull request description is often mostly checklist, and drawn as literal brackets it
		 * loses the one thing it is for: which items are done.
		 */
		const task = /^\[([ xX])\]\s+(.*)$/.exec(body);
		if (task) items.push({ text: task[2], children: [], checked: task[1] !== " " });
		else items.push({ text: body, children: [] });
		i++;
	}

	return { list: { kind: "list", ordered, items }, next: i };
}

/**
 * `<details>` with its `<summary>`, and everything between parsed as blocks.
 *
 * The close is found by depth so a nested `<details>` inside a folded section does not end the
 * outer one early. An unclosed tag folds the rest of the document rather than dropping it.
 */
function parseDetails(lines: string[], start: number): { block: Block; next: number } {
	let depth = 0;
	let end = lines.length - 1;
	for (let i = start; i < lines.length; i++) {
		depth += lines[i].match(/<details[\s>]/gi)?.length ?? 0;
		depth -= lines[i].match(/<\/details>/gi)?.length ?? 0;
		if (depth === 0) {
			end = i;
			break;
		}
	}

	const body = lines
		.slice(start, end + 1)
		.join("\n")
		.replace(/^\s*<details[^>]*>/i, "")
		.replace(/<\/details>\s*$/i, "");

	const summaryMatch = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(body);
	const summary = summaryMatch ? summaryMatch[1].trim() : "详情";
	const inner = summaryMatch ? body.replace(summaryMatch[0], "") : body;

	return { block: { kind: "details", summary, children: parseBlocks(inner.split("\n")) }, next: end + 1 };
}

/** Colons in the separator row say which way each column is set. */
function alignOf(separator: string): Align[] {
	return splitRow(separator).map((cell) => {
		const left = cell.startsWith(":");
		const right = cell.endsWith(":");
		if (left && right) return "center";
		if (right) return "right";
		return "left";
	});
}

/**
 * One row into its cells.
 *
 * A pipe inside a code span is a pipe, not a column edge — `a | b` written in backticks is one
 * cell. Splitting naively turns a row documenting a union type into two ragged cells and knocks
 * every column after it out of alignment.
 */
function splitRow(line: string): string[] {
	const body = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
	const cells: string[] = [];
	let cell = "";
	let inCode = false;

	for (let i = 0; i < body.length; i++) {
		const char = body[i];
		if (char === "`") inCode = !inCode;
		if (char === "\\" && body[i + 1] === "|") {
			// An escaped pipe is literal content; the backslash was only there to hide it.
			cell += "|";
			i++;
			continue;
		}
		if (char === "|" && !inCode) {
			cells.push(cell.trim());
			cell = "";
			continue;
		}
		cell += char;
	}
	cells.push(cell.trim());

	return cells;
}
