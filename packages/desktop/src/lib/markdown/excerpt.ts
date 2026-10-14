import { parseMarkdown, type Block } from "./blocks.ts";
import { parseInline, type Inline } from "./inline.ts";

function inlineText(tokens: Inline[]): string {
	return tokens.map((token) => {
		if ("children" in token) return inlineText(token.children);
		if ("text" in token) return token.text;
		if (token.kind === "math") return token.tex;
		if (token.kind === "image") return token.alt;
		if (token.kind === "credential") return `[credential:${token.name}]`;
		return " ";
	}).join("");
}

function blockText(blocks: Block[]): string {
	return blocks.map((block) => {
		switch (block.kind) {
			case "rule": return "";
			case "code": return block.code;
			case "math": return block.tex;
			case "html": return blockText(block.children);
			case "details": return inlineText(parseInline(block.summary)) + " " + blockText(block.children);
			case "list": return block.items.map((item) => inlineText(parseInline(item.text)) + " " + blockText(item.children)).join(" ");
			case "table": return [...block.header, ...block.rows.flat()].map((cell) => inlineText(parseInline(cell))).join(" ");
			default: return inlineText(parseInline(block.text));
		}
	}).join(" ");
}

/** A preview is a readable excerpt, not a second document with rules, embeds and controls. */
export function markdownExcerpt(source: string): string {
	return blockText(parseMarkdown(source)).replace(/\s+/g, " ").trim();
}
