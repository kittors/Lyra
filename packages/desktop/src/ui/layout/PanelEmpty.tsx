import { translate } from "../../i18n/translate.ts";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { X } from "lucide-react";
import { Spinner } from "../motion/loaders.tsx";

/**
 * The middle of an empty panel body.
 *
 * Centred icon, name, one sentence saying what this is. The same shape for every kind of tab,
 * so the panel reads as one thing with several contents rather than as several unrelated
 * screens that happen to share a frame.
 *
 * Its own file because both the panel shell and the things inside it need it, and having the
 * shell export it made the two import each other.
 */
export function PanelEmpty({
	icon: Icon,
	title,
	children,
	action,
}: {
	icon: LucideIcon;
	title: string;
	children: React.ReactNode;
	/**
	 * The one thing to do from here, when there is one.
	 *
	 * An empty panel is not always the end of a road: a clean working tree with an unpushed commit
	 * is a state with an obvious next step, and having to go and find it in the toolbar is how that
	 * step gets missed. Optional because most empty states genuinely are the end — nothing to do is
	 * a perfectly good answer, and inventing a button for it would be worse than the silence.
	 *
	 * Kept at the right edge with the panel's other actions so the empty message remains quiet.
	 */
	action?: {
		icon: LucideIcon;
		label: string;
		onClick: () => void;
		disabled?: boolean;
		loading?: boolean;
		cancelLabel?: string;
	};
}) {
	const [hovered, setHovered] = useState(false);
	const isLoading = action?.loading ?? false;
	const ActionIcon = action?.icon;

	return (
		<div className={`relative flex min-h-0 flex-1 flex-col items-center justify-center px-7 pb-6 text-center ${action ? "pt-9" : ""}`}>
			<Icon size={30} strokeWidth={1.35} className="text-ink-faint" />
			<h2 className="mt-3.5 text-title font-medium text-ink">{title}</h2>
			<p className="mt-2 max-w-[290px] text-label leading-relaxed text-ink-muted">{children}</p>
			{action && (
				<button
					type="button"
					disabled={action.disabled && !isLoading}
					onClick={action.onClick}
					onMouseEnter={() => setHovered(true)}
					onMouseLeave={() => setHovered(false)}
					data-ly-tip={isLoading ? (action.cancelLabel ?? translate("panelEmpty.cancelAction", { action: action.label })) : undefined}
					aria-label={isLoading ? (action.cancelLabel ?? translate("panelEmpty.cancelAction", { action: action.label })) : action.label}
					className="absolute right-2.5 top-1.5 flex h-[26px] items-center justify-center gap-1.5 rounded-md px-2 text-detail font-medium text-ink-muted transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40"
				>
					{isLoading ? (
						hovered ? (
							<X size={13} strokeWidth={2.2} />
						) : (
							<Spinner size={13} />
						)
					) : (
						<>{ActionIcon && <ActionIcon size={13} strokeWidth={1.8} />}{action.label}</>
					)}
				</button>
			)}
		</div>
	);
}
