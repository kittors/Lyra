/**
 * ```mermaid 围栏那根线。
 *
 * 组件（`MermaidBlock`）写完了、e2e 探针也在断言它，但 `Markdown` 的 `case "code"` 一直只走
 * `CodeBlock`——全仓对它的引用只有它自己、那个探针、和 knip 的忽略名单。模型输出一张图，用户看到的
 * 是二十行 `graph TD`。
 *
 * **这里测不到图画出来。** happy-dom 没有布局，`mermaid` 又是动态 import 的一百多兆，组件在
 * `svg === null` 时按设计渲染 fallback，所以这一层看到的永远是那段原文——图画得对不对，归
 * `e2e/mermaid-probe.ts` 在真窗口里回答。
 *
 * 那这一层还能钉住什么：**画不出来时退回去的那条路**。它才是大多数人多数时候看到的东西（语法写错、
 * 引擎还在加载、机器装不下），而它一旦坏掉，一段本来能读的内容就变成一个空盒子。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { Markdown } from "../../src/features/conversation/Markdown.tsx";
import { isMermaid } from "../../src/features/conversation/MermaidBlock.tsx";
import { mount } from "../helpers/mount.ts";

const DIAGRAM = ["```mermaid", "graph TD", "  A[开始] --> B[结束]", "```"].join("\n");
const PLAIN = ["```ts", "const a = 1;", "```"].join("\n");

test("a mermaid fence still reads as its source until the diagram arrives", async () => {
	/*
	 * 接上画图那条路之后，图没画出来的那一刻不能是空白。
	 *
	 * 这条同时是接线的烟雾测试：`MermaidBlock` 的 fallback 由 `Markdown` 这一侧给（组件自己 import
	 * `CodeBlock` 会绕出一条十二个模块的循环依赖，`pnpm arch` 拦得住）。给错了、给空了，这里就空了。
	 */
	const view = await mount(h(Markdown, { text: DIAGRAM }));

	assert.match(view.text(), /graph TD/, "图还没画出来时，源码该顶在那儿");
	assert.match(view.text(), /A\[开始\]/, "整段都要在，不是只剩第一行");
	await view.unmount();
});

test("an ordinary fence is untouched", async () => {
	// 反向误伤比不画图严重：所有代码块都被当成图，整个转录就没法读了。
	const view = await mount(h(Markdown, { text: PLAIN }));

	assert.match(view.text(), /const a = 1;/);
	await view.unmount();
});

test("the fence language is matched the way people actually type it", () => {
	assert.equal(isMermaid("mermaid"), true);
	assert.equal(isMermaid("Mermaid"), true, "大小写不该决定它画不画");
	assert.equal(isMermaid(" mermaid "), true, "围栏语言两头的空白是打字留下的，不是意图");
	assert.equal(isMermaid("mermaidjs"), false, "别的语言不能沾边就算");
	assert.equal(isMermaid(""), false);
});
