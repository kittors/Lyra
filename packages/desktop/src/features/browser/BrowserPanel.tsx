import { ArrowLeft, ArrowRight, Globe, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { useSide } from "../dock/sideStore.ts";

/**
 * What to call the page at the bottom of the panel.
 *
 * A preview's URL is two UUIDs and a filename, which answers nothing anyone would ask. Its title
 * is available whenever the panel was opened from a preview card; after navigating away and back
 * it is not, and "本地预览" is still truer than the raw address.
 */
function prettyLocation(url: string, target: ReturnType<typeof useSide.getState>["browserTarget"]): string {
	if (!url.startsWith(`${PREVIEW_PREFIX}:`)) return url;
	return target?.kind === "preview" ? `预览 · ${target.preview.title}` : "本地预览";
}

/** `webview` is an Electron element; React has no types for its attributes. */
type WebviewElement = HTMLElement & {
	src: string;
	canGoBack(): boolean;
	canGoForward(): boolean;
	goBack(): void;
	goForward(): void;
	reload(): void;
	getURL(): string;
};

const PREVIEW_PREFIX = "ly-preview";

function targetUrl(target: ReturnType<typeof useSide.getState>["browserTarget"]): string {
	if (!target) return "";
	return target.kind === "url" ? target.url : `ly-preview://${target.preview.sessionId}/${target.preview.id}/${target.preview.entry}`;
}

/**
 * The full-size half of the browser.
 *
 * The inline card in the transcript is for things you glance at; anything you need to actually
 * use — a page with its own navigation, a preview worth more than 320px, a local dev server —
 * belongs here, where it gets the whole panel and a way to move around.
 *
 * An Electron `webview` rather than an iframe: it is a separate process, so a page that hangs
 * or crashes takes nothing with it, and it can carry its own history. Node is off, context
 * isolation is on, and it has no preload — it can render and nothing more.
 */
export function BrowserPanel() {
	const target = useSide((s) => s.browserTarget);
	const openUrl = useSide((s) => s.openUrl);
	const view = useRef<WebviewElement>(null);
	const [address, setAddress] = useState("");
	const [current, setCurrent] = useState("");
	const [loading, setLoading] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	const url = targetUrl(target);

	useEffect(() => {
		setAddress(target?.kind === "url" ? target.url : "");
		setFailure(null);
	}, [target]);

	// The element emits DOM events rather than React ones, so they are attached by hand.
	useEffect(() => {
		const element = view.current;
		if (!element) return;
		const started = () => {
			setLoading(true);
			setFailure(null);
		};
		/*
		 * The address bar follows the page, not the other way round.
		 *
		 * Going back used to leave whatever had last been typed sitting in the field, so the bar
		 * claimed one page while another was on screen. Every navigation — typed, clicked, or from
		 * the history buttons — ends here, which is the only way the two stay in agreement.
		 */
		const stopped = () => {
			setLoading(false);
			const here = element.getURL();
			setCurrent(here);
			setAddress(here.startsWith(`${PREVIEW_PREFIX}:`) ? "" : here);
		};
		const failed = (event: Event) => {
			const detail = event as Event & { errorDescription?: string; errorCode?: number };
			setLoading(false);
			// -3 is an aborted navigation, which is what a redirect looks like from here.
			if (detail.errorCode === -3) return;
			setFailure(detail.errorDescription || "页面加载失败");
		};
		element.addEventListener("did-start-loading", started);
		element.addEventListener("did-stop-loading", stopped);
		element.addEventListener("did-fail-load", failed);
		return () => {
			element.removeEventListener("did-start-loading", started);
			element.removeEventListener("did-stop-loading", stopped);
			element.removeEventListener("did-fail-load", failed);
		};
	}, [url]);

	function go(raw: string) {
		const trimmed = raw.trim();
		if (!trimmed) return;
		// A bare host is a URL people mean, not a search they typed.
		const withScheme = /^[a-z][\w+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
		openUrl(withScheme);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex h-9 shrink-0 items-center gap-1 px-2">
				<IconButton
					icon={<ArrowLeft size={13} strokeWidth={1.9} />}
					label="后退"
					size="sm"
					disabled={!url}
					onClick={() => view.current?.canGoBack() && view.current.goBack()}
				/>
				<IconButton
					icon={<ArrowRight size={13} strokeWidth={1.9} />}
					label="前进"
					size="sm"
					disabled={!url}
					onClick={() => view.current?.canGoForward() && view.current.goForward()}
				/>
				<IconButton
					icon={<RotateCw size={12.5} strokeWidth={1.9} className={loading ? "ly-pulse" : undefined} />}
					label="刷新"
					size="sm"
					disabled={!url}
					onClick={() => view.current?.reload()}
				/>

				<form
					className="min-w-0 flex-1"
					onSubmit={(event) => {
						event.preventDefault();
						go(address);
					}}
				>
					<input
						value={address}
						onChange={(event) => setAddress(event.target.value)}
						placeholder="输入网址"
						spellCheck={false}
						className="h-[26px] w-full rounded-md border border-line bg-input px-2.5 text-detail text-ink placeholder:text-ink-faint focus:border-ink-faint"
					/>
				</form>

				{url && (
					<IconButton
						icon={<X size={13} strokeWidth={1.9} />}
						label="关闭页面"
						size="sm"
						onClick={() => useSide.setState({ browserTarget: null })}
					/>
				)}
			</div>

			{failure && (
				<div className="mx-2 mb-1.5 shrink-0 rounded-lg border border-danger/25 bg-danger/8 px-2.5 py-1.5">
					<Text size="detail" tone="danger">
						{failure}
					</Text>
				</div>
			)}

			{url ? (
				<webview
					ref={view as never}
					src={url}
					// No preload, no node integration: it renders pages, it does not run our code.
					className="min-h-0 flex-1 bg-white"
					partition="persist:ly-browser"
					allowpopups={undefined}
				/>
			) : (
				<PanelEmpty icon={Globe} title="浏览器">
					在上面输入网址，或者用对话里预览卡片上的「在侧栏中打开」。
				</PanelEmpty>
			)}

			{/*
			 * What is actually loaded, spelled out at the bottom.
			 *
			 * A preview's real URL is two UUIDs and a filename, which tells nobody anything, so it
			 * says the title instead — the address bar stays empty and available for typing a URL,
			 * and this line answers "what am I looking at".
			 */}
			{current && (
				<Text size="caption" tone="faint" className="shrink-0 truncate border-t border-line-soft px-3 py-1">
					{prettyLocation(current, target)}
				</Text>
			)}
		</div>
	);
}
