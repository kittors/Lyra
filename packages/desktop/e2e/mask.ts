/**
 * 量一条渐隐到底有多厚，注进页面里跑。
 *
 * 「顶上有没有虚化」这件事，写给遮罩的那些自定义属性是答不了的——它们是输入，各自都可以是对的，
 * 合起来仍然什么都不虚化：一个 0 的深度会把那一整段渐变的每个 stop 压到同一个位置上，遮罩照样
 * 成立，只是从实到透明用了 0px。所以这里问的是输出：把浏览器算完的 `mask-image` 取回来，沿 y 轴
 * 逐像素插值，数有多少像素落在「既不全实也不全透」之间。硬切是 0，正常是三十几。
 *
 * 探针和录像共用这一份。两边量的是同一个数，一支说「停稳之后各个位置都对」，一支说「滚的过程里
 * 没有哪一帧跳」，合起来才算把这件事说完。
 *
 * 取 computed 而不是 inline：inline 里是一串 `calc(var(...) * 0.41)`，谁都看不出最后落在哪。
 * 浏览器算完之后顶上那些 stop 全是实实在在的 px；底下那几个留着 `calc(100% - ...)` 没算，按视口
 * 高度代进去——两头都要问，所以两种形状都得认。
 */
export const MASK_PROBE = `
/*
 * 科学计数法也得认，而且一个 stop 都不许漏。
 *
 * 一个过渡走到尾声时，长度会小到浏览器改用 \`2.55124e-05px\` 印出来。之前那条正则只认
 * \`[\\d.]+\`，碰上它整段 \`calc()\` 都匹配不上——底下那八个 stop 于是被悄悄丢掉，数组的末尾成了
 * 「111px 处全实」接「100% 处全透」，中间五百多像素被当成一条渐变插了出来。量出来是 71.5 和
 * 149.5：两个都不离谱，都像那么回事，全是假的。
 *
 * 所以这里除了把数字认全，还要数一遍：解析出的 stop 数对不上原串里的颜色数就直接报错。一个漏掉
 * 的 stop 换来的不是「量不到」，是一个看着合理的错数——那比量不到坏得多。
 */
const NUM = "-?\\\\d*\\\\.?\\\\d+(?:[eE][-+]?\\\\d+)?";
const STOP = new RegExp("(rgba?\\\\([^)]*\\\\))\\\\s+(?:calc\\\\(100% - (" + NUM + ")px\\\\)|(" + NUM + ")%|(" + NUM + ")px)", "g");
const maskStops = (el) => {
	const style = getComputedStyle(el);
	const css = style.maskImage && style.maskImage !== "none" ? style.maskImage : style.webkitMaskImage;
	if (!css || css === "none") return [];
	const height = el.clientHeight;
	const out = [];
	STOP.lastIndex = 0;
	let hit;
	while ((hit = STOP.exec(css))) {
		const parts = hit[1].match(/-?[\\d.]+(?:[eE][-+]?\\d+)?/g).map(Number);
		const at = hit[2] !== undefined ? height - Number(hit[2])
			: hit[3] !== undefined ? (height * Number(hit[3])) / 100
			: Number(hit[4]);
		out.push({ alpha: parts.length > 3 ? parts[3] : 1, at });
	}
	const colours = (css.match(/rgba?\\(/g) || []).length;
	if (out.length !== colours) {
		throw new Error("遮罩有 " + colours + " 个色标，只认出 " + out.length + " 个：" + css.slice(0, 400));
	}
	return out.sort((a, b) => a.at - b.at);
};
const alphaAt = (stops, y) => {
	if (stops.length === 0) return 1;
	if (y <= stops[0].at) return stops[0].alpha;
	for (let i = 0; i < stops.length - 1; i++) {
		const lo = stops[i], hi = stops[i + 1];
		if (lo.at === hi.at) continue;
		if (y >= lo.at && y <= hi.at) return lo.alpha + (hi.alpha - lo.alpha) * ((y - lo.at) / (hi.at - lo.at));
	}
	return stops[stops.length - 1].alpha;
};
/** 一段 y 区间里，既不全实也不全透的那些像素有多厚。 */
const spanIn = (el, from, to) => {
	const stops = maskStops(el);
	if (stops.length === 0) return 0;
	let n = 0;
	for (let y = from; y <= to; y += 0.5) {
		const a = alphaAt(stops, y);
		if (a > 0.02 && a < 0.98) n++;
	}
	return n * 0.5;
};
const softSpan = (el) => spanIn(el, 0, 160);
const bottomSpan = (el) => spanIn(el, Math.max(0, el.clientHeight - 160), el.clientHeight);
`;
