/**
 * The settings pages' shared controls.
 *
 * Split by what you do with them — arrange (`layout`), type into (`inputs`), toggle or press
 * (here) — and re-exported so a page imports one thing rather than three.
 */


import { Button } from "../../ui/primitives/Button.tsx";

export * from "./inputs.tsx";
export * from "./layout.tsx";

/**
 * The switch used by every boolean setting.
 *
 * Both colours came from a hard-coded pair — an iOS blue and a dark grey — so it ignored the
 * accent the user picked and, on a light theme, showed a near-black track for "off" against a
 * pale card. The track now follows the theme in both states, and the knob reuses `.ly-knob`,
 * which is the same treatment the appearance sliders use: white with a hairline and a shadow so
 * it stays visible on a pale track, lightened on dark so it does not glare.
 */
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-[var(--ly-t-base)] ${
				checked ? "bg-accent" : "bg-line"
			}`}
		>
			<span
				className="ly-knob absolute top-[3px] h-4 w-4 rounded-full border transition-[left] duration-[var(--ly-t-base)]"
				style={{ left: checked ? 19 : 3 }}
			/>
		</button>
	);
}

export function Segmented<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (value: T) => void;
	options: { value: T; label: string }[];
}) {
	return (
		<div className="flex gap-0.5 rounded-lg bg-card p-0.5">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => onChange(option.value)}
					className={`h-[26px] rounded-md px-3 text-label transition-colors ${
						value === option.value ? "bg-elevated text-ink" : "text-ink-muted hover:text-ink"
					}`}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

export function Badge({ tone, children }: { tone: "ok" | "muted" | "danger" | "accent"; children: React.ReactNode }) {
	const tones = {
		ok: "bg-ok/15 text-ok",
		muted: "bg-card text-ink-faint",
		danger: "bg-danger/15 text-danger",
		accent: "bg-accent/15 text-accent",
	};
	return (
		<span className={`rounded-full px-2 py-0.5 text-detail leading-[18px] ${tones[tone]}`}>{children}</span>
	);
}

/**
 * The outlined button every settings page uses for a secondary action.
 *
 * Laid out as a flex row so an icon can sit beside the label — three pages had copied the class
 * list verbatim rather than use this, and one of them had drifted: a different height, and a
 * press animation the others did not have.
 */
/**
 * The two buttons this file used to define, now `Button` with a variant chosen.
 *
 * Kept as names rather than replaced at 40-odd call sites, because these two *are* the right words
 * at a settings page: `GhostButton` is the outlined one, `PrimaryButton` is the one to press. What
 * they no longer are is a second definition of what a button looks like — the height, the radius
 * and the press feedback come from `ui/primitives/Button.tsx` along with everything else's.
 */
export function GhostButton({
	children,
	icon,
	onClick,
	tone = "default",
	disabled,
	title,
}: {
	children?: React.ReactNode;
	icon?: React.ReactNode;
	onClick: () => void;
	tone?: "default" | "danger";
	disabled?: boolean;
	title?: string;
}) {
	return (
		<Button
			variant={tone === "danger" ? "danger" : "ghost"}
			icon={icon}
			onClick={onClick}
			disabled={disabled}
			label={title}
		>
			{children}
		</Button>
	);
}

export function PrimaryButton({
	children,
	onClick,
	disabled,
	className = "",
}: {
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<Button variant="primary" onClick={onClick} disabled={disabled} className={className}>
			{children}
		</Button>
	);
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
	return <p className="px-4 py-10 text-center text-label leading-relaxed text-ink-faint">{children}</p>;
}
