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
	attachments?: { start: number; end: number; kind?: string; bodiless?: boolean }[];
	/**
	 * 还没上屏的那几个字母，正在等着被选成一个字。
	 *
	 * 输入法给这一段画一条下划线，说的是「这还没定下来」。组字期间画字的是这一层而不是 textarea
	 * （底下那行字始终透明），那条下划线就得由这一层自己补——否则 `zhe` 看起来和已经打完的字一样。
	 */
	composing?: { start: number; end: number };
}

interface TextSpan {
	text: string;
	className?: string;
	/** 附件标记按门类上色，色值由 `.ly-attachment-token[data-kind]` 给。 */
	kind?: string;
	/** 只有名字进了提示词，内容没有——图标淡一档说这件事。 */
	bodiless?: boolean;
	/** 首尾那对 `【】` 单独包一层画成透明——留位不留形，见下面组装 span 的地方。 */
	brackets?: boolean;
}

/** Split text by non-overlapping ranges and mark matched spans. */
function buildDecoratedSpans(value: string, decoration: ComposerDecorations): TextSpan[] {
	interface Segment {
		start: number;
		end: number;
		className: string;
		/** 附件标记才有：门类决定它是哪种颜色。 */
		kind?: string;
		/** 同上，只有名字进了提示词的那些。 */
		bodiless?: boolean;
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
					...(a.bodiless ? { bodiless: true } : {}),
				});
			}
		}
	}

	/*
	 * 组字那一段排在最后加。
	 *
	 * 重叠时先到的那个赢（见下面那圈循环），所以它让着命令、引用和附件标记——那三样是这句话的结
	 * 构，而这一段只是几个还没落定的字母。真重叠上的时候丢掉它只是少一条下划线，反过来丢掉的却是
	 * 一枚标记。
	 */
	const composing = decoration.composing;
	if (composing && composing.start >= 0 && composing.end <= value.length && composing.start < composing.end) {
		segments.push({ start: composing.start, end: composing.end, className: "ly-composing-token" });
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
			...(seg.bodiless ? { bodiless: true } : {}),
			/*
			 * 附件标记的那对方括号留着占位，但不画出来。
			 *
			 * 这一层是铺在 textarea 上的镜像，每个字必须和底下真正的字符严丝合缝——所以既不能把
			 * 括号从这里删掉（textarea 里有它们，删了之后整段字就错位了），也不能给标签加左右内
			 * 边距（同理）。把它们画成透明是唯一两头都成立的办法：字符照样占它那一格宽度，而那一
			 * 格正好成了标签天然的左右留白。
			 */
			...(seg.className === "ly-attachment-token" ? { brackets: true } : {}),
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

	/*
	 * 组字的时候这一层浮到上面去。
	 *
	 * 平时它铺在 textarea 底下，靠底下那行字透明透上来——够用，因为 textarea 除了字什么都不画。组
	 * 字时不是：浏览器会给还没上屏的那几个字母刷一块不透明的高亮底，而那块底盖住的正是这一层画的同
	 * 几个字母，于是屏幕上出现一块什么都没有的色块。浮上来之后，那块底就退成了它本来该是的样子——
	 * 输入法给这一段打的底色，字在上面。
	 *
	 * 只在组字时浮。这一层不吃鼠标也不吃选择，但它毕竟带着标记那层淡底色，常态压在选区上没必要。
	 */
	return (
		<div
			aria-hidden
			className={`pointer-events-none absolute inset-0 select-none overflow-hidden ${decoration.composing ? "z-10" : ""} ${commandHint ? "ly-fade-edge" : ""}`}
		>
			<div ref={mirror} className="ly-composer-text whitespace-pre-wrap break-words" data-command-mirror>
				{spans.map((s, idx) =>
					s.className ? (
						<span key={idx} className={s.className} data-kind={s.kind} data-bodiless={s.bodiless ? "" : undefined}>
							{s.brackets && s.text.length > 2 ? (
								/*
								 * 底色只包到名字为止，收尾那个方括号留在外面。
								 *
								 * 两个方括号都是透明的占位，但它们看起来不一样：左边那个底下画着图标，右
								 * 边那个是纯空白——底色要是把两个都包进去，右侧就凭空多出一整个字符的留
								 * 白，和左边对不齐。包到名字为止之后，标签自身是对称的，而右边那一格空白
								 * 正好成了它和后面那句话之间的间隔。
								 */
								<>
									<span className="ly-token-body">
										<span className="ly-token-bracket">{s.text.slice(0, 1)}</span>
										{s.text.slice(1, -1)}
									</span>
									<span className="ly-token-bracket">{s.text.slice(-1)}</span>
								</>
							) : (
								s.text
							)}
						</span>
					) : (
						<span key={idx}>{s.text}</span>
					),
				)}
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
