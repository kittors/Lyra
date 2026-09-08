/**
 * 视口之外还要多画多少行。
 *
 * 手写虚拟列表都有同一个毛病：可见区间是在 scroll 事件里 `setState` 的，而 setState 要等下一次
 * 渲染才画得出来。固定留 8 行（约 288px）在慢慢滚的时候够用，快起来就不够——拖着滚动条走，一帧
 * 能跨过好几屏，新的一段还没渲染、旧的已经移出视口，中间那片就是白的。
 *
 * 所以基线是「一屏」，再按这一帧实际滚了多远往上加：滚得越快预留越多，让渲染追得上。上限拦的是
 * 甩到底那一下——那种时候多画几百行只会更慢，而它落地后的下一帧本来就会把正确的一段补上。
 *
 * 纯函数放在这里，是因为轨迹和任务两个列表都要用，而它们分属两个 feature，彼此不能直接串门。
 */

const MIN = 8;
const MAX = 160;

/** 这一帧滚了 `moved` 像素、视口装得下 `rows` 行、每行 `height` 高，那么上下各留多少行。 */
export function overscanFor(moved: number, rows: number, height: number): number {
	return Math.min(MAX, Math.max(MIN, rows + Math.ceil(Math.abs(moved) / Math.max(1, height))));
}
