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

import { ChevronRight, ExternalLink } from "lucide-react";
import { createContext, Fragment, memo, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { CodeBlock } from "./CodeBlock.tsx";
import type { Block, ListItem } from "../lib/markdown/blocks.ts";
import { parseMarkdown } from "../lib/markdown/blocks.ts";
import { resolveAsset } from "../lib/markdown/assets.ts";
import { type Inline, parseInline } from "../lib/markdown/inline.ts";
import { renderMath } from "../lib/markdown/math.ts";
import { stripEmoji } from "../lib/markdown/strip-emoji.ts";
import { bridge } from "../services/index.ts";

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
	const clean = stripEmoji(text);

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
	const doc = useMemo(() => ({ baseDir, remoteImages }), [baseDir, remoteImages]);

	return (
		<Doc.Provider value={doc}>
			<div className={`prose-dw min-w-0 ${className}`}>{renderBlocks(clean)}</div>
		</Doc.Provider>
	);
});

function renderBlocks(source: string): ReactNode {
	return parseMarkdown(source).map((block, index) => <Fragment key={index}>{renderBlock(block)}</Fragment>);
}

function renderBlock(block: Block): ReactNode {
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
						<Fragment key={index}>{renderBlock(child)}</Fragment>
					))}
				</div>
			);
		case "paragraph":
			return <p>{inline(block.text)}</p>;
		case "code":
			return <CodeBlock lang={block.lang} code={block.code} />;
		case "rule":
			return <hr />;
		case "quote":
			return <blockquote>{renderBlocks(block.text)}</blockquote>;
		case "math":
			return <MathBlock tex={block.tex} />;
		case "details":
			return <Details summary={block.summary} blocks={block.children} />;
		case "list": {
			const Tag = block.ordered ? "ol" : "ul";
			return (
				<Tag>
					{block.items.map((item, index) => (
						<Item key={index} item={item} />
					))}
				</Tag>
			);
		}
		case "table":
			return (
				<div className="ly-table">
					<table>
						<thead>
							<tr>
								{block.header.map((cell, index) => (
									<th key={index} style={{ textAlign: block.align[index] ?? "left" }}>
										{inline(cell)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{block.rows.map((row, rowIndex) => (
								<tr key={rowIndex}>
									{row.map((cell, cellIndex) => (
										<td key={cellIndex} style={{ textAlign: block.align[cellIndex] ?? "left" }}>
											{inline(cell)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		default:
			return null;
	}
}

function Item({ item }: { item: ListItem }) {
	const body = (
		<>
			{inline(item.text)}
			{item.children.map((child, index) => (
				<Fragment key={index}>{renderBlock(child)}</Fragment>
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

/** `<details>`, folded, with the same motion as every other disclosure in the app. */
function Details({ summary, blocks }: { summary: string; blocks: Block[] }) {
	const [open, setOpen] = useState(false);

	return (
		<div className="ly-details" data-open={open}>
			<button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="ly-details-summary">
				<ChevronRight size={13} strokeWidth={2} className="ly-details-chevron" />
				<span>{inline(summary)}</span>
			</button>
			<div className="ly-reveal" data-open={open} aria-hidden={!open}>
				<div>
					<div className="ly-details-body">
						{blocks.map((child, index) => (
							<Fragment key={index}>{renderBlock(child)}</Fragment>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

function MathBlock({ tex }: { tex: string }) {
	const html = renderMath(tex, true);
	// TeX that does not parse is shown as it was written; a red error box helps nobody read it.
	if (!html) return <pre className="ly-math-raw">{tex}</pre>;
	// biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX's own output, built from a parse tree it escapes.
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
			// biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX's own output, built from a parse tree it escapes.
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

/** Only http(s) opens, and it opens outside — nothing navigates this window away from the app. */
function Link({ href, children }: { href: string; children: ReactNode }) {
	const safe = href.startsWith("http://") || href.startsWith("https://");
	if (!safe) return <>{children}</>;
	return (
		<a
			href={href}
			onClick={(event) => {
				event.preventDefault();
				void bridge.system.openExternal(href);
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
	const { baseDir, remoteImages } = useContext(Doc);
	const remote = remoteImages && src.startsWith("https://") ? src : null;
	const fetched = useRemoteImage(remote);

	const direct = src.startsWith("data:") || src.startsWith("blob:") ? src : null;
	const onDisk = direct || remote ? null : resolveAsset(baseDir, src);
	const resolved = direct ?? fetched ?? (onDisk ? bridge.files.mediaUrl(onDisk) : null);

	if (resolved) {
		return (
			<img
				src={resolved}
				alt={alt}
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

	const name = alt || decodeURIComponent(src.split("/").pop()?.split("?")[0] || "图片");
	return (
		<Link href={src}>
			<span className="ly-md-image-link">
				<ExternalLink size={11.5} strokeWidth={1.9} />
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
