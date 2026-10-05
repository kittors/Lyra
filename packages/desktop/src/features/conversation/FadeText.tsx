/**
 * 正在输出的一段字，新来的字淡入，而不是一个个蹦出来。
 *
 * 只有平滑出字（`useSmoothText`）时，字是匀速了，可每个字仍然是从无到有硬切出来的——看上去就是
 * 在「吐字」。这里给每个新字一个出现的时刻，从透明淡到实色；同一批到达的字错开一点，铺满到下一批
 * 到来之前，于是看到的是一条连续流动的淡入，而不是一格一格的跳。思路来自 streamdown 的
 * `StreamTail`。
 *
 * **只有还在淡的字才是 `<span>`。** 淡完的字并回前面的纯文本，否则一条长回复会攒下几千个 span。
 * span 按字的序号作 key：前面的字并回纯文本时，后面的 span 不会被重建，动画也就不会从头再来。
 *
 * **出现时刻记在这个实例身上，不按整块统一编号。** 按渲染顺序给整块数字编号，在 StrictMode 的
 * 双重渲染下会数两遍；而流式输出时只有最后一段字在长，前面的实例原样留着，各记各的就够了。
 */

import { type CSSProperties, useRef } from "react";

/** 一个字淡入要多久。和 `markdown.css` 里 `.ly-fade-char` 的时长是同一个数，改一处要跟着改另一处。 */
export const FADE = 180;
/** 相邻两个字最多错开多久。再慢，字就追不上屏幕上正在放出来的速度了。 */
const MAX_PACE = 18;
/** 两批字之间的间隔按这个范围算：太短没意义，太长（上游停过一阵）不该让下一批慢慢挤出来。 */
const MIN_GAP = 16;
const MAX_GAP = 160;
/**
 * 刚挂上的一段字铺开多久。它没有「上一批」可比；整句一次到达的短回复就是这种，铺开一点，读起来
 * 是从左到右淡进来，而不是整句同时浮现。
 */
const FIRST_GAP = 120;

export function FadeText({ text }: { text: string }) {
	const chars = Array.from(text);
	const { settled, style } = useFade(chars.length);

	return (
		<>
			{chars.slice(0, settled).join("")}
			{chars.slice(settled).map((char, offset) => (
				<span key={settled + offset} className="ly-fade-char" style={style(settled + offset)}>
					{char}
				</span>
			))}
		</>
	);
}

/**
 * 一段正在长的字里，每个字什么时候出现：`settled` 之前的已经淡完，画成纯文本；之后的每个字按
 * `style(序号)` 画成淡入的 span，序号就是 key。`length` 按码点数（`Array.from`），不按 UTF-16。
 *
 * 代码块也用它：配色切出来的 token 边界随着字长出来会变，但每个字的序号不变，出现时刻就不会乱。
 */
export function useFade(length: number): { settled: number; style: (index: number) => CSSProperties } {
	const state = useRef<{ births: number[]; last: number; styles: Map<number, CSSProperties> } | null>(null);
	state.current ??= { births: [], last: 0, styles: new Map() };
	const here = state.current;
	const now = performance.now();
	const births = here.births;

	if (length < births.length) births.length = length;
	const fresh = length - births.length;
	if (fresh > 0) {
		/*
		 * 这一批字错开出现，铺满到大约下一批该来的时候：间隔取上一批到这一批的实际间隔。
		 * 刚挂上的实例没有上一批，按 `FIRST_GAP` 铺开。
		 */
		const gap = here.last ? Math.min(MAX_GAP, Math.max(MIN_GAP, now - here.last)) : FIRST_GAP;
		const pace = Math.min(MAX_PACE, gap / fresh);
		let previous = births.length > 0 ? births[births.length - 1] : now - pace;
		while (births.length < length) {
			previous = Math.min(now + gap, Math.max(previous + pace, now));
			births.push(previous);
		}
		here.last = now;
	}

	// 出现时刻是递增的，所以淡完的字总是连成开头那一段。
	let settled = 0;
	while (settled < length && now - births[settled] >= FADE) settled++;
	for (const key of here.styles.keys()) if (key < settled) here.styles.delete(key);

	return {
		settled,
		style: (index) => {
			// 第一次画出来时定下，之后不再改：改 `animation-delay` 会让正在淡的字跳一下。
			let style = here.styles.get(index);
			if (!style) {
				style = { animationDelay: `${Math.round(births[index] - now)}ms` };
				here.styles.set(index, style);
			}
			return style;
		},
	};
}
