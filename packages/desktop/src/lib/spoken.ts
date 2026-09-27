/**
 * 转录里哪几句是人自己说的——输入框的方向键和对话里的「问题导航」都靠它。
 *
 * 从 `conversation/` 搬到这里：三个输入框（主的、侧边聊天、子智能体）都要往回翻自己说过的话，而
 * 输入框那个域一旦为此去引对话域的大门，就连上了「对话 → 输入框 → 对话」那一整圈——`pnpm arch`
 * 管这叫新的环。判断本身只看消息，不需要任何界面，放在 `lib` 里两边都够得着。
 */

import type { Message } from "@lyra/core";
import { translate } from "../i18n/translate.ts";
import { stripPlaceholders } from "./attachment-placeholders.ts";

/** The runtime's "carry on" message, recognised by what it says as well as by its flag. */
export function isNudge(message: Message | undefined): boolean {
	if (message?.role !== "user") return false;
	return message.content.some((c) => c.type === "text" && c.text.startsWith(translate("grouping.autoContinue")));
}

/** 人说过的一句话，连同它当初那条消息。 */
export interface Spoken {
	/** 人打的那些字：附件正文和旧记号都已经剥掉。 */
	text: string;
	/** 原消息。附件要还原回输入框，得从这里取，见 `composer/attachments/restore.ts`。 */
	message: Message;
}

/**
 * 人真正打进去过的那些话，最近的排在最前。
 *
 * 和 `questionsIn` 同住一个文件，是因为两者靠的是同一条判断：`synthetic`、`ruleMatch` 和 nudge 都
 * 挂在 user 名下，却没有一个是人敲出来的。分在两处写，迟早有一处会漏掉其中一种——而漏掉的后果是
 * 把一句人从没说过的话摆到他面前，还让他以为是自己说的。
 *
 * `text` 取 `displayText`（没有才退回正文），和气泡里显示的是同一份：附件正文不跟着回输入框，那是
 * 上千行的东西。`message` 原样交出去，因为「附件本身」得跟着回去——只给字的那一版，等于把当初那条
 * 「这张图里有什么」还原成一个没有指代对象的问题。
 *
 * 没打字但附了文件的那条也算数：它同样是人发出去的一条消息，翻回来是一袋文件加一个空输入框。
 *
 * 给输入框的方向键用，见 `composer/useInputHistory.ts`。
 */
/**
 * 一条记录画得出来吗——这里只问「有没有 role」，因为这几个函数全是按 role 分岔的。
 *
 * 和 `lib/transcript.ts` 的闸门是同一件事的两道：那一道把坏记录换成占位行，这一道是给绕过它的调用
 * 点兜底。两道都要，因为这几个函数是导出的——`Conversation` 过了闸门，而下一个调用点未必记得过，
 * 而漏掉的代价是整块界面白掉、报一句 `Cannot read properties of undefined (reading 'role')`，
 * 从那句话完全看不出是转录里缺了一格。
 */
export const readable = (message: Message | undefined): message is Message =>
	Boolean(message && typeof message.role === "string");

export function spokenByPerson(messages: readonly Message[]): Spoken[] {
	const said: Spoken[] = [];
	for (const message of messages) {
		if (!readable(message)) continue;
		if (message.role !== "user" || message.synthetic || message.ruleMatch || isNudge(message)) continue;
		const body = message.content
			.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
			.map((block) => block.text)
			.join("\n\n");
		const text = stripPlaceholders(message.displayText ?? body, message.attachments ?? []).trim();
		if (text || message.attachments?.length) said.push({ text, message });
	}
	return said.reverse();
}
