/**
 * The settings pages' shared controls.
 *
 * Split by what you do with them — arrange (`layout`), type into (`inputs`), toggle or press
 * (here) — and re-exported so a page imports one thing rather than three.
 */


import { useLayoutEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
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
export function Toggle({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (checked: boolean) => void; ariaLabel?: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			// For the switches whose own label is not beside them, or is not unique on the page.
			aria-label={ariaLabel}
			onClick={() => onChange(!checked)}
			className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-[var(--ly-t-base)] ${
				checked ? "bg-accent" : "bg-line"
			}`}
		>
			{/*
			 * 圆点靠 transform 走，不靠 left。
			 *
			 * 两件事。`left` 每一帧都要重新布局一次，而 `transform` 是合成器自己的事——同样的
			 * 220ms，前者在忙的时候会掉帧，后者不会。以及缓动：原先没写，浏览器给的是默认的
			 * `ease`，两头都慢、中间快，看起来是圆点「挪」了一下；`--ly-e-out` 是这个应用里所有
			 * 东西落位时用的那条曲线——快起、末段收住，落下去是停稳而不是停住。
			 *
			 * 16px 就是原先那两个 left 的差（19 − 3）。
			 */}
			<span
				className="ly-knob absolute top-[3px] left-[3px] h-4 w-4 rounded-full border transition-transform duration-[var(--ly-t-base)] ease-[var(--ly-e-out)]"
				style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
			/>
		</button>
	);
}

/**
 * 一排互斥的选项，选中的那个下面垫着一块会滑过去的底。
 *
 * 底以前是选中那颗按钮自己的背景色，于是切换时唯一发生的事是一格的底色亮起、另一格暗下——两
 * 个各自淡入淡出的方块，中间那段路没有东西走过。一块共用的底会从这里滑到那里，而滑动本身就说
 * 明了这两个选项是同一排里的两个位置，不是两个开关。
 *
 * 位置是量出来的，不是按等分算的：「费用」和「Token」不一样宽，任何按份数算的写法在第一个中英
 * 混排的标签上就错了。量在 layout effect 里，赶在这一帧画出来之前——晚一帧的话，第一次渲染就
 * 能看见那块底从左上角飞过来。
 */
export function Segmented<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (value: T) => void;
	/**
	 * `icon` turns a segment into a glyph, with `label` becoming its tooltip and accessible name.
	 *
	 * Label stays required either way — the same bargain `IconButton` makes, and for the same
	 * reason: an icon-only control without one is unreadable to a screen reader and unguessable to
	 * everyone else.
	 */
	options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
	const box = useRef<HTMLDivElement>(null);
	const [rail, setRail] = useState<{ left: number; width: number } | null>(null);

	useLayoutEffect(() => {
		// 遍历而不是拼一个属性选择器：值是调用方给的，转义它要 `CSS.escape`，而那是浏览器才有的。
		const selected = Array.from(box.current?.children ?? []).find((node) => node.getAttribute("data-segment") === value);
		if (selected instanceof HTMLElement) setRail({ left: selected.offsetLeft, width: selected.offsetWidth });
	}, [value, options]);

	return (
		<div ref={box} className="relative flex gap-0.5 rounded-full bg-card p-0.5">
			{/* 量到之前不画。它一出现就已经在正确的位置上，不需要一段从零滑过来的开场。 */}
			{rail && (
				<span
					aria-hidden
					data-segment-rail=""
					className="absolute top-0.5 bottom-0.5 left-0 rounded-full bg-elevated transition-[transform,width] duration-[var(--ly-t-base)] ease-[var(--ly-e-out)]"
					style={{ width: rail.width, transform: `translateX(${rail.left}px)` }}
				/>
			)}
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					data-segment={option.value}
					data-ly-tip={option.icon ? option.label : undefined}
					aria-label={option.icon ? option.label : undefined}
					aria-pressed={value === option.value}
					onClick={() => onChange(option.value)}
					// `relative` 把字提到那块底上面；没有它，滑过去的底会盖住它正要标出的那个词。
					className={`relative h-[26px] rounded-full text-label transition-[color,transform] duration-[var(--ly-t-quick)] active:scale-[0.97] ${
						// A glyph wants a square; a word wants room either side of it.
						option.icon ? "grid w-[30px] place-items-center" : "px-3"
					} ${value === option.value ? "text-ink" : "text-ink-muted hover:text-ink"}`}
				>
					{option.icon ?? option.label}
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
	icon,
	onClick,
	disabled,
	title,
	className = "",
}: {
	children?: React.ReactNode;
	/** Give this and drop `children` to make it icon-only; `title` then carries the words. */
	icon?: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	/** Tooltip and accessible name. Required in practice for an icon-only button. */
	title?: string;
	className?: string;
}) {
	return (
		<Button variant="primary" icon={icon} onClick={onClick} disabled={disabled} label={title} className={className}>
			{children}
		</Button>
	);
}

/**
 * 一片什么都没有的地方。
 *
 * **一个记号，加两三个字。** 从前是一整句解释浮在一张空卡片中间——「这个区间还没有模型用量。」
 * ——而空着这件事一眼就看得出来，用一句话把它再说一遍只是让这块空白更重。记号负责让这块地方
 * 看起来是画好的而不是没画完，短句负责说清空的是什么。
 *
 * 进场分两拍：记号先落下（`ly-pop`，从 0.5 倍弹到位），字随后淡上来。两件事同时出现是一次闪现，
 * 差 70ms 就成了一个动作——东西落定，然后它说了句话。`motion-reduce` 下两拍都不播。
 *
 * 记号可选，而且**默认没有**：十几处用到这个组件，多数是设置页里一行字就够的角落，每处都配图标
 * 只会变成一片图标墙。传它是因为那块空白足够大——一张卡片、一整块图表——大到值得有东西站在中间。
 */
export function EmptyHint({ children, icon: Icon }: { children: React.ReactNode; icon?: LucideIcon }) {
	return (
		<div data-ly-empty="" className="flex flex-col items-center justify-center gap-3.5 px-6 py-12 text-center">
			{Icon && (
				/*
				 * 44px 的圆底配 20px 的记号。
				 *
				 * 一个线性图标单独放在大片留白中间会显得太轻，像是没对齐；一块底给了它确定的位置和
				 * 重量。底比图标大一圈有余，图标才像是被放进去的，而不是被框住的。
				 */
				<span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink/[0.04] text-ink-faint/70 animate-[ly-pop_var(--ly-t-base)_var(--ly-e-out)_both] motion-reduce:animate-none">
					<Icon size={20} strokeWidth={1.5} aria-hidden />
				</span>
			)}
			<p className="max-w-[260px] text-label text-ink-faint animate-[ly-fade-up_var(--ly-t-base)_var(--ly-e-out)_70ms_both] motion-reduce:animate-none">
				{children}
			</p>
		</div>
	);
}
