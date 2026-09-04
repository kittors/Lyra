/**
 * The schemes that ship.
 *
 * Each is small because the router already did the parsing, the indexing and the range slicing.
 * What is left per handler is the part that is genuinely specific: where the bytes are, and what
 * counts as escaping.
 */

import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuleSet } from "../rules/types.ts";
import { RULES_KEY } from "../tools/rule.ts";
import type { Skill } from "../skills/loader.ts";
import { SKILLS_KEY } from "../skills/tool.ts";
import { resolveInside, stillInside } from "./router.ts";
import { ResourceError, type Completion, type ParsedUrl, type Resource, type ResourceContext, type ResourceHandler } from "./types.ts";

/**
 * `skill://<name>` is the SKILL.md; `skill://<name>/<path>` is a file in its directory.
 *
 * Read-only. Reading a skill and activating one are different acts — the `skill` tool injects the
 * body as an instruction the model then follows, this returns text it is looking at — and they
 * both stay, because "consult" and "adopt" are not the same request.
 */
export const skillResource: ResourceHandler = {
	scheme: "skill",
	/*
	 * Three forms, each paired with what it is for.
	 *
	 * The first draft led with "技能正文" and listed the forms after, and a weaker model read that
	 * as "a skill is a directory" — it went looking for `skill://pdf-extract/README.md`, a file
	 * nobody had mentioned, then fell back to guessing filenames on disk. Naming the bare form
	 * first, explicitly, is the difference between three affordances and one guess.
	 */
	describe: "`skill://<名字>` 是技能正文本身；`skill://<名字>/` 列出它的目录里有什么；`skill://<名字>/<文件名>` 读目录里的某个文件",

	async resolve(url: ParsedUrl, ctx: ResourceContext): Promise<Resource> {
		const skills = (ctx.state.get(SKILLS_KEY) as Skill[] | undefined) ?? [];
		const [name, ...rest] = url.segments;
		const skill = skills.find((s) => s.name === name);
		if (!skill) {
			const available = skills.map((s) => s.name).join("、");
			throw new ResourceError(`没有叫“${name}”的技能。现有的是：${available || "（一个都没有）"}`);
		}

		/*
		 * A trailing slash asks what is in the directory, not what the skill says.
		 *
		 * Without this the address space has no answer to "what files does this skill have", and a
		 * model that wants one falls back to walking the filesystem — which it did, and guessed the
		 * wrong extension on the way. An address space that covers reading but not listing sends
		 * people back to paths for half their questions, which is most of the value gone.
		 */
		if (rest.length === 0 && url.path.endsWith("/")) {
			const { readdir } = await import("node:fs/promises");
			const entries = await readdir(skill.dir, { withFileTypes: true }).catch(() => []);
			const listing = entries
				.map((entry) => `- skill://${skill.name}/${entry.name}${entry.isDirectory() ? "/" : ""}`)
				.join("\n");
			return {
				url: url.raw,
				content: listing || `（技能“${skill.name}”的目录里没有别的文件）`,
				contentType: "text/markdown",
				label: `技能“${skill.name}”目录里的全部文件`,
				meta: { name: skill.name, dir: skill.dir },
			};
		}

		if (rest.length === 0) {
			return {
				url: url.raw,
				content: skill.content,
				contentType: "text/markdown",
				label: `技能“${skill.name}”的完整正文`,
				meta: { name: skill.name, dir: skill.dir, source: skill.source },
			};
		}

		const target = resolveInside(skill.dir, rest.join("/"));
		if (!target) throw new ResourceError(`\`${url.raw}\` 指到了技能目录外面。`);
		if (!(await stillInside(skill.dir, target))) throw new ResourceError(`\`${url.raw}\` 经过软链后指到了技能目录外面。`);

		const content = await readFile(target, "utf8").catch(() => null);
		if (content === null) throw new ResourceError(`技能“${name}”里没有 ${rest.join("/")}。`);
		return {
			url: url.raw,
			content,
			contentType: "text/plain",
			label: `技能“${name}”目录里 ${rest.join("/")} 的完整内容`,
			meta: { name: skill.name, file: target },
		};
	},

	async list(ctx: ResourceContext): Promise<Completion[]> {
		const skills = (ctx.state.get(SKILLS_KEY) as Skill[] | undefined) ?? [];
		return skills.map((s) => ({ value: `skill://${s.name}`, description: s.description }));
	},
};

/** `rule://<name>` is a rule body. Read-only, and that is a boundary rather than an omission. */
export const ruleResource: ResourceHandler = {
	scheme: "rule",
	describe: "规则正文",

	async resolve(url: ParsedUrl, ctx: ResourceContext): Promise<Resource> {
		const set = ctx.state.get(RULES_KEY) as RuleSet | undefined;
		const all = set ? [...set.always, ...set.book, ...set.stream] : [];
		const name = url.segments.join("/");
		const rule = all.find((r) => r.name === name);
		if (!rule) {
			const available = all.map((r) => r.name).join("、");
			throw new ResourceError(`没有叫“${name}”的规则。现有的是：${available || "（一条都没有）"}`);
		}
		return {
			url: url.raw,
			content: rule.content,
			contentType: "text/markdown",
			label: `规则“${rule.name}”的完整正文`,
			meta: { name: rule.name, path: rule.path, bucket: rule.bucket, source: rule.source },
		};
	},

	async list(ctx: ResourceContext): Promise<Completion[]> {
		const set = ctx.state.get(RULES_KEY) as RuleSet | undefined;
		const all = set ? [...set.always, ...set.book, ...set.stream] : [];
		return all.map((r) => ({ value: `rule://${r.name}`, description: r.description ?? r.bucket }));
	},
};

/**
 * `scratch://<path>` is the session's own directory. The one writable scheme.
 *
 * It already existed as a bare filesystem path the prompt told the model about, which meant the
 * model had to be trusted to keep using it — and a path in a prompt is a suggestion. As an address
 * it is a place, and `write scratch://notes.md` cannot land in the user's project by mistake.
 */
export const scratchResource: ResourceHandler = {
	scheme: "scratch",
	describe: "本次会话的临时目录，可读可写，会话结束后消失",

	async resolve(url: ParsedUrl, ctx: ResourceContext): Promise<Resource> {
		const target = scratchTarget(url, ctx);
		const content = await readFile(target, "utf8").catch(() => null);
		if (content === null) throw new ResourceError(`临时目录里没有 ${url.path}。`);
		return { url: url.raw, content, contentType: "text/plain", meta: { file: target } };
	},

	async write(url: ParsedUrl, content: string, ctx: ResourceContext): Promise<void> {
		const target = scratchTarget(url, ctx);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");
	},

	async list(ctx: ResourceContext): Promise<Completion[]> {
		if (!ctx.scratchDir) return [];
		const { readdir } = await import("node:fs/promises");
		const entries = await readdir(ctx.scratchDir, { withFileTypes: true }).catch(() => []);
		return entries.filter((e) => e.isFile()).map((e) => ({ value: `scratch://${e.name}` }));
	},
};

function scratchTarget(url: ParsedUrl, ctx: ResourceContext): string {
	if (!ctx.scratchDir) throw new ResourceError("这个会话没有临时目录。");
	const target = resolveInside(ctx.scratchDir, url.segments.join("/"));
	if (!target) throw new ResourceError(`\`${url.raw}\` 指到了临时目录外面。`);
	return target;
}

/**
 * `lyra://<topic>` is Lyra's own documentation.
 *
 * The case for it: when someone says "write me a skill that handles PDFs", the agent's alternative
 * to reading this is whatever impression of the format survived in its training data — which for a
 * format this app defines is a guess with the shape of a fact. One read produces a skill that
 * actually loads.
 *
 * The prompt has to say **only read this when the question is about Lyra**, or the model will
 * consult it in the middle of unrelated work.
 */
const TOPICS: Record<string, { title: string; body: string }> = {
	"writing-skills": {
		title: "怎么写一个技能",
		body: [
			"技能是一个目录，里面有一个 `SKILL.md`。放在 `<项目>/.lyra/skills/<名字>/` 或 `~/.lyra/skills/<名字>/`。",
			"",
			"```markdown",
			"---",
			"name: pdf-extract           # 小写、连字符分隔，必须和目录名一致的话更好认",
			"description: 从 PDF 里抽取文本与表格。用户提到 PDF、扫描件、发票时用这个。",
			"allowed-tools: [read, bash] # 可选。省略表示不限制",
			"disable-model-invocation: false  # 可选。true 表示只能由人手动触发",
			"---",
			"",
			"正文就是给模型的指令。写清楚步骤，不要写背景介绍。",
			"技能目录里的其他文件可以用 `skill://pdf-extract/<文件名>` 读到。",
			"```",
			"",
			"**`description` 是最重要的一行**——模型是靠读它来决定用不用这个技能的。",
			"写「什么时候该用它」，不要写「它是什么」。",
			"",
			"同名时优先级：项目 > 用户 > 插件包 > 代码里注册的。",
		].join("\n"),
	},
	"writing-rules": {
		title: "怎么写一条规则",
		body: [
			"规则是一个 markdown 文件，放在 `<项目>/.lyra/rules/` 或 `~/.lyra/rules/`。",
			"按 frontmatter 分成三桶，**这决定了它什么时候花你的 token**：",
			"",
			"| 桶 | 怎么触发 | frontmatter |",
			"| --- | --- | --- |",
			"| 常驻 | 每一轮都在提示词里 | `alwaysApply: true` |",
			"| 规则库 | 列出名字，模型按需读正文 | 有 `description`，无 `condition` |",
			"| 流规则 | 模型写出匹配内容时才注入 | 有 `condition` |",
			"",
			"```markdown",
			"---",
			"condition: '\\bvar\\s+\\w'   # 正则。写出匹配内容时中止并重来",
			"scope: text                 # text / thinking / tool:<名字> / tool:bash(*.sh)",
			"interrupt: always           # always / prose-only / tool-only / never",
			"repeat: once                # once / always / { afterTurns: 5 }",
			"---",
			"这个仓库不用 `var`。用 `const`，需要重新赋值时用 `let`。",
			"```",
			"",
			"**流规则在提示词里不占一个字节**，所以一个项目可以有五十条。",
			"",
			"`.cursor/rules`、`.windsurf/rules`、`.clinerules`、`.github/instructions`",
			"里已有的规则会被直接读取，不需要迁移。",
		].join("\n"),
	},
	"editing-files": {
		title: "编辑文件的格式",
		body: [
			"`edit` 用行锚定的补丁，不是 `old_string`/`new_string`。",
			"",
			"先 `read` 拿到文件头上的 `[路径#TAG]`，编辑时把那个 tag 带上：",
			"",
			"```",
			"REPLACE 12-14",
			"+新的第一行",
			"+新的第二行",
			"",
			"INSERT AFTER 40",
			"+插在第 40 行后面",
			"",
			"DELETE 7-9",
			"```",
			"",
			"tag 对不上就说明文件在你读完之后被改过了，这时编辑会被拒绝而不是覆盖。",
			"重新 `read` 再按新的行号来。",
		].join("\n"),
	},
	addresses: {
		title: "地址空间",
		body: [
			"这些地址在 `read` 里跟普通路径一样用：",
			"",
			"- `skill://<名字>` 技能正文；`skill://<名字>/<路径>` 技能目录里的文件",
			"- `rule://<名字>` 规则正文",
			"- `scratch://<路径>` 本次会话的临时目录，**可写**，会话结束后消失",
			"- `lyra://<主题>` 这份文档本身",
			"",
			"末尾可以跟行范围：`read skill://pdf:10-40`。",
			"只给 scheme（`read rule://`）会列出这个命名空间里有什么。",
		].join("\n"),
	},
};

export const lyraResource: ResourceHandler = {
	scheme: "lyra",
	describe: "Lyra 自己的文档。**只在用户问 Lyra 本身时读**",

	async resolve(url: ParsedUrl): Promise<Resource> {
		const topic = url.segments.join("/");
		const found = TOPICS[topic];
		if (!found) {
			throw new ResourceError(`没有“${topic}”这个主题。现有的是：${Object.keys(TOPICS).join("、")}`);
		}
		return {
			url: url.raw,
			content: `# ${found.title}\n\n${found.body}`,
			contentType: "text/markdown",
			immutable: true,
			label: `Lyra 文档：${found.title}（完整）`,
			meta: { topic },
		};
	},

	async list(): Promise<Completion[]> {
		return Object.entries(TOPICS).map(([key, value]) => ({ value: `lyra://${key}`, description: value.title }));
	},
};

/** Remove a session's scratch directory. */
export async function clearScratch(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true }).catch(() => {});
}


/** Where the scratch directory for a session lives, given the app's home. */
export function scratchPath(home: string, sessionId: string): string {
	return join(home, "scratch", sessionId);
}

/**
 * `agent://<id>` is a sub-agent's structured result; `agent://<id>/<path>` is one field of it.
 *
 * The reason for the path half: in an orchestration with eight sub-agents, a parent that wants one
 * value has to re-read a whole reply to get it, and does that eight times. `agent://sub-a1b2/
 * files.0.path` is the value.
 *
 * The path syntax is `a.b.0.c` and nothing more. JSONPath expressions (`$..[?(@.x)]`) are a second
 * language, and the cost of a model learning it exceeds what it buys over reading one more field.
 */
export const agentResource: ResourceHandler = {
	scheme: "agent",
	describe: "`agent://<id>` 子代理交回的结构化结果；`agent://<id>/<字段路径>` 取其中一个字段（如 `files.0.path`）",

	async resolve(url: ParsedUrl, ctx: ResourceContext): Promise<Resource> {
		const registry = ctx.state.get(SUBAGENTS_KEY) as SubAgentLookup | undefined;
		if (!registry) throw new ResourceError("这个会话没有子代理。");

		const [id, ...rest] = url.segments;
		/*
		 * Accept a suffix as well as the full id.
		 *
		 * The id is `<session>:sub:<8 hex>`, and what appears in the transcript and what a person
		 * types is the short tail. Resolving through `detail` in both cases matters: `list` returns
		 * summaries, which carry no structured output, and taking one of those would report every
		 * short-form address as having no result.
		 */
		const match = registry.detail(id) ?? (() => {
			const found = registry.list().find((r) => r.id.endsWith(id));
			return found ? registry.detail(found.id) : null;
		})();
		const record = match;
		if (!record) {
			const known = registry.list().map((r) => r.id).join("、");
			throw new ResourceError(`没有 id 是“${id}”的子代理。现有的是：${known || "（一个都没有）"}`);
		}
		if (!record.output) {
			/*
			 * A sub-agent without a declared schema returns prose, and that is not a failure — so the
			 * text is handed over rather than an error. Saying "this one has no structured output"
			 * and stopping would send the parent looking for a way to get it, and there is not one.
			 */
			return {
				url: url.raw,
				content: record.answer ?? "（这个子代理还没有结果）",
				contentType: "text/plain",
				label: `子代理 ${record.agent} 的回复（这个 agent 没有声明结构化输出，所以是文本）`,
				meta: { id: record.id, agent: record.agent, status: record.status },
			};
		}

		if (rest.length === 0) {
			return {
				url: url.raw,
				content: JSON.stringify(record.output, null, 2),
				contentType: "application/json",
				label: `子代理 ${record.agent} 的完整结果`,
				meta: { id: record.id, agent: record.agent, status: record.status, warnings: record.warnings },
			};
		}

		const picked = pickPath(record.output, rest.join("/").split("."));
		if (picked === undefined) {
			throw new ResourceError(`子代理 ${record.id} 的结果里没有 \`${rest.join("/")}\`。可用的顶层字段：${Object.keys(record.output).join("、")}`);
		}
		return {
			url: url.raw,
			content: typeof picked === "string" ? picked : JSON.stringify(picked, null, 2),
			contentType: typeof picked === "string" ? "text/plain" : "application/json",
			label: `子代理 ${record.agent} 结果里的 ${rest.join("/")}`,
			meta: { id: record.id, agent: record.agent },
		};
	},

	async list(ctx: ResourceContext): Promise<Completion[]> {
		const registry = ctx.state.get(SUBAGENTS_KEY) as SubAgentLookup | undefined;
		if (!registry) return [];
		return registry.list().map((r) => ({ value: `agent://${r.id}`, description: `${r.agent} · ${r.description} · ${r.status}` }));
	},
};

/** Only what `agent://` needs, so this file does not depend on the registry's whole shape. */
interface SubAgentLookup {
	list(): { id: string; agent: string; description: string; status: string }[];
	detail(id: string): {
		id: string;
		agent: string;
		status: string;
		answer?: string;
		output?: Record<string, unknown>;
		warnings?: string[];
	} | null;
}

export const SUBAGENTS_KEY = "subAgentRegistry";

/** Walk `a.b.0.c`. Anything the path does not fit returns undefined rather than throwing. */
function pickPath(root: unknown, segments: string[]): unknown {
	let current: unknown = root;
	for (const segment of segments) {
		if (current === null || current === undefined) return undefined;
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index)) return undefined;
			current = current.at(index);
			continue;
		}
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/**
 * The shipped schemes.
 *
 * `agent://` is in the list but contributes nothing until a session registers a sub-agent registry,
 * which is what keeps it out of the prompt for sessions that cannot dispatch — an advertised
 * address that never resolves teaches the model to try things that fail.
 */
export const BUILTIN_RESOURCES: ResourceHandler[] = [skillResource, ruleResource, scratchResource, lyraResource, agentResource];
