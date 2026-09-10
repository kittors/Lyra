/**
 * 一整轮的过程，收成一行。
 *
 * 一轮读下来是「想 → 做 → 说」。过程值得看一次——正在跑的时候你就想看着它——但看过之后，翻回
 * 一段旧对话时四十行工具卡片挡在答案前面就只是噪音了。所以这一行是过程的开关：正在跑时它是开的
 * 而且不必按，跑完之后它自己收起来，需要时一点就回来。
 *
 * 收起时它必须说清楚里面是什么，否则就是把东西藏起来而已。说的是名词不是事件：「读取文件 5 个 ·
 * 思考 3 次」，而不是「12 个步骤」——没人见过那 12 个步骤。全是思考、一个工具都没调时它说
 * 「思考了一会儿」，因为那时候确实没有别的可说。
 *
 * 行的骨架和思考行、工具行是同一个（见 `FlowRow`），所以一轮里所有过程行的左边缘是一条线。
 */

import { Layers } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { FlowRow } from "./FlowRow.tsx";
import { translate } from "../../i18n/translate.ts";
import { useTranscriptDisclosure } from "./view-state.ts";

export function TurnProcess({
	counts,
	running,
	stateKey,
	children,
}: {
	counts: { tools: number; thinking: number };
	/** 正在跑的那一轮全程摊开——那时候人是在看着它的。 */
	running: boolean;
	stateKey?: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useTranscriptDisclosure(stateKey);
	const body = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number | null>(null);

	// 量出来的高度，不是猜的：动到一个不是真实高度的 max-height，要么裁掉内容要么提前停。
	useLayoutEffect(() => {
		const element = body.current;
		if (!element) return;
		const measure = () => setHeight(element.scrollHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [children, open, running]);

	const shown = running || open;

	return (
		<div className="mb-2.5" data-ly-turn-process={running ? "running" : "done"} data-ly-turn-open={shown ? "" : undefined}>
			{/*
			 * 正在跑的时候不画这一行。
			 *
			 * 那会儿过程本来就全开着，一个「点开/收起」的开关在此刻什么也不做——而它会占掉一行、
			 * 在回合结束的瞬间又改变含义。跑完再出现，是它唯一有意义的时刻。
			 */}
			{!running && (
				<FlowRow
					icon={<Layers size={13} strokeWidth={1.8} />}
					summary={summarize(counts)}
					open={open}
					onToggle={() => setOpen((value) => !value)}
					label={summarize(counts)}
				/>
			)}

			{/* `ly-freeze`：展开后的高度跟着内容走，拖动边界时它每帧都在变，缓动的高度会追不上指针。 */}
			<div
				style={{ height: shown ? height ?? "auto" : 0 }}
				inert={!shown}
				aria-hidden={!shown}
				className="ly-freeze overflow-hidden transition-[height] duration-[var(--ly-t-base)] ease-out"
			>
				<div ref={body}>{children}</div>
			</div>
		</div>
	);
}

/** 里面有什么，用名词说。 */
function summarize(counts: { tools: number; thinking: number }): string {
	const parts: string[] = [];
	if (counts.tools > 0) parts.push(translate("turnProcess.tools", { n: counts.tools }));
	if (counts.thinking > 0) parts.push(translate("turnProcess.thinking", { n: counts.thinking }));
	// 一个工具都没调，那就只有想过——这时候「N 个步骤」是句空话。
	return parts.length > 0 ? parts.join(translate("turnProcess.separator")) : translate("turnProcess.thoughtOnly");
}
