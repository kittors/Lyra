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

import { Component, type ErrorInfo, type ReactNode } from "react";

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
					<h1 className="text-title font-semibold text-ink">这个界面崩了</h1>
					<p className="mt-1.5 text-label leading-relaxed text-ink-muted">
						渲染进程抛了一个没人接住的错误。会话和设置都还在，重新加载这个窗口就能回去。
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

					{componentStack && (
						<details className="mt-2">
							<summary className="cursor-pointer text-detail text-ink-faint transition-colors hover:text-ink">
								组件栈
							</summary>
							<pre className="mt-1.5 max-h-[220px] overflow-auto rounded-[10px] border border-line bg-card/40 px-3 py-2.5 font-mono text-caption leading-relaxed whitespace-pre-wrap text-ink-muted select-text">
								{componentStack.trim()}
							</pre>
						</details>
					)}

					<div className="mt-5 flex items-center gap-2">
						<button
							type="button"
							onClick={() => window.location.reload()}
							className="h-8 rounded-lg bg-ink px-3.5 text-label font-medium text-shell transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90"
						>
							重新加载
						</button>
						{/*
						 * Worth saying out loud, because it is the answer surprisingly often during
						 * development: the main process does not hot-reload, so a renderer built
						 * against a newer IPC shape than the one answering it will throw right here.
						 */}
						<span className="text-detail text-ink-faint">改过主进程或 core 的话，要重启 dev server</span>
					</div>
				</div>
			</div>
		);
	}
}
