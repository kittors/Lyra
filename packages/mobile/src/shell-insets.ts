/**
 * The phone's own chrome, told to the page.
 *
 * The WebView runs edge to edge: its background reaches under the status bar and the home
 * indicator, and only the controls inside it keep clear of them. That split is the page's to make
 * — it knows which of its parts are background and which are buttons — but it cannot measure the
 * chrome itself. `env(safe-area-inset-*)` answers inside WKWebView and answers zero in most
 * Android WebViews, so the numbers come from here, where `react-native-safe-area-context` has them
 * for both platforms, and the page reads them as `--ly-native-*` with `env()` as the fallback.
 */

export interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** The four sides, in the order CSS writes them. */
const SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * What the page should keep clear of right now.
 *
 * With the keyboard up the WebView already ends at the keyboard's top edge (see `desk.tsx`), and
 * the home indicator is behind the keyboard — reserving its inset there would float the composer a
 * thumb's width above the keys for nothing.
 */
export function pageInsets(insets: Insets, keyboardUp: boolean): Insets {
	const round = (value: number) => Math.max(0, Math.round(value * 100) / 100);
	return {
		top: round(insets.top),
		right: round(insets.right),
		bottom: keyboardUp ? 0 : round(insets.bottom),
		left: round(insets.left),
	};
}

/**
 * The script that writes them onto the document.
 *
 * Safe to run before the document exists — `injectedJavaScriptBeforeContentLoaded` runs that
 * early — and safe to run again on every change, since it only sets four properties. The attribute
 * says the numbers are authoritative, so the page stops second-guessing them with `env()`.
 */
export function insetScript(insets: Insets): string {
	const values = Object.fromEntries(SIDES.map((side) => [side, `${insets[side]}px`]));
	return `(() => {
	const values = ${JSON.stringify(values)};
	const apply = () => {
		const root = document.documentElement;
		if (!root) return false;
		for (const side of ${JSON.stringify(SIDES)}) root.style.setProperty("--ly-native-" + side, values[side]);
		root.setAttribute("data-lyra-shell", "native");
		return true;
	};
	if (!apply()) document.addEventListener("readystatechange", apply, { once: true });
})();`;
}
