/**
 * ```mermaid 画成图，而不是印成一段代码。
 *
 * 模型很爱用它解释东西——时序、状态机、依赖、一棵进程树——而读者拿到的是二十行 `graph TD`。
 * 那几行是给渲染器看的，不是给人看的：要从里面看出一张图，得在脑子里跑一遍布局算法。
 *
 * 三件事是这个组件存在的理由，都不是「调一下 mermaid.render」那么简单：
 *
 * 1. **它必须是懒的。** mermaid 打出来一百多兆，带着自己的解析器和布局引擎。静态 import 会把
 *    它焊进转录的主包，于是每个从不画图的会话都要先下载它。这里用动态 import，第一次真的遇到
 *    一个 mermaid 围栏时才去取。
 *
 * 2. **它必须是防备的。** 围栏里的字来自模型，而模型的输入来自网页、文件、工具输出——那是一条
 *    很长的不可信链路。mermaid 默认允许节点标签里写 HTML，`securityLevel: "strict"` 把这条关上；
 *    出来的 SVG 仍然要经过 `dangerouslySetInnerHTML`，所以这个开关不是可选项。
 *
 * 3. **它必须会退让。** 流式输出时，围栏是一个字一个字长出来的——大部分时刻它在语法上都是错的。
 *    一个画不出来就报红的组件，会在每次模型画图时先闪一串错误。画不出来就退回代码块，安静地。
 */

import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

/** 围栏的语言标记里，哪些算 mermaid。 */
export function isMermaid(lang: string): boolean {
	return lang.trim().toLowerCase() === "mermaid";
}

/*
 * 明暗跟着应用走，而应用把答案写在根元素的 `color-scheme` 上（见 `settings/theme.ts`）。
 *
 * 订阅两头：系统主题翻面（跟随系统时），以及设置页直接改根元素的 style。少订一头，就会出现
 * 一张亮色的图钉在暗色的对话里——而且它不会自己好，除非那条消息碰巧重渲染。
 */
function subscribeScheme(onChange: () => void): () => void {
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	media.addEventListener("change", onChange);
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
	return () => {
		media.removeEventListener("change", onChange);
		observer.disconnect();
	};
}

function currentScheme(): "dark" | "light" {
	const declared = document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme;
	if (declared.includes("dark")) return "dark";
	if (declared.includes("light")) return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 渲染同一张图的两次之间，id 不能撞——mermaid 用它在文档里挂临时节点。 */
let seq = 0;

export function MermaidBlock({
	code,
	fallback,
}: {
	code: string;
	/**
	 * 画不出来、或者还没画出来时顶上的东西——由调用方给。
	 *
	 * 一开始这里直接 `import { CodeBlock }`，结果是一条绕了十二个模块的循环依赖：
	 * `Markdown → MermaidBlock → CodeBlock → dock → … → conversation/index → Markdown`。
	 * `pnpm arch` 把它拦了下来。
	 *
	 * 而拆开之后才是对的分工：这个组件知道怎么画图、知道自己画没画成，但「画不成的时候该显示
	 * 什么」是那段 Markdown 的事——同一个围栏在别处也许该显示别的东西。
	 */
	fallback: ReactNode;
}) {
	const scheme = useSyncExternalStore(subscribeScheme, currentScheme, () => "light" as const);
	const [svg, setSvg] = useState<string | null>(null);
	/*
	 * 「还没画出来」和「画不出来」是两种状态，不能合成一个。
	 *
	 * 合成一个的话，流式输出时每一帧不完整的语法都会先退成代码块再变回图，一路闪。
	 */
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let alive = true;
		setFailed(false);

		void (async () => {
			try {
				const mermaid = (await import("mermaid")).default;
				if (!alive) return;
				mermaid.initialize({
					startOnLoad: false,
					// 见上：围栏内容是不可信输入，标签里的 HTML 一律当文本。
					securityLevel: "strict",
					theme: scheme === "dark" ? "dark" : "default",
					fontFamily: "var(--ly-font-sans, inherit)",
				});
				/*
				 * `parse` 先问一句能不能画。
				 *
				 * `render` 失败时会往文档里留下它的临时容器和一个「Syntax error」的图；先 parse
				 * 就不会走到那一步——流式输出时这条路每秒要走好几遍。
				 */
				await mermaid.parse(code);
				if (!alive) return;
				const { svg: out } = await mermaid.render(`ly-mermaid-${(seq += 1)}`, code);
				if (alive) setSvg(out);
			} catch {
				// 画不出来就是画不出来：退回代码块，不喊。
				if (alive) setFailed(true);
			}
		})();

		return () => {
			alive = false;
		};
	}, [code, scheme]);

	/*
	 * 画不出来，和还没画出来，显示的是同一个东西——那段原文。
	 *
	 * 不占位的话，图出来的瞬间下面整段答案会往下跳一截，而读者多半正在读那一段。
	 */
	if (failed || svg === null) return <>{fallback}</>;

	return (
		<div
			className="ly-mermaid my-3 flex justify-center overflow-x-auto"
			role="img"
			// 经过 strict 模式的 mermaid，标签已被当作文本处理；见文件头第 2 条。
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}
