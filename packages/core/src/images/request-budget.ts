/**
 * How much of the conversation's pictures one request carries.
 *
 * Every request re-sends the whole history, pictures included — a prompt cache saves the provider's
 * work, not the upload. So a conversation that has collected thirty screenshots uploads thirty
 * screenshots on every turn, and on a relay with a thin uplink that is minutes per turn before the
 * model sees a single token. The newest pictures are the ones being talked about; the old ones are
 * context. Old ones step down: first to a small gist the model can still recognise, then to a line
 * that says a picture was there.
 *
 * The decision is replayed from the start of the conversation every time, message by message, as if
 * each request were being made again. That makes it stable: what an earlier request decided about a
 * picture is what this one decides, because it is the same replay with more messages after it. And
 * once the full-size window overflows it is cut back well below the line (`lowWater`), so a cut — which
 * changes the request's prefix and so costs the prompt cache from that point — happens every few
 * pictures, not on every one. opencode (25 → 15 MiB) and Claude Code (20 blocks / 10 MB of slack) do
 * the same for the same reason.
 *
 * Only what is sent changes. The transcript, the session store and the screen keep every picture.
 */

export type ImageTier = "full" | "gist" | "note";

export interface BudgetSlot {
	/** Bytes this picture costs at full size, after it was fitted to the provider. */
	bytes: number;
	/** Index of the message it is in. */
	message: number;
}

export interface ImageBudget {
	/** Full-size pictures one request carries before the oldest step down. */
	fullBytes: number;
	fullCount: number;
	/** Gists kept before the oldest become a line of text. */
	gistCount: number;
	/** What an overflowing window is cut back to, as a share of its limits. */
	lowWater: number;
}

/**
 * Ten pictures, or 4 MiB, at full size; twenty gists behind them.
 *
 * Sized for the slow end: at 15 KB/s — a relay measured on the user's own line — 4 MiB is four and a
 * half minutes, against twenty-eight for the thirteen 4K pictures this replaced. A conversation with a
 * handful of pictures never reaches the line at all.
 */
export const DEFAULT_IMAGE_BUDGET: ImageBudget = { fullBytes: 4 * 1024 * 1024, fullCount: 10, gistCount: 20, lowWater: 0.6 };

export interface BudgetMessage {
	role: "user" | "assistant" | "toolResult";
	/** An assistant message that called no tool: the turn ended with it. */
	endsTurn?: boolean;
}

/**
 * Decide every picture's tier.
 *
 * Never stepped down, whatever the budget says: what the person sent in the turn being replayed (the
 * question is about those), and the message that just arrived (a screenshot the model asked for one
 * step ago). Everything else goes oldest first. `gists` is false where no codec can make one: the
 * full window then steps straight down to a line.
 */
export function planImageTiers(messages: readonly BudgetMessage[], slots: readonly BudgetSlot[], budget: ImageBudget, gists: boolean): ImageTier[] {
	const tiers: ImageTier[] = slots.map(() => "full");
	const byMessage = new Map<number, number[]>();
	for (const [index, slot] of slots.entries()) {
		const list = byMessage.get(slot.message) ?? [];
		list.push(index);
		byMessage.set(slot.message, list);
	}

	const full: number[] = [];
	let fullBytes = 0;
	const gisted: number[] = [];
	let turnStart = 0;

	const isProtected = (slot: number, current: number) => {
		const at = slots[slot].message;
		return at === current || (at >= turnStart && messages[at]?.role === "user");
	};

	/** Step down the oldest unprotected entries of `queue` until `done` says enough. */
	const cut = (queue: number[], current: number, done: () => boolean, demote: (slot: number) => void) => {
		let at = 0;
		while (at < queue.length && !done()) {
			if (isProtected(queue[at], current)) {
				at++;
				continue;
			}
			demote(queue.splice(at, 1)[0]);
		}
	};

	const settle = (current: number) => {
		if (fullBytes > budget.fullBytes || full.length > budget.fullCount) {
			const bytesTo = budget.fullBytes * budget.lowWater;
			const countTo = Math.floor(budget.fullCount * budget.lowWater);
			cut(full, current, () => fullBytes <= bytesTo && full.length <= countTo, (slot) => {
				fullBytes -= slots[slot].bytes;
				if (gists) {
					tiers[slot] = "gist";
					gisted.push(slot);
				} else {
					tiers[slot] = "note";
				}
			});
		}
		if (gisted.length > budget.gistCount) {
			const countTo = Math.floor(budget.gistCount * budget.lowWater);
			cut(gisted, current, () => gisted.length <= countTo, (slot) => {
				tiers[slot] = "note";
			});
		}
	};

	for (let message = 0; message < messages.length; message++) {
		const arriving = byMessage.get(message);
		for (const slot of arriving ?? []) {
			full.push(slot);
			fullBytes += slots[slot].bytes;
		}
		if (arriving) settle(message);
		// A finished turn releases what was asked in it: from the next message on, it is history.
		if (messages[message].role === "assistant" && messages[message].endsTurn) {
			turnStart = message + 1;
			settle(message);
		}
	}
	return tiers;
}
