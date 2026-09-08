/**
 * The controls that pick a number or a time.
 *
 * Each of these replaces an `<input>` whose widget the platform draws: a range's thumb, a number's
 * spinner, a time field's clock. Styling reaches none of them — `appearance: none` takes away the
 * track and leaves the thumb, and a time input's picker is a panel belonging to the browser — so
 * they arrive in whatever shape and colour the OS chose, next to controls the app drew itself.
 *
 * The pattern is the one `EffortMenu` already uses: keep the native element for its behaviour and
 * its accessibility, make it invisible, and draw the part you can see. That is deliberately not the
 * same as replacing it with `<div>`s — the range still gives arrow keys, Home/End and a real
 * `aria-valuenow`, none of which is worth reimplementing badly.
 */

import { Input } from "../../ui/inputs/NativeField.tsx";
import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type JSX } from "react";

import { InlineSelect } from "./inputs.tsx";

/**
 * A slider whose track and handle are ours.
 *
 * The native input stays on top at zero opacity, so every interaction — drag, click-to-jump, arrow
 * keys, page up/down — is the browser's own, and the drawn part underneath only follows `value`.
 *
 * `onCommit` is for the callers whose `onChange` is expensive. A settings slider's value goes to
 * the main process, gets written to disk and comes back; doing that once per notch turns a drag
 * into a queue of round trips. Those callers keep the cheap half in `onChange` — the preview, the
 * readout — and put the write in `onCommit`, which fires on the range's own `change`: once per
 * decision, not once per notch.
 */
export function Slider({
	value,
	onChange,
	onCommit,
	min = 0,
	max = 100,
	step = 1,
	width = 180,
	label,
}: {
	value: number;
	onChange: (value: number) => void;
	/** Called on the range's own `change` — the drag let go, the track clicked, a key pressed. */
	onCommit?: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	width?: number;
	label: string;
}): JSX.Element {
	/*
	 * 拖动中先认自己刚给出的值，不等 `value` 从外面回来。
	 *
	 * 这是个受控 input：`value` 来自设置，而设置要走一趟主进程——存盘、通知、再回来。那一趟没
	 * 回来之前，每一次重渲染都会按旧的 `value` 把 DOM 复位一次，于是拖动变成「往前一点、弹回
	 * 去、再跳过来」。实测拖一次 1 → 10，十二帧里有九帧显示的是落后一两格的旧值。
	 *
	 * 外面追上来了就把控制权交还——两个数汇合，草稿作废。松手之后它们必然会汇合，所以这里不需要
	 * 另一个「什么时候清掉」的时机。
	 */
	const [draft, setDraft] = useState<number | null>(null);
	const [dragging, setDragging] = useState(false);
	if (draft !== null && draft === value) setDraft(null);
	const shown = draft ?? value;
	const ratio = max === min ? 0 : (shown - min) / (max - min);
	/*
	 * 拖动时不做缓动。
	 *
	 * 150ms 的过渡对「点一下轨道跳过去」是对的，对拖动是错的：手指每一帧都给一个新位置，把手却
	 * 每一帧都从头开始爬一段 150ms 的曲线，永远停在光标后面。手上感觉不是「慢」，是「黏」。
	 */
	const glide = dragging ? "none" : "var(--ly-t-quick) var(--ly-e-out)";

	/*
	 * 「选定了」这个信号，用滑条自己的 `change`。
	 *
	 * range 的 `input` 是拖动途中每一格都发，`change` 只在松手、点轨道、按方向键这些「这一下算
	 * 数了」的时刻发一次——落盘要挂的正是后者。自己拿 `pointerup` 拼一个也能对付鼠标，但会漏掉
	 * 键盘，也漏掉浏览器在失焦时补发的那一次。React 把 `onChange` 接到了原生的 `input` 上，所以
	 * 真的 `change` 只能自己听。
	 *
	 * 挂一次就不再重挂：回调从 ref 里现取，省得每次渲染都拆装一遍监听。
	 *
	 * 这里**不加**「值变了吗」的守卫。滑条自己已经守过了——原生 `change` 只在值确实动过之后才
	 * 发，点回原处不发。而这里能拿来比的 `value` 早已经是拖动中的草稿值（调用方把草稿喂回来画
	 * 预览），拿它比就永远相等，于是一次也提交不出去：预览跟着滑，读数跟着滑，磁盘上一动不动。
	 */
	const field = useRef<HTMLInputElement>(null);
	const latest = useRef(onCommit);
	latest.current = onCommit;
	useEffect(() => {
		const el = field.current;
		if (!el) return;
		const commit = () => latest.current?.(Number(el.value));
		el.addEventListener("change", commit);
		return () => el.removeEventListener("change", commit);
	}, []);

	return (
		<div className="relative h-[18px]" style={{ width }}>
			{/* Track, and the part of it behind the handle. */}
			<div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 overflow-hidden rounded-full bg-line">
				<div
					className="h-full rounded-full bg-info"
					style={{ width: `${ratio * 100}%`, transition: `width ${glide}` }}
				/>
			</div>

			{/*
			 * Inset by half the handle so its centre lands on the ends of the track rather than its
			 * edge hanging past them — the same `calc` EffortMenu uses, for the same reason.
			 */}
			<div
				className="ly-knob pointer-events-none absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border"
				style={{ left: `calc(7px + ${ratio} * (100% - 14px))`, transition: `left ${glide}` }}
			/>

			<input
				ref={field}
				type="range"
				min={min}
				max={max}
				step={step}
				value={shown}
				aria-label={label}
				onChange={(event) => {
					const next = Number(event.target.value);
					setDraft(next);
					onChange(next);
				}}
				/*
				 * `pointerdown` 而不是 `mousedown`：触摸板和触摸屏走的是同一个事件。键盘到不了这里，
				 * 所以按方向键时把手照旧带着缓动挪过去——那正是它该有的样子。
				 */
				onPointerDown={() => setDragging(true)}
				onPointerUp={() => setDragging(false)}
				onPointerCancel={() => setDragging(false)}
				className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
			/>
		</div>
	);
}

/**
 * A number field with steppers the app drew.
 *
 * `type="text"` with a numeric keypad hint rather than `type="number"`: the latter draws a spinner
 * that differs in every browser, and it reports an empty string for input it considers invalid, so
 * `1e5` and `--3` arrive as "nothing typed" while looking like they were accepted.
 */
export function NumberField({
	value,
	onChange,
	min = Number.NEGATIVE_INFINITY,
	max = Number.POSITIVE_INFINITY,
	step = 1,
	width = 76,
	label,
}: {
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	width?: number;
	label: string;
}): JSX.Element {
	const clamp = (next: number) => Math.min(max, Math.max(min, next));
	/*
	 * How many decimals this field accepts, taken from its own step.
	 *
	 * This used to be `Math.trunc`, unconditionally, which is right for a font size and silently
	 * destroys the two fields whose step is a fraction: typing 1.8 into 行高 stored 1, and 字距
	 * — whose entire range is -0.1 to 0.2 — could only ever be set to 0. Both looked like the
	 * setting having no effect, because the value that reached the app was not the one typed.
	 *
	 * From `step` rather than a flag, since the step already says what the field's resolution is.
	 */
	const decimals = (String(step).split(".")[1] ?? "").length;
	const round = (next: number) => (decimals === 0 ? Math.trunc(next) : Number(next.toFixed(decimals)));

	return (
		<div
			className="flex h-[30px] items-center rounded-lg border border-line bg-input focus-within:border-ink-faint"
			style={{ width }}
		>
			<Input
				type="text"
				inputMode="numeric"
				value={String(value)}
				aria-label={label}
				onChange={(event) => {
					const text = event.target.value.trim();
					// An empty box is the minimum rather than a refused keystroke: refusing it makes the
					// field impossible to clear, since selecting all and typing passes through "".
					if (text === "" || text === "-") return onChange(clamp(0));
					const parsed = Number(text);
					if (Number.isFinite(parsed)) onChange(clamp(round(parsed)));
				}}
				onKeyDown={(event) => {
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					// Rounded, or 1.6 + 0.1 arrives as 1.7000000000000002 and the box shows all of it.
					onChange(clamp(round(value + (event.key === "ArrowUp" ? step : -step))));
				}}
				className="w-full min-w-0 bg-transparent px-2 text-center font-mono text-label text-ink"
			/>
			<div className="flex shrink-0 flex-col pr-[3px]">
				<Stepper label={`${label}：增加`} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
					<Plus size={10} strokeWidth={2.4} />
				</Stepper>
				<Stepper label={`${label}：减少`} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
					<Minus size={10} strokeWidth={2.4} />
				</Stepper>
			</div>
		</div>
	);
}

function Stepper({
	children,
	label,
	disabled,
	onClick,
}: {
	children: JSX.Element;
	label: string;
	disabled: boolean;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className="flex h-[11px] w-[16px] items-center justify-center rounded-[3px] text-ink-faint transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
		>
			{children}
		</button>
	);
}

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
	value: String(hour).padStart(2, "0"),
	label: String(hour).padStart(2, "0"),
}));
const MINUTES = Array.from({ length: 60 }, (_, minute) => ({
	value: String(minute).padStart(2, "0"),
	label: String(minute).padStart(2, "0"),
}));

/**
 * A time, as two lists rather than a browser's clock.
 *
 * `<input type="time">` renders a field whose segments, separator and picker panel all belong to
 * the platform: on macOS it is a stepper, on Windows a dropdown, on Android a dial. It also parses
 * and formats according to the OS locale, so the same task can read `09:00` on one machine and
 * `9:00 AM` on another while storing the same string.
 *
 * Two lists remove all of that and remove typing as well, which suits what this is for: a task runs
 * at a chosen hour and minute, and there is no value outside 00:00–23:59 to express.
 */
export function TimeField({
	value,
	onChange,
	label,
}: {
	/** `HH:mm`, the same 24-hour string the scheduler stores. */
	value: string;
	onChange: (value: string) => void;
	label: string;
}): JSX.Element {
	// A malformed or empty stored value shows as 00:00 rather than as an empty control.
	const [hour = "00", minute = "00"] = /^\d{2}:\d{2}$/.test(value) ? value.split(":") : ["00", "00"];
	const last = useRef({ hour, minute });
	last.current = { hour, minute };

	return (
		<div className="flex items-center gap-1">
			<InlineSelect
				value={hour}
				options={HOURS}
				onChange={(next) => onChange(`${next}:${last.current.minute}`)}
				ariaLabel={`${label}：小时`}
			/>
			<span className="text-label text-ink-faint">:</span>
			<InlineSelect
				value={minute}
				options={MINUTES}
				onChange={(next) => onChange(`${last.current.hour}:${next}`)}
				ariaLabel={`${label}：分钟`}
			/>
		</div>
	);
}
