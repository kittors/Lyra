import { translate } from "../../i18n/translate.ts";
import type { Language } from "@codemirror/language";
import { Check, Copy, Play, WrapText } from "lucide-react";
import { type CSSProperties, memo, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { highlightGeneration, loadFenceLanguage, onHighlightChange, sharedHighlightStyle, tokenize, tokenizeGrowing, type Grown, type Token } from "../../lib/code/highlight.ts";
import { iconColour, lookFor } from "../../ui/fileIcon.tsx";
import { useSide, openScopedPanel } from "../dock/index.ts";
import { useDockScope } from "../../app/session-scope.tsx";
import { useFade } from "./FadeText.tsx";

/**
 * Fences that are commands rather than code.
 *
 * A Python snippet in a reply is an illustration; a shell line is an instruction, and the gap
 * between reading it and running it is a trip to another window and a paste. Only these get the
 * button — offering to "run" a TypeScript block would be offering something that cannot happen.
 */
const SHELL = new Set(["bash", "sh", "zsh", "shell", "console", "terminal"]);

/** 围栏语言名到扩展名，只为给标题栏挑一个和文件树同款的图标；不在表里的按原样当扩展名。 */
const LANG_EXTENSION: Record<string, string> = {
	typescript: "ts",
	javascript: "js",
	python: "py",
	rust: "rs",
	golang: "go",
	ruby: "rb",
	kotlin: "kt",
	csharp: "cs",
	"c++": "cpp",
	markdown: "md",
	shell: "sh",
	console: "sh",
	terminal: "sh",
	text: "txt",
	plaintext: "txt",
};

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

export function CodeBlock({ lang, code, fade = false }: { lang: string; code: string; fade?: boolean }) {
	const [copied, setCopied] = useState(false);
	const [wrap, setWrap] = useState(false);
	const label = lang.toLowerCase() || "text";
	const look = lookFor(`code.${LANG_EXTENSION[label] ?? label}`, false);
	const [language, setLanguage] = useState<Language | null>(null);
	/*
	 * The screen this block is drawn in, which the command belongs to. Named for both halves of
	 * 「在终端运行」 — where the terminal opens and which terminal runs it — because the keyboard
	 * presses the button without giving this screen the focus, and both halves used to follow the focus.
	 */
	const screen = useDockScope();

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

	/** 正在输出时上一次的解析结果，下一帧只解析长出来的那一截，见 `tokenizeGrowing`。 */
	const grown = useRef<Grown | undefined>(undefined);

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
			if (!fade) {
				grown.current = undefined;
				return tokenize(code, language, sharedHighlightStyle());
			}
			grown.current = tokenizeGrowing(code, language, sharedHighlightStyle(), grown.current);
			return grown.current.tokens;
		} catch {
			// A half-written fence mid-stream is not a reason to lose the text.
			return null;
		}
		// oxlint-disable-next-line exhaustive-deps -- `generation` 不出现在函数体里，它就是「重算」的信号
	}, [code, language, generation, fade]);

	// 正在输出的代码块，新来的字和正文一样淡入，见 `FadeText`。不在输出的块不记出现时刻。
	const { settled, style } = useFade(fade ? Array.from(code).length : 0);

	return (
		<div className="ly-code-block" data-wrap={wrap || undefined}>
			<div className="ly-code-head">
				<look.Icon size={14} strokeWidth={1.9} className="shrink-0" style={{ color: iconColour(look) }} />
				<span className="min-w-0 flex-1 truncate">{label}</span>
				{SHELL.has(label) && commandFrom(code) && (
					<CodeAction
						tip={translate("codeBlock.runInTerminal")}
						onClick={() => {
							// 叫一个终端来接这条命令。已经有的会被聚焦而不是再开一个。
							const at = openScopedPanel("terminal", undefined, screen ?? undefined);
							// For that terminal, wherever the request landed: a command nobody's terminal takes is lost.
							useSide.getState().runInTerminal(commandFrom(code), at);
						}}
					>
						<Play size={14} strokeWidth={1.9} />
					</CodeAction>
				)}
				<CodeAction tip={translate("fileActions.wrap")} active={wrap} onClick={() => setWrap(!wrap)}>
					<WrapText size={14} strokeWidth={1.9} />
				</CodeAction>
				<CodeAction
					tip={translate("common.copy")}
					onClick={() => {
						void navigator.clipboard.writeText(code);
						setCopied(true);
						setTimeout(() => setCopied(false), 1400);
					}}
				>
					{copied ? <Check size={14} strokeWidth={2} className="text-ok" /> : <Copy size={14} strokeWidth={1.9} />}
				</CodeAction>
			</div>
			<pre>
				{fade ? (
					fading(tokens ?? [{ text: code, className: "" }], settled, style)
				) : (
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
				)}
			</pre>
		</div>
	);
}

function CodeAction({ tip, active, onClick, children }: { tip: string; active?: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button
			type="button"
			data-ly-tip={tip}
			aria-label={tip}
			aria-pressed={active}
			onClick={onClick}
			className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-[var(--ly-t-quick)] hover:bg-ink/[0.06] hover:text-ink ${active ? "text-ink" : "text-ink-muted"}`}
		>
			{children}
		</button>
	);
}

/** 正在输出的代码按这么多行一段画；写完的段不再重画。 */
const CHUNK_LINES = 24;

/**
 * 正在输出的代码：淡完的字按 token 配色成段画，还在淡的字一个一个画成带配色的 span。
 *
 * 按行切成段，每段是一个块级元素，整段都淡完了就交给 `SettledChunk`，内容不变它就不重画。不切的话
 * 整块代码是同一个行内排版：每帧长一个字，几百行、几千个 span 全部重排一遍。量过：300 行的块按
 * 每秒 150 字输出，切段之前三分之一以上的帧超过 16ms。切开之后浏览器只重排最后一段。
 *
 * 段放在 `pre` 底下、每段自己再套一个 `code`，和写完之后整块的 `<pre><code>` 一行一行排得一样：
 * 行高由 `pre` 的字号撑着。段放进 `code` 里面的话，每行矮 3px，写完换回整块那一刻，三百行的块
 * 一下子长高近一千像素。
 *
 * 还在淡的字按字的序号作 key，挂在 token 外面而不是里面。配色是整块重算的，`cons` 长成 `const`
 * 时 token 的边界和类名都会变；字挂在 token 里的话会跟着 token 被重建，淡入从头再来。挂在外面，
 * 变的只是它的类名，动画不受影响。
 */
function fading(tokens: Token[], settled: number, style: (index: number) => CSSProperties): ReactNode[] {
	const out: ReactNode[] = [];
	let chunk: Token[] = [];
	let start = 0;
	let at = 0;
	let lines = 0;
	const flush = () => {
		if (chunk.length === 0) return;
		// `at` 这时是这一段的末尾：它之前的字都淡完了，这一段就不会再变。
		out.push(
			at <= settled ? (
				<SettledChunk key={`s${start}`} tokens={chunk} />
			) : (
				<span key={`f${start}`} className="ly-code-chunk">
					<code>{live(chunk, start, settled, style)}</code>
				</span>
			),
		);
		chunk = [];
		start = at;
		lines = 0;
	};
	for (const token of tokens) {
		// 一个 token 可以跨行（块注释、模板字符串），在换行处切开，段才能按行分。
		const parts = token.text.split("\n");
		parts.forEach((part, index) => {
			const text = index < parts.length - 1 ? `${part}\n` : part;
			if (!text) return;
			chunk.push({ text, className: token.className });
			at += Array.from(text).length;
			if (index < parts.length - 1 && ++lines === CHUNK_LINES) flush();
		});
	}
	flush();
	return out;
}

/** 一段里还有字在淡：淡完的部分成段，其余一个字一个 span。 */
function live(tokens: Token[], start: number, settled: number, style: (index: number) => CSSProperties): ReactNode[] {
	const out: ReactNode[] = [];
	let at = start;
	tokens.forEach((token, index) => {
		const chars = Array.from(token.text);
		const done = Math.max(0, Math.min(chars.length, settled - at));
		if (done > 0) {
			const text = chars.slice(0, done).join("");
			out.push(token.className ? <span key={`t${index}`} className={token.className}>{text}</span> : text);
		}
		for (let offset = done; offset < chars.length; offset++) {
			const char = at + offset;
			out.push(
				<span key={char} className={token.className ? `${token.className} ly-fade-char` : "ly-fade-char"} style={style(char)}>
					{chars[offset]}
				</span>,
			);
		}
		at += chars.length;
	});
	return out;
}

const SettledChunk = memo(
	function SettledChunk({ tokens }: { tokens: Token[] }) {
		return (
			<span className="ly-code-chunk">
				<code>{tokens.map((token, index) => (token.className ? <span key={index} className={token.className}>{token.text}</span> : token.text))}</code>
			</span>
		);
	},
	(a, b) => a.tokens.length === b.tokens.length && a.tokens.every((token, index) => token.text === b.tokens[index].text && token.className === b.tokens[index].className),
);
