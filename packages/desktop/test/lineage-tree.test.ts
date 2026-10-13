/**
 * 一张图的来龙去脉排成一列：相邻的两步用直线连，分叉和合成走左边的括线；当前这张的来路单独标出来。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { familyOf, lineageTree, type FamilyNode } from "../src/lib/lineage-tree.ts";

const node = (id: string, at: number, parents: string[] = [], index = 0): FamilyNode => ({ id, at, parents, index });
const graph = (...nodes: FamilyNode[]) => new Map(nodes.map((item) => [item.id, item]));
const ids = (tree: ReturnType<typeof lineageTree>) => tree.order.map((item) => item.id);
const links = (tree: ReturnType<typeof lineageTree>) => tree.links.map((link) => `${tree.order[link.from].id}→${tree.order[link.to].id}${link.lane === null ? "" : `@${link.lane}`}${link.onPath ? "*" : ""}`);

test("一条改了又改的链：一列到底，全是直线，没有括线", () => {
	const family = familyOf("hat", graph(node("dog", 1), node("hat", 2, ["dog"]), node("girl", 3, ["hat"])));
	const tree = lineageTree(family, "girl");
	assert.deepEqual(ids(tree), ["dog", "hat", "girl"]);
	assert.deepEqual(links(tree), ["dog→hat*", "hat→girl*"]);
	assert.equal(tree.lanes, 0);
});

test("同一张图往两个方向改：先改的那条走完，再列另一条；另一条用括线从原图接过来", () => {
	// 按时间是 白天、夜晚、黄昏、冬夜——黄昏夹在夜晚和冬夜中间，两条分支都被打散。
	const nodes = graph(node("day", 1), node("night", 2, ["day"]), node("sunset", 3, ["day"]), node("winter", 4, ["night"]));
	const tree = lineageTree(familyOf("day", nodes), "sunset");
	assert.deepEqual(ids(tree), ["day", "night", "winter", "sunset"]);
	assert.deepEqual(links(tree), ["day→night", "night→winter", "day→sunset@0*"]);
	assert.equal(tree.lanes, 1);
});

test("当前这张的来路标出来，别的分支不标", () => {
	const nodes = graph(node("day", 1), node("night", 2, ["day"]), node("sunset", 3, ["day"]), node("winter", 4, ["night"]));
	assert.deepEqual(links(lineageTree(familyOf("day", nodes), "winter")), ["day→night*", "night→winter*", "day→sunset@0"]);
});

test("两张图合成一张：等两张都列出来才列它，线一律往下", () => {
	// 附上的照片比狗晚，但合成图要等它出现以后才排，否则有一根线要往上走。
	const nodes = graph(node("dog", 1), node("photo", 2), node("both", 3, ["dog", "photo"]));
	const tree = lineageTree(familyOf("both", nodes), "both");
	assert.deepEqual(ids(tree), ["dog", "photo", "both"]);
	assert.deepEqual(links(tree), ["dog→both@0*", "photo→both*"]);
	assert.ok(tree.links.every((link) => link.from < link.to));
});

test("一张图出了几个版本：括线各占一道，从近到远嵌套，不共用一段", () => {
	const nodes = graph(node("dog", 1), node("v1", 2, ["dog"], 0), node("v2", 2, ["dog"], 1), node("v3", 2, ["dog"], 2), node("final", 5, ["v3"]));
	const tree = lineageTree(familyOf("dog", nodes), "final");
	assert.deepEqual(ids(tree), ["dog", "v1", "v2", "v3", "final"]);
	assert.deepEqual(links(tree), ["dog→v1", "dog→v2@0", "dog→v3@1*", "v3→final*"]);
	assert.equal(tree.lanes, 2);
});

test("一条括线用完的那一道，后面不重叠的括线可以再用", () => {
	const nodes = graph(node("a", 1), node("b", 2, ["a"]), node("c", 3, ["a"]), node("d", 4, ["c"]), node("e", 5, ["d"]), node("f", 6, ["d"]));
	const tree = lineageTree(familyOf("a", nodes), "f");
	assert.deepEqual(ids(tree), ["a", "b", "c", "d", "e", "f"]);
	assert.deepEqual(links(tree), ["a→b", "a→c@0*", "c→d*", "d→e", "d→f@0*"]);
	assert.equal(tree.lanes, 1);
});

test("一家子只含连得上的图；来源不在这一家里的不画线", () => {
	const nodes = graph(node("dog", 1), node("hat", 2, ["dog"]), node("tree", 3));
	assert.deepEqual(
		familyOf("dog", nodes).map((item) => item.id),
		["dog", "hat"],
	);
	assert.deepEqual(familyOf("nothing", nodes), []);
	const lone = lineageTree([node("hat", 2, ["missing"])], "hat");
	assert.deepEqual(ids(lone), ["hat"]);
	assert.deepEqual(lone.links, []);
});
