/**
 * The controls you type into or pick from.
 *
 * The dropdown is a popover rather than a native `<select>`: the native one draws its own list
 * with the system's fonts and colours, which on macOS is a panel that belongs to another program.
 * Everything else here exists so that a text field, a secret and a choice read as one family
 * rather than three.
 */

import { Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { acceleratorLabel, composingKey, recordAccelerator } from "../../ui/keyboard.ts";
import { MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";

export function TextInput({
	value,
	onChange,
	placeholder,
	mono,
	invalid,
	className = "",
	...rest
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	mono?: boolean;
	invalid?: boolean;
	className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className">) {
	return (
		<input
			{...rest}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			className={`h-[38px] rounded-[10px] border bg-input px-3.5 text-label text-ink placeholder:text-ink-faint focus:border-ink-faint ${
				invalid ? "border-danger/60" : "border-line"
			} ${mono ? "font-mono text-label" : ""} ${className || "w-full"}`}
		/>
	);
}

export function SecretInput({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<input
				type={visible ? "text" : "password"}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				spellCheck={false}
				autoComplete="off"
				className="h-[38px] w-full rounded-[10px] border border-line bg-input pr-10 pl-3.5 text-label tracking-wide text-ink placeholder:text-ink-faint focus:border-ink-faint"
			/>
			<button
				type="button"
				data-ly-tip={visible ? "隐藏" : "显示"}
				onClick={() => setVisible((v) => !v)}
				className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-faint transition-colors hover:text-ink"
			>
				{visible ? <EyeOff size={15} strokeWidth={1.8} /> : <Eye size={15} strokeWidth={1.8} />}
			</button>
		</div>
	);
}

/**
 * A dropdown, built from the app's own popover rather than from `<select>`.
 *
 * The native control was the last thing here drawing itself with the platform's widgets: its
 * list is rendered by the OS, so it ignores the theme, the type scale and the corner radii, and
 * on macOS it opens as a panel that overlaps its own trigger. Everything else in the app that
 * offers a list of choices already goes through `Popover` — the model picker, the effort picker,
 * the branch menu — so this one does too, and inherits their keyboard handling and dismissal.
 */
function Dropdown<T extends string>({
	value,
	onChange,
	options,
	size,
	ariaLabel,
}: {
	value: T;
	onChange: (value: T) => void;
	options: { value: T; label: string; detail?: string; icon?: React.ReactNode }[];
	/** `field` fills a form row; `inline` is the compact one that sits at the end of a setting. */
	size: "field" | "inline";
	/** For a dropdown whose own label does not say what it is — two of them reading `09` and `30`. */
	ariaLabel?: string;
}) {
	const menu = usePopover();
	const current = options.find((option) => option.value === value);
	const field = size === "field";

	return (
		<>
			<button
				type="button"
				onClick={menu.toggle}
				aria-label={ariaLabel}
				aria-haspopup="menu"
				aria-expanded={menu.open}
				className={`flex items-center justify-between gap-2 border text-ink transition-colors ${
					field
						? "h-[38px] w-full rounded-[10px] border-line bg-input px-3.5 text-label"
						: "h-[30px] rounded-lg border-line bg-card px-3 text-label"
				} ${menu.open ? "border-ink-faint" : "hover:border-ink-faint"}`}
			>
				<span className="flex min-w-0 items-center gap-2">
					{current?.icon}
					<span className="min-w-0 truncate">{current?.label ?? value}</span>
				</span>
				<ChevronDown
					size={field ? 15 : 13}
					strokeWidth={1.9}
					className="shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)]"
					style={menu.open ? { transform: "rotate(180deg)" } : undefined}
				/>
			</button>

			{menu.open && (
				<Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="end" width="default">
					{/*
					 * The icon column is reserved for the whole list, not per row.
					 *
					 * These options carry an icon only where one could be found — the file-opener
					 * dropdown reads each application's own icon off the machine, and four of its seven
					 * are simply not installed. With the column collapsing on the rows that had none,
					 * their labels started 26px left of the rest and the menu read as two lists that
					 * had been stacked by accident.
					 */}
					<MenuBody insetIcons={options.some((option) => option.icon)}>
						{options.map((option) => (
							<MenuItem
								key={option.value}
								selected={option.value === value}
								detail={option.detail}
								icon={option.icon}
								trailing={
									option.value === value ? (
										<Check size={13} strokeWidth={2.2} className={`shrink-0 text-ink ${option.detail ? "mt-[3px]" : ""}`} />
									) : undefined
								}
								onClick={() => {
									onChange(option.value);
									menu.close();
								}}
							>
								{option.label}
							</MenuItem>
						))}
					</MenuBody>
				</Popover>
			)}
		</>
	);
}

/**
 * A shortcut recorder control that listens for key combinations.
 */
export function ShortcutRecorder({
	value,
	onChange,
	placeholder = "按下快捷键",
}: {
	value?: string;
	onChange: (shortcut: string) => void;
	placeholder?: string;
}) {
	const [recording, setRecording] = useState(false);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!recording) return;
		if (composingKey(e.nativeEvent)) return;
		e.preventDefault();
		e.stopPropagation();

		if (e.key === "Escape") {
			setRecording(false);
			return;
		}

		if (e.key === "Backspace" || e.key === "Delete") {
			onChange("");
			setRecording(false);
			return;
		}

		const result = recordAccelerator(e.nativeEvent);
		if (!result) return;
		onChange(result);
		setRecording(false);
	};

	return (
		<button
			type="button"
			onClick={() => setRecording(true)}
			onBlur={() => setRecording(false)}
			onKeyDown={handleKeyDown}
			className={`flex h-[32px] min-w-[140px] items-center justify-center gap-1.5 rounded-lg border px-3 text-label font-mono transition-colors duration-[var(--ly-t-quick)] ${
				recording
					? "border-accent bg-accent/10 text-accent ring-2 ring-accent/20 animate-pulse"
					: value
						? "border-line bg-card text-ink hover:border-ink-faint"
						: "border-dashed border-line bg-card/50 text-ink-muted hover:border-ink-faint"
			}`}
		>
			<span>{recording ? "请在键盘上按下快捷键..." : value ? acceleratorLabel(value) : placeholder}</span>
		</button>
	);
}

export function Select<T extends string>(props: {
	value: T;
	onChange: (value: T) => void;
	options: { value: T; label: string; detail?: string; icon?: React.ReactNode }[];
	ariaLabel?: string;
}) {
	return <Dropdown {...props} size="field" />;
}

/** Compact inline dropdown used in setting rows, matching the reference "Zed ˅" control. */
export function InlineSelect<T extends string>(props: {
	value: T;
	onChange: (value: T) => void;
	options: { value: T; label: string; detail?: string; icon?: React.ReactNode }[];
	ariaLabel?: string;
}) {
	return <Dropdown {...props} size="inline" />;
}
