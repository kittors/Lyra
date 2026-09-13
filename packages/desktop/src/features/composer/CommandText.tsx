import type { CommandDecoration } from "./command-catalog.ts";

interface MentionDecoration {
	start: number;
	end: number;
	kind?: "file" | "subagent" | "plugin" | "session";
}

export interface ComposerDecorations {
	command?: CommandDecoration;
	mentions?: MentionDecoration[];
	/**
	 * 正文里代表附件的那些标记，`【图片 1】`。
	 *
	 * 它们是人打出来的字里唯一一段「不是字」的东西：指的是上面那一排里的某一个附件，删掉那个附件
	 * 它就该消失。画成一枚标签而不是一串方括号，是因为方括号在中文里是普通标点——不画出来的话，
	 * 「这个【重要】」和真正的引用长得一模一样。
	 */
	attachments?: { start: number; end: number; kind?: string }[];
}

interface TextSpan {
	text: string;
	className?: string;
	/** 附件标记按门类上色，色值由 `.ly-attachment-token[data-kind]` 给。 */
	kind?: string;
}

/** Split text by non-overlapping ranges and mark matched spans. */
function buildDecoratedSpans(value: string, decoration: ComposerDecorations): TextSpan[] {
	interface Segment {
		start: number;
		end: number;
		className: string;
		/** 附件标记才有：门类决定它是哪种颜色。 */
		kind?: string;
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

	if (decoration.attachments) {
		for (const a of decoration.attachments) {
			if (a.start >= 0 && a.end <= value.length && a.start < a.end) {
				segments.push({
					start: a.start,
					end: a.end,
					className: "ly-attachment-token",
					...(a.kind ? { kind: a.kind } : {}),
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
			...(seg.kind ? { kind: seg.kind } : {}),
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
						<span key={idx} className={s.className} data-kind={s.kind}>
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
