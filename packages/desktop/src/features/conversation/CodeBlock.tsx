import { translate } from "../../i18n/translate.ts";
import type { Language } from "@codemirror/language";
import { Check, Copy, Play } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { highlightGeneration, loadFenceLanguage, onHighlightChange, sharedHighlightStyle, tokenize } from "../../lib/code/highlight.ts";
import { useSide } from "../dock/index.ts";

/**
 * Fences that are commands rather than code.
 *
 * A Python snippet in a reply is an illustration; a shell line is an instruction, and the gap
 * between reading it and running it is a trip to another window and a paste. Only these get the
 * button — offering to "run" a TypeScript block would be offering something that cannot happen.
 */
const SHELL = new Set(["bash", "sh", "zsh", "shell", "console", "terminal"]);

/**
 * 超过这么多字符就不高亮了。
 *
 * 见下面 `tokens` 里的注释——这个数是照着「一帧以内跑得完」量出来的。
 */
const HIGHLIGHT_LIMIT = 60_000;

/** Comment lines and prompt markers are for reading; the shell should not receive them. */
function commandFrom(code: string): string {
	return code
		.split("\n")
		.map((line) => line.replace(/^\s*[$>]\s+/, "").trimEnd())
		.filter((line) => line.trim() && !line.trim().startsWith("#"))
		.join("\n")
		.trim();
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
	const [copied, setCopied] = useState(false);
	const [language, setLanguage] = useState<Language | null>(null);

	/*
	 * Grammar fetched per language, colouring recomputed per edit.
	 *
	 * Grammars are dynamic imports — a transcript that only ever shows TypeScript should not pay
	 * for the Python and SQL parsers as well. While one is in flight the block renders as plain
	 * text, which is also what a reply still streaming its fence shows.
	 */
	useEffect(() => {
		if (!lang) return;
		let cancelled = false;
		void loadFenceLanguage(lang).then((result) => {
			if (!cancelled) setLanguage(result);
		});
		return () => {
			cancelled = true;
		};
	}, [lang]);

	/*
	 * 换了代码主题就得重算，因为类名整套都换了。
	 *
	 * token 和它的类名是一起算出来存进 `useMemo` 的，而换主题会重新生成一整套类名——存着的那份
	 * 于是指向一批不存在的规则，整块代码掉回默认字色。依赖里带上代数，换代就重算。
	 */
	const generation = useSyncExternalStore(onHighlightChange, highlightGeneration, highlightGeneration);

	const tokens = useMemo(() => {
		if (!language) return null;
		/*
		 * 太长的块不高亮，直接给纯文本。
		 *
		 * `tokenize` 是同步的，而它前面没有任何上限。本机一个会话里有一条用户消息 233KB、1087 行，
		 * 整段是一个代码围栏——打开那个会话时主线程被占死 **2.3 秒**，鼠标转圈，而那个会话一共只有
		 * 34 条消息。相比之下 382 条消息、25MB 的会话只卡 195ms：贵的从来不是条数或文件大小，是
		 * 单块文本的长度。
		 *
		 * 60KB 这个数是量出来的，不是拍的：低于它的块在这台机器上都在一帧以内跑完；而真正会越过它的
		 * 内容——整个文件粘进来、几千行日志——本来也不是拿来逐行读的，少了配色不影响它被翻阅和复制。
		 *
		 * `return null` 走的是这个组件本来就有的降级路径（半截围栏在流式输出中途也走它），所以文本
		 * 一个字都不会少，只是没有配色。
		 */
		if (code.length > HIGHLIGHT_LIMIT) return null;
		try {
			return tokenize(code, language, sharedHighlightStyle());
		} catch {
			// A half-written fence mid-stream is not a reason to lose the text.
			return null;
		}
		// oxlint-disable-next-line exhaustive-deps -- `generation` 不出现在函数体里，它就是「重算」的信号
	}, [code, language, generation]);

	return (
		<div className="group relative">
			{lang && (
				<span className="absolute top-2.5 left-3.5 font-mono text-caption tracking-wide text-ink-faint select-none">
					{lang}
				</span>
			)}
			{SHELL.has(lang.toLowerCase()) && commandFrom(code) && (
				<button
					type="button"
					data-ly-tip={translate("codeBlock.runInTerminal")}
					onClick={() => useSide.getState().runInTerminal(commandFrom(code))}
					className="absolute top-2 right-8 hidden p-1 text-ink-muted transition-colors group-hover:block hover:text-ink"
				>
					<Play size={13} strokeWidth={1.9} />
				</button>
			)}
			<button
				type="button"
				data-ly-tip={translate("common.copy")}
				onClick={() => {
					void navigator.clipboard.writeText(code);
					setCopied(true);
					setTimeout(() => setCopied(false), 1400);
				}}
				className="absolute top-2 right-2 hidden p-1 text-ink-muted transition-colors group-hover:block hover:text-ink"
			>
				{copied ? <Check size={13} strokeWidth={2} className="text-ok" /> : <Copy size={13} strokeWidth={1.9} />}
			</button>
			<pre className={lang ? "pt-7" : undefined}>
				<code>
					{tokens
						? tokens.map((token, index) =>
								token.className ? (
									<span key={index} className={token.className}>
										{token.text}
									</span>
								) : (
									token.text
								),
							)
						: code}
				</code>
			</pre>
		</div>
	);
}
