/**
 * Parsing an address and handing it to whoever owns the scheme.
 *
 * Per session, never a module singleton. omp's router is process-global, so with a main session
 * and a sub-agent both live, `skill://x` resolves against whichever of them wrote the global state
 * last — a bug that only appears under concurrency and reads as a skill occasionally containing
 * someone else's text. A router per session cannot have it.
 */

import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { realpath } from "node:fs/promises";
import { ResourceError, type ParsedUrl, type Resource, type ResourceContext, type ResourceHandler } from "./types.ts";

/**
 * A scheme is letters, digits and hyphens, and must be followed by `://`.
 *
 * The `://` is required rather than optional because `C:\Users` and `note:todo` are not addresses
 * and must keep being read as file paths. Windows drive letters in particular would be captured by
 * a looser pattern, and the failure would be a path that silently stops resolving on one platform.
 */
const URL_PATTERN = /^([a-z][a-z0-9-]*):\/\/(.*)$/i;
/** A trailing `:12` or `:12-40`, the same selector `read` accepts on file paths. */
const RANGE_PATTERN = /:(\d+)(?:-(\d+))?$/;

export function parseResourceUrl(input: string): ParsedUrl | null {
	const match = URL_PATTERN.exec(input.trim());
	if (!match) return null;

	const scheme = match[1].toLowerCase();
	let path = match[2];
	let range: ParsedUrl["range"];

	const ranged = RANGE_PATTERN.exec(path);
	if (ranged) {
		range = { from: Number(ranged[1]), to: ranged[2] ? Number(ranged[2]) : undefined };
		path = path.slice(0, ranged.index);
	}

	return {
		scheme,
		path,
		segments: path.split("/").filter((segment) => segment.length > 0),
		range,
		raw: input.trim(),
	};
}

export class ResourceRouter {
	private readonly handlers = new Map<string, ResourceHandler>();

	register(handler: ResourceHandler): () => void {
		if (this.handlers.has(handler.scheme)) {
			throw new Error(`Resource scheme "${handler.scheme}://" is already registered.`);
		}
		this.handlers.set(handler.scheme, handler);
		return () => {
			this.handlers.delete(handler.scheme);
		};
	}

	/** Whether this looks like an address we own. A `://` we do not know is not a file path either. */
	canResolve(input: string): boolean {
		const parsed = parseResourceUrl(input);
		return parsed !== null && this.handlers.has(parsed.scheme);
	}

	/** Whether this is an address at all, known scheme or not. */
	looksLikeUrl(input: string): boolean {
		return parseResourceUrl(input) !== null;
	}

	schemes(): { scheme: string; describe: string; writable: boolean }[] {
		return [...this.handlers.values()]
			.map((h) => ({ scheme: h.scheme, describe: h.describe, writable: typeof h.write === "function" }))
			.sort((a, b) => a.scheme.localeCompare(b.scheme));
	}

	async resolve(input: string, ctx: ResourceContext): Promise<Resource> {
		const { url, handler } = this.route(input);

		/*
		 * An empty path is a request for the index. Handled here rather than in each handler so
		 * `read skill://` behaves the same way for every scheme, including ones added later by an
		 * extension whose author never read this file.
		 */
		if (url.segments.length === 0) {
			if (!handler.list) throw new ResourceError(`\`${url.scheme}://\` 不能列目录，请给一个具体的名字。`);
			const entries = await handler.list(ctx);
			const body =
				entries.length === 0
					? `（${url.scheme}:// 下面暂时没有东西）`
					: entries.map((e) => (e.description ? `- ${e.value}: ${e.description}` : `- ${e.value}`)).join("\n");
			return { url: url.raw, content: body, contentType: "text/markdown" };
		}

		const resource = await handler.resolve(url, ctx);
		return url.range ? sliceResource(resource, url.range) : resource;
	}

	async write(input: string, content: string, ctx: ResourceContext): Promise<void> {
		const { url, handler } = this.route(input);
		if (!handler.write) {
			/*
			 * Read-only is the default and the interesting half of this design. A model that could
			 * `write rule://no-force-push` could edit the constraint that stops it force-pushing,
			 * and the edit would look like an ordinary tool call. Changing a rule goes through the
			 * filesystem, where the user's own review applies.
			 */
			throw new ResourceError(`\`${url.scheme}://\` 是只读的，不能写。`);
		}
		await handler.write(url, content, ctx);
	}

	async list(scheme: string, ctx: ResourceContext) {
		const handler = this.handlers.get(scheme);
		if (!handler?.list) return [];
		return handler.list(ctx);
	}

	private route(input: string): { url: ParsedUrl; handler: ResourceHandler } {
		const url = parseResourceUrl(input);
		if (!url) throw new ResourceError(`“${input}”不是一个地址。`);
		const handler = this.handlers.get(url.scheme);
		if (!handler) {
			const known = [...this.handlers.keys()].map((s) => `${s}://`).join("、");
			throw new ResourceError(`不认识 \`${url.scheme}://\`。现在可用的是：${known || "（没有）"}`);
		}
		return { url, handler };
	}
}

function sliceResource(resource: Resource, range: { from: number; to?: number }): Resource {
	const lines = resource.content.split("\n");
	const from = Math.max(1, range.from);
	const to = Math.min(lines.length, range.to ?? range.from);
	return { ...resource, content: lines.slice(from - 1, to).join("\n") };
}

/**
 * Resolve `child` under `root`, or null if it escapes.
 *
 * Uses `path.relative` rather than comparing string prefixes. `plugins/loader.ts` carries the note
 * from the time this was written the other way: joining `` `${root}/` `` and testing `startsWith`
 * misjudged every path on Windows, where the separator in the constructed prefix and the one in
 * the real path disagree.
 */
export function resolveInside(root: string, child: string): string | null {
	if (isAbsolute(child)) return null;
	const resolved = resolvePath(root, child);
	const step = relative(resolvePath(root), resolved);
	if (step !== "" && (step.startsWith("..") || isAbsolute(step))) return null;
	return resolved;
}

/**
 * The same check again after following symlinks.
 *
 * `resolveInside` is defeated by a symlink inside the root that points out of it: the textual path
 * never leaves, and the read does. Called separately because it costs a syscall and only matters
 * where the root holds files the user did not write.
 */
export async function stillInside(root: string, resolved: string): Promise<boolean> {
	const [realRoot, realChild] = await Promise.all([
		realpath(root).catch(() => root),
		realpath(resolved).catch(() => resolved),
	]);
	const step = relative(realRoot, realChild);
	return step === "" || (!step.startsWith("..") && !isAbsolute(step));
}
