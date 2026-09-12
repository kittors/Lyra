import type { CommandDecoration } from "./command-catalog.ts";

interface MentionDecoration {
	start: number;
	end: number;
	kind?: "file" | "subagent" | "plugin" | "session";
}

export interface ComposerDecorations {
	command?: CommandDecoration;
	mentions?: MentionDecoration[];
}

interface TextSpan {
	text: string;
	className?: string;
}

/** Split text by non-overlapping ranges and mark matched spans. */
function buildDecoratedSpans(value: string, decoration: ComposerDecorations): TextSpan[] {
	interface Segment {
		start: number;
		end: number;
		className: string;
	}

	const segments: Segment[] = [];
	if (decoration.command) {
		segments.push({
			start: decoration.command.start,
			end: decoration.command.end,
			className: "ly-command-token",
		});
	}

	if (decoration.mentions) {
		for (const m of decoration.mentions) {
			if (m.start >= 0 && m.end <= value.length && m.start < m.end) {
				segments.push({
					start: m.start,
					end: m.end,
					className: "ly-mention-token",
				});
			}
		}
	}

	// Sort segments by start offset
	segments.sort((a, b) => a.start - b.start);

	const spans: TextSpan[] = [];
	let cursor = 0;

	for (const seg of segments) {
		if (seg.start < cursor) {
			// Skip overlapping segment
			continue;
		}
		if (seg.start > cursor) {
			spans.push({ text: value.slice(cursor, seg.start) });
		}
		spans.push({
			text: value.slice(seg.start, seg.end),
			className: seg.className,
		});
		cursor = seg.end;
	}

	if (cursor < value.length) {
		spans.push({ text: value.slice(cursor) });
	}

	return spans;
}

/** Decoration never owns input, selection or clipboard data; the native textarea does. */
export function CommandText({
	value,
	decoration,
	mirror,
}: {
	value: string;
	decoration: ComposerDecorations;
	mirror: React.RefObject<HTMLDivElement | null>;
}) {
	const spans = buildDecoratedSpans(value, decoration);
	const commandHint = decoration.command?.hint;

	return (
		<div aria-hidden className={`pointer-events-none absolute inset-0 select-none overflow-hidden ${commandHint ? "ly-fade-edge" : ""}`}>
			<div ref={mirror} className="ly-composer-text whitespace-pre-wrap break-words" data-command-mirror>
				{spans.map((s, idx) => (
					s.className ? (
						<span key={idx} className={s.className}>
							{s.text}
						</span>
					) : (
						<span key={idx}>{s.text}</span>
					)
				))}
				{/* A native textarea reserves a line after a trailing newline; an empty div line collapses. */}
				{value.endsWith("\n") && "\u200b"}
				{commandHint && (
					<span className="ly-command-hint text-ink-faint">
						{value.length === decoration.command?.end ? " " : ""}
						{commandHint}
					</span>
				)}
			</div>
		</div>
	);
}
