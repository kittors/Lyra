/**
 * A provider's initial on a tinted square, so the list has something to line up on.
 *
 * Providers are relays and gateways named whatever their owner liked — 「公司」, `commandcode` — so
 * there is no brand to look up the way `ModelIcon` does for models. A letter is what is left, and
 * the hue is derived from the name so the same provider keeps its colour across restarts.
 *
 * The text colour is mixed toward `ink` rather than picked per theme: ink is dark on a light theme
 * and light on a dark one, so one expression stays readable on both.
 */

export function ProviderAvatar({ name, size, className = "" }: { name: string; size: "sm" | "lg"; className?: string }) {
	const hue = [...name].reduce((sum, char) => (sum * 31 + (char.codePointAt(0) ?? 0)) % 360, 7);
	const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
	return (
		<span
			aria-hidden
			className={`grid shrink-0 place-items-center font-semibold ${
				size === "sm" ? "h-5 w-5 rounded-[6px] text-[11px]" : "h-9 w-9 rounded-[10px] text-title"
			} ${className}`}
			style={{
				background: `hsl(${hue} 65% 52% / 0.14)`,
				color: `color-mix(in srgb, hsl(${hue} 65% 52%) 72%, var(--color-ink))`,
			}}
		>
			{initial}
		</span>
	);
}
