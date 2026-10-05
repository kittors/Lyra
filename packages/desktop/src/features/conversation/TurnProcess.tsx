import { Collapse } from "../../ui/layout/Collapse.tsx";
/**
 * 一段过程，收成一行。一轮里模型中途说的话把过程切成几段，话留在外面（见 `turnBlocks`）。
 *
 * 一轮读下来是「想 → 做 → 说」。过程值得看一次——正在跑的时候你就想看着它——但看过之后，翻回
 * 一段旧对话时四十行工具卡片挡在答案前面就只是噪音了。所以这一行是过程的开关。
 *
 * 收起时它必须说清楚里面是什么，否则就是把东西藏起来而已。说的是名词不是事件：「思考 3 次 ·
 * 读取文件 5 个、执行命令」，而不是「12 个步骤」——没人见过那 12 个步骤。全是思考、一个工具都没调
 * 时它说「思考了一会儿」，因为那时候确实没有别的可说。
 *
 * 行的骨架和思考行、工具行是同一个（见 `FlowRow`），里面的过程挂在左边一条竖线下面。
 */

import { Layers } from "lucide-react";

import { FlowRow } from "./FlowRow.tsx";
import { translate } from "../../i18n/translate.ts";
import { useTranscriptDisclosure } from "./view-state.ts";
import { useCallChain } from "./call-chain.ts";

export function TurnProcess({
	counts,
	work,
	running,
	stateKey,
	children,
	trailing,
}: {
	counts: { tools: number; thinking: number };
	/** What the calls in this turn did, in words — see `describeRun`. Falls back to a bare count. */
	work?: string;
	/** 收起那一行的行尾：这一轮派出去的子智能体的脸。 */
	trailing?: React.ReactNode;
	/** 正在跑的那一轮。「展开」排法下它全程摊开、没有那一行；「折叠」排法下只影响标记。 */
	running: boolean;
	stateKey?: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useTranscriptDisclosure(stateKey);
	const chain = useCallChain();

	if (chain === "expanded") {
		// The earlier layout: no line while the turn runs (it is shown in full), folded once it ends.
		const shown = running || open;
		return (
			<div data-ly-turn-process={running ? "running" : "done"} data-ly-turn-open={shown ? "" : undefined}>
				{!running && (
					<FlowRow
						icon={<Layers size={13} strokeWidth={1.8} />}
						summary={countsOnly(counts)}
						trailing={trailing}
						label={translate("process.turn")}
						open={shown}
						onToggle={() => setOpen((value) => !value)}
					/>
				)}
				<Collapse open={shown} bodyClassName={running ? "flex flex-col gap-2.5" : "flex flex-col gap-2.5 pt-2.5"}>{children}</Collapse>
			</div>
		);
	}

	/*
	 * Folded by default, running or not — the line's tally already says what is going on, and the
	 * replies between segments stay outside it. Opening one is remembered as the person's choice.
	 */
	return (
		<div data-ly-turn-process={running ? "running" : "done"} data-ly-turn-open={open ? "" : undefined}>
			<FlowRow
				icon={<Layers size={13} strokeWidth={1.8} />}
				summary={
					// The words change as calls land; the key keeps the fade on the words. See `FlowRow`.
					<span key={summarize(counts, work)} className="ly-fade-in">
						{summarize(counts, work)}
					</span>
				}
				trailing={trailing}
				label={translate("process.turn")}
				open={open}
				onToggle={() => setOpen((value) => !value)}
			/>

			<Collapse open={open} bodyClassName="pt-2.5">
				{/* The rail sits under the header's icon, so everything inside reads as belonging to it. */}
				<div data-ly-process-rail="" className="ml-[7px] flex flex-col gap-2.5 border-l border-line-soft pl-[14px]">
					{children}
				</div>
			</Collapse>
		</div>
	);
}

/** The earlier line: how many calls, then how many thoughts. */
function countsOnly(counts: { tools: number; thinking: number }): string {
	const parts: string[] = [];
	if (counts.tools > 0) parts.push(translate("turnProcess.tools", { n: counts.tools }));
	if (counts.thinking > 0) parts.push(translate("turnProcess.thinking", { n: counts.thinking }));
	return parts.length > 0 ? parts.join(translate("turnProcess.separator")) : translate("turnProcess.thoughtOnly");
}

/** 里面有什么，用名词说。 */
function summarize(counts: { tools: number; thinking: number }, work?: string): string {
	const parts: string[] = [];
	if (counts.thinking > 0) parts.push(translate("turnProcess.thinking", { n: counts.thinking }));
	if (counts.tools > 0) parts.push(work || translate("turnProcess.tools", { n: counts.tools }));
	// 一个工具都没调，那就只有想过——这时候「N 个步骤」是句空话。
	return parts.length > 0 ? parts.join(translate("turnProcess.separator")) : translate("turnProcess.thoughtOnly");
}
