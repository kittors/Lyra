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

import { skillCommandName } from "./command-catalog.ts";
import { bridge } from "../../services/index.ts";

/** 附件在草稿里的样子，只取这一步用得上的几项。 */
export interface OutgoingAttachment {
	name: string;
	mimeType: string;
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
	if (draft.attachments.length > 0) {
		const textFiles = draft.attachments.filter((a) => a.isText && a.text);
		if (textFiles.length > 0) {
			const attachedTexts = textFiles.map((f) => `### Attached file: ${f.name}\n\`\`\`\n${f.text}\n\`\`\``);
			outgoing = outgoing ? `${outgoing}\n\n${attachedTexts.join("\n\n")}` : attachedTexts.join("\n\n");
		}
	}

	const images = draft.attachments
		.filter((a) => !a.isText && a.data)
		.map((a): UserContent => ({ type: "image", data: a.data!, mimeType: a.mimeType }));

	return {
		content: [
			...images,
			...(outgoing ? [{ type: "text" as const, text: outgoing }] : []),
		],
		...(displayText !== undefined ? { displayText } : {}),
		...(skillRef ? { skillRef } : {}),
		...(draft.sessionRefs.length > 0 ? { sessionRefs: draft.sessionRefs } : {}),
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
