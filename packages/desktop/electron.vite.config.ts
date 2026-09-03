import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

/**
 * Drop KaTeX's `woff` and `ttf` faces.
 *
 * KaTeX ships each of its twenty-odd faces three times over for browsers that predate `woff2`.
 * This app runs on one engine, and that engine has supported `woff2` for a decade — so those two
 * copies are 3.4MB that can never be requested.
 *
 * Done on the finished bundle rather than on the stylesheet, because by the time Vite sees the
 * stylesheet Tailwind has already inlined the `@import` and the file no longer identifies itself
 * as KaTeX's. Here the filenames still do.
 */
function katexWoff2Only(): Plugin {
	return {
		name: "katex-woff2-only",
		generateBundle(_options, bundle) {
			const dropped: string[] = [];
			for (const file of Object.keys(bundle)) {
				// `.woff2` does not match: the `$` requires the name to end at `woff`.
				if (/KaTeX_[^/]*\.(woff|ttf)$/.test(file)) {
					dropped.push(file.split("/").pop() as string);
					delete bundle[file];
				}
			}
			if (dropped.length === 0) return;

			for (const asset of Object.values(bundle)) {
				if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) continue;
				let css = String(asset.source);
				for (const name of dropped) {
					// The whole `, url(…) format(…)` clause goes; leaving a dangling comma breaks the rule.
					const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					css = css.replace(new RegExp(`\\s*,\\s*url\\(["']?[^)"']*${escaped}["']?\\)\\s*format\\([^)]*\\)`, "g"), "");
				}
				asset.source = css;
			}
		},
	};
}

export default defineConfig({
	main: {
		// @lyra/core ships TypeScript sources, so it must be bundled rather than
		// externalised — Node cannot require a .ts entry point at runtime.
		plugins: [externalizeDepsPlugin({ exclude: ["@lyra/core"] })],
		build: {
			rollupOptions: {
				input: { index: resolve("electron/main.ts") },
				/*
				 * `electron` is a devDependency, so the externalize plugin leaves it in — and
				 * bundling its CommonJS loader breaks on `__dirname` under ESM output.
				 *
				 * `node-pty` for a sharper reason: it loads a compiled `.node` addon by relative
				 * path. Inlined into an ESM bundle its `__dirname` does not exist, and the app
				 * fails to boot at all. Native modules are always external.
				 *
				 * `koffi` is the same kind of thing and fails in a worse way. It resolves to a
				 * platform-specific `.node` binary, and left to the bundler that binary is inlined
				 * as a module — so a build made on macOS carries `koffi-darwin-arm64` into the
				 * Windows package, where the sandbox that depends on it cannot load. External, it
				 * resolves at runtime on the machine that is actually running.
				 *
				 * The `@koromix/*` pattern is the same rule reaching one level further. `koffi`
				 * does not contain the binary itself — it requires whichever of four
				 * `@koromix/koffi-<platform>` packages matches the machine, and naming only the
				 * parent leaves the bundler to follow that require into all four. It then tries to
				 * read a `.node` binary as source and stops with 「stream did not contain valid
				 * UTF-8」, four times over. Latent until something in `electron/` changes, because
				 * until then the main bundle is served from cache and never re-resolved.
				 *
				 * Listed here rather than left to the plugin because assigning `external`
				 * replaces what the plugin contributes instead of adding to it.
				 */
				external: ["electron", "node-pty", "koffi", /^@koromix\//],
			},
		},
		resolve: {
			// The core package ships TypeScript sources and imports them with explicit .ts
			// extensions; Rollup needs the extension list to include them.
			extensions: [".ts", ".js", ".mjs", ".json"],
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin({ exclude: ["@lyra/core"] })],
		build: {
			rollupOptions: {
				input: { index: resolve("electron/preload.ts") },
				external: ["electron"],
			},
		},
	},
	renderer: {
		root: ".",
		plugins: [react(), tailwindcss(), katexWoff2Only()],
		resolve: {
			alias: { "@": resolve("src") },
		},
		build: {
			rollupOptions: {
				/*
				 * The gallery is an extra entry, and only when asked for.
				 *
				 * `pnpm gallery` sets `LYRA_GALLERY`; `pnpm build` and `pnpm package` do not, so the
				 * shipped application never carries it. An extra entry rather than a separate tool
				 * because it has to be built the way the app is built — same Tailwind pass, same
				 * tokens, same fonts — or it would be showing components that only look right in the
				 * gallery.
				 */
				input: process.env.LYRA_GALLERY
					? { index: resolve("index.html"), gallery: resolve("gallery/index.html") }
					: { index: resolve("index.html") },
				output: {
					/*
					 * What goes in its own file, and why any of it should.
					 *
					 * Everything used to land in one 4.4MB chunk. On a desktop that is a slow first
					 * paint and nothing worse — the file is on the same disk. On a phone it is the
					 * whole story: the interface is served over the network now, and through a relay
					 * it crosses the public internet twice, so those megabytes are the difference
					 * between an app that opens and one that appears not to.
					 *
					 * Split by *when it is needed* rather than by size. Each of these is either
					 * something the first screen cannot do without (react), or something a whole
					 * class of screens never touches (the editor, the terminal, maths).
					 */
					manualChunks(id) {
						if (!id.includes("node_modules")) return;

						// The framework. Needed before anything renders, and changes least often —
						// so it is the one chunk worth caching hardest.
						if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";

						// The code editor. Reached by opening a file, which most sessions never do.
						if (/[\\/]node_modules[\\/](@codemirror|@lezer)[\\/]/.test(id)) return "editor";

						// The terminal emulator, same reasoning.
						if (/[\\/]node_modules[\\/]@xterm[\\/]/.test(id)) return "terminal";

						/*
						 * Maths typesetting, and the largest thing here that most people never see.
						 * It loads when a reply contains a formula, which is a minority of replies in
						 * a minority of sessions.
						 */
						if (/[\\/]node_modules[\\/]katex[\\/]/.test(id)) return "katex";

						// Icons. Tree-shaken to what is imported, but that is still a few hundred.
						if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "icons";
					},
				},
			},
		},
	},
});
