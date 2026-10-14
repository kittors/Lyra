/**
 * An icon button that copies something, and shows that it did.
 *
 * The clipboard is a place nobody can see, so a copy that happened and one that did not look the
 * same unless the button says so: it turns into a tick for a moment — long enough to see, shorter
 * than "is it stuck" — and its tooltip says what happened. A copy that failed says that instead.
 *
 * What to copy is the caller's: a string goes straight to the clipboard, or `copy` does it some
 * other way (the vault's values are written by the main process) and answers whether it worked.
 */

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { translate } from "../../i18n/translate.ts";
import type { DataAttributes } from "./Button.tsx";
import { IconButton } from "./IconButton.tsx";

const TICK_MS = 1400;

/**
 * The tick, as a hook, for a copy that is not an icon button — a chip in a sentence copies too. `run`
 * takes the copy and resolves the state from it; the tick goes back to idle on its own.
 */
export function useCopyFeedback(): { state: "idle" | "done" | "failed"; run: (copy: () => Promise<boolean>) => void } {
	const [state, setState] = useState<"idle" | "done" | "failed">("idle");
	const timer = useRef<number | undefined>(undefined);
	// What it sits in can go before the tick does — a deleted credential's row — and a timer left behind writes to nothing.
	useEffect(() => () => window.clearTimeout(timer.current), []);
	const settle = (next: "done" | "failed") => {
		setState(next);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setState("idle"), TICK_MS);
	};
	const run = (copy: () => Promise<boolean>) => {
		void copy().then(
			(ok) => settle(ok ? "done" : "failed"),
			() => settle("failed"),
		);
	};
	return { state, run };
}

export function CopyButton({
	label,
	text,
	copy,
	done,
	icon,
	size = "sm",
	className = "",
	...data
}: DataAttributes & {
	/** What it copies, as its tooltip: 「复制引用」. */
	label: string;
	/** Copied as is. Give this or `copy`. */
	text?: string;
	/** Copies some other way; resolves to whether it worked. */
	copy?: () => Promise<boolean>;
	/** What it says once it has: defaults to 「已复制」. */
	done?: string;
	icon?: React.ReactNode;
	size?: "xs" | "sm" | "md";
	className?: string;
}) {
	const { state, run } = useCopyFeedback();

	return (
		<IconButton
			{...data}
			size={size}
			className={className}
			label={state === "done" ? (done ?? translate("common.copied")) : state === "failed" ? translate("copy.failed") : label}
			icon={state === "done" ? <Check size={13} strokeWidth={2.2} className="ly-pop text-ok" /> : (icon ?? <Copy size={13} strokeWidth={1.9} />)}
			onClick={() => run(copy ?? (() => navigator.clipboard.writeText(text ?? "").then(() => true)))}
		/>
	);
}
