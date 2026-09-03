/**
 * What one recorded run actually consisted of.
 *
 * The list above answers "what has it done"; this answers "what exactly did it send, and what came
 * back" — the question you ask when a step did something you did not expect. Everything shown here
 * is read from what was already written down, so it says what happened rather than what the UI
 * thinks happened.
 *
 * Long output is capped rather than given its own scrollbar: a scrolling region inside a scrolling
 * panel means the wheel does something different depending on where the pointer happens to be.
 */

import type { ToolRun } from "../../store/index.ts";
import { CodeText } from "../conversation/detail/CodeText.tsx";
import { Section } from "../conversation/detail/Section.tsx";

/** Past this, output is trimmed with a note rather than made scrollable. */
const MAX_OUTPUT = 4000;

export function RunDetail({ run }: { run: ToolRun }) {
	const command = typeof run.args?.command === "string" ? run.args.command : null;
	const rest = { ...run.args };
	delete rest.command;
	const output = textOf(run);

	return (
		<>
			{command && (
				<Section title="命令" mono tone="ink">
					<span className="mr-2 select-none text-ink-faint">$</span>
					<CodeText text={command} kind="shell" />
				</Section>
			)}

			{Object.keys(rest).length > 0 && (
				<Section title="参数" mono>
					<CodeText text={JSON.stringify(rest, null, 2)} kind="json" />
				</Section>
			)}

			<Section
				title={run.status === "error" ? "错误" : run.status === "running" ? "输出（进行中）" : "结果"}
				mono
				tone={run.status === "error" ? "danger" : "muted"}
			>
				{output || (run.status === "running" ? "等待输出…" : "（无输出）")}
			</Section>
		</>
	);
}

/** A tool result is a list of parts; only the text ones can be shown as text. */
function textOf(run: ToolRun): string {
	const text = (run.result?.content ?? [])
		.filter((part) => part.type === "text")
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("\n")
		.trim();
	if (text.length <= MAX_OUTPUT) return text;
	return `${text.slice(0, MAX_OUTPUT)}\n\n… 还有 ${text.length - MAX_OUTPUT} 个字符`;
}
