/**
 * Saying something about a pull request, and deciding about it.
 *
 * The same field the conversation uses. A review is typing into a box and pressing send, which is
 * a thing this app already knows how to look like — a second hand-rolled textarea would be a
 * second set of paddings, a second growth rule and a second answer to what ⌘↵ does.
 *
 * One field for comment and verdict both, because they are the same sentence with a different
 * weight behind it: a comment is a remark, an approval is a remark that also unblocks a merge.
 * Two boxes would mean writing the thought, then deciding which box it belonged in.
 *
 * "请求修改" refuses to send without a reason. A change request with no explanation is the one
 * outcome that reliably wastes someone's afternoon.
 */

import { Check, X } from "lucide-react";
import { useState } from "react";
import { ComposerSend, ComposerShell } from "../composer/ComposerShell.tsx";

export type Verdict = "approve" | "request-changes" | "comment";

export function ReviewBar({
	onSubmit,
	disabled,
}: {
	onSubmit: (verdict: Verdict, body: string) => Promise<string | null>;
	disabled?: boolean;
}) {
	const [body, setBody] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const send = async (verdict: Verdict) => {
		if (busy || disabled) return;
		setBusy(true);
		setError(null);
		const failure = await onSubmit(verdict, body);
		setBusy(false);
		if (failure) {
			setError(failure);
			return;
		}
		// Cleared only on success: a failed send must not take the text with it.
		setBody("");
	};

	return (
		<div className="shrink-0 px-4 pt-1 pb-3">
			{error && <p className="pb-1.5 text-detail leading-relaxed text-danger">{error}</p>}

			<ComposerShell
				value={body}
				onChange={setBody}
				onSubmit={() => void send("comment")}
				disabled={disabled}
				placeholder={disabled ? "选中一个 Pull Request" : "留下评论…"}
				left={
					<div className="flex items-center gap-1.5">
						<Verdicts busy={busy} disabled={disabled} onSend={send} />
					</div>
				}
				right={<ComposerSend running={false} disabled={busy || disabled || !body.trim()} onSend={() => void send("comment")} onStop={() => {}} />}
			/>
		</div>
	);
}

/** The two decisions, next to the field rather than behind a menu: both are one click of work. */
function Verdicts({
	busy,
	disabled,
	onSend,
}: {
	busy: boolean;
	disabled?: boolean;
	onSend: (verdict: Verdict) => void;
}) {
	return (
		<>
			<button
				type="button"
				disabled={busy || disabled}
				onClick={() => onSend("approve")}
				data-ly-tip="批准这个 Pull Request"
				className="flex h-[26px] items-center gap-1 rounded-lg px-2 text-detail text-ink-muted transition-colors hover:bg-card-hover hover:text-ok disabled:opacity-45"
			>
				<Check size={12.5} strokeWidth={2} />
				批准
			</button>
			<button
				type="button"
				disabled={busy || disabled}
				onClick={() => onSend("request-changes")}
				data-ly-tip="请求修改，需要写明理由"
				className="flex h-[26px] items-center gap-1 rounded-lg px-2 text-detail text-ink-muted transition-colors hover:bg-card-hover hover:text-danger disabled:opacity-45"
			>
				<X size={12.5} strokeWidth={2} />
				请求修改
			</button>
		</>
	);
}
