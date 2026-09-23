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
