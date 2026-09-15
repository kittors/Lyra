/**
 * The last thing between a thrown error and a grey window.
 *
 * React unmounts the entire tree when an error reaches the root uncaught, so one component
 * throwing took the whole app with it — and what was left was the window's background colour and
 * three traffic lights. No message, no stack, nothing to act on; from the outside it is
 * indistinguishable from a hang, a failed build, or a crash of the main process.
 *
 * This does not make anything work that did not. It makes the failure legible: what threw, where,
 * and the one action worth offering, which is reloading the renderer. In a desktop app that is a
 * real recovery — the main process, the sessions and the settings are all still alive on the other
 * side of the IPC boundary, and only this window has to be rebuilt.
 *
 * A class, because `getDerivedStateFromError` has no hook equivalent. It is the only one in the
 * codebase and this is the reason.
 */

import { RotateCw } from "lucide-react";
import { translate } from "../../i18n/translate.ts";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { CopyMark } from "./CopyMark.tsx";
import { Disclosure } from "./Disclosure.tsx";

interface State {
	error: Error | null;
	/** React's own note about which component threw, which a stack trace does not tell you. */
	componentStack: string | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
	override state: State = { error: null, componentStack: null };

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		// Also to the console, so it lands in the devtools log with everything logged around it.
		console.error("[lyra] uncaught render error", error, info.componentStack);
		this.setState({ componentStack: info.componentStack ?? null });
	}

	override render(): ReactNode {
		const { error, componentStack } = this.state;
		if (!error) return this.props.children;

		return (
			<div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-shell px-8">
				<div className="w-full max-w-[560px]">
					<h1 className="text-title font-semibold text-ink">{translate("errorBoundary.title")}</h1>
					<p className="mt-1.5 text-label leading-relaxed text-ink-muted">
						{translate("errorBoundary.detail")}
					</p>

					{/*
					 * The message verbatim, in mono, selectable.
					 *
					 * Whoever is looking at this is about to paste it somewhere — an issue, a chat, a
					 * search box — and a paraphrase would be the one thing that cannot be pasted.
					 */}
					<pre className="mt-4 max-h-[180px] overflow-auto rounded-[10px] border border-danger/35 bg-danger/6 px-3 py-2.5 font-mono text-detail leading-relaxed whitespace-pre-wrap text-danger select-text">
						{error.message || String(error)}
					</pre>

					{/*
					 * 错误自己的调用栈，和组件栈分开两块。
					 *
					 * 组件栈只说「崩在 Conversation 这棵树里」，而那是一个有几十个 useMemo 的组件——
					 * 从它完全看不出是哪一个函数读到了 undefined。真正能定位的是 `error.stack`：即使
					 * 压缩过，chunk 的行列号配 source map 也能还原到具体那一行。
					 *
					 * 这一条是踩出来的：同一个崩溃报上来三次，每次都只有组件栈，于是每次都只能靠猜
					 * 「大概是转录里缺了一格」，三次都没查到根上。默认展开，就是因为前两次它没被复制。
					 */}
					{error.stack && (
						<div className="mt-2">
							<Disclosure variant="compact" title={translate("errorBoundary.errorStack")} defaultOpen>
								<div className="group/copy relative mt-1">
									<CopyMark text={error.stack.trim()} side="left" />
									<pre className="max-h-[220px] overflow-auto rounded-[10px] border border-line bg-card/40 py-2.5 pr-3 pl-9 font-mono text-caption leading-relaxed whitespace-pre-wrap text-ink-muted select-text">
										{error.stack.trim()}
									</pre>
								</div>
							</Disclosure>
						</div>
					)}

					{componentStack && (
						<div className="mt-2">
							<Disclosure variant="compact" title={translate("errorBoundary.stack")}>
								{/*
								 * 这一段的下一步一定是粘到别处去，所以角上给一枚复制键。
								 *
								 * 左上角而不是右上角：这一框会横向溢出，右上角那枚会压在最长那几行的字上；
								 * 而左边是每一行的行首，缩进留出来的空白本来就在那儿。`pl-9` 是给它让的位。
								 */}
								<div className="group/copy relative mt-1">
									<CopyMark text={componentStack.trim()} side="left" />
									<pre className="max-h-[220px] overflow-auto rounded-[10px] border border-line bg-card/40 py-2.5 pr-3 pl-9 font-mono text-caption leading-relaxed whitespace-pre-wrap text-ink-muted select-text">
										{componentStack.trim()}
									</pre>
								</div>
							</Disclosure>
						</div>
					)}

					{/*
					 * 这一行的字顶着左边，和上面的标题、正文、报错框对齐。
					 *
					 * 按钮从行首挪到了话的后面：它是这句话的出口（「要重启 dev server」——那就重启给你看），
					 * 排在话前面时，整段说明被它推离了左边缘，页面上于是有两条左边界。
					 */}
					<div className="mt-5 flex items-center gap-1.5">
						{/*
						 * Worth saying out loud, because it is the answer surprisingly often during
						 * development: the main process does not hot-reload, so a renderer built
						 * against a newer IPC shape than the one answering it will throw right here.
						 */}
						<span className="text-detail text-ink-faint">{translate("errorBoundary.devHint")}</span>
						{/*
						 * 没有底色也没有描边。
						 *
						 * 这一屏上唯一该被填实的是那个报错框——它是这一屏的主语。一枚实心按钮压在说明文字
						 * 旁边，读起来像是这句话在催人按它，而它只是「顺手可以重来一次」。
						 */}
						<button
							type="button"
							data-ly-tip={translate("errorBoundary.reload")}
							aria-label={translate("errorBoundary.reload")}
							onClick={() => window.location.reload()}
							className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
						>
							<RotateCw size={13} strokeWidth={2} aria-hidden />
						</button>
					</div>
					{/* 组件栈是这一屏里唯一带线索的东西，而它默认是折起来的——得说一句。 */}
					<p className="mt-1.5 text-detail text-ink-faint">{translate("errorBoundary.issueHint")}</p>
				</div>
			</div>
		);
	}
}
