/**
 * Markdown renderer.
 *
 * Hand-written rather than `marked` + `dangerouslySetInnerHTML`: model output and other people's
 * pull request descriptions are both untrusted, and building React elements means every string
 * goes through React's escaping on the way in.
 *
 * This file is only the drawing. Which lines are a table and which characters are emphasis are
 * decided in `markdown-blocks.ts` and `markdown-inline.ts`, where they can be tested.
 */

import { translate } from "../../i18n/translate.ts";
import { FileText, ExternalLink, FolderOpen } from "lucide-react";
import { createContext, type CSSProperties, Fragment, isValidElement, memo, type ReactNode, type SyntheticEvent, useContext, useEffect, useMemo, useState } from "react";
import { CodeBlock } from "./CodeBlock.tsx";
import { isMermaid, MermaidBlock } from "./MermaidBlock.tsx";
import { MarkdownTable } from "./MarkdownTable.tsx";
import { Disclosure } from "../../ui/layout/Disclosure.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import type { Block, ListItem } from "../../lib/markdown/blocks.ts";
import { parseMarkdown } from "../../lib/markdown/blocks.ts";
import { resolveAsset, isAbsolutePath } from "../../lib/markdown/assets.ts";
import { fileLinkCaption } from "../../lib/markdown/file-link.ts";
import { groupTokens, HUGE_BLOCK } from "../../lib/markdown/slice.ts";
import { type Inline, parseInline } from "../../lib/markdown/inline.ts";
import { renderMath } from "../../lib/markdown/math.ts";
import { stripEmoji } from "../../lib/markdown/strip-emoji.ts";
import { available, bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { companionOf, openScopedPanel } from "../dock/index.ts";
import { useRevealLabel } from "../../store/open-targets.ts";
import { SessionScope, useDockScope, useScopedProjectPath } from "../../app/session-scope.tsx";
import { usePathMenu } from "./PathMenu.tsx";

/**
 * What this text is, beyond the characters in it.
 *
 * Only pictures need it, and only two facts about them: where a relative `src` points, and whether
 * this document is one whose remote references may be fetched. A context rather than a prop chain
 * because everything between the component and an `<img>` is a plain function — `renderBlock`,
 * `renderToken` — and threading two values through nine of them to reach one leaf is nine places
 * for them to be dropped.
 *
 * The default is the strict one. A caller that says nothing gets what every caller got before this
 * existed: relative paths unresolved and remote pictures shown as named links.
 */
interface DocumentContext {
	/** The directory the text was read from, if it was read from one. */
	baseDir?: string;
	/** Whether an https `src` may be fetched (through the main process) and drawn. */
	remoteImages: boolean;
	preview?: boolean;
}

const Doc = createContext<DocumentContext>({ remoteImages: false });

/**
 * Memoised on the four values it is given, all of them primitives.
 *
 * Parsing is the expensive half of drawing a transcript, and it was being redone for reasons that
 * have nothing to do with the text: dragging the sidebar's edge re-renders every component that
 * reads the layout, which reaches the transcript, which reached here — so one drag re-parsed
 * several hundred kilobytes of markdown, forty-five times over. Nothing about a message changes
 * because a pane got wider, and a boundary that says so costs one shallow comparison.
 */
export const Markdown = memo(function Markdown({
	text,
	className = "",
	baseDir,
	remoteImages = false,
	preview = false,
}: {
	text: string;
	className?: string;
	/**
	 * Where this file lives, so `<img src="assets/logo.png">` can find `assets/logo.png`.
	 *
	 * Passed by the panes that opened a real file. A pull request body and a model's reply have no
	 * directory — a relative path in either refers to a checkout that may not be on this machine —
	 * so they pass nothing and those images stay links.
	 */
	baseDir?: string;
	/**
	 * Draw pictures this document points at over https.
	 *
	 * Off unless asked for, and asked for only by the file viewer. A README's badges are part of
	 * reading it; the same behaviour applied to a comment anybody can write would make opening a
	 * pull request a request to whatever host that comment named. The fetch happens in the main
	 * process either way — see `system:remoteImage`.
	 */
	remoteImages?: boolean;
	/** A bounded, non-interactive excerpt without code tools or image loading. */
	preview?: boolean;
}) {
	/*
	 * System emoji come out first.
	 *
	 * Everything that reaches this component was written somewhere else — a pull request
	 * description, a review comment, a model's reply — and a colour emoji dropped into a screen of
	 * single-weight line icons is drawn by the OS from another font, in colours from nobody's
	 * palette. One `🤖` in a description is the loudest thing on the page by accident.
	 *
	 * Here rather than at each call site, because this is the one door remote prose comes through.
	 */
	/*
	 * 去表情和解析都缓存住，否则每一次重渲染都把整段正文重扫一遍。
	 *
	 * 这两步原先都在 render body 里裸跑。对一段一两 KB 的回复无所谓，对一条 233KB 的消息就不是了：
	 * 本机有个会话里粘进来过一整个文件，打开它主线程占死两秒多。上面那条「一次拖动就重新解析了一遍」
	 * 的注释说的是同一件事——那次给 `doc` 加了 memo，正文这一半漏了。
	 *
	 * 这只省掉**重复**的那些次。第一次仍然要老老实实解析一遍，那一次的成本由 `CodeBlock` 的高亮
	 * 上限和下面的块数上限管。
	 */
	const clean = useMemo(() => stripEmoji(text), [text]);

	// The class rides alongside `prose-dw` rather than replacing it, so a caller can dial the
	// size or colour down — reasoning is secondary text — without losing the block styling.
	/*
	 * `min-w-0`, because this is often a flex child and its contents are not all shrinkable.
	 *
	 * A flex item defaults to `min-width: auto`, which means "at least as wide as my contents" —
	 * and a code block holding an unbroken 40-character hash has contents that do not wrap. Without
	 * this the item grows to fit it, `pre`'s own `overflow-x` never comes into play because there
	 * is nothing left to overflow, and the width is pushed up through every ancestor instead.
	 */
	// Memoised because a new object here re-renders every picture in the document on every keystroke
	// of a streaming reply — which for a remote one means dropping and re-requesting it.
	const doc = useMemo(() => ({ baseDir, remoteImages, preview }), [baseDir, remoteImages, preview]);
	const blocks = useMemo(() => renderBlocks(clean, preview), [clean, preview]);

	return (
		<Doc.Provider value={doc}>
			<div className={`prose-dw min-w-0 ${className}`}>{blocks}</div>
		</Doc.Provider>
	);
});

function renderBlocks(source: string, preview = false): ReactNode {
	return parseMarkdown(source).map((block, index) => <Fragment key={index}>{renderBlock(block, preview)}</Fragment>);
}

function renderBlock(block: Block, preview = false): ReactNode {
	switch (block.kind) {
		case "heading": {
			const Tag = `h${Math.min(block.level, 4)}` as "h1" | "h2" | "h3" | "h4";
			return <Tag style={block.align ? { textAlign: block.align } : undefined}>{inline(block.text)}</Tag>;
		}
		/*
		 * A `<div align="center">` and what it holds.
		 *
		 * `text-align` inherits, which is why nothing has to be pushed down into the children: one
		 * declaration on the box sets the picture, the badges and the tagline underneath it, exactly
		 * as the same three lines behave in a browser.
		 */
		case "html":
			return (
				<div className="ly-md-html" style={block.align ? { textAlign: block.align } : undefined}>
					{block.children.map((child, index) => (
						<Fragment key={index}>{renderBlock(child, preview)}</Fragment>
					))}
				</div>
			);
		case "paragraph":
			// 大到会把浏览器按住不放的那种，切开画；正常的一段走原路，一行代码都不多跑。
			if (block.text.length > HUGE_BLOCK) return <HugeParagraph text={block.text} />;
			return <p>{inline(block.text)}</p>;
		case "code":
			if (preview) return <pre><code>{block.code}</code></pre>;
			/*
			 * ```mermaid 画成图，画不出来就还是那段代码。
			 *
			 * `fallback` 由这里给而不是组件自己 import `CodeBlock`：那样会绕出一条十二个模块的循环
			 * 依赖（`Markdown → MermaidBlock → CodeBlock → dock → … → conversation/index → Markdown`），
			 * `pnpm arch` 拦得住。分工也因此更清楚——组件知道画没画成，「画不成时显示什么」是这段
			 * Markdown 的事。
			 */
			if (isMermaid(block.lang)) {
				return <MermaidBlock code={block.code} fallback={<CodeBlock lang={block.lang} code={block.code} />} />;
			}
			return <CodeBlock lang={block.lang} code={block.code} />;
		case "rule":
			return <hr />;
		case "quote":
			return <blockquote>{renderBlocks(block.text, preview)}</blockquote>;
		case "math":
			return <MathBlock tex={block.tex} />;
		case "details":
			return preview ? <p>{inline(block.summary)}</p> : <Details summary={block.summary} blocks={block.children} />;
		case "list": {
			const Tag = block.ordered ? "ol" : "ul";
			return (
				<Tag>
					{block.items.map((item, index) => (
						<Item key={index} item={item} preview={preview} />
					))}
				</Tag>
			);
		}
		case "table":
			return <MarkdownTable block={block} inline={inline} preview={preview} />;
		default:
			return null;
	}
}

/**
 * 一段大到画不动的正文。
 *
 * 现场是一条 12.26 MB 的消息：193 行，最长的一行 1.3 MB。装进一个 `<p>` 里，Chromium 要给一千
 * 三百万个字符算换行——实测 45 秒还没画完，整个窗口按住不动。这不是「慢」，是没法用。
 *
 * 切成小片、每片挂 `content-visibility: auto` 之后是 17 毫秒：屏幕外的片浏览器根本不去布局，滚到
 * 哪儿算哪儿。内容一个字不少地留在 DOM 里——能选、能复制、Ctrl+F 找得到（Chrome 会为查找自动展开
 * 跳过的片），不折叠、不聚合、不截断。
 *
 * **为什么是块级元素。** `content-visibility` 在 `inline-block` 上实测无效（同样 45 秒不出来），
 * 所以片必须是块级的，而块级元素之间浏览器复制时会插一个换行。`groupTokens` 因此尽量只在原本就有
 * 换行的地方开新片；只有单个 text token 自己就超过上限时才从中间断开，那一处复制会多一个换行。
 *
 * 解析仍然是整段一次（964 ms），不是逐片解析（1443 ms）——片边界会打断匹配，反而更慢。
 */
function HugeParagraph({ text }: { text: string }) {
	const groups = useMemo(() => groupTokens(parseInline(text)), [text]);
	return (
		<div className="ly-md-huge">
			{groups.map((group, index) => (
				<p key={index} className="ly-md-huge-slice">
					{renderTokens(group)}
				</p>
			))}
		</div>
	);
}

function Item({ item, preview }: { item: ListItem; preview: boolean }) {
	const body = (
		<>
			{inline(item.text)}
			{item.children.map((child, index) => (
				<Fragment key={index}>{renderBlock(child, preview)}</Fragment>
			))}
		</>
	);

	if (item.checked === undefined) return <li>{body}</li>;
	return (
		<li className="ly-task" data-done={item.checked}>
			{/* Drawn, not an <input>: this reflects what the author wrote, and is not a control. */}
			<span aria-hidden className="ly-task-box">
				{item.checked && (
					<svg viewBox="0 0 12 12" fill="none" aria-hidden>
						<path d="M2.5 6.2 4.8 8.5 9.5 3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				)}
			</span>
			<span>{body}</span>
		</li>
	);
}

/** `<details>`, folded the way every other section in the app folds rather than the browser's way. */
function Details({ summary, blocks }: { summary: string; blocks: Block[] }) {
	return (
		<Disclosure variant="framed" title={inline(summary)}>
			{blocks.map((child, index) => (
				<Fragment key={index}>{renderBlock(child)}</Fragment>
			))}
		</Disclosure>
	);
}

function MathBlock({ tex }: { tex: string }) {
	const html = renderMath(tex, true);
	// TeX that does not parse is shown as it was written; a red error box helps nobody read it.
	if (!html) return <pre className="ly-math-raw">{tex}</pre>;
	// noDangerouslySetInnerHtml 在这里不适用（本仓库用 oxlint，不认 biome 的抑制注释，所以这只是一句说明）: KaTeX's own output, built from a parse tree it escapes.
	return <div className="ly-math-block" dangerouslySetInnerHTML={{ __html: html }} />;
}

function inline(text: string): ReactNode[] {
	return renderTokens(parseInline(text));
}

function renderTokens(tokens: Inline[]): ReactNode[] {
	return tokens.map((token, index) => <Fragment key={index}>{renderToken(token)}</Fragment>);
}

function renderToken(token: Inline): ReactNode {
	switch (token.kind) {
		case "text":
			return token.text;
		case "code":
			return <code className="[box-decoration-break:clone] [-webkit-box-decoration-break:clone]">{token.text}</code>;
		case "break":
			return <br />;
		case "strong":
			return <strong>{renderTokens(token.children)}</strong>;
		case "em":
			return <em>{renderTokens(token.children)}</em>;
		case "del":
			return <del>{renderTokens(token.children)}</del>;
		case "tag": {
			const Tag = token.name;
			return <Tag>{renderTokens(token.children)}</Tag>;
		}
		case "math": {
			const html = renderMath(token.tex, false);
			if (!html) return `$${token.tex}$`;
			// noDangerouslySetInnerHtml 在这里不适用（本仓库用 oxlint，不认 biome 的抑制注释，所以这只是一句说明）: KaTeX's own output, built from a parse tree it escapes.
			return <span className="ly-math" dangerouslySetInnerHTML={{ __html: html }} />;
		}
		case "link":
			return <Link href={token.href}>{renderTokens(token.children)}</Link>;
		case "image":
			return <Image src={token.src} alt={token.alt} width={token.width} height={token.height} />;
		default:
			return null;
	}
}

/** Local artifacts use the bounded file reader; executable URI schemes never navigate the app. */
function textOf(node: ReactNode): string {
	if (node == null || typeof node === "boolean") return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
	return "";
}

/**
 * The room the exit bar needs: a 28px card (22px buttons, 2px padding above and below, a 1px
 * hairline), a 4px gap, and 2px to spare. It is the same arithmetic as `[data-ly-file-actions]` in
 * `markdown.css` — change one and the other has to follow.
 */
const ACTIONS_CLEARANCE = 34;

/**
 * The `overflow` values that cut off whatever sticks out. Listed rather than written as "anything
 * but visible": where there is no computed value the answer is an empty string, and that is not a clip.
 */
const CLIPPING_OVERFLOW = /^(hidden|clip|auto|scroll|overlay)$/;

/**
 * Whether the exit bar goes above the chip or below it.
 *
 * Above by default: the line above has already been read, so covering a piece of it costs the least,
 * while the line below is the one about to be read — and the link's own path tooltip opens there too.
 * But reaching upward runs into whatever clips the chip. Every message row carries `contain: paint`
 * (`.group/msg` in `base.css`), so the part of the bar that leaves the row is never painted, and a
 * chip on a message's first line hits that every time; the top of the scroller and a table's
 * horizontal scroll box do the same. So measure: if it does not fit above and there is more room
 * below, go below.
 *
 * Measured once, as the pointer or focus arrives, with no listener kept: where the chip is at that
 * moment is where the bar will appear.
 */
function actionsSide(chip: HTMLElement): "above" | "below" {
	const box = chip.getBoundingClientRect();
	let top = 0;
	let bottom = window.innerHeight;
	for (let el = chip.parentElement; el && el !== document.body; el = el.parentElement) {
		const style = getComputedStyle(el);
		const clips =
			CLIPPING_OVERFLOW.test(style.overflowX) ||
			CLIPPING_OVERFLOW.test(style.overflowY) ||
			/paint|strict|content/.test(style.contain) ||
			style.contentVisibility === "auto";
		if (!clips) continue;
		const edge = el.getBoundingClientRect();
		top = Math.max(top, edge.top);
		bottom = Math.min(bottom, edge.bottom);
	}
	const above = box.top - top;
	return above >= ACTIONS_CLEARANCE || above >= bottom - box.bottom ? "above" : "below";
}

/**
 * How far the bar's left edge sits from the chip's: straight above where the pointer came in, but
 * never overhanging either end of the chip.
 *
 * Pinned to the top-right corner, a 300px filename put the bar 250px diagonally away from a pointer
 * that entered at the left end. Most of that path is off the chip, so only the grace period on
 * leaving kept the bar alive — and measured, it had faded out before the pointer got there. Above
 * the pointer, it is 20px straight up.
 *
 * Placed once, on entry, and not after: a bar that chases the pointer is wobbling, not waiting to be
 * pressed. A chip narrower than the bar gets it flush left rather than hanging off the left edge.
 */
function actionsOffset(chip: HTMLElement, pointerX: number): number {
	const box = chip.getBoundingClientRect();
	const width = chip.querySelector<HTMLElement>("[data-ly-file-actions-bar]")?.offsetWidth ?? 0;
	return Math.round(Math.max(0, Math.min(pointerX - box.left - width / 2, box.width - width)));
}

/**
 * A link to a file on this machine, plus two ways out that only appear when the pointer arrives.
 *
 * Clicking the link itself works as it always has — it opens in the built-in panel, the fastest way
 * to read a `.md` or a `.ts`. The trouble is the files it cannot open: click an `.exe` and the dock
 * panel is pushed aside in exchange for "binary file, cannot be shown as text". The reader gives up
 * what they were looking at to be told it cannot be opened, while the two things they actually wanted
 * — run it, see where it is — are both out of reach.
 *
 * So there are two exits beside it, rather than a change to what clicking means: a link that
 * sometimes opens the panel and sometimes Finder is unpredictable, and that makes people warier of
 * clicking than two extra icons do.
 *
 * They only show on hover, for the same reason as the `MessageActions` row: they repeat beside every
 * filename on the page, and left visible they would compete with the text. Where they show is a
 * small bar *above* the chip, not inside it:
 *
 * - They used to sit on the chip's right edge — 17px buttons, 11.5px icons — directly over the last
 *   30px of the filename. The gradient meant to hold the end up with the chip's own background held
 *   nothing: that background is itself a 5% translucent wash of ink, so the letters showed through
 *   between the icons and the two ran together.
 * - Growing the chip to the right to make room pushes the following words along and can re-wrap the
 *   line, so the text jumps under the pointer.
 *
 * The bar is out of flow, so not a pixel of the text moves, and the buttons can be the size small
 * icon buttons are everywhere else (`IconButton`'s `sm`: 22px, 14px icons) instead of being squeezed
 * into the height of a line. How it shows, how it hides and what happens on a device without hover
 * are all in `markdown.css`, under `[data-ly-file-actions]`.
 */
function FileLink({ href, path, children }: { href: string; path: string; children: ReactNode }) {
	const revealLabel = useRevealLabel();
	const canOpen = available("system", "openPath");
	const canReveal = available("system", "openIn");
	const caption = fileLinkCaption(textOf(children), path);
	// The file pane opens in the screen this link is drawn in: the keyboard reaches a link in a screen
	// without the press that would have given that screen the focus.
	const screen = useDockScope();
	// Right-click: the same menu a file the turn edited offers, with 打开 doing what a click does.
	const pathMenu = usePathMenu(useScopedProjectPath());
	const [side, setSide] = useState<"above" | "below">("above");
	/** Pixels from the chip's left edge to the bar's; `null` keeps it right, for focus, which has no pointer to face. */
	const [offset, setOffset] = useState<number | null>(null);
	const openFile = () => {
		const name = path.split(/[/\\]/).pop() || path;
		void useOpenFile
			.getState()
			.open({ path, name })
			.catch((error: unknown) => useApp.getState().notify(String(error), "error"));
		openScopedPanel("file", companionOf("file"), screen ?? undefined);
	};
	const fail = (error: unknown) => useApp.getState().notify(String(error), "error");
	const place = (event: SyntheticEvent<HTMLElement>, pointerX?: number) => {
		// Already inside the bar: leave it where it is, or it moves out from under the pointer.
		if (event.target instanceof Element && event.target.closest("[data-ly-file-actions]")) return;
		setSide(actionsSide(event.currentTarget));
		setOffset(pointerX === undefined ? null : actionsOffset(event.currentTarget, pointerX));
	};
	/*
	 * Tooltips open away from the bar. With the bar above, the buttons' tips go up too rather than back
	 * down over the chip; with the bar below, the link's own path tip moves above so the two do not stack.
	 */
	const buttonTip = side === "above" ? "top" : "bottom";

	return (
		/*
		 * The geometry is `[data-ly-file-link]` in `markdown.css`; this only builds the DOM — link,
		 * filename, two exits. A name that is too long is ellipsised by the stylesheet, not cut here.
		 */
		<span
			data-ly-file-link
			data-ly-file-actions-side={side}
			style={offset === null ? undefined : ({ "--ly-file-actions-x": `${offset}px` } as CSSProperties)}
			onPointerEnter={(event) => place(event, event.clientX)}
			/*
			 * Only focus that arrives from the keyboard. Clicking the link focuses it too, and then the
			 * pointer is already on the chip with the bar lined up above it; placing the bar again as if
			 * there were no pointer makes it jump to the right end at the moment of the press.
			 */
			onFocus={(event) => {
				if (!event.currentTarget.matches(":hover")) place(event);
			}}
		>
			<a
				href={href}
				data-ly-tip={caption.tip}
				data-ly-tip-side={side === "below" ? "top" : undefined}
				onClick={(event) => {
					event.preventDefault();
					openFile();
				}}
				onContextMenu={(event) => pathMenu.onContextMenu(event, { path, onOpen: openFile })}
			>
				<FileText size={13} />
				<span data-ly-file-name>{caption.text}</span>
			</a>
			{/*
			 * 按能力画，不按平台画。
			 *
			 * 手机上这两个 API 根本不存在——画出来是两个按下去什么都不会发生的图标，比没有更糟。
			 * `available()` 问的正是这件事，所以这里不需要知道自己跑在什么上面。
			 */}
			{(canOpen || canReveal) && (
				<span data-ly-file-actions>
					<span data-ly-file-actions-bar>
						{canOpen && (
							<FileLinkAction
								label={translate("openTarget.defaultApp")}
								tipSide={buttonTip}
								icon={<ExternalLink size={14} />}
								onClick={() => void bridge.system.openPath(path).catch(fail)}
							/>
						)}
						{canReveal && (
							<FileLinkAction
								label={revealLabel}
								tipSide={buttonTip}
								icon={<FolderOpen size={14} />}
								onClick={() => void bridge.system.openIn("reveal", path).catch(fail)}
							/>
						)}
					</span>
				</span>
			)}
			{pathMenu.element}
		</span>
	);
}

/** One exit: the app's small icon button, which gives the tooltip and the accessible name together. */
function FileLinkAction({
	label,
	icon,
	tipSide,
	onClick,
}: {
	label: string;
	icon: ReactNode;
	tipSide: "top" | "bottom";
	onClick: () => void;
}) {
	return (
		<IconButton
			size="sm"
			label={label}
			icon={icon}
			tipSide={tipSide}
			onClick={(event) => {
				// Stop here: the link and the message row around it each give a click a meaning of their own.
				event.preventDefault();
				event.stopPropagation();
				onClick();
			}}
		/>
	);
}

function Link({ href, children }: { href: string; children: ReactNode }) {
	const { baseDir, preview } = useContext(Doc);
	/*
	 * A relative path means the project of the conversation this text is in, which in a split is not
	 * necessarily the one with focus: resolved against the focused one, a `README.md` in one screen's
	 * reply opened the other project's. The path alone, as one subscription — a long transcript has a
	 * great many links.
	 */
	const project = useScopedProjectPath();
	// Context reads, not subscriptions: only a press needs them, and it reads the store then.
	const scoped = useContext(SessionScope);
	const screen = useDockScope();
	const safe = href.startsWith("http://") || href.startsWith("https://");
	const path = safe ? null : resolveAsset(baseDir ?? project ?? (isAbsolutePath(href) ? "/" : undefined), href.replace(/:\d+(?:-\d+)?$/, ""));
	if (preview || (!safe && !path)) return <>{children}</>;
	if (path) return <FileLink href={href} path={path}>{children}</FileLink>;
	return (
		<a
			href={href}
			onClick={(event) => {
				event.preventDefault();
				const state = useApp.getState();
				if (state.settings?.browser?.openLinks === "builtin" && !event.shiftKey) {
					// A tab of this screen's conversation, whichever screen has the focus.
					const sessionId = scoped === undefined ? state.activeSessionId : scoped;
					void bridge.browser.command({ type: "open", url: href, sessionId, newTab: true }).catch((error: unknown) => state.notify(String(error), "error"));
					/*
					 * Brought forward here rather than left to the main process's reveal, which only opens
					 * the panel for the live conversation — the keyboard reached this link without making
					 * its screen live, and the page would have loaded where nobody could see it.
					 */
					if (screen) openScopedPanel("browser", undefined, screen);
				} else void bridge.system.openExternal(href);
			}}
		>
			{children}
		</a>
	);
}

/**
 * A picture, drawn if there is a way to draw it and named if there is not.
 *
 * Three sources, three answers, and the page's `img-src` — `self data: blob:` — never moves:
 *
 * - `data:` and `blob:` go straight into `src`, as they always did.
 * - A path beside the file goes through `ly-media:`, the scheme the file panel already uses for
 *   images and video. Its handler re-checks that the path is inside an open project, so a README
 *   pointing at `../../../.ssh/id_rsa` gets a 403 rather than a picture.
 * - An https URL is fetched by the main process and comes back as a data URL, the same route
 *   avatars and registry logos take — and only for documents whose caller asked for it.
 *
 * Anything left over stays what it was: a named link that opens in the browser, which keeps the
 * reference and its filename instead of leaving a broken image behind.
 */
function Image({ src, alt, width, height }: { src: string; alt: string; width?: number; height?: number }) {
	const { baseDir, remoteImages, preview } = useContext(Doc);
	const remote = !preview && remoteImages && src.startsWith("https://") ? src : null;
	const fetched = useRemoteImage(remote);

	const direct = src.startsWith("data:") || src.startsWith("blob:") ? src : null;
	const onDisk = direct || remote ? null : resolveAsset(baseDir, src);
	const resolved = direct ?? fetched ?? (onDisk ? bridge.files.mediaUrl(onDisk) : null);

	if (preview) return <span>{alt || translate("markdown.image")}</span>;

	if (resolved) {
		return (
			<img
				src={resolved}
				alt={alt}
				loading="lazy"
				/*
				 * The author's `width` as a maximum, not as a width.
				 *
				 * `<img width="200">` in a README means "at most this big"; setting the attribute
				 * itself would also make it a minimum, and a 200px logo would then overflow a pane
				 * narrower than that rather than shrinking with everything else.
				 */
				style={{ maxWidth: width ? `min(100%, ${width}px)` : undefined, maxHeight: height ? `${height}px` : undefined }}
				className="ly-md-image"
			/>
		);
	}

	// In flight: a gap, not a link that is about to be replaced by the picture underneath it.
	if (remote && fetched === undefined) return null;

	const name = alt || decodeURIComponent(src.split("/").pop()?.split("?")[0] || translate("markdown.image"));
	return (
		<Link href={src}>
			<span className="ly-md-image-link">
				{/* The same size as the file chip's `FileText`: two kinds of link prefix in one paragraph, and at 11.5px beside body text it is only x-height tall and reads as punctuation. */}
				<ExternalLink size={13} strokeWidth={1.9} />
				{name}
			</span>
		</Link>
	);
}

/**
 * One remote picture as a data URL.
 *
 * Three states, not two: `undefined` while the request is in flight, `null` once it has failed,
 * and the data URL when it arrived. The caller needs the distinction — a picture that has not
 * answered yet should leave a gap, and one that will never answer should fall back to its link, so
 * the reference is not silently lost.
 */
function useRemoteImage(url: string | null): string | null | undefined {
	const [data, setData] = useState<string | null | undefined>(undefined);

	useEffect(() => {
		if (!url) return;
		let alive = true;
		setData(undefined);
		void bridge.system
			.remoteImage(url)
			.then((result) => alive && setData(result))
			.catch(() => alive && setData(null));
		return () => {
			alive = false;
		};
	}, [url]);

	return url ? data : null;
}
