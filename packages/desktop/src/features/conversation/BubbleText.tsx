/**
 * 一条自己发出去的消息，气泡里那部分正文。
 *
 * 主会话和侧边聊天共用，因为它们画的本来就是同一件东西——而在这个文件出现之前，它们各画各的：
 * 主会话把附件切成行内胶囊、正文当纯文本；侧边聊天把所有文本块拼起来直接摊开，于是
 * `### Attached file: image.png` 这种写给模型的记号原样出现在人眼前。同一条消息两个样子。
 *
 * **两种画法，按有没有附件标记分。** 这是个取舍，写下来免得下一个人以为是漏的：
 *
 * - **没有标记**：整段交给 markdown。一条以 `# 需求1` 开头的消息，人写的时候就是当标题写的，
 *   画成一行井号是把他的意思丢了。绝大多数长消息走这一支。
 * - **有标记**：保持行内纯文本。markdown 是块级的——`看这张 【图片 1】 再看那张` 交给它，
 *   会切成「段落、胶囊、段落」三块竖着排，一句话被拆成三行。胶囊本身就是这句话的一部分，
 *   把它挤到单独一行，比不支持 markdown 更糟。带附件的消息几乎都是短句，这一支够用。
 *
 * 两个渲染器都由调用方给，这个文件自己什么都不画。不是为了灵活——是因为 `Markdown` 经
 * `dock/index.ts` 绕回 `conversation/index.ts`，在这里直接 import 它会连出一个新的环
 * （`pnpm arch` 当场报出来）。切分在这里，画什么在外面，两边都干净。
 */

import { useMemo } from "react";
import { placeAttachments } from "../../lib/attachment-placeholders.ts";

export function BubbleText<File extends { name: string; label?: string }>({
	text,
	files,
	renderText,
	renderFile,
	className = "",
}: {
	/** 人打的那些字，`【图片 1】` 这样的标记留在里面。 */
	text: string;
	/** 这条消息带的附件，用来认出文中的标记。 */
	files: File[];
	/** 没有标记时，整段怎么画——通常是 `<Markdown/>`。 */
	renderText: (text: string) => React.ReactNode;
	/** 一枚标记画成什么。点它之后做什么两边并不一样，所以也由调用方给。 */
	renderFile: (file: File, at: number) => React.ReactNode;
	className?: string;
}) {
	const segments = useMemo(() => placeAttachments(text, files).segments, [text, files]);
	const hasFiles = segments.some((segment) => segment.kind === "file");

	if (!hasFiles) return <div className={className}>{renderText(text)}</div>;

	return (
		<p className={`whitespace-pre-wrap break-words ${className}`}>
			{segments.map((segment, at) => (segment.kind === "text" ? segment.text : renderFile(segment.file, at)))}
		</p>
	);
}
