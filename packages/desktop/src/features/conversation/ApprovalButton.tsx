/**
 * A button on a card that is waiting for a decision: 拒绝, 允许一次, 提交.
 *
 * Words on the button, not in a tooltip — see `PermissionChoices` for why this card family spells
 * its answers out. The one to press is ink-filled; the rest are quiet until the pointer is on them.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function ApprovalButton({
	tone = "quiet",
	icon,
	children,
	className = "",
	...rest
}: {
	tone?: "quiet" | "primary";
	icon?: ReactNode;
	children: ReactNode;
	className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children" | "className">) {
	const paint =
		tone === "primary"
			? "bg-ink px-3 font-medium text-shell transition-opacity hover:opacity-90 active:opacity-75"
			: "px-2.5 text-ink-muted hover:bg-card-hover hover:text-ink active:bg-elevated";
	return (
		<button {...rest} type="button" className={`flex h-8 items-center gap-1.5 rounded-lg text-label transition-colors disabled:opacity-50 ${paint} ${className}`}>
			{icon}
			{children}
		</button>
	);
}
