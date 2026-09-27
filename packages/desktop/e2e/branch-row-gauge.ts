/**
 * The page side of `branch-row-hover-probe.ts`: what a branch row painted, read inside the window.
 *
 * Its own file because it runs somewhere else. `install` is serialised with `toString()` and
 * evaluated in the renderer, so it must not close over anything in this module; the types are what
 * the probe gets back across the debugger.
 *
 * The mask parser counts its colour stops against the colours in the string and throws on a
 * mismatch: a stop it failed to read would not show up as "unmeasured" but as a plausible wrong x.
 */

export type Read = {
	top: number;
	bottom: number;
	current: boolean;
	tagLeft: number | null;
	box: { left: number; right: number };
	textWidth: number;
	offset: number;
	strip: { left: number; covered: number; buttons: number } | null;
	maskEnd: number;
	alphaAtTextEnd: number;
	fit: string | null;
	controls: string;
	hovered: boolean;
};
export type Frame = Read & { t: number };
export type Point = { x: number; y: number; lands: boolean };

export function install(): true {
	type Stop = { alpha: number; at: number };
	const r1 = (v: number) => Math.round(v * 10) / 10;
	const NUM = String.raw`-?\d*\.?\d+(?:[eE][-+]?\d+)?`;
	const STOP = new RegExp(String.raw`(rgba?\([^)]*\))\s+(?:calc\(100% - (${NUM})px\)|(${NUM})%|(${NUM})px)`, "g");
	const stops = (el: HTMLElement): Stop[] => {
		const css = getComputedStyle(el).maskImage;
		if (!css || css === "none") return [];
		const out = [...css.matchAll(STOP)].map((hit) => {
			const channels = (hit[1].match(/-?[\d.]+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
			const at = hit[2] !== undefined ? el.clientWidth - Number(hit[2]) : hit[3] !== undefined ? (el.clientWidth * Number(hit[3])) / 100 : Number(hit[4]);
			return { alpha: channels.length > 3 ? channels[3] : 1, at };
		});
		if (out.length !== (css.match(/rgba?\(/g) ?? []).length) throw new Error(`mask stops missed: ${css.slice(0, 300)}`);
		return out.sort((a, b) => a.at - b.at);
	};
	const alphaAt = (list: Stop[], x: number) => {
		if (list.length === 0) return 1;
		if (x <= list[0].at) return list[0].alpha;
		for (let i = 0; i < list.length - 1; i++) {
			const lo = list[i];
			const hi = list[i + 1];
			if (hi.at > lo.at && x >= lo.at && x <= hi.at) return lo.alpha + ((hi.alpha - lo.alpha) * (x - lo.at)) / (hi.at - lo.at);
		}
		return list[list.length - 1].alpha;
	};
	const NAME = ".ly-fade-tail > span > span:not([data-ly-scroll-dup])";
	const find = (name: string) =>
		[...document.querySelectorAll<HTMLElement>('[data-dock-pane="review"] [data-ly-hover-row]')].find((row) => row.querySelector(NAME)?.textContent === name) ?? null;
	const read = (row: HTMLElement) => {
		const title = row.querySelector<HTMLElement>(".ly-fade-tail") as HTMLElement;
		const body = row.querySelector<HTMLElement>(NAME) as HTMLElement;
		const tag = row.querySelector<HTMLElement>("[data-ly-branch-name] > :last-child");
		const strip = row.querySelector<HTMLElement>("[data-ly-hover-reveal]")?.getBoundingClientRect();
		const tb = title.getBoundingClientRect();
		const bb = body.getBoundingClientRect();
		const list = stops(title);
		let visibleTo = 0;
		for (let x = 0; x <= title.clientWidth; x += 0.5) if (alphaAt(list, x) > 0.02) visibleTo = x;
		return {
			top: r1(row.getBoundingClientRect().top),
			bottom: r1(row.getBoundingClientRect().bottom),
			current: Boolean(tag && tag !== title),
			tagLeft: tag && tag !== title ? r1(tag.getBoundingClientRect().left) : null,
			box: { left: r1(tb.left), right: r1(tb.right) },
			textWidth: body.offsetWidth,
			offset: r1(bb.left - tb.left),
			// `covered` rounds the raw overlap exactly as HoverRowReveal does, so the two compare as strings.
			strip: strip ? { left: r1(strip.left), covered: Math.max(0, Math.round(tb.right - strip.left)), buttons: row.querySelectorAll("[data-ly-hover-reveal] button").length } : null,
			// The last x at which the mask still shows anything: where the name dissolves, wherever the text has scrolled.
			maskEnd: r1(tb.left + visibleTo),
			alphaAtTextEnd: r1(alphaAt(list, Math.min(bb.right - tb.left - 1, title.clientWidth))),
			fit: title.getAttribute("data-ly-scroll-fit"),
			controls: getComputedStyle(row).getPropertyValue("--ly-row-controls").trim(),
			hovered: row.matches(":hover"),
		};
	};
	const store = window as unknown as Record<string, unknown>;
	store.__lyBranch = {
		names: () => [...document.querySelectorAll(`[data-dock-pane="review"] [data-ly-hover-row] ${NAME}`)].map((el) => el.textContent),
		read: (name: string) => {
			const row = find(name);
			return row ? read(row) : null;
		},
		point: (name: string, what: "name" | "switch") => {
			const row = find(name);
			const el = what === "name" ? row?.querySelector(".ly-fade-tail") : row?.querySelector("[data-ly-hover-reveal] button:last-child");
			if (!el) return null;
			const b = el.getBoundingClientRect();
			// On the name and well clear of the strip, so the pointer never rests on a button.
			const x = what === "name" ? b.left + Math.min(40, b.width * 0.3) : b.left + b.width / 2;
			const y = b.top + b.height / 2;
			return { x: Math.round(x), y: Math.round(y), lands: el.contains(document.elementFromPoint(x, y)) };
		},
		track: (name: string, frames: number) => {
			const row = find(name);
			if (!row) return false;
			const log: object[] = [];
			store.__lyBranchTrack = log;
			const t0 = performance.now();
			let n = 0;
			const tick = () => {
				// Sampled after the frame renders: a rAF callback runs before layout and the ResizeObservers.
				setTimeout(() => row.isConnected && log.push({ t: Math.round(performance.now() - t0), ...read(row) }), 0);
				if (++n < frames) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
			return true;
		},
		frames: () => store.__lyBranchTrack ?? [],
	};
	return true;
}
