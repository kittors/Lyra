/**
 * System notification on agent task events.
 *
 * Emits an OS notification when an agent finishes its work or asks for user assistance
 * while the user is away from the app window. Clicking the notification restores and
 * focuses the window, navigating directly to the conversation.
 *
 * The text is in the interface language, from the main process's own catalog in `i18n.ts` —
 * the renderer's `translate` is not reachable from here.
 */

import type { AgentEvent, UiLocale } from "@lyra/core";
import { nativeTranslator } from "./i18n.ts";

export interface NotificationInstance {
	show(): void;
	on(event: "click", listener: () => void): void;
}

export interface TaskDoneDetails {
	sessionId: string;
	title?: string;
}

export interface NeedAssistanceDetails {
	sessionId: string;
	title?: string;
	question?: string;
	kind?: "question" | "approval";
}

/** All pending decisions need attention while their conversation is out of view. */
export function notifyAgentEvent(sessionId: string, event: AgentEvent, title?: string): void {
	if (event.type === "agent_end" && event.reason === "done") notifyTaskDone({ sessionId, title });
	if (event.type === "approval_request") {
		const question = event.kind === "interactive" || event.subject === "ask_user";
		// 后台子智能体问的，说出是谁在问——人要据此决定的，正是「这个活该不该由它来干」。
		const asking = question ? event.detail || event.reason : event.title;
		notifyNeedAssistance({ sessionId, title, kind: question ? "question" : "approval", question: event.from && asking ? translator()("notification.asking", { agent: event.from.description, question: asking }) : asking });
	}
}

export interface WindowLike {
	isDestroyed(): boolean;
	isVisible(): boolean;
	isFocused(): boolean;
	isMinimized(): boolean;
}

interface NotificationOptionsLike {
	title: string;
	body: string;
	icon?: string;
	silent?: boolean;
}

export interface NotifyDeps {
	isSupported(): boolean;
	window(): WindowLike | null;
	appIcon(): string | undefined;
	sendTrayCommand(command: `open-session:${string}`): void;
	createNotification(options: NotificationOptionsLike): NotificationInstance;
	/**
	 * The interface language setting, and the OS locale that `"system"` resolves against.
	 *
	 * Asked for each notification rather than captured once, so a language change applies to the
	 * next notification with nothing to re-wire.
	 */
	uiLocale(): UiLocale;
	systemLocale(): string;
}

let deps: NotifyDeps = {
	isSupported: () => false,
	window: () => null,
	appIcon: () => undefined,
	sendTrayCommand: (_cmd) => {},
	createNotification: () => ({
		show: () => {},
		on: () => {},
	}),
	uiLocale: () => "zh-CN",
	systemLocale: () => "zh-CN",
};

export function configureNotify(next: Partial<NotifyDeps>): void {
	deps = { ...deps, ...next };
}

function translator(): ReturnType<typeof nativeTranslator> {
	return nativeTranslator(deps.uiLocale(), deps.systemLocale());
}

function isWindowActive(win: WindowLike | null): boolean {
	return Boolean(win && !win.isDestroyed() && win.isVisible() && win.isFocused() && !win.isMinimized());
}

/**
 * Triggered when a turn finishes with reason "done".
 * Suppressed if the user is already looking at the focused window.
 */
export function notifyTaskDone(details: TaskDoneDetails): void {
	if (!deps.isSupported()) return;
	if (isWindowActive(deps.window())) return;

	const t = translator();
	const sessionTitle = details.title?.trim();
	const body = sessionTitle ? t("notification.done", { title: sessionTitle }) : t("notification.doneUntitled");
	const icon = deps.appIcon();

	const notification = deps.createNotification({
		title: "Lyra",
		body,
		...(icon ? { icon } : {}),
		silent: false,
	});

	notification.on("click", () => {
		// The shared tray dispatcher reveals the window and waits for a cold renderer.
		deps.sendTrayCommand(`open-session:${details.sessionId}`);
	});

	notification.show();
}

/**
 * Triggered when an agent requests user assistance or choices via ask_user.
 * Suppressed if the user is actively viewing the focused window.
 */
export function notifyNeedAssistance(details: NeedAssistanceDetails): void {
	if (!deps.isSupported()) return;
	if (isWindowActive(deps.window())) return;

	const t = translator();
	const sessionTitle = details.title?.trim();
	const question = details.question?.trim().replace(/\s+/g, " ");
	const questionSummary = question ? (question.length > 80 ? `${question.slice(0, 77)}...` : question) : undefined;

	const approval = details.kind === "approval";
	const status = sessionTitle
		? t(approval ? "notification.approval" : "notification.reply", { title: sessionTitle })
		: t(approval ? "notification.approvalUntitled" : "notification.replyUntitled");
	const body = questionSummary ? t("notification.detail", { status, detail: questionSummary }) : status;

	const icon = deps.appIcon();
	const notification = deps.createNotification({
		title: "Lyra",
		body,
		...(icon ? { icon } : {}),
		silent: false,
	});

	notification.on("click", () => {
		deps.sendTrayCommand(`open-session:${details.sessionId}`);
	});

	notification.show();
}
