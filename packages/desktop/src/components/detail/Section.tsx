/**
 * A labelled block inside an expanded card.
 *
 * One definition, used by the transcript's tool cards and by both panels. They had drifted into
 * three slightly different looks — different padding, different label size, monospace applied to
 * prose — which is the sort of difference nobody can name but everybody sees.
 *
 * `mono` rather than always-monospace: a command, a JSON argument and a program's output are code
 * and read better as code; a question someone typed is not, and setting it in a terminal face makes
 * the panel look like a log of machine noise rather than a record of a conversation.
 *
 * Code also gets a block of its own — inset, darker, rounded — instead of sitting flush against the
 * card's edges. It is the difference between a card that contains a command and a card that has a
 * command spilled across it: the block gives the text a margin to breathe in and says where it
 * starts and stops without needing a rule to do it.
 *
 * The heading rolls when it changes, which is here rather than at the call sites because only one
 * of them ever changes — a call finishing turns 输出（进行中） into 结果 under the text it labels —
 * and a heading that never changes never animates.
 */

import { RollingText } from "../../ui/motion/RollingText.tsx";

export function Section({
	title,
	mono = false,
	tone = "muted",
	children,
}: {
	title: string;
	mono?: boolean;
	tone?: "muted" | "ink" | "danger";
	children: React.ReactNode;
}) {
	const colour = tone === "danger" ? "text-danger/90" : tone === "ink" ? "text-ink" : "text-ink-muted";
	return (
		<div className="px-3 py-2.5">
			<div className="mb-1.5 text-caption tracking-wide text-ink-faint uppercase">
				<RollingText>{title}</RollingText>
			</div>
			<div
				className={`text-detail leading-relaxed break-words whitespace-pre-wrap ${colour} ${
					mono ? "rounded-lg bg-shell/70 px-2.5 py-2 font-mono" : ""
				}`}
			>
				{children}
			</div>
		</div>
	);
}
