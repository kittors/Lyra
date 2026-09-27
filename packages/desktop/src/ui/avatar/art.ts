/**
 * 每种形状的轮廓、脸在哪，和每种颜色的色值。
 *
 * 都画在 100×100 的格子里，身体大致占 10–90：留出边是给悬停时那一下「果冻」——压扁时会横着
 * 胀出去一截，贴边画的话那一截会被裁掉。
 *
 * `face` 是两只眼睛的中点。不是每个形状都在正中：三角形的肚子在下半截，云的上沿全是鼓包，
 * 眼睛放在几何中心会挤到边上去。整体都往右上偏一点，这张脸就是在「看着」右边的名字。
 */

import type { AvatarColor, AvatarShape } from "../../lib/agent-avatar.ts";

export interface ShapeArt {
	d: string;
	/** 只有水滴用：它是歪着的，歪在路径外面比把每个坐标都转一遍好改。 */
	transform?: string;
	face: { x: number; y: number; gap: number; scale: number };
}

const n = (value: number) => Math.round(value * 100) / 100;

/** 顺时针的圆。几个圆叠在一起时方向必须一致，非零环绕规则下才是「并起来」而不是挖出洞。 */
function circle(cx: number, cy: number, r: number): string {
	return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 1 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 1 ${n(-2 * r)} 0Z`;
}

/** 顺时针的圆角矩形，和 `circle` 同一个方向。 */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
	return (
		`M${n(x + r)} ${n(y)}H${n(x + w - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}` +
		`V${n(y + h - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}` +
		`H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}Z`
	);
}

/** 圆角多边形：每个角沿两条边各退 `radius`，拿角本身做二次曲线的控制点。 */
function roundedPolygon(points: [number, number][], radius: number): string {
	const toward = ([cx, cy]: [number, number], [tx, ty]: [number, number]) => {
		const length = Math.hypot(tx - cx, ty - cy);
		const reach = Math.min(radius, length / 2) / length;
		return `${n(cx + (tx - cx) * reach)} ${n(cy + (ty - cy) * reach)}`;
	};
	let d = "";
	points.forEach((point, index) => {
		const previous = points[(index - 1 + points.length) % points.length];
		const next = points[(index + 1) % points.length];
		d += `${index === 0 ? "M" : "L"}${toward(point, previous)}Q${n(point[0])} ${n(point[1])} ${toward(point, next)}`;
	});
	return `${d}Z`;
}

/** 正多边形 / 星形的顶点，从正上方开始顺时针。 */
function ring(count: number, radius: (index: number) => number, cx = 50, cy = 50): [number, number][] {
	return Array.from({ length: count }, (_, index) => {
		const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
		return [cx + radius(index) * Math.cos(angle), cy + radius(index) * Math.sin(angle)];
	});
}

/** 一圈小圆围着一个大圆：花瓣和饼干边都是这么叠出来的。 */
function scalloped(count: number, orbit: number, petal: number, core: number): string {
	return [circle(50, 50, core), ...ring(count, () => orbit).map(([x, y]) => circle(x, y, petal))].join("");
}

export const SHAPE_ART: Record<AvatarShape, ShapeArt> = {
	circle: { d: circle(50, 50, 40), face: { x: 56, y: 43, gap: 15.5, scale: 1 } },
	drop: {
		d: "M50 8C57 21 80 39 80 61A30 30 0 0 1 20 61C20 39 43 21 50 8Z",
		transform: "rotate(-16 50 58)",
		face: { x: 53, y: 58, gap: 14.5, scale: 0.95 },
	},
	squircle: { d: "M50 12C80 12 88 20 88 50S80 88 50 88 12 80 12 50 20 12 50 12Z", face: { x: 56, y: 44, gap: 15.5, scale: 1 } },
	blob: {
		d: "M19 41C17 25 31 13 47 15C57 16 62 21 72 19C86 17 94 31 90 47C87 59 92 70 84 80C74 92 52 90 38 86C22 82 11 72 13 58C14 50 20 48 19 41Z",
		face: { x: 58, y: 46, gap: 15.5, scale: 1 },
	},
	cloud: {
		d: [circle(29, 62, 16), circle(46, 45, 21), circle(66, 48, 16), circle(76, 63, 15), roundRect(26, 56, 52, 22, 11)].join(""),
		face: { x: 54, y: 58, gap: 14.5, scale: 0.95 },
	},
	pill: { d: roundRect(11, 30, 78, 42, 21), face: { x: 57, y: 47, gap: 14.5, scale: 0.92 } },
	triangle: { d: roundedPolygon([[50, 12], [90, 84], [10, 84]], 11), face: { x: 53, y: 63, gap: 13.5, scale: 0.88 } },
	flower: { d: scalloped(5, 25, 19, 27), face: { x: 55, y: 49, gap: 14.5, scale: 0.95 } },
	hexagon: { d: roundedPolygon(ring(6, () => 41), 10), face: { x: 56, y: 46, gap: 15.5, scale: 1 } },
	ghost: {
		d:
			"M17 50C17 29 32 14 50 14C68 14 83 29 83 50V80C83 87 77 89 73 85L70 82C67 79 63 79 60 82L57 85C53 89 47 89 43 85" +
			"L40 82C37 79 33 79 30 82L27 85C23 89 17 87 17 80Z",
		face: { x: 56, y: 45, gap: 15.5, scale: 1 },
	},
	star: { d: roundedPolygon(ring(10, (index) => (index % 2 === 0 ? 45 : 24), 50, 53), 5), face: { x: 53, y: 55, gap: 12.5, scale: 0.8 } },
	bean: {
		d: "M13 53C13 33 27 22 42 25C51 27 55 32 63 30C77 26 89 36 89 53C89 73 72 84 51 84C30 84 13 73 13 53Z",
		face: { x: 57, y: 55, gap: 15.5, scale: 1 },
	},
	arch: { d: "M16 48A34 34 0 0 1 84 48V78Q84 86 76 86H24Q16 86 16 78Z", face: { x: 56, y: 48, gap: 15.5, scale: 1 } },
	diamond: { d: roundedPolygon([[50, 7], [93, 50], [50, 93], [7, 50]], 13), face: { x: 54, y: 47, gap: 14.5, scale: 0.95 } },
	heart: {
		d: "M50 87C43 81 11 61 11 37C11 23 21 13 34 13C42 13 47 17 50 23C53 17 58 13 66 13C79 13 89 23 89 37C89 61 57 81 50 87Z",
		face: { x: 53, y: 43, gap: 15.5, scale: 0.95 },
	},
	burst: { d: scalloped(12, 36, 9.5, 37), face: { x: 56, y: 46, gap: 14.5, scale: 0.95 } },
};

/**
 * 眼睛的颜色，亮暗主题都是它：眼睛长在身体上，不长在窗口上，窗口底色换了它也不该跟着换。
 * 和身体的颜色一样是这幅画自己的颜料，不是界面的 token，所以写在这里而不是样式表里。
 */
export const EYE_ART = "#141417";

/**
 * 色值是亮暗两种主题共用的一套中等明度：眼睛是深色的，身体太暗眼睛就看不见，太浅在白底上
 * 就化开了。所以没有黑、没有灰、也没有嫩黄。
 */
export const COLOR_ART: Record<AvatarColor, string> = {
	blue: "#2f7cf6",
	green: "#1fa35c",
	pink: "#e3398f",
	teal: "#12aaa0",
	violet: "#8b5cf6",
	brown: "#8f5d36",
	orange: "#ff9a1f",
	red: "#ee4d4d",
	yellow: "#f2b61b",
	indigo: "#5d63f0",
	lime: "#7cbb2c",
	sky: "#36b3f0",
	rose: "#fb6f8e",
	mint: "#2fcf8f",
	coral: "#ff7b56",
	plum: "#b34fc8",
};
