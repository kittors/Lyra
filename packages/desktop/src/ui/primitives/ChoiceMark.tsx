import { Check } from "lucide-react";

/**
 * The on/off mark this app draws for itself.
 *
 * A native checkbox takes the host OS's chrome: Aqua on macOS, Fluent on Windows, and neither
 * one matches the ink/accent cards around it. The plugin switch already learned this; the
 * question card was still shipping `accent-accent` inputs. One mark, two shapes.
 */
export function ChoiceMark({
	checked,
	kind,
	indeterminate = false,
	className = "",
}: {
	checked: boolean;
	kind: "checkbox" | "radio";
	indeterminate?: boolean;
	className?: string;
}) {
	const on = checked || indeterminate;
	if (kind === "radio") {
		return (
			<span
				aria-hidden
				data-ly-choice={on ? "on" : "off"}
				data-ly-choice-kind="radio"
				className={`grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-[var(--ly-t-quick)] ${on ? "border-accent" : "border-ink-faint/55 group-hover:border-ink-muted"} ${className}`}
			>
				<span className={`rounded-full bg-accent transition-transform duration-[var(--ly-t-quick)] ease-[var(--ly-e-out)] ${on ? "size-2 scale-100" : "size-2 scale-0"}`} />
			</span>
		);
	}
	return (
		<span
			aria-hidden
			data-ly-choice={indeterminate ? "mixed" : on ? "on" : "off"}
			data-ly-choice-kind="checkbox"
			className={`grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-[var(--ly-t-quick)] ${on ? "border-accent bg-accent text-shell" : "border-ink-faint/55 bg-card group-hover:border-ink-muted"} ${className}`}
		>
			{indeterminate ? <span className="h-0.5 w-2 rounded-full bg-shell" /> : <Check size={11} strokeWidth={2.6} className={`transition-opacity duration-[var(--ly-t-quick)] ${checked ? "opacity-100" : "opacity-0"}`} />}
		</span>
	);
}
