/**
 * The three controls only the appearance page has: a colour, a number, a theme thumbnail.
 *
 * A colour is edited as text and applied only once it parses, so a half-typed `#33` does not
 * repaint the window on the way to `#339CFF`. The thumbnail is drawn rather than screenshotted —
 * it has to keep working when the accent colour is one the user just typed.
 */

import { useEffect, useState } from "react";
import { NumberField } from "./pickers.tsx";
import { contrastingInk, parseHex } from "../../lib/theme.ts";

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	const [draft, setDraft] = useState(value);
	const valid = parseHex(draft) !== null;

	// Switching theme swaps which colour this row edits. Without this the field kept showing
	// the dark value after switching to light, since useState only seeds on first render.
	// The case-insensitive compare keeps the user's own typing from being rewritten mid-edit.
	useEffect(() => {
		setDraft((current) => (current.toUpperCase() === value.toUpperCase() ? current : value));
	}, [value]);

	return (
		<div className="flex items-center justify-between border-b border-line-soft px-4 py-3 last:border-b-0">
			<span className="text-body text-ink">{label}</span>
			<label
				className="flex h-[30px] cursor-pointer items-center gap-2 rounded-lg px-2.5 transition-colors"
				style={{ background: valid ? draft : "transparent", color: valid ? contrastingInk(draft) : undefined }}
			>
				<span className="h-3.5 w-3.5 rounded-full border border-current opacity-60" />
				<input
					value={draft}
					onChange={(e) => {
						setDraft(e.target.value);
						// Apply as soon as it parses, so dragging through values previews live.
						if (parseHex(e.target.value)) onChange(e.target.value.toUpperCase());
					}}
					onBlur={() => !valid && setDraft(value)}
					spellCheck={false}
					className={`w-[74px] bg-transparent font-mono text-label tracking-wide ${valid ? "" : "text-danger"}`}
				/>
			</label>
		</div>
	);
}

/** A size in pixels: the shared number field, plus the unit it is always in. */
export function PixelField({
	value,
	min,
	max,
	onChange,
	label,
}: {
	value: number;
	min: number;
	max: number;
	onChange: (value: number) => void;
	label: string;
}) {
	return (
		<div className="flex items-center gap-2">
			<NumberField value={value} min={min} max={max} onChange={onChange} label={label} width={64} />
			<span className="text-detail text-ink-faint">px</span>
		</div>
	);
}

/** Miniature of the app shell, so each theme option is recognisable at a glance. */
export function ThemePreview({ variant, accent }: { variant: "system" | "light" | "dark"; accent: string }) {
	const light = { shell: "#f5f5f5", card: "#ffffff", bar: "#e2e2e2", line: "#d6d6d6" };
	const dark = { shell: "#2b2b2b", card: "#1d1d1d", bar: "#3a3a3a", line: "#454545" };

	// A function that returns markup, not a component: it is called, never mounted, so React
	// never remounts its subtree — which is what defining a component inside render would cost.
	const half = (c: typeof light, clip?: string) => (
		<g clipPath={clip}>
			<rect x="0" y="0" width="120" height="80" fill={c.shell} />
			<rect x="0" y="0" width="40" height="80" fill={c.bar} />
			<rect x="46" y="10" width="64" height="5" rx="2.5" fill={c.line} />
			<rect x="46" y="22" width="64" height="48" rx="5" fill={c.card} />
			<rect x="52" y="30" width="34" height="4" rx="2" fill={c.line} />
			<rect x="52" y="40" width="46" height="4" rx="2" fill={c.line} />
			<rect x="52" y="50" width="28" height="4" rx="2" fill={accent} opacity="0.85" />
		</g>
	);

	return (
		<svg viewBox="0 0 120 80" className="w-full rounded-[7px]" aria-hidden>
			<defs>
				<clipPath id={`ly-half-${variant}`}>
					<rect x="0" y="0" width="60" height="80" />
				</clipPath>
			</defs>
			{variant === "light" && half(light)}
			{variant === "dark" && half(dark)}
			{variant === "system" && (
				<>
					{half(dark)}
					{half(light, `url(#ly-half-${variant})`)}
				</>
			)}
		</svg>
	);
}
