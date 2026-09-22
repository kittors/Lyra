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

import { translate } from "../../i18n/translate.ts";
import { useCallback, useEffect, useRef, useState } from "react";

import { CircleHelp, TriangleAlert } from "lucide-react";
import { Overlay } from "./Overlay.tsx";
import { DialogAction, DialogFrame } from "./Dialog.tsx";

/** Narrow enough to read as a question rather than as a form. */
const CONFIRM_WIDTH = 400;

export interface ConfirmOptions {
	/** The question, naming the thing. "卸载 Chrome？" — not "确定吗？". */
	title: string;
	/** What it costs, in one line. Skip it when the title already says everything. */
	detail?: React.ReactNode;
	/** The verb, on the button that does it. */
	confirmLabel: string;
	/** 取消按钮上的字，默认「取消」。 */
	cancelLabel?: string;
	/**
	 * `danger` 是默认，因为这个东西本来是给删除用的。
	 *
	 * `normal` 留给另一类问题：不是「这个删了拿不回来」，而是「以后要不要自动做这件事」。
	 * 两种都该停下一切来问，但只有前一种该是红的——把每个问题都画成危险，等于没画过危险。
	 */
	tone?: "danger" | "normal";
	onConfirm: () => void;
	/**
	 * 取消也要做点什么的时候。
	 *
	 * 绝大多数确认框的取消就是「什么都别发生」，所以这是可选的。但有一种问题不是这样：
	 * 「以后要不要自动做这件事」——那里的取消是一个回答（不要），把它当成没问过，
	 * 意思就是下次还问。
	 */
	onCancel?: () => void;
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
	cancelLabel,
	tone = "danger",
	onConfirm,
	onCancel,
}: ConfirmOptions & { onCancel: () => void }) {
	return (
		<DialogFrame
			icon={tone === "danger" ? <TriangleAlert size={20} className="shrink-0 text-danger" /> : <CircleHelp size={20} className="shrink-0 text-accent" />}
			title={title}
			detail={detail}
			actions={(
				<>
					{/*
					 * 动词写在按钮上，不挂在 tooltip 上。
					 *
					 * 这里曾经是一个叉一个勾，理由是「是/否由标题负责」。标题确实问清了问题，但两颗
					 * 图标没有回答它：✓ 的意思由它旁边那行字决定，而删除、卸载、清空、退出登录这几
					 * 件事在同一个勾上长得一模一样。要读出按下去会发生什么，得先把鼠标停上去等一个
					 * tooltip——而这正是一个「停下一切来问」的界面最不该要求的动作。
					 *
					 * 这也是应用里其它对话框的样子（权限确认、更新、新建项目），同一套 `DialogAction`。
					 */}
					<div className="flex-1" />
					<DialogAction onClick={onCancel}>{cancelLabel ?? translate("common.cancel")}</DialogAction>
					<DialogAction tone={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>
						{confirmLabel}
					</DialogAction>
				</>
			)}
		/>
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
			{(dismiss) => <ConfirmBody {...options} onConfirm={() => dismiss(options.onConfirm)} onCancel={() => dismiss()} />}
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
				cancelLabel={pending.cancelLabel}
				tone={pending.tone}
				onConfirm={() => {
					setPending(null);
					pending.onConfirm();
				}}
				/* 取消也可能是一个回答——见 `onCancel` 上的说明。 */
				onCancel={() => {
					setPending(null);
					pending.onCancel?.();
				}}
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

	/*
	 * A question left unanswered must not outlive the component, or its `await` never returns.
	 *
	 * Deferred by a microtask, and that is the whole of it. React tears a tree down from the top, so
	 * this cleanup runs *before* the `Overlay` further down — and the Overlay is what holds an answer
	 * that has already been given: the confirm button hands its callback over the moment it is
	 * pressed, and the exit animation is all that stands between then and it running. Settling
	 * `false` here synchronously reaches past that and files a press of 「删除」 as a cancellation.
	 * Nothing is deleted, and nothing says why.
	 *
	 * Every cleanup in the tree is synchronous, so one microtask is enough to be last. A promise
	 * already settled ignores the second answer, which is exactly the precedence wanted: an answer
	 * that was given beats the default for one that was not.
	 */
	const live = useRef(pending);
	live.current = pending;
	useEffect(() => () => {
		const unanswered = live.current;
		if (unanswered) queueMicrotask(() => unanswered.settle(false));
	}, []);

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
