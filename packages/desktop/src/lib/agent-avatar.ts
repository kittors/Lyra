/**
 * 智能体长什么样：一个形状配一个颜色，再加一双眼睛（眼睛归 `ui/avatar` 画）。
 *
 * 这里只管「谁是谁」，不管怎么画——纯逻辑，没有 React，单测不需要 DOM。
 *
 * 形象写在定义文件的 `avatar: cloud-violet` 里，是这个智能体身份的一部分：换台机器、换个
 * 窗口、在面板里还是在设置页里，同一个名字是同一张脸。没写的（手写的定义、旧文件）按名字
 * 算一张，算法是确定的，所以同一个名字每次都算出同一张。
 */

export const AVATAR_SHAPES = [
	"circle",
	"drop",
	"squircle",
	"blob",
	"cloud",
	"pill",
	"triangle",
	"flower",
	"hexagon",
	"ghost",
	"star",
	"bean",
	"arch",
	"diamond",
	"heart",
	"burst",
] as const;

export const AVATAR_COLORS = [
	"blue",
	"green",
	"pink",
	"teal",
	"violet",
	"brown",
	"orange",
	"red",
	"yellow",
	"indigo",
	"lime",
	"sky",
	"rose",
	"mint",
	"coral",
	"plum",
] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export interface Avatar {
	shape: AvatarShape;
	color: AvatarColor;
}

const SHAPES = new Set<string>(AVATAR_SHAPES);
const COLORS = new Set<string>(AVATAR_COLORS);
const COMBOS = AVATAR_SHAPES.length * AVATAR_COLORS.length;
/*
 * 探测的步长。和组合总数互质，走满一圈正好把每个组合碰一次；取一个大的奇数而不是 1，是为了
 * 撞车时换到的那一张和原来那张形状、颜色都不同——步长 1 只会换个颜色，看着还像同一个。
 */
const STRIDE = 97;

/** `cloud-violet` → `{ shape: "cloud", color: "violet" }`；认不出来的一律 `null`，由调用方兜底。 */
export function parseAvatar(value: unknown): Avatar | null {
	if (typeof value !== "string") return null;
	const [shape, color, ...rest] = value.trim().toLowerCase().split("-");
	if (rest.length > 0 || !shape || !color || !SHAPES.has(shape) || !COLORS.has(color)) return null;
	return { shape: shape as AvatarShape, color: color as AvatarColor };
}

export function formatAvatar(avatar: Avatar): string {
	return `${avatar.shape}-${avatar.color}`;
}

/** FNV-1a：短、快、分布够匀，而且在哪个进程里算都一样。 */
function nameHash(name: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < name.length; index++) {
		hash ^= name.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function comboAt(index: number): Avatar {
	const at = ((index % COMBOS) + COMBOS) % COMBOS;
	return { shape: AVATAR_SHAPES[at % AVATAR_SHAPES.length], color: AVATAR_COLORS[Math.floor(at / AVATAR_SHAPES.length)] };
}

/**
 * 按名字算一张，避开 `taken` 里已经有人用的。
 *
 * 和 `freshAvatar` 一样挑剔：形状、颜色都没人用的先要，其次形状新，再次颜色新，最后只要组合
 * 新——只是这里的「挑」是确定的，从名字算出的那一格开始往后找。从前只要组合没人用就收，于是
 * 一个手写的 `boss` 算出来是蓝色的拱门，站在蓝色的圆 `general` 下面，像是同一个人换了个发型。
 *
 * 全被占了（两百多个智能体）就不避了——总得给一张，重复一张脸比没有脸好。
 */
export function hashedAvatar(name: string, taken: Iterable<Avatar> = []): Avatar {
	const used = new Set<string>();
	const shapes = new Set<string>();
	const colors = new Set<string>();
	for (const face of taken) {
		used.add(formatAvatar(face));
		shapes.add(face.shape);
		colors.add(face.color);
	}
	const start = nameHash(name);
	const accept = [
		(face: Avatar) => !shapes.has(face.shape) && !colors.has(face.color),
		(face: Avatar) => !shapes.has(face.shape),
		(face: Avatar) => !colors.has(face.color),
		() => true,
	];
	for (const fits of accept) {
		for (let step = 0; step < COMBOS; step++) {
			const candidate = comboAt(start + step * STRIDE);
			if (!used.has(formatAvatar(candidate)) && fits(candidate)) return candidate;
		}
	}
	return comboAt(start);
}

/**
 * 一份名单里每个人的脸，保证互不相同。
 *
 * 写明了的先落座（定义里的 `avatar`，其次是 `fallback` 给的，内置的那几个就走这条），剩下的
 * **按名字排好序**再逐个算——排序是为了让结果只取决于名单里有谁，不取决于名单是按什么顺序
 * 送来的：设置页和提及菜单拿到的是同一批人、不同的顺序，两边必须画出同一张脸。
 *
 * 写明了的两个撞了，照写的来：那是人自己挑的。
 */
export function assignAvatars(
	agents: readonly { name: string; avatar?: string }[],
	fallback: (name: string) => string | undefined = () => undefined,
): Map<string, Avatar> {
	const assigned = new Map<string, Avatar>();
	const taken: Avatar[] = [];
	const unnamed: string[] = [];
	for (const agent of agents) {
		if (assigned.has(agent.name)) continue;
		const own = parseAvatar(agent.avatar) ?? parseAvatar(fallback(agent.name));
		if (own) {
			assigned.set(agent.name, own);
			taken.push(own);
		} else unnamed.push(agent.name);
	}
	for (const name of [...new Set(unnamed)].sort()) {
		const face = hashedAvatar(name, taken);
		assigned.set(name, face);
		taken.push(face);
	}
	return assigned;
}

/**
 * 给一个新智能体挑一张没人用过的脸。
 *
 * 不只是「这个组合没人用」：形状和颜色能都不撞就都不撞。七个内置的已经把圆、水滴、方块……和
 * 蓝、绿、粉……占了，新来的要是个绿色的圆，组合是新的，一眼看过去却像 `general` 换了件衣服。
 * 两样都新的挑不出来，退一步只要形状新，再退一步只要组合新。
 */
export function freshAvatar(taken: Iterable<Avatar>, random: () => number = Math.random): Avatar {
	const used = new Set<string>();
	const shapes = new Set<string>();
	const colors = new Set<string>();
	for (const face of taken) {
		used.add(formatAvatar(face));
		shapes.add(face.shape);
		colors.add(face.color);
	}
	const all: Avatar[] = [];
	for (let index = 0; index < COMBOS; index++) all.push(comboAt(index));
	const open = all.filter((face) => !used.has(formatAvatar(face)));
	const tiers = [
		open.filter((face) => !shapes.has(face.shape) && !colors.has(face.color)),
		open.filter((face) => !shapes.has(face.shape)),
		open.filter((face) => !colors.has(face.color)),
		open,
	];
	const pool = tiers.find((tier) => tier.length > 0) ?? all;
	return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/**
 * 眨眼的节奏，按名字定。
 *
 * 一屏七张脸要是同一个节拍一起眨，看起来像是屏幕闪了一下，而不是七个各自活着的东西。间隔落在
 * 2.8–6.4 秒之间：人大约三到四秒眨一次，再慢就像在发呆，再快就像在紧张。
 */
export function blinkPause(name: string, random: () => number = Math.random): number {
	const base = 2800 + (nameHash(`${name}:blink`) % 2400);
	return base + Math.floor(random() * 1200);
}
