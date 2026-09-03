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

import { Minus, Plus } from "lucide-react";
import { useRef, type JSX } from "react";

import { InlineSelect } from "./inputs.tsx";

/**
 * A slider whose track and handle are ours.
 *
 * The native input stays on top at zero opacity, so every interaction — drag, click-to-jump, arrow
 * keys, page up/down — is the browser's own, and the drawn part underneath only follows `value`.
 */
export function Slider({
	value,
	onChange,
	min = 0,
	max = 100,
	step = 1,
	width = 180,
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
	const ratio = max === min ? 0 : (value - min) / (max - min);

	return (
		<div className="relative h-[18px]" style={{ width }}>
			{/* Track, and the part of it behind the handle. */}
			<div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 overflow-hidden rounded-full bg-line">
				<div
					className="h-full rounded-full bg-info"
					style={{ width: `${ratio * 100}%`, transition: "width var(--ly-t-quick) var(--ly-e-out)" }}
				/>
			</div>

			{/*
			 * Inset by half the handle so its centre lands on the ends of the track rather than its
			 * edge hanging past them — the same `calc` EffortMenu uses, for the same reason.
			 */}
			<div
				className="ly-knob pointer-events-none absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border"
				style={{ left: `calc(7px + ${ratio} * (100% - 14px))`, transition: "left var(--ly-t-quick) var(--ly-e-out)" }}
			/>

			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				aria-label={label}
				onChange={(event) => onChange(Number(event.target.value))}
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
			<input
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
