#!/usr/bin/env node
/**
 * Two builds of the stylesheet, compared as sets of rules rather than as text.
 *
 * Splitting a 3800-line stylesheet into files is pure movement: every rule that existed before must
 * exist after, and nothing new may appear. Diffing the built CSS as text cannot say that — the
 * order changes with the import order, and a reordered file is a diff of the whole thing.
 *
 * So each rule is normalised to `selector{prop:value;…}` and the two sets are compared. Order is
 * ignored deliberately; what order *does* affect is the cascade, and that is what the screenshot
 * comparison in e2e is for. This answers the cheaper question first: is anything missing.
 *
 *   node scripts/css-equivalence.mjs before.css after.css
 */

import { readFile } from "node:fs/promises";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
	console.error("用法: node scripts/css-equivalence.mjs <改动前.css> <改动后.css>");
	process.exit(2);
}

/**
 * Every declaration block, keyed by what it applies to.
 *
 * A hand-rolled scanner rather than a parser: this needs to run before any dependency is added,
 * and the shape it has to understand — balanced braces, strings, comments — is small enough to
 * scan. At-rules keep their prelude as part of the key, so a rule inside `@media (max-width: 40rem)`
 * is a different entry from the same rule outside it.
 */
function rules(css) {
	const found = new Map();
	const stack = [];
	let buffer = "";
	let index = 0;

	while (index < css.length) {
		const char = css[index];

		// Comments and strings are skipped whole; a brace inside either is not structure.
		if (char === "/" && css[index + 1] === "*") {
			const end = css.indexOf("*/", index + 2);
			index = end === -1 ? css.length : end + 2;
			continue;
		}
		if (char === '"' || char === "'") {
			const quote = char;
			let cursor = index + 1;
			while (cursor < css.length && (css[cursor] !== quote || css[cursor - 1] === "\\")) cursor++;
			buffer += css.slice(index, cursor + 1);
			index = cursor + 1;
			continue;
		}

		if (char === "{") {
			stack.push(buffer.trim().replace(/\s+/g, " "));
			buffer = "";
			index++;
			continue;
		}

		if (char === "}") {
			const selector = stack.pop() ?? "";
			const context = [...stack, selector].filter(Boolean).join(" >> ");
			const body = buffer
				.split(";")
				.map((part) => part.trim().replace(/\s+/g, " "))
				.filter(Boolean)
				.sort()
				.join(";");
			// A block with no declarations is a nesting container; its children were already recorded.
			if (body) found.set(`${context}{${body}}`, (found.get(`${context}{${body}}`) ?? 0) + 1);
			buffer = "";
			index++;
			continue;
		}

		buffer += char;
		index++;
	}
	return found;
}

const before = rules(await readFile(beforePath, "utf8"));
const after = rules(await readFile(afterPath, "utf8"));

const missing = [...before.keys()].filter((key) => !after.has(key));
const added = [...after.keys()].filter((key) => !before.has(key));

const show = (label, list) => {
	console.error(`\n${label}（${list.length} 条）：`);
	for (const rule of list.slice(0, 15)) console.error(`  ${rule.slice(0, 160)}`);
	if (list.length > 15) console.error(`  …还有 ${list.length - 15} 条`);
};

if (missing.length === 0 && added.length === 0) {
	console.log(`两份产物的规则集合一致（各 ${before.size} 条）`);
	process.exit(0);
}

if (missing.length > 0) show("改动后少了", missing);
if (added.length > 0) show("改动后多了", added);
console.error("\n拆分应该是纯搬运。上面的差异说明有东西被改掉或漏掉了。");
process.exit(1);
