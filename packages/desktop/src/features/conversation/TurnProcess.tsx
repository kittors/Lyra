import { Collapse } from "../../ui/layout/Collapse.tsx";
/**
 * A stretch of process, folded into one line. What the model says partway through a turn cuts the
 * process into stretches, and what is said stays outside (see `turnBlocks`).
 *
 * A turn reads "think → do → say". The process is worth seeing once — while it runs you want to watch
 * it — but after that, forty tool cards in front of the answer in an old conversation are only noise.
 * So this line is the process's switch.
 *
 * Folded, it has to say what is inside, or it is merely hiding things. It speaks in nouns, not events:
 * 「思考 3 次 · 读取文件 5 个、执行命令」, not 「12 个步骤」 — nobody has seen those twelve steps. When it
 * is all reasoning and not one tool was called, it says 「思考了一会儿」, because then there really is
 * nothing else to say.
 *
 * The row has the same skeleton as the reasoning and tool rows (see `FlowRow`); the process inside hangs
 * under a vertical line on the left.
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
	live,
	stateKey,
	children,
	trailing,
}: {
	counts: { tools: number; thinking: number };
	/** What the calls in this turn did, in words — see `describeRun`. Falls back to a bare count. */
	work?: string;
	/** 收起那一行的行尾：这一轮派出去的子智能体的脸。 */
	trailing?: React.ReactNode;
	/** The turn that is running. Under "Expanded" it is laid open the whole way, with no line; under "Collapsed" it only changes the marker. */
	running: boolean;
	/**
	 * The work being pushed forward right now is in this stretch — see `liveWork` in `grouping.ts`.
	 *
	 * Under "Collapsed" the line is all there is of the stretch while it runs, so it carries the glide
	 * that says a row is working (see `FlowRow`). Folded and still, a stretch that was being worked on
	 * looked exactly like one that had finished.
	 */
	live?: boolean;
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
				running={live}
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

/** What is inside, said in nouns. */
function summarize(counts: { tools: number; thinking: number }, work?: string): string {
	const parts: string[] = [];
	if (counts.thinking > 0) parts.push(translate("turnProcess.thinking", { n: counts.thinking }));
	if (counts.tools > 0) parts.push(work || translate("turnProcess.tools", { n: counts.tools }));
	// 一个工具都没调，那就只有想过——这时候「N 个步骤」是句空话。
	return parts.length > 0 ? parts.join(translate("turnProcess.separator")) : translate("turnProcess.thoughtOnly");
}
