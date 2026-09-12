/**
 * Sorting a new issue.
 *
 * Two things happen here, and only the first one is automatic in any meaningful sense: a label
 * that says which area of the code this is about, and a comment that says what is missing from
 * the report. The second is the one that saves time — most bug reports that go nowhere go nowhere
 * because nobody ever asked for the one detail that would have made them reproducible.
 *
 * The agent never closes anything and never applies `bug` or `confirmed`. Deciding that something
 * is a real defect is a judgement about the code, and it should be made by someone who can then
 * go and fix it.
 */

import { addLabels, readIssue, removeLabel, upsertComment, type Repo } from "../github.ts";
import { runOnce } from "../agent.ts";

const TRIAGE_MARKER = "<!-- lyra-agent: triage -->";

/** The areas an issue can be about. The agent picks from this list and nothing else. */
export const AREAS = [
	"area:agent",
	"area:model",
	"area:session",
	"area:plugins",
	"area:desktop",
	"area:mobile",
	"area:build",
] as const;

export async function triageIssue(args: {
	token: string;
	repo: Repo;
	number: number;
	cwd: string;
	verbose?: boolean;
}): Promise<void> {
	const issue = await readIssue(args.token, args.repo, args.number);

	const answer = await runOnce({
		cwd: args.cwd,
		verbose: args.verbose,
		prompt: prompt(issue.title, issue.body),
	});

	const { labels, comment } = parse(answer);

	await addLabels(args.token, args.repo, args.number, labels);
	if (comment) {
		await upsertComment(args.token, args.repo, args.number, TRIAGE_MARKER, `## 🤖 分类\n\n${comment}`);
	}
	// It has been triaged now, whatever the outcome.
	if (labels.length > 0) await removeLabel(args.token, args.repo, args.number, "needs-triage");
}

function prompt(title: string, body: string): string {
	return `给这个仓库的一个新 issue 做分类。仓库代码就在当前目录，可以读、可以搜——
在判断它属于哪一块之前，最好先找到相关的代码确认一下。

标题：${title}

正文：
${body || "（空）"}

做两件事：

**一、选一个区域标签**，只能从这个列表里选，最多两个：
${AREAS.map((a) => `- ${a}`).join("\n")}

**二、指出报告里缺什么。** 只说真正影响判断的那些：没有复现步骤、没说期望是什么、
没说版本、错误信息被转述而不是原样贴出来。如果报告已经足够完整，就说"信息完整"。

不要做的事：不要判断这是不是真 bug，不要提修复方案，不要关闭或建议关闭任何东西。

按这个格式回答，不要有别的内容：

LABELS: area:xxx, area:yyy
COMMENT: 一到三句话，中文，说清楚缺什么、为什么需要它。`;
}

/** Pull the two fields out, ignoring anything the model added around them. */
export function parse(answer: string): { labels: string[]; comment: string } {
	const labelLine = /^LABELS:\s*(.+)$/im.exec(answer);
	const commentLine = /^COMMENT:\s*([\s\S]+)$/im.exec(answer);

	const labels = (labelLine?.[1] ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s): s is (typeof AREAS)[number] => (AREAS as readonly string[]).includes(s))
		.slice(0, 2);

	return { labels, comment: (commentLine?.[1] ?? "").trim().slice(0, 1000) };
}
