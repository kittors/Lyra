import { useSide } from "../sideStore.ts";
import { CARRY_ON_PROMPTS } from "./conversation/grouping.ts";
import { useApp } from "../store.ts";
import { useConfirmer } from "../ui/overlay/Confirm.tsx";
import { hasRetryPoint } from "../store/derive.ts";

/**
 * The turn stopped somewhere short of the end, and here is how to pick it up.
 *
 * Pressing stop, quitting the app mid-turn, a crash, a machine going to sleep, or a model that
 * ended cleanly with items still on its own list: five ways to arrive at a conversation with
 * work left in it. Two questions follow — carry on, or do that last part again — and both are one
 * click, because retyping the request is the only alternative and it is a bad one.
 *
 * The pause used to be the one case with no answer here. Stopping is not damage, so nothing was
 * recorded and nothing was offered, and a turn you paused three seconds ago looked exactly like a
 * conversation that had finished. Getting back into it meant typing 「继续」 by hand — which is
 * the whole of what the button does, so the only thing being asked for was the typing.
 *
 * Deliberately the quietest thing on the page. It sits where the timestamps sit, in the same
 * grey at the same size: it is a footnote about what happened, not an alarm. Anything louder
 * would make an ordinary pause look like a failure.
 */
export function ResumeRow() {
	const send = useApp((s) => s.send);
	const retryFrom = useApp((s) => s.retryFrom);
	const running = useApp((s) => s.running);
	const stopped = useApp((s) => s.stopped);
	const messages = useApp((s) => s.messages);
	const todos = useApp((s) => s.todos);
	const confirm = useConfirmer();
	/*
	 * A task that stopped when this session did, if there is one. See the click handler below.
	 *
	 * Read from the side panel's store because that is where the queue's state is mirrored; both
	 * live in this renderer, and duplicating it here would be a second copy to keep in step.
	 *
	 * Above the early return, because hooks cannot be called conditionally.
	 */
	const interrupted = useSide((s) => s.tasks.find((t) => t.status === "cancelled" && t.cancelledBy === "stop"));
	const resumeTask = useSide((s) => s.resumeTask);

	const unfinished = todos.filter((todo) => todo.status !== "completed").length;
	/*
	 * Three ways for work to be left undone, and the same two things to offer for all of them.
	 *
	 * The third is the quiet one and was not covered at all — the model ends its turn cleanly with
	 * items still on its list. Nothing is wrong in that case, which is exactly why nothing said
	 * anything, and the plan sat there unfinished with no way back into it.
	 */
	if (running || (!stopped && unfinished === 0)) return null;

	/*
	 * What happened, in the fewest words that are true.
	 *
	 * The plan's count is the fallback rather than the headline: when the turn stopped in the
	 * middle, *that* is the news, and 「计划还有 3 项未完成」 buries it under a number.
	 */
	/*
	 * What stopped, said plainly — and said about the *task* when there was one.
	 *
	 * Pausing a session that was running something dispatched from the side chat stops two things,
	 * and 「已暂停」 alone describes only the conversation. The person reading this needs to know
	 * the dispatched work is what 继续 will pick up, or the panel saying 「主会话已暂停，任务一并
	 * 中断」 and this row saying 「已暂停」 read as two unrelated facts.
	 */
	const note = interrupted
		? "派出的任务被一并中断"
		: stopped === "user"
			? "已暂停"
			: stopped === "error"
				? "上次请求失败，进度已保留"
				: stopped === "interrupt"
					? "上次执行被中断"
					: `计划还有 ${unfinished} 项未完成`;
	/*
	 * What 继续 says, matched to what actually happened.
	 *
	 * 「从中断的地方接着做」 is a lie in the third case: nothing was interrupted, the model simply
	 * finished a turn with items still on its list. The model reads this message and acts on it, so
	 * a wrong account of where it stopped is a wrong instruction, not just a wrong word.
	 */
	/*
	 * From the shared list, not written out here.
	 *
	 * `grouping.ts` matches these exact strings to tell "carrying on" apart from "asking something
	 * new" — that is what keeps a task's elapsed time and tokens whole across an interruption.
	 * A second copy of the sentence is a mismatch waiting for the day somebody improves the wording.
	 */
	const carryOn =
		stopped === "user"
			? CARRY_ON_PROMPTS[0]
			: stopped === "error" || stopped === "interrupt"
				? CARRY_ON_PROMPTS[1]
				: CARRY_ON_PROMPTS[2];

	return (
		<div className="ly-enter mb-2.5 flex items-center gap-2 text-detail text-ink-faint">
			<span>{note}</span>
			<span className="text-line">·</span>
			<button
				type="button"
				data-ly-tip={interrupted ? "把被中断的那个任务重新排上" : "接着做完没做完的部分"}
				/*
				 * Sent as the app's own message, not as something you typed.
				 *
				 * `synthetic` is what the transcript uses for a message composed on your behalf, and
				 * the note on `send` names 「继续」 as the case it exists for — this call simply never
				 * passed it. Two things followed. The sentence appeared in the conversation as though
				 * you had written it, which is noise: you pressed a button. And it counted as a new
				 * question, so the turn's clock and token total started again — a task paused once and
				 * resumed reported the length of its second half, and its tokens-per-second described
				 * a stretch of work nobody ran.
				 */
				onClick={() => {
					/*
					 * If a dispatched task went down with the pause, continuing means continuing *it*.
					 *
					 * Pausing the session cancels whatever it was running, and a task dispatched from
					 * the side chat is exactly that. Sending 继续 into the conversation resumes the
					 * conversation and leaves the task cancelled — the panel goes on saying it was
					 * interrupted, and the work the side chat asked for is quietly never done. There
					 * are two things stopped here and only one of them was being picked up.
					 */
					if (interrupted) {
						void resumeTask(interrupted.id);
						return;
					}
					/*
					 * `carryOn` is what keeps the turn's clock and its tokens whole across the pause.
					 *
					 * `synthetic` alone was not enough, and the note above is what it looked like when it was
					 * thought to be: the flag keeps the sentence out of the transcript and out of the walk
					 * that computes a finished turn's stats, but the live meter lives in the store and `send`
					 * reset it on every call regardless. So this row described the pause correctly while the
					 * running line under it counted the second leg from zero.
					 *
					 * A flag rather than matching the wording again: `grouping.ts` has to recognise these
					 * sentences because a transcript read back from disk is all it has, but here we know —
					 * this is the button.
					 */
					void send([{ type: "text", text: carryOn }], { synthetic: true, carryOn: true });
				}}
				className="rounded px-1 text-ink-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
			>
				继续
			</button>
			{/*
			 * Not a second kind of "carry on": this one throws the reply away and asks again.
			 *
			 * Which is what makes it worth having next to 继续 — between them they cover both
			 * readings of a turn that stopped. Either what it did so far is worth keeping and the
			 * rest should follow, or it went wrong somewhere back there and the whole answer should
			 * be had again. The tooltip says which, because "重试" alone does not, and one of the
			 * two is destructive.
			 */}
			{hasRetryPoint(messages) && (
				<button
					type="button"
					data-ly-tip="丢掉这次的回答，重新生成"
					/*
					 * Asked first, because this one is the expensive mistake.
					 *
					 * 继续 and 重试 sit next to each other and read as two flavours of the same
					 * offer, and they are opposites: one keeps everything the turn did and adds to
					 * it, the other throws all of it away and pays for it again. On a turn that had
					 * already spent several hundred thousand tokens reading a codebase, pressing the
					 * wrong one costs that much a second time — and nothing about the word 「重试」
					 * says so.
					 */
					onClick={() =>
						confirm.ask({
							title: "重新生成这次回答？",
							detail: (
								<>
									这会丢掉本轮已经做过的工作——读过的文件、跑过的命令、写到一半的回答——
									并从你最后一条消息重新开始，重新消耗一次 token。
									<br />
									想保留这些、只把没做完的做完，请选「继续」。
								</>
							),
							confirmLabel: "重新生成",
							onConfirm: () => void retryFrom(messages.length - 1),
						})
					}
					className="rounded px-1 text-ink-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
				>
					重试
				</button>
			)}
			{confirm.element}
		</div>
	);
}
