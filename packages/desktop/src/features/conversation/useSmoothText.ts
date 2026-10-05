/**
 * 正在输出的回复，按匀速把字放出来，而不是来多少画多少。
 *
 * 字到达的节奏是服务商的：有的每个 token 一帧，有的攒几百毫秒一次倒出一两百字。后一种画出来是
 * 一顿一顿的——停住，整句蹦出来，再停住。`ThinkingBlock` 的流水行为同一件事写过 `useTyped`，
 * 这里是正文版，差别在速度的上限：正文要跟得上一个每秒上千字的模型，所以没有封顶，落后多少由
 * `CATCH_UP` 管。
 *
 * 速度取两者中较大的：
 *
 * - 最近的到达速率（平滑过的），让一批批进来的字匀成一条线，而不是每批先快后慢；
 * - 积压量 / `CATCH_UP`，保证无论上游多快，屏幕上最多落后约这么久。
 *
 * **写完不等于演完。** `live` 变成 false 时，还没放出来的字照常放完，最后一个字淡完之后才交出
 * `active: false`，调用方这时才换回原文。短回复尤其要这样：一句话往往整句到达、紧接着就结束，
 * 从前在结束那一刻直接给全文、掐掉淡入，字是实着蹦出来的。
 */

import { useEffect, useRef, useState } from "react";
import { motionReduced } from "../../ui/motion/reduced.ts";

/** 积压的字要在大约这么多秒内放完；也就是稳定输出时屏幕落后模型的时间。 */
const CATCH_UP = 0.15;
/** 积压很少时的最低速度（字/秒），免得最后几个字拖着出来。 */
const FLOOR = 60;
/** 到达速率的上限（字/秒）。一次倒进来一大段时，瞬时速率高得没有意义，别让它把平滑冲掉。 */
const RATE_CAP = 1000;
/** 一次进来这么多字就不是在「输出」了（重连、补发），直接给全文。 */
const JUMP = 2000;
/**
 * 最后一个字放出来之后，还要等多久才算演完：它的出现时刻最多排在放出来之后 160ms，再淡 180ms
 * （见 `FadeText`），留一点余量。
 */
const LINGER = 400;

export function useSmoothText(text: string, live: boolean): { text: string; active: boolean } {
	const motion = !motionReduced();
	const [shown, setShown] = useState(text);
	const [active, setActive] = useState(live && motion);
	const state = useRef({ target: text, position: text.length, rate: 0, arrived: 0, frame: 0, last: 0, live, active: live && motion, linger: 0 });

	useEffect(() => {
		const here = state.current;
		const now = performance.now();
		here.live = live;
		clearTimeout(here.linger);

		const settle = () => {
			here.linger = window.setTimeout(() => {
				here.active = false;
				setActive(false);
			}, LINGER);
		};

		// 没在演、不是往后接着写、或者一次来得太多：直接给全文。
		if (!motion || !text.startsWith(here.target) || text.length - here.target.length > JUMP || (!live && !here.active)) {
			cancelAnimationFrame(here.frame);
			here.frame = 0;
			here.target = text;
			here.position = text.length;
			here.rate = 0;
			here.arrived = now;
			setShown(text);
			here.active = live && motion;
			setActive(here.active);
			return;
		}

		if (live && !here.active) {
			here.active = true;
			setActive(true);
		}

		if (text !== here.target) {
			const added = text.length - here.target.length;
			// 第一批没有「上一批」可比，只能靠积压量那一项。
			if (here.arrived) {
				const instant = Math.min(RATE_CAP, added / Math.max(0.016, (now - here.arrived) / 1000));
				here.rate = here.rate * 0.7 + instant * 0.3;
			}
			here.arrived = now;
			here.target = text;
		}

		if (here.frame) return;
		if (here.position >= here.target.length) {
			if (!live) settle();
			return;
		}
		here.last = now;
		const step = (time: number) => {
			const current = state.current;
			// 夹住，免得切到后台的窗口回来时把缺席的那段时间一帧花完。
			const delta = Math.min(0.1, Math.max(0, (time - current.last) / 1000));
			current.last = time;
			const backlog = current.target.length - current.position;
			if (backlog <= 0) {
				current.frame = 0;
				if (!current.live) settle();
				return;
			}
			current.position = Math.min(current.target.length, current.position + Math.max(FLOOR, current.rate, backlog / CATCH_UP) * delta);
			let cut = Math.floor(current.position);
			// 不切在一个代理对中间，否则 emoji 会先露出半个乱码。
			const code = current.target.charCodeAt(cut);
			if (code >= 0xdc00 && code <= 0xdfff) cut++;
			setShown(current.target.slice(0, cut));
			current.frame = requestAnimationFrame(step);
		};
		here.frame = requestAnimationFrame(step);
	}, [text, live, motion]);

	useEffect(
		() => () => {
			cancelAnimationFrame(state.current.frame);
			clearTimeout(state.current.linger);
		},
		[],
	);

	return active ? { text: shown, active } : { text, active };
}
