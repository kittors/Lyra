/**
 * Which hover-revealed controls the phone forces into view.
 *
 * Twenty-odd rows in the interface hide a control behind `group-hover`. A phone has no hover, so
 * those controls do not exist there — including copy, edit, rename, archive and delete, which is
 * most of what someone picks up a phone to do. One stylesheet rule reveals them, and the rule turns
 * on a distinction that is easy to get wrong and produces a mess when it is:
 *
 *     [class~="opacity-0"]   matches only a whole class name
 *     [class*="opacity-0"]   would also match `group-hover/project:opacity-0`
 *
 * The second kind is the *reverse* pattern — shown by default, hidden on hover — and it is used
 * for pairs of absolutely-positioned elements that swap places. Revealing both stacks them.
 *
 * Asserted against the class strings actually in the components: a test that invented its own would
 * pass while the rule missed everything it was written for.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";

/** What `[class~="opacity-0"][class*="group-hover"]` means, in one line. */
function revealed(className: string): boolean {
	return className.split(/\s+/).includes("opacity-0") && className.includes("group-hover");
}

test("a control hidden until hover is revealed", () => {
	// MessageActions: the row under every message, carrying copy and edit.
	assert.equal(
		revealed("mt-1 flex h-6 items-center gap-1.5 opacity-0 transition-opacity group-hover/msg:opacity-100"),
		true,
	);
	// SessionRow: rename, archive, delete.
	assert.equal(
		revealed("pointer-events-none absolute inset-y-0 right-0 flex opacity-0 group-hover/session:opacity-100"),
		true,
	);
});

test("the reverse pattern is left alone", () => {
	/*
	 * ProjectHead shows a token count and swaps it for buttons on hover. Both are `absolute
	 * inset-0`. Forcing the first to full opacity as well would leave the count printed over the
	 * buttons — and a substring match on "opacity-0" does exactly that, because the class name
	 * `group-hover/project:opacity-0` contains it.
	 */
	const shownByDefault = "absolute inset-0 transition-opacity group-hover/project:opacity-0";
	assert.equal(revealed(shownByDefault), false);
	assert.ok(shownByDefault.includes("opacity-0"), "确实含有这个子串——所以 ~= 和 *= 的区别是有实际后果的");
});

test("something hidden for a reason other than hover stays hidden", () => {
	// Not every `opacity-0` is a hover reveal; a fade-in has one too, and forcing it visible would
	// skip the animation it exists for.
	assert.equal(revealed("opacity-0 animate-in fade-in"), false);
});

test("every hover-revealed control in the tree is covered by the rule", async () => {
	/*
	 * The real check: read the components and confirm the rule reaches what it claims to. A rule
	 * written against three remembered examples is a rule that silently stops covering the fourth.
	 */
	const root = fileURLToPath(new URL("../src/components/", import.meta.url));
	const files: string[] = [];
	for await (const entry of glob("**/*.tsx", { cwd: root })) files.push(entry);
	assert.ok(files.length > 40, "组件目录应当被扫到");

	const missed: string[] = [];
	let found = 0;
	for (const file of files) {
		const source = await readFile(root + file, "utf8");
		// Every class string that reveals something on hover — including the ones that reveal it
		// only partly (`opacity-60`), which are just as invisible when there is no pointer.
		for (const match of source.matchAll(/group-hover(?:\/[\w-]+)?:opacity-(?:100|[1-9]\d?)/g)) {
			found++;
			// The surrounding class string: back to the nearest quote or backtick.
			const start = source.lastIndexOf('"', match.index) + 1;
			const alt = source.lastIndexOf("`", match.index) + 1;
			const line = source.slice(Math.max(start, alt), match.index + match[0].length);
			if (!revealed(line)) missed.push(`${file}: ${line.slice(-70)}`);
		}
	}

	assert.ok(found >= 12, `应当找到十几处 hover 显示的控件，实际 ${found}`);
	/*
	 * Anything listed here is a control that is invisible on a phone. Some are legitimately out of
	 * reach — a control inside a panel the phone never shows — but the list should be read rather
	 * than lengthened silently, which is what this assertion is for.
	 */
	assert.deepEqual(missed, [], `这些 hover 控件在手机上仍然不可见：\n${missed.join("\n")}`);
});
