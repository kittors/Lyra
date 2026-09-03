/**
 * TeX to HTML, via KaTeX.
 *
 * KaTeX over the browser's own MathML: Chromium renders MathML, but its fraction bars, radical
 * extenders and large operators are visibly less carefully set than KaTeX's, and this application
 * is not one where that is acceptable.
 *
 * The returned string is the one place markup is injected rather than built as elements. It is
 * KaTeX's own output — the TeX source never reaches the DOM as markup, because KaTeX parses it
 * into a tree and escapes every leaf. `trust` stays off, which is what disables `\href`,
 * `\includegraphics` and the rest of the commands that could emit a URL of the author's choosing.
 */

import { renderToString } from "katex";

/*
 * Rendering the same formula twice is common — React re-renders a message on every token that
 * streams in after it, and KaTeX parsing is not cheap. Bounded, because a long session would
 * otherwise accumulate every formula it ever showed.
 */
const cache = new Map<string, string>();
const LIMIT = 400;

/** Returns null when the TeX does not parse — the caller shows the source instead. */
export function renderMath(tex: string, display: boolean): string | null {
	const key = `${display ? "d" : "i"}:${tex}`;
	const hit = cache.get(key);
	if (hit !== undefined) return hit || null;

	let html: string;
	try {
		html = renderToString(tex, {
			displayMode: display,
			throwOnError: true,
			trust: false,
			// Unicode and \newcommand in a pull request body are not errors worth a console warning.
			strict: false,
		});
	} catch {
		/*
		 * A failed parse is stored as empty rather than not stored.
		 *
		 * Text that merely looks like TeX is the common case, and it is re-rendered on every keypress
		 * while a message streams; without a negative entry each of those pays for a full parse and a
		 * thrown exception.
		 */
		html = "";
	}

	if (cache.size >= LIMIT) cache.clear();
	cache.set(key, html);
	return html || null;
}
