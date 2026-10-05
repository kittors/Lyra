import { Bug, Hammer, RefreshCw, Telescope } from "lucide-react";
import mark from "../../assets/empty-mark.png?inline";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Composer } from "../composer/index.ts";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";
import { useScopedSessionId, useScopedWorkspace } from "../../app/session-scope.tsx";
import { useI18n, type MessageKey } from "../../i18n/index.ts";
import { onPhone } from "../../services/index.ts";

/*
 * 输入框下面那一排建议：单色图标，描边胶囊，一个接一个落下来。
 * 之前每个图标带一种颜色，排成一行描边 chip 时四种颜色抢的是输入框的注意力。
 */
const PROMPTS: { icon: typeof Telescope; labelKey: MessageKey; promptKey: MessageKey }[] = [
	{ icon: Telescope, labelKey: "empty.explore", promptKey: "empty.explorePrompt" },
	{ icon: Hammer, labelKey: "empty.build", promptKey: "empty.buildPrompt" },
	{ icon: RefreshCw, labelKey: "empty.review", promptKey: "empty.reviewPrompt" },
	{ icon: Bug, labelKey: "empty.fix", promptKey: "empty.fixPrompt" },
];

/** 吉祥物的高度（见 `EmptyMark`）加上它和标题之间的 24px，顶部留白要扣掉这一段，标题才落在那条线上。 */
const MARK_BLOCK = { compact: 104 + 24, regular: 132 + 24 };

export function EmptyState() {
	const { t } = useI18n();
	const sessionId = useScopedSessionId();
	const { workspace, scratchCwd } = useScopedWorkspace();
	const { compact } = useLayout();

	/** No project behind this conversation, and that was the choice — see the composer's chip. */
	const chatting = !workspace && Boolean(scratchCwd);
	const mark = compact ? MARK_BLOCK.compact : MARK_BLOCK.regular;

	if (onPhone()) {
		/*
		 * The project's name kept on one line: a phone's column is narrow enough that
		 * `aurora-notes` broke at its hyphen and the question read as two unrelated words.
		 */
		const [before, after] = chatting
			? [t("empty.chat"), ""]
			: t("empty.projectQuestion", { project: "\u0001" }).split("\u0001");
		const name = workspace?.name ?? t("empty.noProject");
		return (
			<PhoneEmpty
				heading={
					chatting ? (
						before
					) : (
						<>
							{before}
							<span className="whitespace-nowrap">{name}</span>
							{after}
						</>
					)
				}
			/>
		);
	}

	return (
		// 欢迎页这一列是 `max-w-2xl`（672px），输入框和下面的建议都读它；进了对话再按窗格宽度分档。
		<div data-ly-chat-surface="empty" className="flex min-h-0 flex-1 flex-col [--ly-content:672px]">
			{/*
			 * Scrolls rather than clips: at the minimum window height the mark, the heading, the
			 * composer and the suggestions do not all fit, and a control you cannot reach is worse
			 * than one you have to scroll to.
			 *
			 * 布局：上面一段可压缩的留白把标题放在视口约 29% 处，下面一段 `flex-1` 吃掉剩下的高度。
			 * 仍然是上重下轻而不是 `m-auto` 居中——输入框长高时标题不动，多出来的高度往下推。
			 */}
			<Scroller
				className="flex-1"
				contentClassName={`flex flex-col items-center after:block after:min-h-4 after:w-full after:flex-1 after:content-[''] ${
					compact ? "ly-content-gutter-compact" : "ly-content-gutter"
				}`}
			>
				<div
					aria-hidden
					className="w-full shrink"
					style={{ flexBasis: `max(1rem, calc(29dvh - ${mark}px))` }}
				/>
				<EmptyMark compact={compact} />

				<h1
					className={`mt-6 w-full shrink-0 text-center leading-[1.2] font-medium text-balance text-ink ${
						compact ? "text-heading" : "text-[30px]"
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
					{chatting
						? t("empty.chat")
						: t("empty.projectQuestion", { project: workspace?.name ?? t("empty.noProject") })}
				</h1>

				<div className="mt-11 w-full shrink-0">
					<Composer centered />
				</div>

				{/*
				 * 不比输入框宽，放不下就居中换行。标签收成四个字一枚，平常一行放得下；
				 * 窄窗口里换行而不是横向滚动，滚动会把后两枚藏起来。
				 */}
				<div className="mt-6 w-full max-w-[var(--ly-content)] shrink-0">
					<div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
						{PROMPTS.map((prompt, index) => (
							<button
								key={prompt.labelKey}
								type="button"
								/*
								 * Into the composer, not out to the agent.
								 *
								 * These read as suggestions and sit directly under the cursor's path
								 * to the input, so pressing one used to start a turn — and a turn that
								 * was not asked for costs a request, some tokens, and whatever the
								 * agent decides to do before it can be stopped. As a draft the chip is
								 * a starting point: read it, change it, add the detail it is missing,
								 * and send it when it says what you meant.
								 *
								 * Replacing, not appending. These four are alternatives — pressing a
								 * second one means "that one instead", and stacking them produced a
								 * message asking for an architecture tour, a new feature and a code
								 * review at once.
								 */
								onClick={() => useApp.getState().setComposerDraft(t(prompt.promptKey), { sessionId, replace: true })}
								style={{ animationDelay: `${index * 65}ms` }}
								className="ly-draft-chip group flex h-8 min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-3 text-left"
							>
								<prompt.icon
									size={16}
									strokeWidth={2}
									className="shrink-0 text-ink opacity-70 transition-opacity group-hover:opacity-100"
								/>
								<span className="max-w-64 min-w-0 truncate text-label text-ink opacity-70 transition-opacity group-hover:opacity-100">
									{t(prompt.labelKey)}
								</span>
							</button>
						))}
					</div>
				</div>
			</Scroller>
		</div>
	);
}

/**
 * The illustration above the question.
 *
 * Not the boot screen's artwork: that one carries the wordmark, and "LYRA" drawn right above a
 * heading that already says Lyra is the name twice. Shipped at 480px, 2× of the regular 200px
 * with room to spare.
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

/**
 * The same screen, shaped for a phone: the mark and the question in the middle of the empty space,
 * the four starting points in one row just above the composer.
 *
 * Above the composer because that is where the thumb already is and where the draft they fill in
 * appears. In one row that scrolls sideways because a two-by-two grid of cards took half the screen
 * on a phone and pushed the mark up under the status bar; as chips they cost one line, and the
 * last one peeking in at the edge says there are more.
 *
 * Centred rather than top-weighted, unlike the desktop. There the composer grows under a steady
 * heading; here the keyboard takes half the screen, and a heading pinned to the top of what is left
 * lands under the toolbar. The middle of the space that remains is always visible.
 */
function PhoneEmpty({ heading }: { heading: React.ReactNode }) {
	const { t } = useI18n();
	// The suggestions fill this screen's composer, as on the desktop.
	const screen = useScopedSessionId();
	return (
		<div data-ly-chat-surface="empty" className="flex min-h-0 flex-1 flex-col">
			<Scroller className="flex-1" contentClassName="ly-content-gutter-compact flex min-h-full flex-col">
				<div className="ly-phone-hero">
					<EmptyMark compact />
					<h1 className="ly-phone-hero-title">{heading}</h1>
				</div>
			</Scroller>

			<div className="ly-phone-suggest" role="group" aria-label={t("phone.suggestions")}>
				{PROMPTS.map((prompt) => (
					<button
						key={prompt.labelKey}
						type="button"
						// Into the composer, never straight to the agent — the desktop's row works the same way.
						onClick={() => useApp.getState().setComposerDraft(t(prompt.promptKey), { sessionId: screen, replace: true })}
						className="ly-phone-chip ly-press"
					>
						<prompt.icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
						<span>{t(prompt.labelKey)}</span>
					</button>
				))}
			</div>

			<Composer />
		</div>
	);
}
