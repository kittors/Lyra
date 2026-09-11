/**
 * Anthropic Messages 链上的工具 schema 形状。
 *
 * Anthropic 的校验器只认一小部分 JSON Schema 关键字，别的**整个请求拒收**——而且工具列表每一轮都发，
 * 所以装一个 Zod 或 Pydantic 生成 schema 的 MCP 服务器就足够让这个供应商永久不可用，用户还不会把它
 * 联想到刚装的那个 MCP。
 *
 * 白名单跟着 Anthropic 官方 Python SDK 的 `lib/_parse/_transform.py::transform_schema` 走（下面每条的
 * 出处写在各自的注释里，来源是 oh-my-pi `anthropic.ts:4565-4605` 与 `:4690-4790`，它注明了这个出处）。
 * 每个键具体报什么错**没有原文可引**（未验证原文）——唯一带说明的是 `minItems` 在 object 节点上会被
 * 拒，连 `minItems: 0` 也拒（oh-my-pi `anthropic.ts:4608` 的注释）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeToolSchema, toAnthropicTools } from "../src/ai/anthropic-messages-request.ts";
import type { ToolSpec } from "../src/types.ts";

const normalize = (schema: unknown) => normalizeToolSchema(schema) as Record<string, any>;

test("留不住的键降级进 description，而不是删掉——删掉模型就不知道这条约束了", () => {
	const out = normalize({
		type: "object",
		properties: {
			names: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 },
		},
		required: ["names"],
	});
	const names = out.properties.names;
	assert.equal(names.minItems, undefined, "值不是 0/1 的 minItems 留不住");
	assert.equal(names.maxItems, undefined);
	// 顺序不是源码顺序（`minItems` 先按 array 的白名单留下、再被值检查踢出来，所以排在后面），但它是
	// **确定的**——工具列表每一轮都发，描述文字每轮不一样的话提示缓存就白搭了。
	assert.equal(names.description, "{maxItems: 8, minItems: 2}");
	assert.equal(normalize({ type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 }).description, names.description);
	assert.deepEqual(names.items, { type: "string" }, "结构本身没被动");
	assert.deepEqual(out.required, ["names"]);
});

test("`minItems` 是 0 或 1 时留着——那两个值 Anthropic 收", () => {
	for (const minItems of [0, 1]) {
		const out = normalize({ type: "array", items: { type: "string" }, minItems });
		assert.equal(out.minItems, minItems, String(minItems));
		assert.equal(out.description, undefined);
	}
});

test("object 节点上的 `minItems` 一律降级，连 0 也降", () => {
	// 出处：oh-my-pi `anthropic.ts:4608`——`minItems`/`maxItems` 属于数组，放在 object 上会被拒。
	const out = normalize({ type: "object", properties: { a: { type: "string" } }, minItems: 0 });
	assert.equal(out.minItems, undefined);
	assert.equal(out.description, "{minItems: 0}");
});

test("Zod / Pydantic 最爱生成的那几个键都进描述", () => {
	const out = normalize({
		type: "object",
		properties: {
			slug: { type: "string", pattern: "^[a-z0-9-]+$", minLength: 3, maxLength: 40 },
			count: { type: "integer", exclusiveMinimum: 0, multipleOf: 2 },
		},
		additionalProperties: false,
	});
	assert.equal(out.properties.slug.pattern, undefined);
	assert.match(String(out.properties.slug.description), /pattern: "\^\[a-z0-9-\]\+\$"/);
	assert.match(String(out.properties.slug.description), /minLength: 3/);
	assert.equal(out.properties.count.exclusiveMinimum, undefined);
	assert.equal(out.properties.count.description, "{exclusiveMinimum: 0, multipleOf: 2}");
	assert.equal(out.additionalProperties, false, "这个键是留着的");
});

test("`format` 在 Anthropic 认的那张表里才留，别的进描述", () => {
	assert.equal(normalize({ type: "string", format: "uri" }).format, "uri");
	assert.equal(normalize({ type: "string", format: "date-time" }).format, "date-time");
	assert.equal(normalize({ type: "string", format: "uuid" }).format, "uuid");
	const odd = normalize({ type: "string", format: "slug" });
	assert.equal(odd.format, undefined);
	assert.equal(odd.description, '{format: "slug"}');
});

test("`oneOf` 不在白名单里，整块进描述；`anyOf` / `allOf` 留着并且递归进去", () => {
	const one = normalize({ oneOf: [{ type: "string" }, { type: "number" }] });
	assert.equal(one.oneOf, undefined);
	assert.match(String(one.description), /^\{oneOf: /);

	const any = normalize({ anyOf: [{ type: "string", pattern: "^a" }, { type: "null" }] });
	assert.equal(any.anyOf.length, 2);
	assert.equal(any.anyOf[0].pattern, undefined, "递归也要走到分支里");
	assert.equal(any.anyOf[0].description, '{pattern: "^a"}');
});

test("`$ref` / `$defs` 留着，定义里面也归一化", () => {
	const out = normalize({
		type: "object",
		properties: { where: { $ref: "#/$defs/Range" } },
		$defs: { Range: { type: "array", items: { type: "integer" }, minItems: 2 } },
	});
	assert.deepEqual(out.properties.where, { $ref: "#/$defs/Range" });
	assert.equal(out.$defs.Range.minItems, undefined);
	assert.equal(out.$defs.Range.description, "{minItems: 2}");
});

test("`definitions`（旧写法）同样处理", () => {
	const out = normalize({ type: "object", definitions: { R: { type: "string", pattern: "^x" } } });
	assert.equal(out.definitions.R.description, '{pattern: "^x"}');
});

test("嵌套的 properties / items / prefixItems 都递归到底", () => {
	const out = normalize({
		type: "object",
		properties: {
			edits: {
				type: "array",
				items: { type: "object", properties: { at: { type: "integer", minimum: 0 } }, minProperties: 1 },
			},
			pair: { type: "array", prefixItems: [{ type: "string", pattern: "^a" }, { type: "number" }] },
		},
	});
	assert.equal(out.properties.edits.items.properties.at.minimum, undefined);
	assert.equal(out.properties.edits.items.properties.at.description, "{minimum: 0}");
	assert.equal(out.properties.edits.items.minProperties, undefined);
	assert.equal(out.properties.pair.prefixItems[0].description, '{pattern: "^a"}');
});

test("本来就有 description 时，降级的内容接在后面而不是顶掉它", () => {
	const out = normalize({ type: "string", description: "要搜的正则。", pattern: "^\\d+$" });
	assert.equal(out.description, '要搜的正则。\n\n{pattern: "^\\\\d+$"}');
});

test("没有一个键需要降级时，description 不被凭空造出来", () => {
	const out = normalize({ type: "object", properties: { a: { type: "string" } }, required: ["a"] });
	assert.equal(out.description, undefined);
	assert.equal(out.properties.a.description, undefined);
});

test("值是 undefined 的键不算「有约束」，不写进描述", () => {
	const out = normalize({ type: "array", items: { type: "string" }, minItems: undefined, maxItems: undefined });
	assert.equal(out.description, undefined);
});

test("没写 type 时按 properties / items 猜，猜出来的类型决定留哪些键", () => {
	const asObject = normalize({ properties: { a: { type: "string" } }, required: ["a"], minItems: 3 });
	assert.deepEqual(asObject.required, ["a"], "猜成 object 才留得住 required");
	assert.equal(asObject.minItems, undefined);
	const asArray = normalize({ items: { type: "string" }, minItems: 1 });
	assert.equal(asArray.minItems, 1);
});

test("循环引用不爆栈，而且同一个节点只归一化一次", () => {
	const node: Record<string, unknown> = { type: "object", properties: {}, pattern: "^loop" };
	(node.properties as Record<string, unknown>).self = node;
	const out = normalize(node);
	assert.equal(out.properties.self, out, "自指的地方指回归一化后的同一个对象");
	assert.equal(out.description, '{pattern: "^loop"}');
});

test("不是对象的 schema 原样返回，不被包成对象", () => {
	assert.equal(normalizeToolSchema(undefined), undefined);
	assert.equal(normalizeToolSchema("string"), "string");
	assert.deepEqual(normalizeToolSchema([1, 2]), [1, 2]);
});

test("归一化不改原来那份 schema——工具定义在会话里是共用的", () => {
	const original = { type: "object", properties: { a: { type: "string", pattern: "^a" } }, minItems: 2 };
	const before = JSON.stringify(original);
	normalizeToolSchema(original);
	assert.equal(JSON.stringify(original), before);
});

test("工具列表里真的走了这一遍，而且缓存断点还在最后一个上", () => {
	const tools: ToolSpec[] = [
		{ name: "grep", description: "搜", parameters: { type: "object", properties: { pattern: { type: "string", pattern: "^.+$" } } } },
		{ name: "read", description: "读", parameters: { type: "object", properties: { path: { type: "string" } } } },
	];
	const out = toAnthropicTools(tools) as Array<Record<string, any>>;
	assert.equal(out[0].input_schema.properties.pattern.pattern, undefined);
	assert.equal(out[0].input_schema.properties.pattern.description, '{pattern: "^.+$"}');
	assert.equal(out[0].cache_control, undefined);
	assert.deepEqual(out[1].cache_control, { type: "ephemeral" });
});
