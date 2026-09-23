/**
 * Module hooks for the component tests: an image or a stylesheet imported by a component is an
 * empty string here.
 *
 * Vite turns `import mark from "./x.png?inline"` into a data URL at build time; Node has no idea
 * what to do with the file and refuses the whole module graph that reaches it — which, through
 * one barrel, is most of the app. The tests are not about the pixels.
 */

const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css)(\?[a-z]+)?$/i;

/**
 * Browser-only packages, stubbed by name. `@xterm/xterm` ships a bundle Node cannot read named
 * exports from; the terminal is not what any of these tests look at, but it sits on the same
 * import chain as the conversation.
 *
 * The terminal stub keeps what it was built with and the key handler it was handed, which is all
 * a test can ask of the pane's wiring: which options it chose, and what it does with a key before
 * xterm would see it. `defineProperty` for the options, not assignment: a test may already have put
 * a read-only `options` on the prototype, and assigning over that throws.
 */
const STUBS = {
	"@xterm/xterm":
		"export class Terminal { constructor(options) { Object.defineProperty(this, 'options', { value: { ...options }, writable: true, configurable: true, enumerable: true }); } open() {} write() {} dispose() {} loadAddon() {} attachCustomKeyEventHandler(handler) { this.customKeyEventHandler = handler; } }",
	"@xterm/addon-fit": "export class FitAddon { fit() {} activate() {} dispose() {} }",
};

export async function resolve(specifier, context, next) {
	if (specifier in STUBS) return { url: `lyra-stub:${specifier}`, shortCircuit: true };
	// `x.png?inline` is not a file on disk; resolve the file and keep the query for `load` to see.
	if (ASSET.test(specifier)) {
		const query = /\?[a-z]+$/i.exec(specifier)?.[0] ?? "";
		const resolved = await next(specifier.slice(0, specifier.length - query.length), context);
		return { ...resolved, url: `${resolved.url}${query}`, shortCircuit: true };
	}
	return next(specifier, context);
}

export async function load(url, context, next) {
	if (url.startsWith("lyra-stub:")) return { format: "module", source: STUBS[url.slice("lyra-stub:".length)], shortCircuit: true };
	if (ASSET.test(url)) return { format: "module", source: 'export default "";', shortCircuit: true };
	return next(url, context);
}
