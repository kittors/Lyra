/**
 * 一个智能体能用哪些工具。
 *
 * 两档：全部（和派它的主会话一样多），或者自己挑。挑的时候按「它会碰到什么」分成几行——读、
 * 改、跑命令、上网、和别人协作——而不是一张按字母排的清单：给一个审查者配工具，人想的是「它
 * 不该改文件、不该跑命令」，不是「a 开头的要不要、b 开头的要不要」。
 *
 * 每个工具是一颗能按的胶囊，按下是强调色、带个勾。从前是一格一格的复选框加等宽字，二十个
 * 小方框排成两列，看起来像一张要填的表。
 */

import { Check } from "lucide-react";
import { Segmented } from "./controls.tsx";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

/* 分组和每个工具的说法都是 key，这两张表在模块加载时成型。 */
const GROUPS: { key: MessageKey; tools: string[] }[] = [
	{ key: "agentEditor.toolsRead", tools: ["read", "ls", "glob", "grep", "symbol", "lsp"] },
	{ key: "agentEditor.toolsWrite", tools: ["write", "edit"] },
	{ key: "agentEditor.toolsShell", tools: ["bash", "bash_output"] },
	{ key: "agentEditor.toolsWeb", tools: ["web_fetch", "web_search", "preview"] },
	{ key: "agentEditor.toolsAgent", tools: ["todo_write", "task", "skill", "rule", "recall", "learn", "ask_user"] },
];

const DOES: Record<string, MessageKey> = {
	read: "tools.read",
	write: "tools.create",
	edit: "tools.edit",
	ls: "tools.ls",
	glob: "tools.find",
	grep: "tools.grep",
	symbol: "tools.symbol",
	lsp: "tools.lsp",
	bash: "tools.bash",
	bash_output: "tools.output",
	web_fetch: "tools.fetch",
	web_search: "tools.webSearch",
	preview: "tools.preview",
	todo_write: "tools.todo",
	task: "tools.delegate",
	skill: "tools.skill",
	recall: "tools.recall",
	learn: "tools.learn",
	ask_user: "tools.askUser",
};

export function ToolPicker({ tools, value, readOnly, onChange }: {
	/** 这台机器上现在有的工具。 */
	tools: string[];
	value: string[] | "*";
	/** 从「全部」切到「自己挑」时先勾上的那几个：只读的一组，最不会出事的起点。 */
	readOnly: string[];
	onChange: (next: string[] | "*") => void;
}) {
	const { t } = useI18n();
	const all = value === "*";
	const chosen = new Set(all ? [] : value);
	// 定义里写着、但这台机器上没有的工具也要列出来：取消勾选它是把它从定义里拿掉的唯一办法。
	const known = [...new Set([...tools, ...chosen])];
	const grouped = GROUPS.map((group) => ({ key: group.key, tools: group.tools.filter((name) => known.includes(name)) }));
	const others = known.filter((name) => !GROUPS.some((group) => group.tools.includes(name))).sort();
	const rows = [...grouped, { key: "agentEditor.toolsOther" as MessageKey, tools: others }].filter((row) => row.tools.length > 0);
	const toggle = (name: string) => {
		if (all) return;
		onChange(chosen.has(name) ? value.filter((tool) => tool !== name) : [...value, name]);
	};

	return (
		<section className="rounded-[14px] border border-line bg-card/40 p-4" data-agent-tools="">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="text-label text-ink">{t("agentEditor.allowedTools")}</p>
					<p className="mt-0.5 text-detail text-ink-faint">{all ? t("agentEditor.allTools") : t("agentEditor.toolsCount", { n: chosen.size })}</p>
				</div>
				<Segmented value={all ? "all" : "pick"} onChange={(next) => onChange(next === "all" ? "*" : readOnly.filter((name) => known.includes(name)))}
					options={[{ value: "all", label: t("agentEditor.toolsAll") }, { value: "pick", label: t("agentEditor.toolsPick") }]} />
			</div>
			{!all && (
				<div className="ly-enter mt-4 space-y-3 border-t border-line-soft pt-3.5">
					{rows.map((row) => (
						<div key={row.key} className="flex gap-3">
							<span className="w-14 shrink-0 pt-[5px] text-detail text-ink-faint">{t(row.key)}</span>
							<div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
								{row.tools.map((name) => {
									const on = chosen.has(name);
									return (
										<button key={name} type="button" role="checkbox" aria-checked={on} aria-label={name} data-ly-tip={DOES[name] ? t(DOES[name]) : name} data-tool={name}
											onClick={() => toggle(name)}
											className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-mono text-detail transition-colors duration-[var(--ly-t-quick)] ${
												on ? "bg-accent/15 text-accent hover:bg-accent/20" : "bg-card text-ink-muted hover:bg-card-hover hover:text-ink"
											}`}>
											{on && <Check size={12} strokeWidth={2.4} className="-ml-0.5 shrink-0" aria-hidden />}
											{name}
										</button>
									);
								})}
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
