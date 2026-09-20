/**
 * The controls you type into or pick from.
 *
 * The dropdown is a popover rather than a native `<select>`: the native one draws its own list
 * with the system's fonts and colours, which on macOS is a panel that belongs to another program.
 * Everything else here exists so that a text field, a secret and a choice read as one family
 * rather than three.
 */

import { translate } from "../../i18n/translate.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { acceleratorLabel, composingKey, recordAccelerator } from "../../ui/keyboard.ts";
import { MENU_MAX_HEIGHT, MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";

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
		<Input
			{...rest}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			aria-invalid={invalid || undefined}
			data-ly-field=""
			className={`ly-field ${invalid ? "ly-field-invalid" : ""} ${mono ? "font-mono" : ""} ${numericClass(rest.inputMode)} ${className || "w-full"}`}
		/>
	);
}

/**
 * 一个装数字的框，字就站在框的中间。
 *
 * 文字是从左边读起的，所以文字框左对齐；一个数字不是读出来的，是看一眼就知道多大——它两边留白
 * 不一样宽的时候，一列这样的框看上去像没对齐。判断依据用 `inputMode` 而不是新加一个 prop：说
 * 「这里只输数字」的地方本来就得写它（软键盘要用），再加一个意思相同的开关，迟早会有一个字段
 * 只写了其中一个。
 */
function numericClass(inputMode: React.HTMLAttributes<HTMLElement>["inputMode"]): string {
	return inputMode === "numeric" || inputMode === "decimal" ? "text-center tabular-nums" : "";
}

export function SecretInput({
	value,
	onChange,
	onBlur,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	/**
	 * 失焦时的那一次，带着当前文本。
	 *
	 * 给防抖提交用：改完就切走的那次修改，等不到防抖的定时器。这里传的是值而不是事件，跟
	 * `onChange` 保持同一种形状——调用方不必知道底下是什么元素。
	 */
	onBlur?: (value: string) => void;
	placeholder?: string;
}) {
	const [visible, setVisible] = useState(false);
	return (
		/*
		 * 那只眼睛是这一行里的一件东西，不是浮在它上面的。
		 *
		 * 从前它 `absolute` 贴在右边，靠外层的 `pr-10` 给它空出位置——而那条 padding 从来没生效过：
		 * `.ly-field` 写的是 `padding: 0 16px` 这条合写，它在 `overlay.css` 里没有分层，而 Tailwind
		 * 的 `pr-10` 在 `@layer utilities` 里——未分层的样式一律压过分层的，跟谁写在后面无关。于是
		 * 输入框一路铺到距右边 16px，一把足够长的 key 打出来的圆点直接盖在眼睛上，看不清也点不准。
		 *
		 * 现在两者是同一条 flex 的两个孩子：位置由排版算出来，不由一条可能被覆盖的 padding 让出来。
		 * 负的右外边距把它从 16px 的内衬里拉回 6px——`margin` 不在那条合写里，没有同一个坑。
		 */
		<div className="ly-field w-full gap-1.5" data-ly-field="">
			<Input
				type={visible ? "text" : "password"}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
				placeholder={placeholder}
				spellCheck={false}
				autoComplete="off"
				data-ly-secret-input=""
				className="h-full min-w-0 flex-1 bg-transparent tracking-wide text-ink placeholder:text-ink-faint"
			/>
			<button
				type="button"
				data-ly-tip={translate(visible ? "common.hide" : "common.show")}
				data-ly-secret-toggle=""
				onClick={() => setVisible((v) => !v)}
				className="-mr-1.5 flex size-[26px] shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
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
				data-ly-field=""
				data-ly-select=""
				className={`ly-field justify-between gap-2 ${field ? "w-full" : ""}`}
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
				<Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="end" width="default" maxHeight={MENU_MAX_HEIGHT}>
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
	placeholder,
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
			/*
			 * 框里的字是**现在绑的那组键**，不是这个控件叫什么。
			 *
			 * 「⌥ A」对读屏来说是两个符号，听不出这是一个能改的快捷键；名字得另外给。给了之后，
			 * 「这颗按钮上的字要不要换成图标」也就有了答案——它根本不是标签，换掉就没内容了。
			 */
			aria-label={translate("shortcut.press")}
			onClick={() => setRecording(true)}
			onBlur={() => setRecording(false)}
			onKeyDown={handleKeyDown}
			className={`ly-field min-w-[140px] justify-center gap-1.5 font-mono ${
				recording
					? "bg-accent/10 text-accent"
					: value
						? ""
						: "text-ink-muted"
			}`}
		>
			<span>{recording ? translate("shortcut.pressHint") : value ? acceleratorLabel(value) : (placeholder ?? translate("shortcut.press"))}</span>
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
