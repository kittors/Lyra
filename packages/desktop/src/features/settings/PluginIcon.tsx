/**
 * A bundle's mark.
 *
 * Its own icon when it shipped one, and a mark saying what kind of thing it is when it did not.
 *
 * Three things stood here before. First the initial letter — a wall of lettered tiles is a wall of
 * squares you have to read, and `A` tells you nothing about AgentFlow that the word beside it did
 * not. Then a glyph guessed from the name on a colour hashed from the same name, which is better to
 * look at and worse to trust: it is *generated identity*, a plausible-looking mark that was never
 * chosen by anyone, and telling nine of them apart trains the eye on shapes that mean nothing. Then
 * one shared picture for everything without an icon, which was honest and said the same sentence to
 * a page of MCP servers, a page of plugins and a page of skills — all of which already knew what
 * they were looking at.
 *
 * What is here now says the one thing the app actually knows about a bundle with no icon: which of
 * the three kinds it is. That is a fact read off its contents, not a guess, and it is the same fact
 * the page is sorted by — so the mark agrees with the heading above it instead of competing with it.
 *
 * `brandColour` tints it when the entry declared one. That is not the hashed colour this replaced:
 * a hashed colour is invented here, a declared one was chosen by whoever published the entry and is
 * as much a part of what they shipped as the name. Where none was declared the mark stays grey,
 * which is the difference — nothing is being made up to fill the gap.
 */
import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import { Blocks, FileText, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { iconFit, type IconFit } from "./icon-fit.ts";

import type { BundleKind } from "@lyra/core";
import { bridge } from "../../services/index.ts";

/**
 * A colour we are willing to put in a stylesheet.
 *
 * `brandColor` comes out of a registry index — a JSON file written by someone else — and lands in a
 * `color-mix()` inside an inline style. Anything but a hex literal there is a string being pasted
 * into CSS, so the answer to `red; background: url(https://…)` is that it is not a colour and gets
 * no further. Short and long forms both, with alpha, because all of them are things people write.
 */
export function safeColour(raw: string | undefined): string | null {
	if (!raw) return null;
	return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw.trim()) ? raw.trim() : null;
}

/** Which glyph stands for each kind, and what it is called. Keys — this table is built at import. */
const MARKS: Record<BundleKind, { Glyph: typeof Blocks; label: MessageKey }> = {
	mcp: { Glyph: Server, label: "pluginIcon.mcp" },
	plugin: { Glyph: Blocks, label: "pluginIcon.plugin" },
	skill: { Glyph: FileText, label: "pluginIcon.skill" },
};

/**
 * A skill's mark, which is the same mark for every skill.
 *
 * A skill is a markdown file, not a product: it has no icon and never will, so anything that looks
 * like a logo is the wrong picture here — a list of eight skills became eight copies of the same
 * colourful square, which is a lot of ink spent saying "these are all skills" to someone who is
 * reading a list of skills.
 *
 * Quiet on purpose. It marks where the row starts and gives the name something to sit against;
 * anything more competes with the only part of the row that differs.
 */
export function SkillMark({ size = 30 }: { size?: number }) {
	return <KindMark kind="skill" size={size} />;
}

/**
 * The mark for a bundle that shipped no icon of its own.
 *
 * Shaped like a logo — same square, same corner radius, same place in the row — so a list that
 * mixes real icons with these does not go ragged where the icons run out. It is deliberately much
 * quieter than a real one: an icon somebody drew should win against a mark the app drew, every time.
 */
function KindMark({ kind, brandColor, size }: { kind: BundleKind; brandColor?: string; size: number }) {
	const { Glyph, label } = MARKS[kind] ?? MARKS.plugin;
	const name = translate(label);
	const colour = safeColour(brandColor);

	return (
		<span
			role="img"
			/*
			 * Named for a screen reader and silent to everyone else. No tooltip: the mark always sits
			 * beside the bundle's name, under a heading that already says which of the three kinds is
			 * being listed, so a hover saying translate("pluginIcon.mcp") is a third copy of something nobody asked.
			 */
			aria-label={name}
			style={{
				width: size,
				height: size,
				borderRadius: Math.round(size * 0.235),
				/*
				 * Mixed down, and graded rather than flat.
				 *
				 * Mixed because a brand colour is chosen to be legible against white, and a 38px tile
				 * of it beside eight quiet ones makes the loudest thing on the page whichever author
				 * filled in an optional field. Graded because a flat wash at 12% reads as a failed
				 * image — the same fallback the platform serves for entries with no icon at all, and
				 * these two have to look like one thing since they appear side by side in the same
				 * grid. The numbers match `placeholder()` in the registry's icon route.
				 */
				...(colour
					? {
							background: `linear-gradient(to bottom, color-mix(in srgb, ${colour} 16%, transparent), color-mix(in srgb, ${colour} 6%, transparent))`,
							borderColor: `color-mix(in srgb, ${colour} 22%, transparent)`,
							color: colour,
						}
					: {}),
			}}
			className={`flex shrink-0 items-center justify-center border ${
				colour ? "" : "border-line-soft bg-gradient-to-b from-card to-card/40 text-ink-faint"
			}`}
		>
			<Glyph size={Math.round(size * 0.42)} strokeWidth={1.7} />
		</span>
	);
}

/**
 * Pictures this window has resolved, by the URL they were asked for. Only successes: a failure is
 * asked again next time, when the network may have come back. The main process has its own cache
 * and does the real work; this one only saves the round trip that makes a remounted card flicker.
 */
const RESOLVED = new Map<string, string | null>();

/**
 * A remote logo, resolved to something the page is allowed to draw.
 *
 * `img-src` is `self data: blob:` and stays that way — see `registry:icon`. So a logo that is an
 * https URL cannot be put in a `src` directly: it renders as a broken image, which is worse than no
 * image at all because it looks like the app failed rather than like the entry has no icon. The main
 * process fetches it and hands back a data URL.
 *
 * Mostly unused for the catalogue now: `useCatalog` resolves those in one batch, because whether a
 * picture belongs to an entry at all is a question about the whole list — see `dropShared`. What is
 * left here is the single-URL case, for the callers that have a logo and no catalogue around them.
 *
 * Local sources — a data URL from a manifest, or a bundled asset — are used as they are.
 */
function useResolved(logo: string | undefined): string | null {
	const remote = logo?.startsWith("https://") ? logo : null;
	/*
	 * Started from what this window already resolved, not from nothing. Switching the market's tab
	 * mounts the grid afresh, and a card that has to ask again draws its placeholder for a frame and
	 * fades its logo back in — every card, every switch. Remembered here, a remounted card has its
	 * picture on the first frame.
	 */
	const [resolved, setResolved] = useState<string | null>(() => (remote ? (RESOLVED.get(remote) ?? null) : null));

	useEffect(() => {
		if (!remote) return setResolved(null);
		const known = RESOLVED.get(remote);
		if (known !== undefined) return setResolved(known);
		let alive = true;
		void bridge.plugins
			.icon(remote)
			.then((data) => {
				if (data) RESOLVED.set(remote, data);
				if (alive) setResolved(data);
			})
			.catch(() => alive && setResolved(null));
		return () => {
			alive = false;
		};
	}, [remote]);

	return remote ? resolved : (logo ?? null);
}


/**
 * A bundle's icon, or the mark for what it is.
 *
 * `name`, `id` and `category` are still accepted and ignored: they fed the generated mark two
 * versions ago and every call site still passes them. Removing them from the signature would be a
 * change to nine files that says nothing, and keeping them costs a line.
 */
export function PluginIcon({
	logo,
	brandColor,
	kind = "plugin",
	size = 32,
}: {
	name?: string;
	logo?: string;
	brandColor?: string;
	category?: string;
	id?: string;
	/** Which of the three things this is, so the mark can say so when there is no icon. */
	kind?: BundleKind;
	size?: number;
}) {
	const src = useResolved(logo);
	/*
	 * What the picture turned out to be once it loaded — a tile, or a glyph that needs a plate behind
	 * it (see `iconFit`) — keyed by the picture it describes. Until then the kind's mark stands in
	 * underneath and the picture fades in over it, rather than a blank square becoming a logo in one
	 * frame, or one frame of a full-size logo shrinking onto its plate.
	 */
	const [shown, setShown] = useState<{ src: string; fit: IconFit } | null>(null);
	const loaded = src !== null && shown?.src === src;
	const plate = loaded && shown.fit !== "tile" ? shown.fit : null;

	if (src) {
		const radius = Math.round(size * 0.28);
		const settle = (img: HTMLImageElement) => {
			if (!loaded) setShown({ src, fit: iconFit(img) });
		};
		return (
			<span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
				{!loaded && <KindMark kind={kind} brandColor={brandColor} size={size} />}
				{/*
				 * Fixed colours rather than theme tokens for the plate, on purpose: it exists so that
				 * the mark reads the same on both themes, which a plate that followed the theme would undo.
				 */}
				<span
					className={`absolute inset-0 flex items-center justify-center transition-opacity duration-[var(--ly-t-base)] ease-[var(--ly-e-out)] ${loaded ? "opacity-100" : "opacity-0"}`}
					style={{
						borderRadius: radius,
						...(plate === "light" ? { background: "#fff", boxShadow: "inset 0 0 0 1px rgb(15 23 42 / 0.1)" } : {}),
						...(plate === "dark" ? { background: "#1b1f24", boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.12)" } : {}),
					}}
				>
					<img
						// A picture already decoded — the same data URL on the next card — can be complete
						// before `onLoad` is attached, and then the event never comes.
						ref={(img) => {
							if (img?.complete && img.naturalWidth > 0) settle(img);
						}}
						src={src}
						alt=""
						width={plate ? Math.round(size * 0.68) : size}
						height={plate ? Math.round(size * 0.68) : size}
						/*
						 * Light whatever the window's theme. An SVG can carry its own
						 * `prefers-color-scheme: dark` rules, and in a dark window it turned its strokes
						 * white — on the white plate chosen for the dark strokes `iconFit` measured, so the
						 * logo vanished. The plate is fixed per picture; the picture has to be too.
						 */
						style={plate ? { colorScheme: "light" } : { borderRadius: radius, colorScheme: "light" }}
						className={plate ? "object-contain" : "object-cover"}
						onLoad={(event) => settle(event.currentTarget)}
					/>
				</span>
			</span>
		);
	}

	return <KindMark kind={kind} brandColor={brandColor} size={size} />;
}
