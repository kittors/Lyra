/**
 * Asking before something cannot be taken back.
 *
 * The app deletes plenty of things on a single click — a plugin's directory, a model, an MCP
 * server, a file, a whole session — and every one of them is a click's distance from a control you
 * were aiming at anyway.
 *
 * One shape for all of them, centred over the window on a scrim. It used to be anchored to the
 * control that raised it, on the theory that the connection between the button and the question is
 * worth keeping. In practice that produced a different answer in every corner of the app: a card
 * hanging off a menu here, a card at the pointer there, and in a panel opened to full screen a
 * question that appeared wherever the row happened to be rather than where you were looking. A
 * question that stops everything should look like one, and there is exactly one place a modal
 * belongs.
 *
 * Two ways in, one look and one place:
 *
 *   - `useConfirmer()` for a page full of delete buttons — wrap the handler, render `element` once;
 *   - `useConfirmGate()` when the answer has to be awaited inside a loop.
 *
 * Only for what cannot be undone. Archiving, disabling and unpinning all put themselves back, and
 * a confirmation on those teaches people to click through the ones that matter.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Overlay } from "./Overlay.tsx";

/** Narrow enough to read as a question rather than as a form. */
const CONFIRM_WIDTH = 400;

export interface ConfirmOptions {
	/** The question, naming the thing. "卸载 Chrome？" — not "确定吗？". */
	title: string;
	/** What it costs, in one line. Skip it when the title already says everything. */
	detail?: React.ReactNode;
	/** The verb, on the button that does it. */
	confirmLabel: string;
	onConfirm: () => void;
}

/**
 * The question and the two ways out.
 *
 * Cancel holds the focus, deliberately: this surface exists because something irreversible was one
 * click away, and putting the keyboard on the irreversible half of it would hand back the problem.
 */
export function ConfirmBody({
	title,
	detail,
	confirmLabel,
	onConfirm,
	onCancel,
}: ConfirmOptions & { onCancel: () => void }) {
	return (
		<div className="p-4">
			<div className="text-label font-medium text-ink">{title}</div>
			{detail && <p className="mt-1.5 text-detail leading-relaxed text-ink-muted">{detail}</p>}
			<div className="mt-4 flex items-center justify-end gap-1.5">
				<button
					type="button"
					autoFocus
					onClick={onCancel}
					className="h-[28px] rounded-lg border border-line px-2.5 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
				>
					取消
				</button>
				<button
					type="button"
					onClick={onConfirm}
					className="h-[28px] rounded-lg bg-danger px-2.5 text-detail font-medium text-shell transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90"
				>
					{confirmLabel}
				</button>
			</div>
		</div>
	);
}

/**
 * The question on the app's modal surface: centred, on a scrim, dismissed by Escape or the scrim.
 *
 * `Overlay` supplies all three, and supplies them the same way every other dialog in the app gets
 * them — which is the point of asking through this rather than assembling one per call site.
 */
export function Confirm({ onCancel, ...options }: ConfirmOptions & { onCancel: () => void }) {
	return (
		// Escape and the scrim mean the same thing as the 取消 button, so they get the same handler.
		<Overlay onClose={onCancel} width={CONFIRM_WIDTH}>
			<ConfirmBody {...options} onCancel={onCancel} />
		</Overlay>
	);
}

/**
 * One confirmation for a page full of delete buttons.
 *
 * Each button hands over its own question and its own consequence; the surface, the wording of the
 * two buttons and the fact that cancel is the safe one are settled here. A page with six removable
 * rows would otherwise carry six copies of the same state.
 */
export function useConfirmer() {
	const [pending, setPending] = useState<ConfirmOptions | null>(null);

	return {
		/** Call from the click handler of the button that would delete. */
		ask: useCallback((options: ConfirmOptions) => setPending(options), []),
		/** Render once, anywhere in the component. */
		element: pending ? (
			<Confirm
				title={pending.title}
				detail={pending.detail}
				confirmLabel={pending.confirmLabel}
				onConfirm={() => {
					setPending(null);
					pending.onConfirm();
				}}
				onCancel={() => setPending(null)}
			/>
		) : null,
	};
}

/**
 * The same question, awaited.
 *
 * For the callers that ask inside a loop — pasting five files, two of which collide — where the
 * answer has to come back before the next step can be decided. Written as a promise so that reads
 * as ordinary sequential code rather than as a callback per branch.
 */
export function useConfirmGate() {
	const [pending, setPending] = useState<(ConfirmOptions & { settle: (answer: boolean) => void }) | null>(null);

	// A question left unanswered must not outlive the component, or its `await` never returns.
	const live = useRef(pending);
	live.current = pending;
	useEffect(() => () => live.current?.settle(false), []);

	const ask = useCallback(
		(options: Omit<ConfirmOptions, "onConfirm">): Promise<boolean> =>
			new Promise<boolean>((resolve) => {
				setPending({
					...options,
					onConfirm: () => {},
					settle: (answer) => {
						setPending(null);
						resolve(answer);
					},
				});
			}),
		[],
	);

	return {
		ask,
		element: pending ? (
			<Confirm
				title={pending.title}
				detail={pending.detail}
				confirmLabel={pending.confirmLabel}
				onConfirm={() => pending.settle(true)}
				onCancel={() => pending.settle(false)}
			/>
		) : null,
	};
}
