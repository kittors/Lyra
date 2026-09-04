/**
 * Rules that ship with the product.
 *
 * A rule system whose first screen is empty is a rule system nobody writes for: the format has to
 * be learned before anything is gained, and the gain is hypothetical until you have written one.
 * A handful of working examples answers both — they do something on day one, and they are what a
 * user copies when writing their own.
 *
 * The bar for adding one is high, because these apply to everybody:
 *
 *   It must catch something a good model still does. A rule against nonsense nobody writes is
 *   noise in a diagnostic panel.
 *
 *   It must not duplicate a guard that already exists. `tools/risk*.ts` decides whether a command
 *   needs approval; that is a gate, and a rule is a signpost. Two mechanisms saying the same thing
 *   means one of them gets ignored.
 *
 *   It must be right nearly always. A built-in that misfires teaches people to turn built-ins off.
 *
 * Every one of these can be disabled by name, and a user or project rule of the same name replaces
 * it outright.
 */

import type { Rule } from "./types.ts";

function builtin(rule: Omit<Rule, "path" | "source" | "bucket"> & { bucket?: Rule["bucket"] }): Rule {
	return {
		path: `builtin:${rule.name}`,
		source: "builtin",
		bucket: rule.conditions.length > 0 ? "stream" : rule.alwaysApply ? "always" : "book",
		...rule,
	} as Rule;
}

export const BUILTIN_RULES: Rule[] = [
	builtin({
		name: "no-secret-in-code",
		/*
		 * Provider key prefixes, not "anything that looks like a token".
		 *
		 * A generic high-entropy-string pattern fires on hashes, UUIDs, base64 fixtures and minified
		 * code — which is most of what an agent writes into a file on a normal day. These prefixes
		 * are published, unambiguous, and worth stopping mid-sentence for.
		 *
		 * The `sk-` arm allows hyphenated segments before the payload, because the current OpenAI
		 * and Anthropic formats put one there: `sk-proj-`, `sk-svcacct-`, `sk-ant-api03-`. A pattern
		 * of `sk-[A-Za-z0-9]{16,}` — which is what this shipped with — matches none of them, since
		 * the hyphen ends the character class four characters in. That is the most common key shape
		 * in existence today, and it walked straight through.
		 *
		 * The length floor stays on the *last* segment, so the giveaway is still a long opaque run
		 * and not the hyphens: `sk-example` and `sk-your-api-key-here` remain unmatched.
		 */
		conditions: [
			/\b(sk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,})/,
		],
		scopes: [{ kind: "tool" }, { kind: "text" }],
		interrupt: "always",
		repeat: "always",
		content:
			"你正要写入的内容里有一个真实的密钥。停下：\n" +
			"- 不要把它写进任何文件，包括示例、测试夹具和注释。\n" +
			"- 用环境变量或这个项目已有的凭证机制代替。\n" +
			"- 如果它是从别处读来的，就保持它在别处，不要转抄。\n" +
			"如果这只是一个明显伪造的占位值，把它改成不像真钥匙的形状（例如 `sk-example`）再继续。",
		description: "阻止把疑似真实密钥写进文件",
	}),

	builtin({
		name: "no-force-push",
		// `--force-with-lease` is the careful form and must not be caught by a pattern aimed at `--force`.
		conditions: [/git\s+push\b(?![^\n]*--force-with-lease)[^\n]*(?:--force\b|\s-f\b)/],
		scopes: [{ kind: "tool", tool: "bash" }],
		interrupt: "always",
		repeat: "always",
		content:
			"强制推送会覆盖远端历史，别人已经拉下去的提交会对不上。\n" +
			"- 如果只是要改最后一次提交，用 `--force-with-lease`：远端在你之后动过就会拒绝。\n" +
			"- 如果是共享分支，改用一个新提交来修正，不要重写历史。\n" +
			"- 确实需要强制推送时，先跟用户确认。",
		description: "强制推送前先停一下",
	}),

	builtin({
		name: "no-placeholder-delivery",
		/*
		 * Only the shapes that mean "I am handing you something unfinished and calling it done".
		 *
		 * A plain `TODO` is not one of them — it is ordinary in real code and flagging it would make
		 * this rule the boy who cried wolf.
		 */
		conditions: [
			/(?:TODO|FIXME)\s*:?\s*(?:implement|implementation|fill in|add logic|你来|待实现|补充实现)/i,
			/\/\/\s*(?:\.\.\.|…)\s*(?:rest of|remaining|其余|剩下的|省略)/i,
			/throw new Error\(\s*["'`]not implemented/i,
		],
		scopes: [{ kind: "tool", tool: "edit" }, { kind: "tool", tool: "write" }],
		interrupt: "always",
		repeat: { afterTurns: 5 },
		content:
			"你正要交付一个占位实现。\n" +
			"要么现在把它写完，要么就不要写这一段——一个看起来完成的空壳比一个明说没做的缺口更难发现。\n" +
			"如果确实缺少必要的信息才写不下去，停下来说明缺什么，并把能做完的部分做完。",
		description: "阻止把占位实现当成交付",
	}),
];

/** Built-in rule names, for the settings UI and for `disabledRules`. */
export const BUILTIN_RULE_NAMES = BUILTIN_RULES.map((rule) => rule.name);
