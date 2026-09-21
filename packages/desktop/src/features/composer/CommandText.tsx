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
			{/*
			 * 上下化开自己占一层，横向那条留在外面。
			 *
			 * 两者都是 `mask-image`，写在同一个元素上是同一个属性的两次声明——后来的那条整个替换掉
			 * 前一条，不会合成。而这两件事都真的会同时发生：打一条带长参数的斜杠命令，右端要为提示
			 * 文字化开，上下又因为装不下要化开。叠成两层，遮罩就是相交而不是互相覆盖。
			 *
			 * `absolute inset-0` 是必须的：遮罩里的 `100% - fade-bottom` 算的是这一层自己的高度，
			 * 而镜像里的字比可视区高得多。让它贴死外层，那个 100% 才是 textarea 看得见的那一段。
			 */}
			<div className="ly-field-fade absolute inset-0 overflow-hidden">
				<div ref={mirror} className="ly-composer-text whitespace-pre-wrap break-words" data-command-mirror>
					{spans.map((s, idx) =>
						s.className ? (
							<span key={idx} className={s.className} data-kind={s.kind} data-bodiless={s.bodiless ? "" : undefined}>
								{s.brackets && s.text.length > 2 ? (
									/*
									 * 底色只包图标和名字，收尾那个 `】` 仍占满 1em，但不进胶囊。
									 *
									 * 两端方括号必须留在镜像里：textarea 里有这两个字，删掉或改宽度，后面整段
									 * 都会错位。原先把 `】` 也画进底色，右边就空出整整一格，左边图标却贴着边。
									 * 底色改画在 `.ly-token-paint` 上，右侧只留和左边一样的 inset；`】` 用负边
									 * 距叠回那一点 inset，字符格子一个都没动。
									 */
									<span className="ly-token-body">
										<span className="ly-token-paint">
											<span className="ly-token-bracket">{s.text.slice(0, 1)}</span>
											{s.text.slice(1, -1)}
										</span>
										<span className="ly-token-bracket">{s.text.slice(-1)}</span>
									</span>
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
		</div>
	);
}
