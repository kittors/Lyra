/**
 * The height reporter injected into every generated page, against the page's own markup.
 *
 * The page is whatever the agent wrote, and the injection used to go in through a string
 * replacement whose replacement text carried the page's own `<head …>` tag. `String.replace` reads
 * `$&`, `` $` ``, `$'` and `$$` in that text as patterns, so a head tag that happened to contain one
 * pulled the rest of the document — or the tag again — into its own attribute.
 */

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// `preview-protocol.ts` registers Electron protocols; nothing here touches them, so a hollow module will do.
const electronStub = `data:text/javascript,${encodeURIComponent("export const nativeImage = {}; export const net = {}; export const protocol = {}; export const session = {};")}`;
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "electron") return { url: electronStub, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
const { withHeightReporter } = await import("../electron/preview-protocol.ts");
hooks.deregister();

test("注入不改动页面自己的 head 标签，哪怕里面有 $ 序列", () => {
	const head = `<head data-note="$' $& $\` $$">`;
	const page = `<!doctype html><html>${head}<title>t</title></head><body><p>BODY-MARK</p></body></html>`;
	const out = withHeightReporter(page);

	assert.ok(out.includes(head), "页面原有的 head 标签必须一字不差地留着");
	assert.equal(out.split("BODY-MARK").length - 1, 1, "正文只能出现一次——$' 会把 head 之后的整页再抄进属性里");
	assert.equal(out.split("<head").length - 1, 1, "head 标签只能有一个——$& 会把它自己再嵌进属性里");
	// And the injection still lands where it has to: straight after the head tag, before the page's scripts.
	assert.ok(out.startsWith(`<!doctype html><html>${head}<style>`), "注入内容应紧跟在 head 标签之后");
	assert.ok(out.endsWith(`</script><title>t</title></head><body><p>BODY-MARK</p></body></html>`));
});

test("没有 head 的页面，注入内容放在最前面", () => {
	const out = withHeightReporter("<p>bare</p>");
	assert.ok(out.startsWith("<style>"));
	assert.ok(out.endsWith("</script><p>bare</p>"));
});

/*
 * What the reporter answers, against a model of the page's layout.
 *
 * Only the arithmetic is under test here — the real layout is the window probe's job
 * (`e2e/preview-outside-fold-probe.ts`). What matters most is that the answer holds still: the card
 * sizes itself to what the page asked for, the page is asked again at that size, and a different
 * answer there is a card that moves. A `height: 360px` page answered 256 at the card's starting 440
 * and 362 once the card had shrunk to 256 — every such preview dipped and came back.
 */
interface Layout {
	/** The frame's height: what the card gives the page. */
	viewport: number;
	/** The body's height rule — pixels, `fill` for one stretched to the frame (100vh, 100%), or none. */
	height: number | "fill" | "auto";
	/** What the content composes to with no height rule at all. */
	content: number;
	/** The body's top and bottom margin. */
	margin?: number;
}

function heightReported(layout: Layout): number | null {
	const margin = layout.margin ?? 0;
	const body = {
		style: { height: "", minHeight: "" },
		get offsetHeight() {
			if (this.style.height === "auto" || layout.height === "auto") return layout.content;
			return layout.height === "fill" ? layout.viewport - 2 * margin : layout.height;
		},
		get scrollHeight() {
			return Math.max(this.offsetHeight, layout.content);
		},
		getBoundingClientRect() {
			return { top: margin, bottom: margin + this.offsetHeight, height: this.offsetHeight };
		},
	};
	const html = {
		className: "",
		style: { height: "", minHeight: "" },
		clientHeight: layout.viewport,
		get scrollHeight() {
			return Math.max(layout.viewport, 2 * margin + body.scrollHeight);
		},
	};
	const posted: number[] = [];
	const loads: (() => void)[] = [];
	const page: Record<string, unknown> = {
		location: { hash: "#ly-inline" },
		document: { body, documentElement: html },
		addEventListener: (type: string, listener: () => void) => type === "load" && loads.push(listener),
		setTimeout: () => 0,
		getComputedStyle: () => ({ marginBottom: `${margin}px` }),
		parent: { postMessage: (data: { __dwPreviewHeight: number }) => posted.push(data.__dwPreviewHeight) },
	};
	page.window = page;
	const script = /<script>([\s\S]*)<\/script>/.exec(withHeightReporter("<head></head>"))?.[1];
	assert.ok(script, "the reporter script was not found in the injection");
	runInNewContext(script, page);
	for (const load of loads) load();
	return posted.at(-1) ?? null;
}

/** What a card sized to the page's first answer hears from it next: the same number, or the card moves. */
function settles(layout: Layout): { first: number | null; again: number | null } {
	const first = heightReported(layout);
	return { first, again: first === null ? null : heightReported({ ...layout, viewport: first }) };
}

test("一个自己定了高度、比卡片矮的页面，报的就是它自己的高度，到了那个高度也还是这个数", () => {
	// The probe's page: `height: 360px`, its content composing to 254 without that rule.
	assert.deepEqual(settles({ viewport: 440, height: 360, content: 254 }), { first: 362, again: 362 });
});

test("铺满视口的页面仍然报内容自己的高度，而且站得住", () => {
	assert.deepEqual(settles({ viewport: 440, height: "fill", content: 254 }), { first: 256, again: 256 });
});

test("没定高度的短页面连 body 的外边距一起报，一次就对", () => {
	// 8px of default margin top and bottom: measured without them the page overflowed by 16 and asked again.
	assert.deepEqual(settles({ viewport: 440, height: "auto", content: 200, margin: 8 }), { first: 218, again: 218 });
});

test("比卡片高的页面报它的滚动高度", () => {
	assert.deepEqual(settles({ viewport: 440, height: "auto", content: 900 }), { first: 902, again: 902 });
});

test("body 自己没有高度（只有定位的子元素）时，照旧摘掉高度规则去量内容", () => {
	assert.deepEqual(settles({ viewport: 440, height: 0, content: 300 }), { first: 302, again: 302 });
});
