import type { TurnStop } from "../../store/turn-stop.ts";

/** Someone pressed stop. A clean `done` with leftover todos is not this. */
export function isUserPaused(running: boolean, stopped: TurnStop): boolean {
	return !running && stopped === "user";
}

/**
 * What the collapsed row should claim.
 *
 * `!running && active` used to be "paused". That is how a finished turn whose last todo_write
 * never ticked the last box announced 「已暂停」 after a normal reply.
 *
 * 那次修复把「已暂停」换成了 `step`，而 `step` 读的是 `activeForm`——也就是「正在强制推送到远程」
 * 这种现在进行时。于是一个谎换成了另一个谎，而且是更贵的那一个：轮次早就 `done` 了，什么都没在
 * 推，屏幕却在说它正在推。卡片其余部分并没有跟着撒谎——spinner 停了，按钮换成了 ▶——所以读到的
 * 是三个互相矛盾的信号，而唯一会说话的那个是错的。
 *
 * `activeForm` 只在真的有东西在动时才为真。没在跑就说它停在哪一步，用这一步自己的名字。
 */
export function taskListHeadline(input: {
	running: boolean;
	stopped: TurnStop;
	active?: { content: string; activeForm?: string | null };
	done: number;
	total: number;
}): "paused" | "step" | "stalled" | "allDone" | "notStarted" {
	if (input.active) {
		if (isUserPaused(input.running, input.stopped)) return "paused";
		return input.running ? "step" : "stalled";
	}
	return input.total === input.done ? "allDone" : "notStarted";
}
