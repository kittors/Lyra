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

/** Fence language names to file extensions, only to pick the title bar the same icon the file tree uses; anything not listed is taken as the extension itself. */
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

	/** The last parse while the block is being written; the next frame parses only what grew, see `tokenizeGrowing`. */
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

	// A code block being written fades new characters in like the body text, see `FadeText`. A finished block records no appearance times.
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
							// Call up a terminal to take this command. One that already exists is focused rather than another opened.
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

/** Code being written is drawn in chunks of this many lines; a finished chunk is not drawn again. */
const CHUNK_LINES = 24;

/**
 * Code being written: characters done fading are drawn in chunks with their token colours, the ones
 * still fading as coloured spans one by one.
 *
 * Cut into chunks by line, each a block-level element; a chunk that has finished fading goes to
 * `SettledChunk`, which does not redraw while its content is unchanged. Uncut, the whole block is one
 * inline layout: every frame adds a character and hundreds of lines, thousands of spans, are laid out
 * again. Measured: a 300-line block written at 150 characters a second had over a third of its frames
 * past 16ms before the cut. After it the browser lays out only the last chunk.
 *
 * Chunks sit directly under `pre`, each with a `code` of its own, so they line up exactly as the
 * finished block's single `<pre><code>` does: the line height comes from `pre`'s font size. Inside
 * `code` each line was 3px shorter, and at the moment the finished block replaced them a 300-line block
 * grew by nearly a thousand pixels.
 *
 * A fading character is keyed by its index and hangs outside its token, not inside it. Colours are
 * computed for the whole block, and when `cons` grows into `const` the token's boundaries and class
 * change; a character inside the token would be rebuilt with it and start fading again. Outside, only
 * its class changes and the animation carries on.
 */
function fading(tokens: Token[], settled: number, style: (index: number) => CSSProperties): ReactNode[] {
	const out: ReactNode[] = [];
	let chunk: Token[] = [];
	let start = 0;
	let at = 0;
	let lines = 0;
	const flush = () => {
		if (chunk.length === 0) return;
		// `at` is now this chunk's end: everything before it has finished fading, so the chunk will not change again.
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
		// A token can span lines (block comments, template strings); cut at the newlines so chunks can go by line.
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

/** A chunk with characters still fading: the faded part as text runs, the rest one span per character. */
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
