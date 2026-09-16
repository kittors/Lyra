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
	const container = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number | null>(() => (running || open ? null : 0));
	const shown = running || open;
	const prevShown = useRef(shown);

	useLayoutEffect(() => {
		const el = body.current;
		const box = container.current;
		if (!el || !box) return;

		if (shown !== prevShown.current) {
			if (shown) {
				const targetHeight = el.scrollHeight;
				setHeight(targetHeight);
			} else {
				const currentHeight = el.scrollHeight;
				box.style.height = `${currentHeight}px`;
				void box.offsetHeight;
				box.style.height = "0px";
				setHeight(0);
			}
			prevShown.current = shown;
		} else if (shown) {
			const measure = () => {
				if (box.style.height !== "0px") {
					setHeight(el.scrollHeight);
				}
			};
			const observer = new ResizeObserver(measure);
			observer.observe(el);
			return () => observer.disconnect();
		}
	}, [children, shown]);

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
					label={translate("process.turn")}
					open={shown}
					onToggle={() => setOpen((value) => !value)}
				/>
			)}

			<div
				ref={container}
				style={{ height: shown ? (height !== null ? `${height}px` : "auto") : 0 }}
				onTransitionEnd={(e) => {
					if (e.target === e.currentTarget && shown) {
						setHeight(null);
					}
				}}
				inert={!shown}
				aria-hidden={!shown}
				className="ly-freeze overflow-hidden transition-[height] duration-[var(--ly-t-base)] ease-out"
			>
				{/*
				 * 收起时**不渲染**里面的东西，而不是渲染出来再把高度压成 0。
				 *
				 * 这一行是转录里最贵的一行。一轮四百次工具调用收成一句「调用工具 400 个」，看上去什么都
				 * 没有，实际上那四百个 Run 的组件和 DOM 节点一个不少地压在文档里——量不出来是因为它们
				 * 不可见，不是因为它们不存在。
				 *
				 * 而这笔成本锁死了另外两件事。转录的分页窗口按 **Run** 算（`view-state.ts` 的
				 * `useTranscriptWindow`），因为那是唯一控得住渲染量的闸门；可画出来的单位是 **turn**
				 * （`grouping.ts` 的 `turnBlocks`）。两个单位对不上的后果是用户点「显示更早的 60 条」
				 * 时界面一动不动——新进来的 60 个 Run 全落进这个已经收起的块里，只有那行统计的数字变了。
				 *
				 * 收起即不渲染，这笔成本就没了，窗口也就可以按 turn 分页——三个单位才对得上。
				 *
				 * 动画不受影响：外层的 `height` 在收起状态下已经画过 0，展开时 `children` 出现、上面那个
				 * `useLayoutEffect`（依赖里有 `open`）量到真实高度，过渡就从 0 走到那个值。
				 *
				 * 代价说清楚：折叠区里的内容不再在 DOM 里，浏览器原生的 Ctrl+F 搜不到它。会话搜索走的是
				 * 另一条路（读日志，不读 DOM），不受影响。
				 */}
				<div ref={body}>{shown ? children : null}</div>
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
