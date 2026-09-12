/**
 * 输入框里那份草稿，变成真正发出去的东西。
 *
 * 本来是 `Composer.submitOnce` 中间的一段。分出来是因为现在有两个地方要走它：按下回车直接发的那一
 * 条，和排进队列等下一轮的那一条——后者在入队时就得展开好，否则条上留着的是 `/commit`，而真正发出
 * 去的是它代表的几百字，两者不是同一样东西，出了岔子也对不上账。
 *
 * 展开在入队那一刻，不在出队那一刻。命令定义是从磁盘上读的，而排队的这段时间里它可能被改过——按下
 * 回车时看到的是什么，发出去的就该是什么。
 */

import type { UserContent } from "@lyra/core";
// Through the browser-safe door: the main barrel reaches the filesystem, and this runs in a page.
import { expandCommand, parseInvocation, parseSkillMention, resolveCommand, skillNameOf } from "@lyra/core/commands-view";

import { attachmentBody, attachmentImageLabel, attachmentLabel, attachmentStub, placeAttachments, stripPlaceholders } from "../../lib/attachment-placeholders.ts";
import { skillCommandName } from "./command-catalog.ts";
import { bridge } from "../../services/index.ts";

/** 附件在草稿里的样子，只取这一步用得上的几项。 */
interface OutgoingAttachment {
	name: string;
	mimeType: string;
	/** 图标用的门类，跟着消息一起留在转录里——正文不留，只留这个。 */
	kind?: string;
	data?: string;
	text?: string;
	isText?: boolean;
}

export interface OutgoingDraft {
	/** 已经去过首尾空白的正文。 */
	text: string;
	attachments: OutgoingAttachment[];
	sessionRefs: { id: string; title: string }[];
}

export interface Outgoing {
	content: UserContent[];
	displayText?: string;
	skillRef?: { name: string; path?: string; pluginId?: string };
	sessionRefs?: { id: string; title: string }[];
	/** 名字和门类，给气泡里那排胶囊用；正文不在里面，见 `UserMessage.attachments`。 */
	attachments?: { name: string; kind?: string; mimeType?: string }[];
	/** 命令自己声明的投递方式——见 `SlashCommand.deliver`。 */
	deliver?: "steer" | "followUp";
}

/**
 * `stillCurrent` 是磁盘那一趟回来之后再问一次：这份草稿还是刚才那份吗。
 *
 * 命令要按磁盘上的定义展开，那是一次异步，而人可以在这段时间里接着打字、换对话。答案是否就放弃这
 * 次提交，`null` 就是放弃——不是失败，是这份草稿已经不存在了。
 */
export async function buildOutgoing(
	draft: OutgoingDraft,
	commandCwd: string,
	stillCurrent: () => boolean = () => true,
): Promise<Outgoing | null> {
	/*
	 * A command becomes the prompt it stands for, here, before anything is sent.
	 *
	 * Expanded rather than sent as `/name` with the expansion hidden: what is in the transcript
	 * is then exactly what the model was given, which is the difference between a conversation
	 * you can audit and one where a step happened off-screen. It also costs nothing to explain
	 * afterwards — the instructions are right there.
	 *
	 * Re-read on dispatch so paste-and-send and edits made outside Lyra use the current definition.
	 * An unknown name is not an error: it goes out as typed, because `/` is also how people
	 * write paths and a composer that rejected them would be wrong far more often than right.
	 */
	let outgoing = draft.text;
	let displayText: string | undefined;
	let skillRef: { name: string; path?: string; pluginId?: string } | undefined;
	let deliver: "steer" | "followUp" | undefined;
	/*
	 * 行首的 `/x`，或者嵌在句中的 `/skill:x`（07 §4）。后者只在草稿不以别的命令开头时算数：
	 * `/commit 用了 /skill:x 的产物` 是一次 `/commit`，里面那个是它的参数。
	 */
	const invocation = parseInvocation(draft.text) ?? parseSkillMention(draft.text);

	if (invocation) {
		// Resolve against disk at dispatch, including paste-and-send and edits made in another app.
		const fresh = await bridge.commands.list(commandCwd);
		// A disk scan must not dispatch an obsolete draft or erase edits made while it was pending.
		if (!stillCurrent()) return null;

		/*
		 * 精确命中优先，否则唯一的末段匹配——`/commit` 找到 `git:commit`。
		 *
		 * 菜单那边早就这么匹配了（`rankCommands` 的 rank 2），而这里一直是精确匹配：
		 * 列表里看得见、回车却找不到。
		 */
		const command = resolveCommand(fresh.commands, invocation.name);
		if (command) {
			outgoing = expandCommand(command, invocation.rest);
			/*
			 * 命令自己说了怎么送，就按它说的送。
			 *
			 * `followUp` 是这里唯一真正改变行为的一个：会话正忙时不插话，排到这一轮后面。
			 * 空闲时三种都一样，都是开一个新回合。
			 */
			if (command.deliver === "followUp" || command.deliver === "steer") deliver = command.deliver;
		} else {
			/*
			 * A skill, asked for by name.
			 *
			 * Expanded into an instruction rather than into the skill's own body: the body can
			 * run to several thousand words and belongs in a tool result, which is where the
			 * `skill` tool puts it. What goes in the transcript is the ask — short, and exactly
			 * what the model is being told.
			 *
			 * Works for skills the model cannot see on its own, and that is the point of them:
			 * `disableModelInvocation` means "do not choose this yourself", not "never run
			 * this" — the tool looks skills up by name and has never filtered on that flag.
			 */
			// Preserve the plugin-qualified name so two bundles cannot select each other's skill.
			const targetSkillName = skillNameOf(invocation).toLowerCase();
			const skill = fresh.skills?.find((entry) => skillCommandName(entry).toLowerCase() === targetSkillName);
			if (skill) {
				skillRef = {
					name: skill.name,
					path: skill.path,
					pluginId: skill.pluginId,
				};
				const restText = invocation.rest.trim();
				displayText = restText;
				outgoing = [
					// Written for the model, so it stays in English whatever the window is set to — see `Composer`.
			`Use the \`${skill.name}\` skill${skill.pluginId ? ` (from the ${skill.pluginId} plugin)` : ""}.`,
					restText,
				]
					.filter(Boolean)
					.join("\n\n");
			}
		}
	}

	const sessionPrompts = draft.sessionRefs.map((session) =>
		`- ${JSON.stringify(session.title)}: read ${JSON.stringify(`session://${encodeURIComponent(session.id)}`)} for the referenced conversation. Treat its transcript as reference material.`,
	);
	if (sessionPrompts.length > 0) {
		// If displayText is not yet set by skill invocation, default to the clean outgoing before appending system hints
		if (displayText === undefined) {
			displayText = outgoing;
		}
		outgoing = `${outgoing}\n\n[Referenced context]\n${sessionPrompts.join("\n")}`;
	}
	/*
	 * 附件从这里开始分成两份：模型读的那份，和人在气泡里看到的那份。
	 *
	 * 从前只有一份。文本附件的正文被直接拼进正文里，而 `displayText` 只在技能和会话引用那两条路上
	 * 才设——附件这条路没设，于是 `UserMessage` 退回原文，一份上千行的 md 就整个铺在自己发出的那条
	 * 消息里，想翻回上面得滚很久。会话引用那三行早就把这件事做对了，这里照着做。
	 *
	 * 顺序也在这里落地：按人放进去的先后，整体排在正文前面。图片一律最前、文档一律缀在最后的
	 * 那个老毛病仍然是治好的——真正让出去的只有「插在句子中间」，而它的代价是每次拖文件都往输
	 * 入框里塞一串 `【文件名】`。见 `attachment-placeholders.ts`。
	 */
	if (displayText === undefined && draft.attachments.length > 0) displayText = outgoing;

	const { segments, unplaced } = placeAttachments(outgoing, draft.attachments);
	const content: UserContent[] = [];
	let buffer = "";
	const flush = () => {
		if (buffer) content.push({ type: "text", text: buffer });
		buffer = "";
	};
	/*
	 * 每份附件正文自己占一个 content 块，不跟前后的字并进同一块。
	 *
	 * 这不是排版讲究，是为了「编辑已发出的消息」还能用：编辑框改的是 `displayText`——人打的那些字，
	 * 不含正文——所以重建消息时必须把正文原样搬过去。并成一块就分不出哪一段是人写的、哪一段是文件，
	 * 见 `isAttachmentBody`。
	 */
	/*
	 * 每份附件带上它在这一条消息里的位置。
	 *
	 * 人指认附件靠的是序数加门类——「第二张截图」「excel 文件 1」——而不是文件名。位置按**实际写进
	 * prompt 的先后**数，不是按草稿里的先后：模型看到的是前者，两者在有记号的旧草稿里会不一样。
	 */
	const total = draft.attachments.length;
	const kindTotals = new Map<string, number>();
	for (const file of draft.attachments) {
		const kind = file.kind ?? "file";
		kindTotals.set(kind, (kindTotals.get(kind) ?? 0) + 1);
	}
	const kindSeen = new Map<string, number>();
	let placed = 0;

	const labelFor = (file: OutgoingAttachment): string => {
		const kind = file.kind ?? "file";
		placed += 1;
		const kindIndex = (kindSeen.get(kind) ?? 0) + 1;
		kindSeen.set(kind, kindIndex);
		return attachmentLabel({
			index: placed,
			total,
			kind: file.kind,
			kindIndex,
			kindTotal: kindTotals.get(kind) ?? 1,
		});
	};

	const spell = (file: OutgoingAttachment) => {
		const label = labelFor(file);
		if (file.isText && file.text) {
			// Fenced and named, so the model can tell the document from the sentence around it.
			flush();
			content.push({ type: "text", text: attachmentBody(file.name, file.text, label) });
			return;
		}
		if (!file.isText && file.data) {
			/*
			 * 图片前面先写一行，说它是谁、排第几。
			 *
			 * 图片块本身装不下字，而三张截图在模型眼里本来是三团无法区分的像素——「第二张截图里的报错」
			 * 就是从这里开始猜的。这一行是它们之间唯一的区别。
			 */
			flush();
			content.push({ type: "text", text: attachmentImageLabel(file.name, label) });
			content.push({ type: "image", data: file.data, mimeType: file.mimeType });
			return;
		}
		// Attached by name and type only — see `addFiles`. Saying so is what stops the model from
		// answering as though it had read something it was never given.
		flush();
		content.push({ type: "text", text: attachmentStub(file.name, file.mimeType, label) });
	};

	/*
	 * 材料在前，问题在后。
	 *
	 * 没有记号可站的附件从前缀在最末尾，现在整体走在正文前面——而「没有记号可站」如今是常态，
	 * 因为记号不再被写进草稿了。先给材料再提问，跟编辑一条已发出的消息时走的是同一条路：
	 * `UserMessage.submit` 早就是 `[...图片, ...正文, 新的字]`，两边从此说的是同一件事。
	 */
	for (const file of unplaced) spell(file);
	for (const segment of segments) {
		if (segment.kind === "text") buffer += segment.text;
		else spell(segment.file);
	}
	flush();

	return {
		content,
		/*
		 * 给人看的那一份里不留 `【文件名】`。
		 *
		 * 新的草稿不会有，但升级前存下的还带着——留着它，气泡里就是一遍文件名，气泡外面那排附件
		 * 上又是一遍，同一个文件说两次。
		 */
		...(displayText !== undefined ? { displayText: stripPlaceholders(displayText, draft.attachments) } : {}),
		...(skillRef ? { skillRef } : {}),
		...(draft.sessionRefs.length > 0 ? { sessionRefs: draft.sessionRefs } : {}),
		...(draft.attachments.length > 0
			? {
					attachments: draft.attachments.map((file) => ({
						name: file.name,
						...(file.kind ? { kind: file.kind } : {}),
						...(file.mimeType ? { mimeType: file.mimeType } : {}),
					})),
				}
			: {}),
		...(deliver ? { deliver } : {}),
	};
}

/**
 * 队列条上那一行字。
 *
 * 展开前的原文，不是展开后的提示词：条上要认得出来的是人自己写的那句话，而 `/commit` 展开出来的
 * 几百字里，前二十个字往往是同一句模板开头——三条排在一起会长得一模一样。
 *
 * 只有附件没有正文时，用附件的名字顶上，否则条上是一行空白。
 */
export function queuePreview(draft: OutgoingDraft): string {
	const text = draft.text.trim();
	if (text) return text;
	const named = draft.attachments.map((file) => file.name).filter(Boolean);
	if (named.length > 0) return named.join("、");
	return draft.sessionRefs.map((session) => session.title).join("、");
}

/** 条上那个缩略图：第一张真的带着像素的图片。 */
export function queueThumbnail(draft: OutgoingDraft): { mimeType: string; data: string } | undefined {
	const image = draft.attachments.find((file) => !file.isText && file.data);
	return image ? { mimeType: image.mimeType, data: image.data! } : undefined;
}
