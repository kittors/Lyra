/**
 * What the running line says while a turn is waiting on the network.
 *
 * Its own file because it is the part that was wrong. The line used to state the delay once, at the
 * instant it was decided — "连接中断，1 秒后重试（第 1 次）" — and then hold those exact words for
 * however long the wait really was. Three things about that were false at once, and all three are
 * checkable here rather than by staring at a window and hoping a socket drops.
 */

export interface Retrying {
	/** Which attempt this is, counted across the whole request rather than per retry layer. */
	attempt: number;
	/** When the wait ends, as an instant. A duration would be stale before it could be rendered. */
	until: number;
	reason: string;
	/** The turn being picked back up, rather than a request being sent again. */
	resume: boolean;
}

/**
 * The wait, counted down.
 *
 * A number that moves is checkable: it either reaches zero when the request goes back out, or the
 * claim was false. Past zero it stops claiming anything about time and says what is true then —
 * the wait is over, the request is in flight, and how long *that* takes belongs to the far end.
 *
 * A resume gets different words because it answers a different question. By then the turn has
 * already ended and the transcript shows it failing, so the first thing worth saying is not how
 * long the wait is but that nothing was lost: the tool calls above are still there, and what
 * happens next continues from them rather than starting over.
 */
export function describeRetry(retrying: Retrying, now: number): string {
	const left = Math.ceil((retrying.until - now) / 1000);
	if (!retrying.resume) {
		return `连接中断，${left > 0 ? `${left} 秒后重试` : "正在重连"}（第 ${retrying.attempt} 次）`;
	}
	const wait = left > 0 ? `${left} 秒后从中断处继续` : "正在从中断处继续";
	return `连接中断，进度已保留，${wait}（第 ${retrying.attempt} 次）`;
}
