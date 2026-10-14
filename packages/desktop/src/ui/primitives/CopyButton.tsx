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
	const [state, setState] = useState<"idle" | "done" | "failed">("idle");
	const timer = useRef<number | undefined>(undefined);
	// The row it sits in can go before the tick does — a deleted credential — and a timer left behind writes to nothing.
	useEffect(() => () => window.clearTimeout(timer.current), []);

	const settle = (next: "done" | "failed") => {
		setState(next);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setState("idle"), TICK_MS);
	};
	const run = () => (copy ? copy() : navigator.clipboard.writeText(text ?? "").then(() => true));

	return (
		<IconButton
			{...data}
			size={size}
			className={className}
			label={state === "done" ? (done ?? translate("common.copied")) : state === "failed" ? translate("copy.failed") : label}
			icon={state === "done" ? <Check size={13} strokeWidth={2.2} className="ly-pop text-ok" /> : (icon ?? <Copy size={13} strokeWidth={1.9} />)}
			onClick={() => {
				void run().then(
					(ok) => settle(ok ? "done" : "failed"),
					() => settle("failed"),
				);
			}}
		/>
	);
}
