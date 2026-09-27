/**
 * 每个智能体一张不一样的脸：谁拿到哪张、换个名单顺序还是不是同一张、新来的会不会撞脸。
 *
 * 用户的要求就一句——「每个智能体的 logo 都不一样」——所以这里守的都是「不一样」的各种说法：
 * 名单里互不相同、新建的不和任何人相同、内置的七个连形状和颜色都各不相同。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_AGENTS } from "@lyra/core/agents-builtin";
import {
	AVATAR_COLORS,
	AVATAR_SHAPES,
	assignAvatars,
	blinkPause,
	formatAvatar,
	freshAvatar,
	hashedAvatar,
	parseAvatar,
	type Avatar,
} from "../src/lib/agent-avatar.ts";

const builtin = (name: string) => BUILTIN_AGENTS.find((agent) => agent.name === name)?.avatar;

test("a face is written as `shape-colour`, read back the same, and anything else is refused", () => {
	for (const shape of AVATAR_SHAPES) {
		for (const color of AVATAR_COLORS) {
			assert.deepEqual(parseAvatar(formatAvatar({ shape, color })), { shape, color });
		}
	}
	assert.deepEqual(parseAvatar("  Cloud-Violet "), { shape: "cloud", color: "violet" }, "hand-typed case and spaces are forgiven");
	for (const bad of ["cloud", "cloud-", "-violet", "cloud-violet-x", "square-blue", "cloud-black", "", 42, null, undefined]) {
		assert.equal(parseAvatar(bad), null, String(bad));
	}
});

test("the seven built-in agents differ in shape and in colour, not only in the pair", () => {
	const faces = BUILTIN_AGENTS.map((agent) => parseAvatar(agent.avatar));
	assert.ok(faces.every(Boolean), `every built-in names a face the renderer knows: ${BUILTIN_AGENTS.map((a) => a.avatar)}`);
	const known = faces as Avatar[];
	assert.equal(new Set(known.map((face) => face.shape)).size, known.length, "no two share a shape");
	assert.equal(new Set(known.map((face) => face.color)).size, known.length, "no two share a colour");
	// 截图 2 的那一排：圆、水滴、方块、团子、云、胶囊、三角。
	assert.deepEqual(known.map((face) => face.shape), ["circle", "drop", "squircle", "blob", "cloud", "pill", "triangle"]);
});

test("a name without a face always works out to the same one, and steers clear of faces already taken", () => {
	assert.deepEqual(hashedAvatar("docs-writer"), hashedAvatar("docs-writer"), "deterministic: every window draws the same face");
	const taken = BUILTIN_AGENTS.map((agent) => parseAvatar(agent.avatar) as Avatar);
	for (const name of ["boss", "docs-writer", "qa", "a", "reviewer-2", "翻译"]) {
		const face = hashedAvatar(name, taken);
		assert.ok(!taken.some((other) => formatAvatar(other) === formatAvatar(face)), `${name} does not wear a built-in's face`);
		// 七个内置只占了七种形状、七种颜色，形状颜色都新的组合还多得是，所以必须挑到那种。
		assert.ok(!taken.some((other) => other.shape === face.shape || other.color === face.color), `${name} looks like nobody: ${formatAvatar(face)}`);
	}
});

test("a roster gets one face each, whatever order it arrives in", () => {
	const roster = [
		...BUILTIN_AGENTS.map((agent) => ({ name: agent.name, avatar: agent.avatar })),
		{ name: "boss" },
		{ name: "docs-writer", avatar: "ghost-plum" },
		...Array.from({ length: 30 }, (_, index) => ({ name: `custom-${index}` })),
	];
	const forwards = assignAvatars(roster, builtin);
	const backwards = assignAvatars([...roster].reverse(), builtin);
	assert.equal(new Set([...forwards.values()].map(formatAvatar)).size, roster.length, "every face in the roster is different");
	for (const { name } of roster) assert.deepEqual(forwards.get(name), backwards.get(name), `${name} is the same face either way round`);
	assert.deepEqual(forwards.get("docs-writer"), { shape: "ghost", color: "plum" }, "a written face is kept as written");
	assert.deepEqual(forwards.get("general"), { shape: "circle", color: "blue" });
});

test("a hand-written override of a built-in keeps the built-in's face through the fallback", () => {
	// 文件里没写 avatar 的 `general`：它还是 general，不该换脸。
	const faces = assignAvatars([{ name: "general" }, { name: "explore", avatar: "star-lime" }], builtin);
	assert.deepEqual(faces.get("general"), { shape: "circle", color: "blue" });
	assert.deepEqual(faces.get("explore"), { shape: "star", color: "lime" }, "a face written on purpose beats the built-in's");
});

test("a new agent is handed a face nobody has — preferring a new shape and a new colour", () => {
	const taken = BUILTIN_AGENTS.map((agent) => parseAvatar(agent.avatar) as Avatar);
	for (let seed = 0; seed < 50; seed++) {
		let n = seed;
		const face = freshAvatar(taken, () => ((n = (n * 9301 + 49297) % 233280) / 233280));
		assert.ok(!taken.some((other) => other.shape === face.shape || other.color === face.color), `roll ${seed}: ${formatAvatar(face)}`);
	}
	// 只剩一个空位时，给的就是那一个。
	const all: Avatar[] = AVATAR_SHAPES.flatMap((shape) => AVATAR_COLORS.map((color) => ({ shape, color })));
	const last = all.pop() as Avatar;
	assert.deepEqual(freshAvatar(all, () => 0.99), last);
});

test("blinks come every few seconds, at a pace of each name's own", () => {
	for (const name of ["general", "explore", "x"]) {
		for (let i = 0; i < 20; i++) {
			const pause = blinkPause(name);
			assert.ok(pause >= 2800 && pause <= 6400, `${name}: ${pause}`);
		}
	}
	assert.notEqual(blinkPause("general", () => 0), blinkPause("explore", () => 0), "two names do not blink in step");
});
