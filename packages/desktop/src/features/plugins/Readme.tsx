/**
 * A bundle's README, rendered — the documentation the market's web page shows under an entry's name.
 *
 * `lib/readme/parse.ts` reads the source into a tree; this turns the tree into React elements. There
 * is no `dangerouslySetInnerHTML` anywhere and no markup is built from a string, so nothing in a
 * README — which anybody can submit to a market — becomes an element this file did not choose to
 * make. The parser has already refused every URL it would not follow.
 *
 * What the app adds to the site's version, because it is not a browser tab:
 *
 *   - pictures come through the main process (`system:remoteImage`) — the page's policy does not let
 *     it fetch a remote image itself — and one that never arrives is simply not there;
 *   - a `<picture>` with a dark variant is resolved here, against this window's theme, since the
 *     browser's own `<source media>` would need the remote URL the policy refuses;
 *   - links open in the default browser, and a README's own table of contents scrolls this page.
 *
 * Ported from Lyra-Registry's `packages/web/src/markdown.tsx`; the styles are `styles/readme.css`.
 */

import { Check, ChevronRight, Info, Lightbulb, Link as LinkIcon, MessageSquareWarning, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import { parseMarkdown, type AlertKind, type Block, type Inline } from "../../lib/readme/parse.ts";
import { bridge } from "../../services/index.ts";
import { CopyMark } from "../../ui/layout/CopyMark.tsx";
import { motionReduced } from "../../ui/motion/reduced.ts";

/** Headings are namespaced the way GitHub namespaces them, so a README cannot shadow the app's ids. */
const PREFIX = "user-content-";

export function Readme({ markdown, repo, dir }: { markdown: string; repo?: string; dir?: string }) {
	const blocks = useMemo(() => parseMarkdown(markdown, repo ? { base: { repo, dir: dir ?? "" } } : {}), [markdown, repo, dir]);
	const root = useRef<HTMLDivElement>(null);

	/*
	 * Every link in the document, taken here: `#section` scrolls this page to its heading, and
	 * anything else opens in the default browser rather than navigating the app's own window.
	 */
	const onClick = (event: MouseEvent<HTMLDivElement>) => {
		if (event.defaultPrevented || event.button !== 0) return;
		const anchor = (event.target as Element | null)?.closest?.("a");
		const href = anchor?.getAttribute("href");
		if (!anchor || !href) return;
		event.preventDefault();
		if (href.startsWith("#")) {
			if (!root.current) return;
			findSection(root.current, href.slice(1))?.scrollIntoView({ behavior: motionReduced() ? "auto" : "smooth", block: "start" });
			return;
		}
		void bridge.system.openExternal(href);
	};

	return (
		// The handler only reads clicks on the links inside; the links themselves are the interactive part.
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
		<div className="ly-readme" ref={root} onClick={onClick} data-readme="">
			{renderBlocks(blocks, false)}
		</div>
	);
}

function findSection(root: HTMLElement, raw: string): HTMLElement | null {
	let name = raw;
	try {
		name = decodeURIComponent(raw);
	} catch {
		// A malformed escape is only a name that will not be found.
	}
	for (const candidate of [name, name.toLowerCase()]) {
		const found = root.querySelector<HTMLElement>(`[id="${CSS.escape(PREFIX + candidate)}"]`);
		if (found) return found;
	}
	return null;
}

function renderBlocks(blocks: readonly Block[], tight: boolean): ReactNode[] {
	return blocks.map((block, index) => renderBlock(block, index, tight));
}

function alignClass(align: string | undefined): string | undefined {
	return align === "center" ? "ly-rm-center" : align === "right" ? "ly-rm-right" : undefined;
}

function renderBlock(block: Block, key: number, tight: boolean): ReactNode {
	switch (block.type) {
		case "heading": {
			const Tag = `h${block.level}` as "h2";
			return (
				<Tag key={key} id={PREFIX + block.id} className={alignClass(block.align)}>
					<a className="ly-rm-anchor" href={`#${block.id}`} aria-hidden="true" tabIndex={-1}>
						<LinkIcon size={13} strokeWidth={2} />
					</a>
					{renderInline(block.children)}
				</Tag>
			);
		}
		case "paragraph": {
			// In a tight list an item's text is the item itself, not a paragraph inside it.
			if (tight) return <span key={key}>{renderInline(block.children)}</span>;
			const badges = isBadgeRow(block.children);
			const className = [alignClass(block.align), badges ? "ly-rm-badges" : undefined].filter(Boolean).join(" ") || undefined;
			return (
				<p key={key} className={className}>
					{renderInline(badges ? block.children.filter((node) => node.type !== "text" && node.type !== "break") : block.children)}
				</p>
			);
		}
		case "code":
			return (
				<div key={key} className="ly-rm-code group/copy">
					<pre>
						<code>{block.value}</code>
					</pre>
					<CopyMark text={block.value} />
				</div>
			);
		case "quote":
			return <blockquote key={key}>{renderBlocks(block.children, false)}</blockquote>;
		case "alert":
			return (
				<Alert key={key} kind={block.kind}>
					{renderBlocks(block.children, false)}
				</Alert>
			);
		case "list": {
			const items = block.items.map((item, index) => (
				<li key={index} className={item.checked === undefined ? undefined : "ly-rm-task"}>
					{item.checked !== undefined && (
						<span className="ly-rm-check" data-checked={item.checked || undefined} role="img" aria-label={translate(item.checked ? "readme.done" : "readme.todo")}>
							{item.checked && <Check size={11} strokeWidth={2.6} />}
						</span>
					)}
					{renderBlocks(item.children, block.tight)}
				</li>
			));
			return block.ordered ? (
				<ol key={key} start={block.start === 1 ? undefined : block.start}>
					{items}
				</ol>
			) : (
				<ul key={key} className={block.items.some((item) => item.checked !== undefined) ? "ly-rm-tasks" : undefined}>
					{items}
				</ul>
			);
		}
		case "table":
			return (
				<div key={key} className="ly-rm-table">
					<table>
						<thead>
							<tr>
								{block.head.map((cell, index) => (
									<th key={index} style={block.align[index] ? { textAlign: block.align[index] } : undefined}>
										{renderInline(cell)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{block.rows.map((row, rowIndex) => (
								<tr key={rowIndex}>
									{row.map((cell, index) => (
										<td key={index} style={block.align[index] ? { textAlign: block.align[index] } : undefined}>
											{renderInline(cell)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		case "grid":
			return (
				<div key={key} className={["ly-rm-table", "ly-rm-grid", alignClass(block.align)].filter(Boolean).join(" ")}>
					<table>
						<tbody>
							{block.rows.map((row, rowIndex) => (
								<tr key={rowIndex}>
									{row.map((cell, index) => {
										const Cell = cell.header ? "th" : "td";
										const width = cell.width ? (cell.width.endsWith("%") ? cell.width : `${cell.width}px`) : undefined;
										return (
											<Cell key={index} style={cell.align || width ? { textAlign: cell.align, width } : undefined}>
												{renderBlocks(cell.children, false)}
											</Cell>
										);
									})}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		case "details":
			return (
				<details key={key} className="ly-rm-details" open={block.open || undefined}>
					<summary>
						<ChevronRight size={14} strokeWidth={2} className="ly-rm-details-caret" />
						<span>{block.summary.length ? renderInline(block.summary) : translate("readme.details")}</span>
					</summary>
					<div className="ly-rm-details-body">{renderBlocks(block.children, false)}</div>
				</details>
			);
		case "group":
			return (
				<div key={key} className={alignClass(block.align)}>
					{renderBlocks(block.children, false)}
				</div>
			);
		case "rule":
			return <hr key={key} />;
		default:
			return null;
	}
}

/** Badges only — a row of status pictures, drawn at text height with even gaps. */
function isBadgeRow(nodes: readonly Inline[]): boolean {
	let badges = 0;
	for (const node of nodes) {
		if (node.type === "break" || (node.type === "text" && !node.value.trim())) continue;
		if (node.type === "image" && node.badge) {
			badges += 1;
			continue;
		}
		if (node.type === "link" && node.children.length > 0 && node.children.every((child) => child.type === "image" && child.badge)) {
			badges += 1;
			continue;
		}
		return false;
	}
	return badges > 0;
}

function renderInline(nodes: readonly Inline[]): ReactNode[] {
	return nodes.map((node, key) => {
		switch (node.type) {
			case "text":
				return node.value;
			case "code":
				return <code key={key}>{node.value}</code>;
			case "strong":
				return <strong key={key}>{renderInline(node.children)}</strong>;
			case "em":
				return <em key={key}>{renderInline(node.children)}</em>;
			case "del":
				return <del key={key}>{renderInline(node.children)}</del>;
			case "kbd":
				return <kbd key={key}>{renderInline(node.children)}</kbd>;
			case "sup":
				return <sup key={key}>{renderInline(node.children)}</sup>;
			case "sub":
				return <sub key={key}>{renderInline(node.children)}</sub>;
			case "mark":
				return <mark key={key}>{renderInline(node.children)}</mark>;
			case "break":
				return <br key={key} />;
			case "image":
				return <ReadmeImage key={key} node={node} />;
			case "link":
				// Opened by `Readme`'s click handler: in the page for `#…`, in the browser for anything else.
				return (
					<a key={key} href={node.href} data-ly-tip={node.title ?? (node.internal ? undefined : node.href)}>
						{renderInline(node.children)}
					</a>
				);
			default:
				return null;
		}
	});
}

/**
 * A picture from a README: faded in once it has actually arrived, and gone if it never does.
 *
 * A broken-image glyph with its alt text beside it is the most common way a README looks broken off
 * GitHub — a path the repository has since moved, a badge service that is down. Drawing nothing is
 * closer to what the author meant than drawing the failure.
 */
function ReadmeImage({ node }: { node: Extract<Inline, { type: "image" }> }) {
	const dark = useDarkPage();
	const url = pictureFor(node, dark);
	const data = useRemotePicture(url);
	const [loaded, setLoaded] = useState<string | null>(null);
	if (!data) return null;

	const className = ["ly-rm-img", node.badge ? "ly-rm-img-badge" : undefined, node.round ? "ly-rm-img-round" : undefined].filter(Boolean).join(" ");
	const width = node.width && !node.width.endsWith("%") ? Number(node.width) : undefined;
	const height = node.height && !node.height.endsWith("%") ? Number(node.height) : undefined;
	const style = node.width?.endsWith("%") ? { width: node.width } : width ? { width } : height && !node.badge ? { height, width: "auto" } : undefined;
	return (
		<img
			className={className}
			src={data}
			alt={node.alt}
			data-ly-tip={node.title}
			width={width}
			height={height}
			style={style}
			decoding="async"
			data-loaded={loaded === data || undefined}
			// Decoded already — the same picture elsewhere on the page — before `onLoad` could be attached.
			ref={(element) => {
				if (element?.complete && element.naturalWidth > 0 && loaded !== data) setLoaded(data);
			}}
			onLoad={() => setLoaded(data)}
		/>
	);
}

/** The picture to fetch: a `<picture>`'s dark variant on a dark page, and the image itself otherwise. */
function pictureFor(node: Extract<Inline, { type: "image" }>, dark: boolean): string {
	const wanted = dark ? "dark" : "light";
	const source = node.sources?.find((candidate) => new RegExp(`prefers-color-scheme\\s*:\\s*${wanted}`, "i").test(candidate.media));
	// A `srcset` can list several candidates; the first is the one written for 1×.
	const first = source?.srcSet.split(",")[0]?.trim().split(/\s+/)[0];
	return first?.startsWith("https://") ? first : node.src;
}

/**
 * Pictures this window already fetched, by URL — a README opened twice does not ask twice.
 *
 * Bounded by size, oldest first: a page's pictures can be megabytes each, and a long browse through
 * the market would otherwise keep every one of them for the life of the window. Only arrivals are
 * kept — a failure is the main process's to remember, for a minute, so a picture that missed during a
 * slow start is asked for again the next time its page opens.
 */
const PICTURES = new Map<string, string>();
const PICTURE_BUDGET = 48 * 1024 * 1024;
let pictureBytes = 0;

function rememberPicture(url: string, data: string): void {
	pictureBytes -= PICTURES.get(url)?.length ?? 0;
	PICTURES.delete(url);
	PICTURES.set(url, data);
	pictureBytes += data.length;
	for (const [old, value] of PICTURES) {
		if (pictureBytes <= PICTURE_BUDGET) break;
		PICTURES.delete(old);
		pictureBytes -= value.length;
	}
}

/** `undefined` while it is on its way, `null` if it will not come, the data URL once it has. */
function useRemotePicture(url: string): string | null | undefined {
	const [value, setValue] = useState<string | null | undefined>(() => PICTURES.get(url));
	useEffect(() => {
		const known = PICTURES.get(url);
		if (known !== undefined) return setValue(known);
		if (!url.startsWith("https://")) return setValue(null);
		setValue(undefined);
		let alive = true;
		void bridge.system
			.remoteImage(url)
			.then((data) => {
				if (data) rememberPicture(url, data);
				if (alive) setValue(data);
			})
			.catch(() => alive && setValue(null));
		return () => {
			alive = false;
		};
	}, [url]);
	return value;
}

/** Whether the window is drawn dark right now, following a theme switch while the page is open. */
function useDarkPage(): boolean {
	const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
	useEffect(() => {
		const root = document.documentElement;
		const observer = new MutationObserver(() => setDark(root.classList.contains("dark")));
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);
	return dark;
}

const ALERTS: Record<AlertKind, { label: MessageKey; Icon: LucideIcon }> = {
	note: { label: "readme.note", Icon: Info },
	tip: { label: "readme.tip", Icon: Lightbulb },
	important: { label: "readme.important", Icon: MessageSquareWarning },
	warning: { label: "readme.warning", Icon: TriangleAlert },
	caution: { label: "readme.caution", Icon: OctagonAlert },
};

function Alert({ kind, children }: { kind: AlertKind; children: ReactNode }) {
	const { label, Icon } = ALERTS[kind];
	return (
		<div className={`ly-rm-alert ly-rm-alert-${kind}`}>
			<p className="ly-rm-alert-title">
				<Icon size={14} strokeWidth={2} />
				{translate(label)}
			</p>
			{children}
		</div>
	);
}
