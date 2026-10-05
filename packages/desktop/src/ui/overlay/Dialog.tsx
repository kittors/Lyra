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

/**
 * 对话框底下的那一颗按钮。上面写着它会做的那件事。
 *
 * **写字，不画图标。** 这些按钮曾经有好几处只放一个 ✕ 和一个 ✓，名字挂在 tooltip 上。工具栏
 * 里的图标按钮可以这么省——周围一排东西替它说明它属于哪一类；对话框底下这两颗没有这个周围，
 * 它们是这次操作的结论本身，一个要说清按下去会发生什么，另一个要说清不按会怎样。一个勾在
 * 「删除会话」「卸载插件」「导入 33 个模型」上长得一模一样，而读出区别的唯一办法是把鼠标停
 * 上去等一个 tooltip——这正是一个「停下一切来问」的界面最不该要求的动作。
 *
 * `label` 留着，但只当 tooltip 用：可见的字已经是它的名字了。
 */
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
	bodyClassName,
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
	/**
	 * How tall the scrolling body may grow. Only for the dialogs that are a form rather than a
	 * question — the default is sized for a paragraph and a list, and a settings form under it
	 * scrolls three fields at a time.
	 */
	bodyClassName?: string;
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
			<div className="shrink-0 px-5 pt-5">
				<h2 className="flex items-center gap-2.5 text-label font-medium text-ink" data-dialog-title>
					{icon}
					{title}
				</h2>
				{detail ? <div className="mt-3 text-label leading-relaxed text-ink-muted">{detail}</div> : null}
			</div>
			{(status || children) ? (
				<div className={`flex min-h-0 flex-col px-5 pt-4 ${locked ? "flex-1" : ""}`}>
					{status}
					{children ? (
						/*
						 * The scroll area reaches into the margins on both sides, and the viewport takes them back
						 * with the same inset.
						 *
						 * The thumb is laid over the content (see `Scroller`), and the content's right edge used to
						 * be the scroll area's right edge — so the right-aligned column sat exactly under the thumb:
						 * the 「200K」 at the end of each row in the fetch-models dialog lost half a character to it.
						 *
						 * Not a right inset on the viewport as menus have (`.ly-menu-scroll`): that would make the
						 * list narrower than the status row above it, and the right-aligned column would stop lining
						 * up with 「全选」. Reaching out and taking it back leaves the content's position and width
						 * unchanged, nothing reflows with or without a scrollbar, and the thumb lands in the right
						 * margin. Both sides, because the fills and focus rings that rows and controls draw wider
						 * than their text used to be clipped by the scroll area to the content box; now either side
						 * can draw them.
						 *
						 * It reaches out by exactly the whole margin (20): the thumb is 2px from the card's edge,
						 * and 2px remain between it and the 10px a row's fill extends past the text.
						 */
						<Scroller
							top="fade"
							bottom="fade"
							className={`-mx-5 ${locked ? "min-h-0 flex-1" : bodyClassName ?? "max-h-[min(420px,50dvh)]"}`}
							contentClassName={`px-5 ${status ? "pt-3 pb-1" : "pb-1"}`}
						>
							{children}
						</Scroller>
					) : null}
				</div>
			) : null}
			<div className="flex shrink-0 items-center gap-2 px-5 pt-5 pb-5" data-ly-dialog-actions>
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
