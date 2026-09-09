import { useEffect, useRef, useState } from "react";
import type { BrowserTab } from "../../../shared/browser.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { motionReduced } from "../../ui/motion/reduced.ts";

declare global { interface HTMLWebViewElement { getWebContentsId(): number } }

/** Stable DOM order and src retain page history, forms and scripts while switching tabs. */
export function BrowserPage({ tab, active }: { tab: BrowserTab; active: boolean }) {
	const ref = useRef<HTMLWebViewElement | null>(null);
	const [initialUrl] = useState(tab.url);
	const [size, setSize] = useState({ width: 0, height: 0 });
	const ring = useRef<HTMLDivElement | null>(null);
	const pointer = tab.pointer;
	useEffect(() => {
		if (!ring.current || !active || (pointer?.action !== "click" && pointer?.action !== "type")) return;
		if (motionReduced()) return;
		const animation = ring.current.animate([{ opacity: 0.6, transform: "scale(0.4)" }, { opacity: 0, transform: "scale(1.5)" }], { duration: 320, easing: "ease-out" });
		return () => animation.cancel();
	}, [pointer?.sequence, pointer?.action, active]);
	useEffect(() => {
		const page = ref.current;
		if (!page) return;
		let live = true;
		const attach = () => {
			void bridge.browser.attach(tab.id, page.getWebContentsId()).catch((error: unknown) => { if (live) useApp.getState().notify(String(error), "error"); });
		};
		page.addEventListener("dom-ready", attach);
		const observer = new ResizeObserver(([entry]) => {
			if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
			setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
			void bridge.browser.command({ type: "resize", id: tab.id, width: entry.contentRect.width, height: entry.contentRect.height }).catch((error: unknown) => { if (live) useApp.getState().notify(String(error), "error"); });
		});
		observer.observe(page);
		return () => { live = false; observer.disconnect(); page.removeEventListener("dom-ready", attach); };
	}, [tab.id]);
	const scale = tab.viewport ? Math.min(1, size.width / tab.viewport.width, size.height / tab.viewport.height) : 1;
	const x = Math.max(0, Math.min(size.width - 1, (pointer?.x ?? 0) * tab.zoom * scale));
	const y = Math.max(0, Math.min(size.height - 1, (pointer?.y ?? 0) * tab.zoom * scale));
	/*
	 * Inherited when this tab is the active one, never asserted.
	 *
	 * `visibility` is inherited, and a descendant that declares `visible` comes back into view even
	 * inside an ancestor that is `hidden` — that is the property's defining behaviour, not a quirk.
	 * So `visibility: "visible"` here reached past the one thing that puts the whole workspace away:
	 * opening settings hides it with `invisible` (see `Shell` in `app/App.tsx`, which cannot use
	 * `display: none` without losing the transcript's scroll position), and this webview was the one
	 * element that ignored it. The browser's page went on painting over the settings pane.
	 *
	 * `undefined` leaves the property alone: the active tab is visible exactly when whatever contains
	 * it is. The inactive ones still assert `hidden`, which is what keeps the tab strip working.
	 */
	return <div className="absolute inset-0" style={{ visibility: active ? undefined : "hidden", pointerEvents: active ? "auto" : "none" }}>
		<webview ref={ref} src={initialUrl} partition="persist:ly-browser" data-browser-page={tab.id} className="absolute inset-0 h-full w-full bg-white" />
		{pointer && <>
			<div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-10" style={{ transform: `translate(${x}px, ${y}px)` }}>
				<div ref={ring} data-browser-click-ring className="absolute -left-3 -top-3 h-6 w-6 rounded-full border border-sky-300/70 bg-sky-400/15 opacity-0" />
			</div>
			<div aria-hidden="true" data-browser-cursor={tab.id} data-action={pointer.action} className="pointer-events-none absolute left-0 top-0 z-10 h-0 w-0 transition-transform duration-[140ms] ease-out" style={{ transform: `translate(${x}px, ${y}px)` }}>
				<svg width="24" height="24" viewBox="0 0 32 32" fill="none" className="absolute -left-1 -top-1 overflow-visible" style={{ transformOrigin: "4px 4px", transform: `scale(${x > size.width - 24 ? -1 : 1}, ${y > size.height - 24 ? -1 : 1})`, filter: "drop-shadow(0 0 3px rgb(98 184 255 / 65%)) drop-shadow(0 0 9px rgb(64 157 255 / 45%))" }}>
					<path d="M6.2 3.9C4.7 3.4 3.4 4.7 3.9 6.2L11.1 26.2C11.7 27.9 14.1 27.8 14.6 26L17.2 17.2L26 14.6C27.8 14.1 27.9 11.7 26.2 11.1Z" fill="#080a0d" stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
				</svg>
			</div></>}
	</div>;
}
