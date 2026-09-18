/**
 * The inside of a centred dialog: title, optional status, a fading body, actions.
 *
 * Overlay already owns the card — 22px corners, the scrim, Escape. Callers that rebuilt that
 * per feature invented a second radius and a hairline between the header and the buttons, and
 * the two no longer read as one family. This is the padding and the slots; it does not draw
 * a divider. A boundary here is empty space, the way the permission confirm already was.
 */

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { Overlay } from "./Overlay.tsx";
import { Scroller } from "../scroll/Scroller.tsx";

export function DialogAction({
	children,
	onClick,
	tone = "secondary",
	disabled,
	autoFocus,
	label,
	className = "",
	...rest
}: {
	children: ReactNode;
	onClick?: () => void;
	tone?: "secondary" | "primary" | "danger";
	disabled?: boolean;
	autoFocus?: boolean;
	/** Tooltip only. Visible text already names the button. */
	label?: string;
	className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick" | "type">) {
	const paint =
		tone === "danger"
			? "ly-dialog-action-danger"
			: tone === "primary"
				? "ly-dialog-action-primary"
				: "ly-dialog-action-secondary";
	return (
		<button
			type="button"
			disabled={disabled}
			autoFocus={autoFocus}
			onClick={onClick}
			data-ly-tip={label}
			className={`ly-dialog-action ${paint} disabled:opacity-40 ${className}`}
			{...rest}
		>
			{children}
		</button>
	);
}

export function DialogFrame({
	title,
	icon,
	detail,
	status,
	children,
	actions,
	height,
	className = "",
	...rest
}: {
	title: ReactNode;
	icon?: ReactNode;
	detail?: ReactNode;
	/** Sits in the body, above the scroll — progress, a warning, anything that must not scroll away. */
	status?: ReactNode;
	children?: ReactNode;
	actions: ReactNode;
	height?: number;
	className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "children">) {
	const locked = height !== undefined;
	return (
		<div
			data-ly-dialog
			style={locked ? { height } : undefined}
			className={`flex min-h-0 flex-col ${className}`}
			{...rest}
		>
			<div className="shrink-0 px-6 pt-6">
				<h2 className="flex items-center gap-2.5 text-body font-semibold text-ink" data-dialog-title>
					{icon}
					{title}
				</h2>
				{detail ? <div className="mt-3 text-label leading-relaxed text-ink-muted">{detail}</div> : null}
			</div>
			{(status || children) ? (
				<div className={`flex min-h-0 flex-col px-6 pt-4 ${locked ? "flex-1" : ""}`}>
					{status}
					{children ? (
						<Scroller
							top="fade"
							bottom="fade"
							className={locked ? "min-h-0 flex-1" : "max-h-[min(420px,50dvh)]"}
							contentClassName={status ? "pt-3 pb-1" : "pb-1"}
						>
							{children}
						</Scroller>
					) : null}
				</div>
			) : null}
			<div className="flex shrink-0 items-center gap-2 px-6 pt-5 pb-6" data-ly-dialog-actions>
				{actions}
			</div>
		</div>
	);
}

export function Dialog({
	onClose,
	width = 480,
	label,
	returnFocus,
	...frame
}: {
	onClose: () => void;
	width?: number;
	label?: string;
	returnFocus?: HTMLElement;
} & Parameters<typeof DialogFrame>[0]) {
	return (
		<Overlay onClose={onClose} width={width} label={label} returnFocus={returnFocus}>
			<DialogFrame {...frame} />
		</Overlay>
	);
}
