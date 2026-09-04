/**
 * A prompt template language, so a prompt can be a file instead of string concatenation.
 *
 * What that buys is not elegance. It is that a prompt becomes something you can diff, replace, and
 * write a regression test against — none of which is possible while the text is assembled by code
 * that also decides what goes in it.
 *
 * **Written rather than pulled in.** Handlebars' runtime is around 60KB and brings semantics we do
 * not want: partial registries, block parameters, a `this` context stack, helper registration —
 * and an escaping rule (`{{}}` escapes HTML, `{{{}}}` does not) that is actively wrong here. What
 * we emit is plain text for a model; HTML-escaping it would put `&amp;` in a prompt. `core` has
 * four dependencies and the restraint is deliberate.
 *
 * The syntax is a compatible subset, so moving to Handlebars later would not mean rewriting the
 * templates — only deleting this file.
 */

/** What a template can see. Values are looked up by dotted path. */
export type TemplateData = Record<string, unknown>;

/**
 * Truthiness, with one deliberate departure from JavaScript.
 *
 * An empty array is false. `{{#if skills}}` must not emit an empty `<available_skills>` block when
 * there are no skills — and in JavaScript `[]` is true, which would make every list section need
 * its own length check.
 */
export function truthy(value: unknown): boolean {
	if (Array.isArray(value)) return value.length > 0;
	if (value instanceof Map || value instanceof Set) return value.size > 0;
	return Boolean(value);
}

/** `a.b.c` against nested objects. Missing paths are undefined, never an error. */
export function lookup(data: TemplateData, path: string): unknown {
	/*
	 * Inside `each`, `this` is the item the loop set. Outside one it is the whole context — which
	 * is what a bare `{{this}}` at the top level can only mean.
	 */
	if (path === "this" || path === ".") return "this" in data ? data.this : data;
	let current: unknown = data;
	for (const part of path.split(".")) {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

type Node =
	| { kind: "text"; text: string }
	| { kind: "var"; path: string }
	| { kind: "block"; type: "if" | "unless" | "each"; path: string; body: Node[]; alt: Node[] }
	| { kind: "has"; list: string; names: string[]; negate: boolean; body: Node[]; alt: Node[] };

const TAG = /\{\{([^}]*)\}\}/g;

/**
 * Parse once, render many.
 *
 * The prompt for a given session is rendered every turn with different data; re-parsing the same
 * source each time would be work proportional to how long the conversation runs.
 */
export function compile(source: string): (data: TemplateData) => string {
	const nodes = parse(source);
	return (data) => render(nodes, data).trimEnd();
}

function parse(source: string): Node[] {
	const tokens: { text?: string; tag?: string }[] = [];
	let last = 0;
	TAG.lastIndex = 0;
	for (let match = TAG.exec(source); match !== null; match = TAG.exec(source)) {
		if (match.index > last) tokens.push({ text: source.slice(last, match.index) });
		tokens.push({ tag: match[1].trim() });
		last = match.index + match[0].length;
	}
	if (last < source.length) tokens.push({ text: source.slice(last) });

	let at = 0;

	function block(stop?: string[]): { nodes: Node[]; closed?: string } {
		const nodes: Node[] = [];
		while (at < tokens.length) {
			const token = tokens[at];
			if (token.text !== undefined) {
				nodes.push({ kind: "text", text: token.text });
				at += 1;
				continue;
			}
			const tag = token.tag!;
			if (stop && (stop.includes(tag) || (tag.startsWith("/") && stop.includes(tag)))) {
				at += 1;
				return { nodes, closed: tag };
			}
			at += 1;

			if (tag.startsWith("#if ") || tag.startsWith("#unless ")) {
				const type = tag.startsWith("#if ") ? "if" : "unless";
				const path = tag.slice(type === "if" ? 4 : 8).trim();
				const first = block(["else", `/${type}`]);
				const alt = first.closed === "else" ? block([`/${type}`]).nodes : [];
				nodes.push({ kind: "block", type, path, body: first.nodes, alt });
				continue;
			}
			if (tag.startsWith("#each ")) {
				const first = block(["else", "/each"]);
				const alt = first.closed === "else" ? block(["/each"]).nodes : [];
				nodes.push({ kind: "block", type: "each", path: tag.slice(6).trim(), body: first.nodes, alt });
				continue;
			}
			if (tag.startsWith("#has ") || tag.startsWith("#hasAny ")) {
				/*
				 * `{{#has tools "bash"}}` is the one helper this exists for: behaviour advice that
				 * only appears when the tool it is about is loaded. A session without `bash` seeing
				 * shell guidance is the failure it prevents, and it is the same idea the current
				 * `tool.guidelines` field already encodes — this just makes it expressible in a file.
				 */
				const negate = tag.startsWith("#hasAny ");
				const rest = tag.slice(negate ? 8 : 5).trim();
				const [list, ...quoted] = rest.split(/\s+/);
				const names = quoted.map((q) => q.replace(/^["']|["']$/g, ""));
				const first = block(["else", negate ? "/hasAny" : "/has"]);
				const alt = first.closed === "else" ? block([negate ? "/hasAny" : "/has"]).nodes : [];
				nodes.push({ kind: "has", list, names, negate, body: first.nodes, alt });
				continue;
			}
			if (tag.startsWith("#") || tag.startsWith("/")) {
				/*
				 * An unknown block is emitted as literal text rather than thrown on. A prompt is
				 * content, and a typo in one should produce a visibly odd prompt, not a session that
				 * will not start.
				 */
				nodes.push({ kind: "text", text: `{{${tag}}}` });
				continue;
			}
			nodes.push({ kind: "var", path: tag });
		}
		return { nodes };
	}

	return block().nodes;
}

function render(nodes: Node[], data: TemplateData): string {
	let out = "";
	for (const node of nodes) {
		if (node.kind === "text") {
			out += node.text;
			continue;
		}
		if (node.kind === "var") {
			const value = lookup(data, node.path);
			out += value === undefined || value === null ? "" : String(value);
			continue;
		}
		if (node.kind === "has") {
			const list = lookup(data, node.list);
			const present = Array.isArray(list) ? list.map(String) : [];
			const hit = node.negate ? node.names.some((n) => present.includes(n)) : node.names.every((n) => present.includes(n));
			out += render(hit ? node.body : node.alt, data);
			continue;
		}

		const value = lookup(data, node.path);
		if (node.type === "if") out += render(truthy(value) ? node.body : node.alt, data);
		else if (node.type === "unless") out += render(truthy(value) ? node.alt : node.body, data);
		else {
			const items = Array.isArray(value) ? value : [];
			if (items.length === 0) {
				out += render(node.alt, data);
				continue;
			}
			items.forEach((item, index) => {
				/*
				 * A scalar item is exposed as `this` and an object's fields are spread, so both
				 * `{{#each names}}{{this}}{{/each}}` and `{{#each tools}}{{name}}{{/each}}` read the
				 * way somebody would expect without having to know which they are looking at.
				 */
				const scope: TemplateData =
					typeof item === "object" && item !== null && !Array.isArray(item)
						? { ...data, ...(item as TemplateData), this: item, "@index": index }
						: { ...data, this: item, "@index": index };
				out += render(node.body, scope);
			});
		}
	}
	return out;
}

/** Compile with a cache, keyed on the source itself. */
const cache = new Map<string, (data: TemplateData) => string>();

export function renderTemplate(source: string, data: TemplateData): string {
	let compiled = cache.get(source);
	if (!compiled) {
		compiled = compile(source);
		cache.set(source, compiled);
	}
	return compiled(data);
}
