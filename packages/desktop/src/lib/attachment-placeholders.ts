/**
 * 附件的次序，和它的正文该出现在哪儿。
 *
 * 一份草稿从前是「一段文字加一袋文件」，而那个袋子没有次序：图片一律排在最前，文档一律缀在
 * 最后，不管人是按什么顺序放进去的。一个文件时看不出来；「拿这张截图跟旧的那张比一比」时那
 * 就是整句话的意思，而它在模型看到之前就被丢掉了。
 *
 * 那一版的做法是往草稿里写一个 `【report.md】`，让次序活在唯一一个天然能扛住编辑、撤销、排队
 * 和从队列里退回来的地方——正文本身。次序是保住了，代价是人得一直看着它：输入框里凭空多出一
 * 串方括号，发出去以后气泡里又是一遍文件名，而同一张图的缩略图就挂在气泡外面。为了一个「把图
 * 插在句子中间」的罕见用法，每个人每次拖文件都要付这笔钱。
 *
 * 所以现在次序就是拖进来的次序，附件整体排在正文前面——见 `composer/outgoing.ts`。真正被放弃
 * 的只有「嵌在句子中间」这一种，而「图片一律在前、文档一律在后」那个原始毛病仍然是好的。
 *
 * 这个模块因此变成一条只读的兼容路径：新的草稿不再产生 `【】`，但升级前存下的草稿和已经躺在
 * 转录里的消息还带着它们，得读得懂。匹配按名字加序号：文中第二个 `【shot.png】` 认的是第二个
 * 叫 `shot.png` 的附件。
 */

/** 从前写进草稿的那个记号。如今只有测试和读旧数据的路径还用得上它。 */
export function placeholderFor(name: string): string {
	return `【${name}】`;
}

/**
 * 一份附件在这一条消息里的位置，说给模型听。
 *
 * 人指认附件的说法是「第二张截图」「excel 文件 1」「图片 2」——**序数加门类**，几乎从不是文件名。
 * 而模型收到的是什么？文本附件带着 `### Attached file: 名字`，图片则是一个**赤裸的图片块**，前后
 * 一个字都没有。三张图连着发过去，模型看到的是三团像素，既不知道哪张叫什么，更不知道哪张是第二张。
 * 于是「第二张截图里的报错」这种再普通不过的话，它只能猜。
 *
 * 两个序号都给，因为人用的是这两种数法：`3/5` 是在全部附件里的位置，`image 2 of 3` 是在同门类里的
 * 位置。有了后者，「图片 2」不需要模型自己去数——它数错的时候，没有任何迹象表明它数错了。
 *
 * 英文，和这一带其他给模型看的字一样：这些串不进翻译表，窗口设成什么语言都不该改变模型读到的东西。
 */
export function attachmentLabel(position: { index: number; total: number; kind?: string; kindIndex: number; kindTotal: number }): string {
	const { index, total, kind, kindIndex, kindTotal } = position;
	const within = kind && kindTotal > 1 ? `, ${kind} ${kindIndex} of ${kindTotal}` : kind ? `, ${kind}` : "";
	return total > 1 ? `Attachment ${index} of ${total}${within}` : `Attached file`;
}

/** How a text attachment's contents are spelled into the prompt, named and fenced. */
export function attachmentBody(name: string, text: string, label = "Attached file"): string {
	return `\n\n### ${label}: ${name}\n\`\`\`\n${text}\n\`\`\`\n\n`;
}

/** How a file that could not be read is spelled instead — so the model does not answer as if it had. */
export function attachmentStub(name: string, mimeType?: string, label = "Attached file"): string {
	return `\n\n[${label}: ${name}${mimeType ? ` (${mimeType})` : ""} — contents not included]\n\n`;
}

/**
 * 图片块前面那一行。
 *
 * 图片自己是一个 `image` 内容块，没有地方能写字，所以名字和序号只能作为**紧挨着它的一段文字**送过去。
 * 这一行是三张截图之间唯一的区别。
 */
export function attachmentImageLabel(name: string, label: string): string {
	return `\n\n### ${label}: ${name}\n\n`;
}

/**
 * Whether a text block is an attachment's contents rather than something a person typed.
 *
 * Used when a sent message is edited. The editor works on `displayText`, which is the typed words
 * with the file bodies left out — so rebuilding the message from the edited text alone would send
 * the attachment names with nothing behind them. This is what lets the bodies be carried across
 * unchanged: they were never what was being edited.
 *
 * 前缀从固定的 `### Attached file: ` 放宽成「`###` 或 `[` 开头、冒号前带 `Attach` 字样」，因为标题里
 * 现在还带着序号。转录里躺着的旧消息用的是老写法，两种都得认——认不出来的后果是编辑一条带附件的旧
 * 消息时，附件正文被当成人打的字，跟着编辑框一起没了。
 */
export function isAttachmentBody(text: string): boolean {
	return /^\n\n(?:### |\[)(?:Attached file|Attachment \d+)[:,]/.test(text) || /^\n\n(?:### |\[)Attachment \d+ of \d+/.test(text);
}

export type Segment<File> = { kind: "text"; text: string } | { kind: "file"; file: File };

export interface Placement<File> {
	/** The draft cut at its placeholders, in reading order. */
	segments: Segment<File>[];
	/**
	 * Files with no placeholder to stand at.
	 *
	 * A draft can lose a placeholder honestly — the person deleted that part of the sentence, or the
	 * file arrived from somewhere with no caret to write at, like a queued message being restored.
	 * They still have to be sent, so they go on the end rather than being dropped: an attachment that
	 * silently does not arrive is much worse than one in the wrong place.
	 */
	unplaced: File[];
}

/**
 * Cut `text` at the placeholders that name one of `files`.
 *
 * A `【…】` that names nothing stays as literal text — the brackets are ordinary punctuation in
 * Chinese, and a message that happens to contain 【重要】 is not making a reference to anything.
 */
export function placeAttachments<File extends { name: string }>(text: string, files: File[]): Placement<File> {
	const segments: Segment<File>[] = [];
	const taken = new Set<File>();
	let plain = "";
	let at = 0;

	while (at < text.length) {
		const open = text.indexOf("【", at);
		if (open === -1) break;
		const close = text.indexOf("】", open + 1);
		if (close === -1) break;
		const name = text.slice(open + 1, close);
		const file = files.find((candidate) => candidate.name === name && !taken.has(candidate));
		if (!file) {
			// Not a reference. Keep the brackets and carry on looking after the opening one, so
			// 【a【b.md】 still finds the inner name.
			plain += text.slice(at, open + 1);
			at = open + 1;
			continue;
		}
		plain += text.slice(at, open);
		if (plain) segments.push({ kind: "text", text: plain });
		plain = "";
		segments.push({ kind: "file", file });
		taken.add(file);
		at = close + 1;
	}

	plain += text.slice(at);
	if (plain) segments.push({ kind: "text", text: plain });

	return { segments, unplaced: files.filter((file) => !taken.has(file)) };
}

/**
 * 只留人打的字：认得出的 `【文件名】` 从给人看的那一份里拿掉。
 *
 * 气泡里画的是这个结果，附件本身画在气泡外面那一排上。留着记号就会变成同一个文件说两遍——
 * 这正是它当初被做成行内胶囊想躲开的事，只是那一版把重复挪进了气泡，没有消掉。
 *
 * 记号让位之后留下的空档要一起收干净：`看这张 【a.png】 再看` 剥完是两个连着的空格，一条自己
 * 发出去的消息里出现一段莫名其妙的空白，比留着文件名还难解释。
 */
export function stripPlaceholders<File extends { name: string }>(text: string, files: File[]): string {
	if (!files.length || !text.includes("【")) return text;
	const { segments } = placeAttachments(text, files);
	return segments
		.filter((segment): segment is { kind: "text"; text: string } => segment.kind === "text")
		.map((segment) => segment.text)
		.join("")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
