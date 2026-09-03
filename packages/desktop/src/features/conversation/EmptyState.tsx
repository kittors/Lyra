import { Bug, Hammer, RefreshCw, Telescope } from "lucide-react";
import mark from "../../assets/empty-mark.png?inline";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Composer } from "../composer/index.ts";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";

const CARDS = [
	{
		icon: Telescope,
		tint: "text-info",
		label: "探索并理解代码",
		prompt:
			"帮我梳理这个项目的整体架构：入口在哪里、核心模块怎么划分、数据是怎么流动的。",
	},
	{
		icon: Hammer,
		tint: "text-violet",
		label: "构建新功能、应用或工具",
		prompt:
			"我想新增一个功能，先帮我确认现有代码里应该改哪些文件，再给出实现方案。",
	},
	{
		icon: RefreshCw,
		tint: "text-ok",
		label: "审查代码并提出修改建议",
		prompt:
			"审查当前工作区未提交的改动，指出其中的缺陷和风险，按严重程度排序。",
	},
	{
		icon: Bug,
		tint: "text-accent",
		label: "修复问题和失败",
		prompt: "帮我定位一个问题的根因。先复现，再定位，最后给出最小改动的修复。",
	},
];

export function EmptyState() {
	const scratchCwd = useApp((s) => s.scratchCwd);
	const workspace = useApp((s) => s.workspace);
	const { compact } = useLayout();

	/** No project behind this conversation, and that was the choice — see the composer's chip. */
	const chatting = !workspace && Boolean(scratchCwd);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/*
			 * Scrolls rather than clips: at the minimum window height the mark, the heading and
			 * two rows of cards do not all fit, and a card you cannot reach is worse than one
			 * you have to scroll to.
			 */}
			<Scroller
				className="flex-1"
				contentClassName={`flex flex-col py-4 ${compact ? "px-4" : "px-8"}`}
			>
				{/*
				 * `m-auto` and not `justify-center`: a centred flex child that outgrows its
				 * parent gets clipped at the top with no way to scroll back up to it.
				 */}
				<div className="m-auto flex w-full flex-col items-center">
					<EmptyMark compact={compact} />

					<h1
						className={`mt-6 shrink-0 text-center leading-tight font-semibold tracking-tight text-balance text-ink ${
							compact ? "text-heading" : "text-display"
						}`}
					>
						{/*
						 * A different question, not the same question with a different noun in it.
						 *
						 * 「要在 X 内开发什么？」 is a sentence about working inside something. Sliding the
						 * name of the project-less mode into that slot produced 「要在 无项目 内开发什么？」
						 * — grammatical, and meaningless: there is no inside to be in. Renaming the mode
						 * to Chat would only have made it 「要在 Chat 内开发什么？」. When there is nowhere to
						 * be working, the honest opening is the one that does not claim there is.
						 */}
						{chatting ? (
							"想聊点什么？"
						) : (
							<>
								要在 {/*
								 * The project name carries itself.
								 *
								 * It used to be underlined with a dotted rule, which is the convention for
								 * "there is a definition behind this" — and there is not. A heading that
								 * hints at an interaction it does not have is worse than a plain one.
								 */}
								<span className="text-ink">
									{workspace?.name ?? "未选择项目"}
								</span>{" "}
								内开发什么？
							</>
						)}
					</h1>

					{/*
					 * Capped width, not fixed: a fluid grid meant collapsing the sidebar inflated
					 * every card, while a hard width overflowed a narrow window.
					 *
					 * The column count keys off this container rather than the window, because the
					 * sidebar takes its width out of the same budget — at 760pt with the sidebar
					 * open, four cards get 99px each and every label wraps to four lines. Below
					 * 4×120px they go two by two, which keeps 2×2 symmetry for the four of them.
					 */}
					<div
						className={`@container w-full max-w-[var(--ly-content)] shrink-0 ${compact ? "mt-6" : "mt-9"}`}
					>
						<div className="grid grid-cols-4 gap-2.5 @max-[510px]:grid-cols-2">
							{CARDS.map((card) => (
								<button
									key={card.label}
									type="button"
									/*
									 * Into the composer, not out to the agent.
									 *
									 * These read as suggestions and sit directly under the cursor's path
									 * to the input, so pressing one used to start a turn — and a turn that
									 * was not asked for costs a request, some tokens, and whatever the
									 * agent decides to do before it can be stopped. As a draft the card is
									 * a starting point: read it, change it, add the detail it is missing,
									 * and send it when it says what you meant.
									 *
									 * Replacing, not appending. These four are alternatives — pressing a
									 * second one means "that one instead", and stacking them produced a
									 * message asking for an architecture tour, a new feature and a code
									 * review at once.
									 */
									onClick={() =>
										useApp.getState().setComposerDraft(card.prompt, true)
									}
									/*
									 * Stacked from the top, not spread to the edges.
									 *
									 * With `justify-between` the label was pinned to the bottom of the
									 * card, so a one-line label sat lower than a two-line one and the
									 * four captions started at two different heights. Ordinary flow puts
									 * every label the same distance under its own mark; the cards are a
									 * uniform height anyway, so what varies is the space left below.
									 */
									className="group flex min-h-[72px] flex-col gap-2 rounded-[11px] border border-line bg-transparent p-3 text-left transition-all duration-[var(--ly-t-base)] hover:-translate-y-0.5 hover:border-ink-faint/60 hover:bg-card/60 active:translate-y-0"
								>
									<card.icon
										size={17}
										strokeWidth={1.7}
										className={`shrink-0 ${card.tint}`}
									/>
									<span className="text-label leading-snug text-ink">
										{card.label}
									</span>
								</button>
							))}
						</div>
					</div>
				</div>
			</Scroller>

			<Composer />
		</div>
	);
}

/**
 * The mark above the question.
 *
 * Larger than the outlined terminal glyph it replaces, because it is a picture rather than an icon:
 * at 56px the drawing reads as a smudge, and an illustration nobody can make out is worse than the
 * plain shape it was brought in to replace. Sized in points and shipped at 384px so it stays sharp
 * on a 3× display without carrying a 1254px original into the bundle.
 *
 * `aria-hidden` and an empty `alt`: the heading underneath already says what this screen is for, and
 * a screen reader announcing the decoration first would put an ornament ahead of the sentence.
 */
function EmptyMark({ compact }: { compact: boolean }) {
	const size = compact ? 104 : 132;
	return (
		<img
			src={mark}
			alt=""
			aria-hidden
			draggable={false}
			width={size}
			height={size}
			className="shrink-0 select-none"
		/>
	);
}
