/**
 * 附件的次序，和它在句子里站的位置。
 *
 * 一份草稿从前是「一段文字加一袋文件」，而那个袋子没有次序：图片一律排在最前，文档一律缀在最后，
 * 不管人是按什么顺序放进去的。一个文件时看不出来；「拿这张截图跟旧的那张比一比」时那就是整句话的
 * 意思，而它在模型看到之前就被丢掉了。
 *
 * 做法是往正文里写一个记号，让次序活在唯一一个天然能扛住编辑、撤销、排队和从队列里退回来的地方
 * ——正文本身。这套记号一度被整个拿掉，因为它那时写的是文件名：拖六个文件进来，输入框当场变成三行
 * 方括号，发出去以后气泡里又是一遍，而同一张图的缩略图就挂在气泡外面。
 *
 * 现在它回来了，换了两处：记号写的是「图片 1」「表格 2」——门类加序号，短，而且正是人指认附件时说
 * 的话；两头都把它画成一枚带色的标签（输入框里是镜像层上的高亮，气泡里是个真的 span），而不是一串
 * 裸方括号。于是它不再是噪声，而是句子的一部分：「照着 【表格 1】 改一版」里的那个「表格 1」，和上
 * 面那一排里的某一格是同一个东西，删掉那一格它就跟着消失。
 *
 * 匹配按名字加序号：文中第二个 `【表格 1】` 认的是第二个叫「表格 1」的附件。升级前存下的草稿和转录
 * 里的老消息写的是文件名，那一种也认——见 `answersTo`。
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

type Segment<File> = { kind: "text"; text: string } | { kind: "file"; file: File };

/** 正文里一处认得出的标记：它在哪儿，指的是谁。 */
export interface Placeholder<File> {
	start: number;
	/** 闭合的 `】` 之后一位，可以直接拿去 `slice`。 */
	end: number;
	file: File;
}

/**
 * 标记在正文里叫什么。
 *
 * 不是文件名：一张粘贴进来的图在界面上叫「图片 1」，而它的 `name` 是剪贴板给的 `image.png`——
 * 正文里的标记要和人在附件条上看到的那个名字一字不差，否则「删掉图片 1」这句话里说的东西和屏幕
 * 上的对不上。给模型看的仍然是 `name`，两者分开走。
 */
function answersTo(file: { name: string; label?: string }, written: string): boolean {
	/*
	 * 真名也认。
	 *
	 * 升级前写进草稿和转录的标记用的是文件名（`【image.png】`），而现在写的是界面上那个名字
	 * （`【图片 1】`）。只认后者的话，那些旧消息的标记会全部退化成普通文字——气泡里凭空多出一串
	 * 方括号，而它本来是一枚标签。
	 */
	return file.label === written || file.name === written;
}

/**
 * 扫出正文里所有认得出的标记，带位置。
 *
 * 解析只有这一处。`placeAttachments` 当初把「切开正文」和「找出标记」揉在一起，于是想知道「第二
 * 个标记在第几个字符」的调用方只能再写一遍同样的扫描——而两份扫描迟早对不齐，对不齐的表现是正文
 * 里某一段被高亮成了别的东西。
 *
 * 匹配按名字加次序：第二个 `【图片 1】` 认的是第二个叫「图片 1」的附件。认不出的 `【…】` 原样
 * 留着——中文里方括号是普通标点，一句「这个【重要】」不是在引用任何东西。
 */
export function scanPlaceholders<File extends { name: string; label?: string }>(
	text: string,
	files: File[],
): Placeholder<File>[] {
	const hits: Placeholder<File>[] = [];
	if (!text.includes("【")) return hits;
	const taken = new Set<File>();
	let at = 0;

	while (at < text.length) {
		const open = text.indexOf("【", at);
		if (open === -1) break;
		const close = text.indexOf("】", open + 1);
		if (close === -1) break;
		const name = text.slice(open + 1, close);
		const file = files.find((candidate) => answersTo(candidate, name) && !taken.has(candidate));
		if (!file) {
			// 不是引用。从开头那个括号之后接着找，这样 【a【b.md】 还能找到里面那个名字。
			at = open + 1;
			continue;
		}
		hits.push({ start: open, end: close + 1, file });
		taken.add(file);
		at = close + 1;
	}

	return hits;
}

/**
 * 光标停在这里的话，退格键该吃掉哪一枚标记。
 *
 * 标记是一个整体，不是十一个字符。一格一格地退，`【表格 1】` 会先变成 `【表格 1`——那一刻它已经不
 * 再是标记了（配不上任何附件），于是附件不会跟着卸下来，而屏幕上还剩一串没人认得的字。整枚一起
 * 走，删除才和「这份附件不要了」是同一件事。
 *
 * `backwards` 是退格（吃掉光标前面那一枚），否则是 Delete（吃掉后面那一枚）。光标**在标记中间**时
 * 两个键都吃掉整枚——停在里面本身就说明人没打算逐字编辑它。
 */
export function placeholderAt<File extends { name: string; label?: string }>(
	text: string,
	files: File[],
	caret: number,
	backwards: boolean,
): Placeholder<File> | null {
	for (const hit of scanPlaceholders(text, files)) {
		if (caret > hit.start && caret < hit.end) return hit;
		if (backwards ? caret === hit.end : caret === hit.start) return hit;
	}
	return null;
}

/**
 * 附件的名字变了，正文里指着它的标记跟着改。
 *
 * 序号会变：删掉「图片 1」之后，原来的「图片 2」就成了「图片 1」——附件条上是自动重编的，正文里
 * 那句「照着 【图片 2】 改」如果不动，指的就是一个不存在的编号了。
 *
 * 定位用的是**改名之前**的那份列表，所以不存在「认不出」的问题：先按旧名字把位置扫出来，再一次
 * 性写成新名字。
 */
export function renamePlaceholders<File extends { name: string; label?: string }>(
	text: string,
	before: File[],
	nameAfter: (file: File) => string | null,
): string {
	const hits = scanPlaceholders(text, before);
	if (hits.length === 0) return text;

	let out = "";
	let cursor = 0;
	for (const hit of hits) {
		out += text.slice(cursor, hit.start);
		const next = nameAfter(hit.file);
		// `null` 是「这一份已经不在了」——标记跟着走，剩下的空档在下面收干净。
		if (next !== null) out += placeholderFor(next);
		cursor = hit.end;
	}
	out += text.slice(cursor);

	return out
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

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
export function placeAttachments<File extends { name: string; label?: string }>(text: string, files: File[]): Placement<File> {
	const segments: Segment<File>[] = [];
	const hits = scanPlaceholders(text, files);
	const taken = new Set<File>(hits.map((hit) => hit.file));
	let cursor = 0;

	for (const hit of hits) {
		const plain = text.slice(cursor, hit.start);
		if (plain) segments.push({ kind: "text", text: plain });
		segments.push({ kind: "file", file: hit.file });
		cursor = hit.end;
	}

	const tail = text.slice(cursor);
	if (tail) segments.push({ kind: "text", text: tail });

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
