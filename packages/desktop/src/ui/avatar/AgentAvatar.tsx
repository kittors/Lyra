/**
 * 一个智能体的脸：一块有颜色的形状，一双会眨的眼睛。
 *
 * 表情就是状态。面板里一排子智能体，谁在干活、谁在排队、谁做完了、谁出了事，从眼睛就读得
 * 出来，不用每张脸旁边再挂一个字：
 *
 *   idle     睁着眼，时不时眨一下
 *   working  上下轻轻颠着，眼睛左右扫——像在翻东西
 *   waiting  眯着眼、褪了色，还没轮到它
 *   done     眯成两道弯，满意了
 *   failed   叉叉眼
 *   stopped  闭着眼，被人叫停了
 *
 * 眨眼不用 CSS 的无限循环：那样哪怕一屏二十张脸都在屏幕外，动画时钟也一直在走。这里每张脸
 * 自己排下一次眨眼的时间，看不见就跳过——两次眨眼之间什么都不跑。
 */

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { blinkPause, type Avatar } from "../../lib/agent-avatar.ts";
import type { DispatchState } from "../../lib/dispatches.ts";
import { motionReduced } from "../motion/reduced.ts";
import { COLOR_ART, EYE_ART, SHAPE_ART } from "./art.ts";

export type AvatarMood = "idle" | DispatchState;

export interface AgentAvatarProps {
	avatar: Avatar;
	/** 像素边长。 */
	size?: number;
	mood?: AvatarMood;
	/** 右下角的小圆点：在跑是强调色、会一圈圈往外扩；出错是红的。 */
	badge?: "running" | "failed" | null;
	/**
	 * 悬停时眼睛跟着指针、身子弹一下。默认开。
	 *
	 * `host` 是往上找的那个容器：一整行的任何地方悬停都算，而不是非得对准这 20 像素。
	 */
	interactive?: boolean;
	host?: string;
	/** 名字，决定眨眼的节奏——七张脸不该踩着同一个拍子。 */
	seed?: string;
	/** 默认是装饰：名字总在旁边写着。单独出现、没有字陪着的时候才给它一个名字。 */
	label?: string;
	/** 换一个值就蹦一下——刚保存好、刚换了脸，给它一个「是我」的回应。 */
	cheer?: string | number | null;
	className?: string;
}

/** 眼睛的样子，画在以眼睛中心为原点的小坐标里。 */
function Eye({ mood }: { mood: AvatarMood }) {
	if (mood === "done") return <path d="M-5 2.6Q0 -5.2 5 2.6" fill="none" strokeWidth={3.4} strokeLinecap="round" />;
	if (mood === "failed") return <path d="M-3.8 -3.8L3.8 3.8M3.8 -3.8L-3.8 3.8" fill="none" strokeWidth={3.1} strokeLinecap="round" />;
	if (mood === "stopped") return <path d="M-4.6 -0.6Q0 3 4.6 -0.6" fill="none" strokeWidth={3.1} strokeLinecap="round" />;
	if (mood === "waiting") return <rect x={-3.8} y={-2.4} width={7.6} height={4.8} rx={2.4} />;
	return <rect x={-3.6} y={-7.4} width={7.2} height={14.8} rx={3.6} />;
}

function replay(node: HTMLElement, attribute: string) {
	node.removeAttribute(attribute);
	// 读一次布局，让「去掉」先生效，同一个动画才会从头再放一遍。
	void node.getBoundingClientRect();
	node.setAttribute(attribute, "");
}

/**
 * 眨一下；五次里有一次连眨两下，像真的在眨而不是在闪。
 *
 * 第二下是另排的一个定时器，交回撤掉它的办法：从前它没人管，一张刚交差的脸（弯眼、不再眨）会在
 * 240ms 之后又眨一下——组件测试里它是一条五次里红一次的「交差之后还在眨」。
 */
function blink(node: HTMLElement): () => void {
	replay(node, "data-blink");
	if (Math.random() >= 0.2) return () => {};
	const again = setTimeout(() => { if (node.isConnected) replay(node, "data-blink"); }, 240);
	return () => clearTimeout(again);
}

export function AgentAvatar({
	avatar,
	size = 20,
	mood = "idle",
	badge = null,
	interactive = true,
	host,
	seed = "",
	label,
	cheer = null,
	className = "",
}: AgentAvatarProps) {
	const root = useRef<HTMLSpanElement>(null);
	const art = SHAPE_ART[avatar.shape];
	const colour = COLOR_ART[avatar.color];
	const previous = useRef(mood);

	// 自己排自己的眨眼。看不见（滚出去了、窗口在后台、减少动态效果）的时候那一次跳过。
	useEffect(() => {
		const node = root.current;
		if (!node || mood === "failed" || mood === "stopped" || mood === "done") return;
		let visible = true;
		const watcher = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; });
		watcher?.observe(node);
		/*
		 * 全局的 `setTimeout`，不是 `window.setTimeout`：在窗口里两者是同一个，而在组件测试里
		 * 只有前者能被 `mock.timers` 接管——后者属于那份假 DOM，测试一红，它就在后台一直排下去，
		 * 整个测试文件永远不退出。
		 */
		let timer: ReturnType<typeof setTimeout> | undefined;
		let twice = () => {};
		const next = () => {
			timer = setTimeout(() => {
				if (visible && document.visibilityState !== "hidden" && !motionReduced()) twice = blink(node);
				next();
			}, blinkPause(seed));
		};
		next();
		return () => {
			clearTimeout(timer);
			twice();
			watcher?.disconnect();
		};
	}, [seed, mood]);

	// 悬停：进来弹一下、眨一下，之后眼睛跟着指针走；出去就回正。
	useEffect(() => {
		const node = root.current;
		if (!node || !interactive) return;
		const target: HTMLElement = (host ? node.closest<HTMLElement>(host) : null) ?? node;
		let frame = 0;
		let twice = () => {};
		const enter = () => {
			if (motionReduced()) return;
			replay(node, "data-poke");
			twice = blink(node);
		};
		const move = (event: PointerEvent) => {
			if (motionReduced()) return;
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(() => {
				const box = node.getBoundingClientRect();
				const dx = event.clientX - (box.left + box.width / 2);
				const dy = event.clientY - (box.top + box.height / 2);
				const distance = Math.hypot(dx, dy) || 1;
				// 越远看得越「偏」，但有个上限：眼珠不能跑出脸去。指针落在脸上时几乎正视。
				const reach = Math.min(1, distance / Math.max(box.width * 2.2, 48));
				node.style.setProperty("--ly-look-x", `${((dx / distance) * 5.5 * reach).toFixed(2)}px`);
				node.style.setProperty("--ly-look-y", `${((dy / distance) * 4 * reach).toFixed(2)}px`);
			});
		};
		const leave = () => {
			window.cancelAnimationFrame(frame);
			node.style.removeProperty("--ly-look-x");
			node.style.removeProperty("--ly-look-y");
		};
		target.addEventListener("pointerenter", enter);
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerleave", leave);
		return () => {
			window.cancelAnimationFrame(frame);
			twice();
			target.removeEventListener("pointerenter", enter);
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerleave", leave);
		};
	}, [interactive, host]);

	// 活干完的那一刻蹦一下、出错的那一刻抖一下。只认「从干活变过来」：一打开面板就看见一排
	// 已经做完的，它们不该集体蹦起来。
	useLayoutEffect(() => {
		const node = root.current;
		const was = previous.current;
		previous.current = mood;
		if (!node || was === mood || (was !== "working" && was !== "waiting") || motionReduced()) return;
		if (mood === "done") replay(node, "data-cheer");
		if (mood === "failed" || mood === "stopped") replay(node, "data-shake");
	}, [mood]);

	useLayoutEffect(() => {
		const node = root.current;
		if (!node || cheer === null || cheer === "" || motionReduced()) return;
		replay(node, "data-cheer");
	}, [cheer]);

	/*
	 * 小尺寸时眼睛放大一点。按比例缩到 16px，一只眼睛不到两个像素，脸就成了一块没表情的色块——
	 * 而侧栏、菜单里用的恰恰是这些小号。
	 */
	const boost = size <= 18 ? 1.35 : size <= 26 ? 1.15 : 1;
	const gap = art.face.gap * (1 + (boost - 1) * 0.6);
	const eyes = [art.face.x - gap / 2, art.face.x + gap / 2];
	const style = { "--ly-avatar-size": `${size}px`, "--ly-avatar-color": colour, "--ly-avatar-eye": EYE_ART } as CSSProperties;
	return (
		<span
			ref={root}
			className={`ly-avatar ${className}`}
			style={style}
			data-mood={mood}
			data-avatar={`${avatar.shape}-${avatar.color}`}
			role={label ? "img" : undefined}
			aria-label={label}
			aria-hidden={label ? undefined : true}
			onAnimationEnd={(event) => {
				const node = root.current;
				if (!node) return;
				const name = event.animationName;
				if (name === "ly-avatar-blink") node.removeAttribute("data-blink");
				else if (name === "ly-avatar-jelly") node.removeAttribute("data-poke");
				else if (name === "ly-avatar-cheer") node.removeAttribute("data-cheer");
				else if (name === "ly-avatar-shake") node.removeAttribute("data-shake");
			}}
		>
			<svg viewBox="0 0 100 100" aria-hidden focusable="false">
				<g className="ly-avatar-bob">
					<g className="ly-avatar-squish">
						<path className="ly-avatar-body" d={art.d} transform={art.transform} />
						<g className="ly-avatar-look">
							<g className="ly-avatar-scan">
								<g className="ly-avatar-eyes">
									{eyes.map((x) => (
										<g key={x} transform={`translate(${x} ${art.face.y}) rotate(10) scale(${art.face.scale * boost})`}>
											<Eye mood={mood} />
										</g>
									))}
								</g>
							</g>
						</g>
					</g>
				</g>
			</svg>
			{badge && <span className="ly-avatar-badge" data-tone={badge} />}
		</span>
	);
}
