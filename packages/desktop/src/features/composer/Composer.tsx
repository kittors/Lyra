// Through the browser-safe door: the main barrel reaches the filesystem, and this runs in a page.
import { translate } from "../../i18n/translate.ts";
import { parseInvocation, parseSkillMention } from "@lyra/core/commands-view";
import { Camera, CircleAlert, Folder, GitBranch, MessageSquare, Plus, X } from "lucide-react";
import { openFromEvent } from "../image/index.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChangeBar } from "../git/index.ts";
import { CommandMenu } from "./CommandMenu.tsx";
import { QueuedMessages } from "./QueuedMessages.tsx";
import { buildOutgoing, queuePreview, queueThumbnail } from "./outgoing.ts";
import type { QueuedMessage } from "../../store/queue-slice.ts";
import { MentionMenu } from "./MentionMenu.tsx";
import { useMention } from "./useMention.ts";
import { formatMention } from "./mention-catalog.ts";
import type { ComposerDecorations } from "./CommandText.tsx";
import { useCommands } from "./useCommands.ts";
import { useInputHistory } from "./useInputHistory.ts";
import { commandEntries } from "./command-catalog.ts";
import { ComposerSend, ComposerShell } from "./ComposerShell.tsx";
import { SubAgentBar } from "../subagents/index.ts";
import { ForeignConfigNotice } from "./ForeignConfigNotice.tsx";
import { useDock } from "../dock/index.ts";
import { companionOf } from "../dock/index.ts";
import { ContextMeter } from "./ContextMeter.tsx";
import { EffortMenu, effortLabel } from "../models/index.ts";
import { ModelIcon } from "../models/index.ts";
import { RollingText, useRolled } from "../../ui/motion/RollingText.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { ModelMenu, formatWindow } from "../models/index.ts";
import { modelIdentity, modelTooltip } from "../../lib/model-grouping.ts";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { BranchMenu } from "../modals/index.ts";
import { PermissionPicker } from "../modals/index.ts";
import { ProjectPicker } from "../modals/index.ts";
import { useLayout } from "../../app/layout.tsx";
import { findModel } from "../models/index.ts";
import { fileKind, isReadableAsText, KIND_LABEL, looksBinary, type FileKind } from "./attachments/file-kind.ts";
import { AttachmentStrip, type StripFile } from "./attachments/AttachmentStrip.tsx";
import { useApp } from "../../store/index.ts";
import { carryOnPrompt } from "../../store/derive.ts";
import { sessionThinking } from "../../lib/thinking.ts";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

interface Attachment {
	id: string;
	name: string;
	mimeType: string;
	/** What it is, for the icon and for whether its bytes may enter the prompt. */
	kind?: FileKind;
	data?: string;
	text?: string;
	isText: boolean;
}

export function Composer() {
	const { t } = useI18n();
	const workspace = useApp((s) => s.workspace);
	const scratchCwd = useApp((s) => s.scratchCwd);
	const settings = useApp((s) => s.settings);
	const meta = useApp((s) => s.meta);
	const messages = useApp((s) => s.messages);
	const running = useApp((s) => s.running);
	const stopped = useApp((s) => s.stopped);
	// A count, not the list: a selector that builds an array hands back a new one on every store tick.
	const unfinished = useApp((s) => s.todos.filter((todo) => todo.status !== "completed").length);
	const activeSessionId = useApp((s) => s.activeSessionId);
	// "底部面板" in Settings → 常规. Saved but read by nothing until now.
	const showBottomPanel = useApp((s) => s.settings?.editor.showBottomPanel) ?? true;
	const switchingBranch = useApp((s) => s.switchingBranch);
	const send = useApp((s) => s.send);
	const abort = useApp((s) => s.abort);
	const enqueue = useApp((s) => s.enqueue);
	const flushQueue = useApp((s) => s.flushQueue);
	/** 排着几条。只要不是零，新说的这句就得排到它们后面，不然先后就乱了。 */
	const queuedCount = useApp((s) => (s.activeSessionId ? s.queued[s.activeSessionId]?.length ?? 0 : 0));
	const { compact } = useLayout();

	const draftKey = activeSessionId
		? activeSessionId
		: workspace
			? `new:project:${workspace.path}`
			: `new:scratch:${scratchCwd ?? "general"}`;

	const savedDraft = useApp((s) => s.drafts[draftKey]);
	const setDraft = useApp((s) => s.setDraft);

	const [text, setText] = useState(() => savedDraft?.text ?? "");
	const [sessionRefs, setSessionRefs] = useState<Array<{ id: string; title: string }>>(() => savedDraft?.sessionRefs ?? []);
	const sessionRefsRef = useRef(sessionRefs);
	sessionRefsRef.current = sessionRefs;
	const [attachments, setAttachments] = useState<Attachment[]>(() => (savedDraft?.attachments as Attachment[]) ?? []);

	/*
	 * 这一轮留下的活，和「继续」该发的那句话——没有就是 `null`。
	 *
	 * 条件里原本有个 `!stopped`，意思正好反了：只有模型自己干净收尾时才认继续，而按下暂停、
	 * 应用被关掉、请求失败——真的把活留在半路的那几种——恰恰全被它挡掉，按钮退回成发送箭头。
	 * 转录下面那行已经在说「已暂停 · 继续」，右下角却还是一支向上的箭头，同一件事两种说法。
	 */
	const carryOn = carryOnPrompt(stopped, unfinished);
	/*
	 * 「继续」只在真有活没干完时出现，而那正是 `carryOn` 的问题。
	 *
	 * 这里曾经还有一条 `|| lastMessage.stopReason === "stop"`，理由是「上一轮好好地结束了、你
	 * 也什么都没输入，那就问一句还有没有下文」。听起来无害，实际有三处不对：
	 *
	 * 一是 `stop` 是模型最普通的收尾方式，于是每一轮正常对话结束后按钮都成了三角，而向上的
	 * 箭头——发新消息，输入框最主要的用途——反倒退成了打过字之后才出现的例外。
	 *
	 * 二是转录下面那行只问 `carryOn`（见 `ResumeRow`），所以一轮干净结束时它不出现，右下角却
	 * 画着继续。`ResumeRow` 的注释明说两个入口用同一个判断、不会各说各话，这条分支就是让它
	 * 们各说各话的东西。
	 *
	 * 三是模型收尾时十有八九是在反问——「请问你想查哪座城市？」——这时候按下去发出去的是
	 * 「继续推进当前任务」，而没有任务在推进，它在等一个地名。一次白跑的往返。
	 */
	const continueReady = Boolean(activeSessionId) && !running && !text.trim() && !attachments.length && !sessionRefs.length
		&& carryOn !== null;
	const textRef = useRef(text);
	textRef.current = text;
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	const draftKeyRef = useRef(draftKey);

	/*
	 * Sync local input state whenever the target session/blank draft key switches.
	 */
	useEffect(() => {
		const prevKey = draftKeyRef.current;
		if (prevKey !== draftKey) {
			// Save draft for the key we are leaving.
			setDraft(prevKey, { text: textRef.current, attachments: attachmentsRef.current, sessionRefs: sessionRefsRef.current });
			draftKeyRef.current = draftKey;

			// Restore draft for the key we just moved to.
			const nextDraft = useApp.getState().drafts[draftKey];
			setText(nextDraft?.text ?? "");
			setSessionRefs(nextDraft?.sessionRefs ?? []);
			setAttachments((nextDraft?.attachments as Attachment[]) ?? []);
		}
	}, [draftKey, setDraft]);

	/*
	 * Persist changes to current draft in the store so switching away (or remounting) preserves it.
	 */
	useEffect(() => {
		setDraft(draftKey, { text, attachments, sessionRefs });
	}, [text, attachments, sessionRefs, draftKey, setDraft]);

	/*
	 * Text left here by something outside the composer — opening a review, so far.
	 *
	 * Taken and cleared, so it lands once and is then the user's to edit or discard. Appended
	 * rather than replacing anything already typed: whatever is in the field was typed by hand and
	 * losing it would be worse than an awkward join.
	 */
	const draft = useApp((s) => s.composerDraft);
	const browserAttachment = useApp((s) => s.browserAttachment);
	useEffect(() => {
		if (!browserAttachment || browserAttachment.draftKey !== draftKey) return;
		setText((current) => current.trim() ? `${current.trimEnd()}\n\n${browserAttachment.text}` : browserAttachment.text);
		setAttachments((current) => [...current, { id: crypto.randomUUID(), name: translate("composer.regionShot"), mimeType: "image/png", isText: false, data: browserAttachment.dataUrl.split(",")[1] }]);
		useApp.setState({ browserAttachment: null });
	}, [browserAttachment, draftKey]);
	const field = useRef<HTMLTextAreaElement>(null);
	/*
	 * 往回翻自己说过的话。
	 *
	 * 排在 @ 和 / 后面接方向键——它俩开着的时候，上下是用来挑名单的。
	 */
	const history = useInputHistory({ messages, value: text, onPick: setText, field, resetKey: draftKey });
	useEffect(() => {
		if (!draft.text) return;
		setText((current) =>
			draft.replace || !current.trim() ? draft.text : `${current.trimEnd()}\n\n${draft.text}`,
		);
		useApp.getState().setComposerDraft("");
		/*
		 * And put the caret in it.
		 *
		 * What arrives this way is a starting point rather than a finished message — a suggestion
		 * card, a review to describe — so the next thing anybody does is edit it. Landing the text
		 * without the focus makes that a click they have to find first. At the end, not selected:
		 * this is a draft to add to, not one to type over.
		 */
		const el = field.current;
		if (el) {
			el.focus();
			el.setSelectionRange(el.value.length, el.value.length);
		}
	}, [draft]);


	const commandCwd = workspace?.path ?? scratchCwd ?? "";
	const slash = useCommands(text, commandCwd, field, setText);
	const pickFileForMention = useCallback(async (actionId: string) => {
		try {
			const paths = await bridge.files.pick({ directory: actionId === "action:pick-directory", multiple: false });
			if (!paths.length || draftKeyRef.current !== draftKey) return null;
			return formatMention(paths[0]);
		} catch (err) {
			useApp
				.getState()
				.notify(translate("composer.pickFailed", { reason: err instanceof Error ? err.message : String(err) }), "error");
			return null;
		}
	}, [draftKey]);
	const mention = useMention(text, commandCwd, field, setText, pickFileForMention, (session) => {
		setSessionRefs((refs) => refs.some((ref) => ref.id === session.id) ? refs : [...refs, session]);
	});

	const mergedDecoration = useMemo((): ComposerDecorations => {
		return {
			command: slash.decoration,
			mentions: mention.mentionDecorations,
		};
	}, [slash.decoration, mention.mentionDecorations]);
	const submitting = useRef(new Map<string, symbol>());

	const modelMenu = usePopover();
	const effortMenu = usePopover();
	const permissionMenu = usePopover();
	const projectMenu = usePopover();
	const branchMenu = usePopover();
	const fileRef = useRef<HTMLInputElement>(null);

	/** No project behind this conversation, and that was the choice — not a step left undone. */
	const chatting = !workspace && Boolean(scratchCwd);
	const modelId = meta?.modelId ?? settings?.defaultModelId ?? null;
	// The whole record, not just its name: the mark beside it is chosen from the id the provider
	// knows the model by, which is not the same string as the label somebody typed for it.
	const model = findModel(settings, modelId);
	/*
	 * Which house this model is from, and whether the strip has to say so.
	 *
	 * With one provider the name is the whole answer and the extra word is noise. With two relays
	 * offering the same `grok-4.6`, the name is not an answer at all — so the provider is folded
	 * into the label exactly when it is what tells them apart. Either way the tooltip has room for
	 * all of it.
	 */
	const identity = modelIdentity(settings, modelId);
	const modelName = identity?.ambiguous ? `${identity.provider.name} · ${identity.model.name}` : (model?.name ?? null);
	// The mark rolls with the name it belongs to, on the same terms — never on the first paint.
	const modelRolls = useRolled(modelId ?? "");
	const permissionMode = settings?.permissionMode ?? "auto";
	const permissionLabel = {
		ask: t("composer.permissionAsk"),
		auto: t("composer.permissionAuto"),
		full: t("composer.permissionFull"),
	}[permissionMode];

	async function submit() {
		if (submitting.current.has(draftKey)) return;
		const submission = Symbol();
		submitting.current.set(draftKey, submission);
		const release = () => { if (submitting.current.get(draftKey) === submission) submitting.current.delete(draftKey); };
		try { await submitOnce(release); }
		catch (cause) { useApp
				.getState()
				.notify(translate("composer.sendFailed", { reason: cause instanceof Error ? cause.message : String(cause) }), "error"); }
		finally { release(); }
	}

	async function submitOnce(release: () => void) {
		const trimmed = text.trim();
		if (!trimmed && attachments.length === 0 && sessionRefs.length === 0) {
			if (!continueReady || !carryOn) return;
			/*
			 * `carryOn` 那三句会被 `grouping.ts` 按原文认出来，配上 `carryOn: true`，这一轮的耗时
			 * 和 token 才不会从零重算——否则一个被暂停过一次的任务，报的是它后半段的用时，和一个
			 * 谁也没跑过的 tokens/s。转录下面那行「继续」走的就是这条路；两个入口按下去必须是同
			 * 一件事，不然按哪个还有讲究。
			 */
			await send([{ type: "text", text: carryOn }], { synthetic: true, carryOn: true });
			return;
		}

		/*
		 * 行首的 `/x`，或者嵌在句中的 `/skill:x`（07 §4）。后者只在草稿不以别的命令开头时算数：
		 * `/commit 用了 /skill:x 的产物` 是一次 `/commit`，里面那个是它的参数。
		 *
		 * 这里只为认出内置命令。展开成真正发出去的东西在 `outgoing.ts`——排队那条路也要走它，而两
		 * 条路展开得不一样的话，条上写着的和发出去的就不是同一句话了。
		 */
		const invocation = parseInvocation(trimmed) ?? parseSkillMention(trimmed);

		/*
		 * A built-in acts on the session and sends nothing.
		 *
		 * Cleared first, because these are not instant — `/compact` is a model call — and a field
		 * that still held `/compact` while it ran would invite a second press.
		 */
		const builtin = invocation ? commandEntries([], []).find((entry) => entry.name === invocation.name) : undefined;
		if (builtin) {
			if (attachments.length || sessionRefs.length) { useApp.getState().notify(translate("composer.commandNoFiles"), "warn"); return; }
			if (builtin.action === "compact" && !activeSessionId) { useApp.getState().notify(translate("composer.nothingToCompact"), "warn"); return; }
			if (builtin.action !== "compact" && invocation?.rest) { useApp.getState().notify(translate("composer.commandNoArgs"), "warn"); return; }
			setText("");
			setDraft(draftKey, null);
			// The guard covers draft resolution; runtime execution must not block subsequent messages.
			release();
			if (builtin.action === "compact" && activeSessionId) {
				const result = await bridge.sessions.compact(activeSessionId, invocation?.rest);
				if (!result.ok && result.reason) useApp.getState().notify(result.reason, "warn");
			} else if (builtin.action === "clear") await useApp.getState().newSession();
			else if (builtin.action === "manage-commands") {
				useApp.getState().setSettingsSection("commands");
				useApp.getState().setView("settings");
			}
			return;
		}

		const referencedSessions = sessionRefs;
		const composed = { text: trimmed, attachments, sessionRefs: referencedSessions };
		const outgoing = await buildOutgoing(composed, commandCwd, () =>
			// A disk scan must not dispatch an obsolete draft or erase edits made while it was pending.
			draftKeyRef.current === draftKey && textRef.current === text && attachmentsRef.current === attachments && sessionRefsRef.current === sessionRefs,
		);
		if (!outgoing) return;

		setText("");
		setAttachments([]);
		setSessionRefs([]);
		setDraft(draftKey, null);
		release();

		/*
		 * 忙的时候排队，而不是插进正在跑的那一轮。
		 *
		 * 中途说的话大多是「等等，还有这个」——排在后面，等这一轮做完它自己就发出去了；真要立刻打断，
		 * 条上那个按钮一按就是原来的插话。命令自己声明了 `steer` 的除外：那是写命令的人说清楚了「这
		 * 条就是要插进去」，队列不该替他改主意。
		 *
		 * 队列里还排着东西的时候，即使这会儿空着也要接着排——否则新说的这句会越过前面那几句先到。
		 */
		if (activeSessionId && outgoing.deliver !== "steer" && (running || queuedCount > 0)) {
			enqueue(activeSessionId, {
				content: outgoing.content,
				...(outgoing.displayText !== undefined ? { displayText: outgoing.displayText } : {}),
				...(outgoing.skillRef ? { skillRef: outgoing.skillRef } : {}),
				...(outgoing.sessionRefs?.length ? { sessionRefs: outgoing.sessionRefs } : {}),
				...(outgoing.attachments?.length ? { attachments: outgoing.attachments } : {}),
				draft: { text: trimmed, attachments, sessionRefs: referencedSessions },
				preview: queuePreview(composed),
				...(queueThumbnail(composed) ? { thumbnail: queueThumbnail(composed)! } : {}),
			});
			// 空着却排着队，只可能是上一轮被停掉了：那就由这一次提交把队伍推起来。
			if (!running) void flushQueue(activeSessionId);
			return;
		}

		const accepted = await send(outgoing.content, {
			...(outgoing.deliver ? { deliver: outgoing.deliver } : {}),
			...(outgoing.displayText !== undefined ? { displayText: outgoing.displayText } : {}),
			...(outgoing.skillRef ? { skillRef: outgoing.skillRef } : {}),
			...(outgoing.sessionRefs?.length ? { sessionRefs: outgoing.sessionRefs } : {}),
			...(outgoing.attachments?.length ? { attachments: outgoing.attachments } : {}),
		});
		if (!accepted) {
			// A transport rejection must preserve the original files and command text for retry.
			const newer = useApp.getState().drafts[draftKey];
			const restored = { text: newer?.text ? `${text}\n${newer.text}` : text, attachments: [...attachments, ...(newer?.attachments ?? [])], sessionRefs: [...new Map([...referencedSessions, ...(newer?.sessionRefs ?? [])].map(ref => [ref.id, ref])).values()] };
			setDraft(draftKey, restored);
			if (draftKeyRef.current === draftKey) {
				setText(current => current ? `${text}\n${current}` : text);
				setAttachments(current => [...attachments, ...current]);
				setSessionRefs(current => [...new Map([...referencedSessions, ...current].map(ref => [ref.id, ref])).values()]);
			}
		}
	}

	/**
	 * Take files on, without pretending every one of them is text.
	 *
	 * This used to be two branches: images were read as bytes, and *everything else* went through
	 * `file.text()`. A `.doc` is a compound binary document, so decoding it as UTF-8 produced a few
	 * thousand replacement characters — which were then pasted into the message and sent. The person
	 * saw their contract rendered as noise, and the model received the same noise.
	 *
	 * Three outcomes now, and which one applies is decided before anything is read:
	 *
	 *   - an image, carried as image content the model can actually look at;
	 *   - a kind that is known not to be text — a document, a video, an archive — attached by name
	 *     and type only, with nothing pasted into the prompt;
	 *   - anything else read as text, and *then* checked: the extension is a first guess, and a file
	 *     can be named anything.
	 */
	async function addFiles(files: FileList | null) {
		if (!files) return;
		const next: Attachment[] = [];
		const refused: string[] = [];

		for (const file of Array.from(files).slice(0, 8)) {
			const id = `${file.name}-${Date.now()}-${Math.random()}`;
			const kind = fileKind(file.name, file.type);

			if (kind === "image") {
				const buffer = await file.arrayBuffer();
				next.push({ id, name: file.name, mimeType: file.type, data: bytesToBase64(new Uint8Array(buffer)), isText: false, kind });
				continue;
			}

			if (!isReadableAsText(kind, file.name)) {
				/*
				 * 不是文本，但未必读不出字来。
				 *
				 * PDF、Word、Excel、PPT 里的字是拿得到的——`document-text.ts` 一直能做这件事，只是从来
				 * 没有人调用它（`extractDocumentText` 在仓库里零调用点）。于是拖一份合同进来，得到的是
				 * 一句「内容无法作为文本读取」，而那句话在能力上并不成立。
				 *
				 * 抽取在主进程：架构规则不许页面伸手进 `electron/`，而且 pdf.js 解析一份三百页的文档要
				 * 几百毫秒，卡住一个没有界面的进程比卡住正在打字的窗口好。哪些格式认得由那边说了算，
				 * 这里不复制一份清单——两处清单迟早分家。
				 */
				const bytes = new Uint8Array(await file.arrayBuffer());
				const extracted = await bridge.files.documentText(file.name, bytes).catch(() => null);

				if (extracted?.text) {
					next.push({
						id,
						name: file.name,
						mimeType: file.type || "application/octet-stream",
						text: extracted.truncated
							? `${extracted.text}\n\n${translate("composer.textTruncated", { count: extracted.fullLength - extracted.text.length })}`
							: extracted.text,
						isText: true,
						// 门类不改：图标该是 PDF 就还是 PDF，变的只是「内容进不进 prompt」。
						kind,
					});
					continue;
				}

				next.push({ id, name: file.name, mimeType: file.type || "application/octet-stream", isText: false, kind });
				/*
				 * 读不出来的两种，分开说。
				 *
				 * 扫描件是「这份文件里本来就没有文字」，要的是 OCR；格式不支持是「换个格式」。合成同
				 * 一句话，等于让人去试一件不可能成功的事。
				 */
				refused.push(
					extracted?.imageOnly
						? translate("composer.scannedDocument", { name: file.name })
						: `${file.name}（${translate(KIND_LABEL[kind])}）`,
				);
				continue;
			}

			try {
				const buffer = new Uint8Array(await file.arrayBuffer());
				if (looksBinary(buffer)) {
					// Named like text, and is not. Same treatment as the known kinds above.
					next.push({ id, name: file.name, mimeType: file.type || "application/octet-stream", isText: false, kind: "binary" });
					refused.push(translate("composer.binaryFile", { name: file.name }));
					continue;
				}
				next.push({
					id,
					name: file.name,
					mimeType: file.type || "text/plain",
					text: new TextDecoder().decode(buffer),
					isText: true,
					kind,
				});
			} catch {
				useApp.getState().notify(translate("subAgent.fileUnreadable", { name: file.name }), "warn");
			}
		}

		/*
		 * Said once, and said plainly.
		 *
		 * The file is still attached — the name and type reach the model, which is often all the
		 * question needs. What must not happen silently is the contents being dropped: someone who
		 * expects the agent to have read their document should find out here rather than from an
		 * answer that quietly ignored it.
		 */
		if (refused.length > 0) {
			useApp
				.getState()
				.notify(translate("composer.unreadableAsText", { names: refused.join("、") }), "warn");
		}
		if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
	}

	/**
	 * 取下一个附件，只动上面那一排。
	 *
	 * 从前这里还要回正文里把 `【文件名】` 抠掉，而它是 `indexOf` 找第一个同名的——附两张都叫
	 * `shot.png` 的图、删掉后一张，被抠走的是前一张的记号，剩下那张就此失去位置。正文里不再有
	 * 记号之后，这类对不上账的情况整类消失了。
	 */
	function detach(target: Attachment) {
		setAttachments((prev) => prev.filter((a) => a.id !== target.id));
	}

	const takeScreenshot = useCallback(async () => {
		try { await bridge.screenshot.start(settings?.screenshot); }
		catch (error) { useApp.getState().notify(String(error), "error"); }
	}, [settings?.screenshot]);

	/**
	 * 从队列里退回来的那一条，落回输入框。
	 *
	 * 退回来的是「那一次提交」而不是它的文本，所以附件和引用一起回来——编辑一句配了三张图的话，图
	 * 不跟着回来的话就等于没退回来。
	 *
	 * 追加，不是替换：输入框里可能已经打了别的字，那是手打的，丢掉比接得难看糟得多。
	 *
	 * 输入框自己也动一下。被拿走的那一行在上面收掉，字落在下面，中间没有任何东西说这两件事是同一件
	 * ——闪一下的是接住它的这个框，人的眼睛才跟得过来。类先摘掉再挂上，中间强制一次布局：同一个
	 * 动画连着放第二遍，不这样它根本不会重新开始。
	 */
	const restoreQueued = (entry: QueuedMessage) => {
		setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${entry.draft.text}` : entry.draft.text));
		setAttachments((current) => [...current, ...(entry.draft.attachments as Attachment[])]);
		setSessionRefs((current) => [...new Map([...current, ...entry.draft.sessionRefs].map((ref) => [ref.id, ref])).values()]);
		const el = field.current;
		if (!el) return;
		el.focus();
		// 光标落在末尾，等文本真的进去之后——这是一份可以接着改的草稿，不是一段等着被覆盖的选中。
		requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
		const shell = el.closest(".ly-composer");
		if (!(shell instanceof HTMLElement)) return;
		shell.classList.remove("ly-composer-catch");
		void shell.offsetWidth;
		shell.classList.add("ly-composer-catch");
		shell.addEventListener("animationend", () => shell.classList.remove("ly-composer-catch"), { once: true });
	};

	/**
	 * 带着像素的那几个，按它们在附件里的先后。
	 *
	 * 查看器里的序号只能在这一份里数：混着文档一起数，附件里有图有文档时点开的就是另一张图。
	 */
	const previewable = attachments.filter((a) => !a.isText && a.data);

	/**
	 * 输入框上方那一排，交给 `AttachmentStrip` 去摆。
	 *
	 * `key` 就是附件 id，取下时按它找回原件——名字会重，id 不会。
	 */
	const strip: StripFile[] = attachments.map((attachment) => {
		const kind = attachment.kind ?? (attachment.isText ? "text" : "binary");
		// 只有正文和像素都进不了提示词的，才是「仅文件名」。一张图的字节是送到了的。
		const bodiless = !attachment.isText && !attachment.data;
		return {
			key: attachment.id,
			name: attachment.name,
			kind,
			...(attachment.data && !attachment.isText
				? { src: `data:${attachment.mimeType};base64,${attachment.data}` }
				: {}),
			tip: `${attachment.name}\n${t(KIND_LABEL[kind])}${bodiless ? ` · ${t("composer.filenameOnly")}` : ""}`,
		};
	});

	return (
		/*
		 * `ly-composer-dock`: the strip along the bottom of the conversation, named so the phone can
		 * find it. It is the one thing that has to move when a keyboard slides over the window —
		 * the transcript above it stays put and keeps its scroll position. See `--ly-keyboard`.
		 */
		<div className={`ly-composer-dock shrink-0 pt-2 pb-5 ${compact ? "px-4" : "px-8"}`}>
			<div className="mx-auto w-full max-w-[var(--ly-content)]">
				{/*
				 * That work has been delegated, above everything else the composer says.
				 *
				 * A sub-agent's context is deliberately kept out of this transcript, which is what
				 * makes it invisible — for two minutes nothing on screen told a run reading forty
				 * files apart from one that was stuck. The bar is that line, and it opens the pane.
				 */}
				{/* Once per project: what other tools' configuration this repository carries, already in use. */}
				<ForeignConfigNotice />
				<SubAgentBar onOpen={() => useDock.getState().open("subagents", companionOf("subagents"))} />
				{/*
				 * Where the turn will run, and what it has already changed.
				 *
				 * The chips shrink and ellipsise rather than being dropped when space runs short,
				 * because "which project, which branch" is exactly what you need before send.
				 *
				 * One row, because these are the same question asked at two moments: the project
				 * and branch are what you check before pressing send, the change counts are what
				 * you check after. Splitting them into two strips would cost a row of height to
				 * separate things you read together.
				 */}
				{showBottomPanel && (
				<div className="flex items-center gap-0.5 overflow-hidden pb-1">
					<Chip
						/*
						 * Chat, not 「无项目」.
						 *
						 * The old label named the state by what it lacks — a mode called "no project",
						 * which reads as something missing rather than as something chosen. What it
						 * actually is: a conversation with no checkout behind it. Reviewing a repository
						 * that is not on this machine, asking something that is not about code. That is a
						 * chat, and naming it after itself is the difference between a state and a gap.
						 *
						 * 「选择项目」 stays for the case where nothing has been chosen yet, which really is
						 * an unfinished step. The picker sits behind all three.
						 */
						icon={chatting ? <MessageSquare size={13} strokeWidth={1.8} /> : <Folder size={13} strokeWidth={1.8} />}
						label={workspace?.name ?? (chatting ? "Chat" : t("composer.selectProject"))}
						onClick={projectMenu.toggle}
						active={projectMenu.open}
					/>
					{workspace?.branch && (
						/*
						 * The name stays put while a switch runs; the mark says it is running.
						 *
						 * Which is the whole point — see `BranchMenu`. Showing the target name early
						 * reads well right up until git refuses, and then the chip has claimed
						 * something that did not happen. A pulsing branch mark is honest about both
						 * outcomes and still answers the click immediately.
						 */
						<Chip
							icon={<GitBranch size={13} strokeWidth={1.8} className={switchingBranch ? "ly-pulse" : undefined} />}
							label={workspace.branch}
							busy={Boolean(switchingBranch)}
							onClick={branchMenu.toggle}
							active={branchMenu.open}
						/>
					)}
					<div className="min-w-2 flex-1" />
					<ChangeBar />
				</div>
				)}

				<div className="relative">
				{/*
				 * 排着的那几条，就在输入框上面。
				 *
				 * 挨着输入框，因为它们是同一件事的两截：正在打的这一句，和已经说完、等着轮到自己的那
				 * 几句。摆到转录里去就成了「已经发生的事」，而它们一件都还没发生。
				 */}
				{/* 按会话重挂：换个对话，条上的进退场和拖动状态都属于上一个对话，不该跟着过来。 */}
				{activeSessionId && <QueuedMessages key={activeSessionId} sessionId={activeSessionId} running={running} onEdit={restoreQueued} />}
				<CommandMenu id={slash.id} commands={slash.matches} term={slash.term} active={slash.active} keyboardSelection={slash.keyboardSelection} onPick={slash.pick} onHover={slash.hover} />
				<MentionMenu id={mention.id} items={mention.matches} term={mention.term} active={mention.active} keyboardSelection={mention.keyboardSelection} onPick={(item) => void mention.pick(item)} onHover={mention.hover} />
				<ComposerShell
					fieldRef={field}
					/*
					 * 翻到第几条了，写在框里的最上沿。
					 *
					 * 在框里而不是框外：翻出来的那句就落在它下面一行，两者说的是同一件事，隔着边框分开摆
					 * 就得让人自己把它们联系起来。不写又不行——翻出来的那句和自己刚打的那句长得一模一样，
					 * 都是输入框里的黑字，按到哪儿了全凭记性，一旦记错，再按一下就走过头了。
					 */
					hint={
						history.position ? (
							<div data-ly-history="" className="px-4 pt-2.5 text-caption text-ink-faint">
								{t("composer.history", { current: history.position.current, total: history.position.total })}
							</div>
						) : undefined
					}
					value={text}
					onChange={(next) => {
						slash.change(next);
						mention.change(next);
					}}
					decoration={mergedDecoration}
					onSelect={() => {
						slash.select();
						mention.select();
					}}
					onFocus={() => {
						slash.focus();
						mention.focus();
					}}
					onBlur={() => {
						slash.blur();
						mention.blur();
					}}
					commandMenu={
						mention.matches.length > 0
							? { id: mention.id, active: mention.active, open: true }
							: { id: slash.id, active: slash.active, open: slash.matches.length > 0 }
					}
					onSubmit={() => void submit()}
					onKeyDown={(event) => {
						if (mention.keyDown(event)) return;
						slash.keyDown(event, () => void submit());
						// 命令单接下了这个键就到此为止：它是拿 preventDefault 说这话的，见 ComposerShell。
						if (event.defaultPrevented) return;
						history.keyDown(event);
					}}
					placeholder={t("composer.placeholder")}
					onFiles={(files) => void addFiles(files)}
					attachments={
						attachments.length > 0 || sessionRefs.length > 0 ? (
							<div className="flex flex-col gap-2 px-4 pt-3.5">
								{sessionRefs.length > 0 && (
									<div className="flex flex-wrap gap-1.5">
										{sessionRefs.map((session) => <button key={session.id} type="button" aria-label={translate("composer.removeSessionRef", { title: session.title })} onClick={() => setSessionRefs((refs) => refs.filter((ref) => ref.id !== session.id))} className="flex h-8 max-w-[240px] items-center gap-1.5 rounded-lg border border-line-soft bg-card pr-1.5 pl-2 text-caption text-ink-muted transition-colors hover:text-ink"><MessageSquare size={12} className="shrink-0" /><span className="min-w-0 truncate">{session.title}</span><X size={12} className="shrink-0" /></button>)}
									</div>
								)}
								<AttachmentStrip
									files={strip}
									onRemove={(file) => {
										const target = attachments.find((a) => a.id === file.key);
										if (target) detach(target);
									}}
									/*
									 * 这一份还能被改：在查看器里标注完，改的是还没发出去的草稿本身。
									 * 气泡外那一排就没有 `onReplace`——那一份已经发出去了，是记录。
									 */
									onOpen={(index, event) =>
										openFromEvent(
											event,
											previewable.map((a) => ({
												src: `data:${a.mimeType};base64,${a.data}`,
												alt: a.name,
												onReplace: (dataUrl: string) =>
													setAttachments((prev) =>
														prev.map((item) =>
															item.id === a.id ? { ...item, ...fromDataUrl(dataUrl, item) } : item,
														),
													),
											})),
											index,
										)
									}
								/>
							</div>
						) : undefined
					}
					left={
						<>
							<button
								type="button"
								data-ly-tip={t("composer.addAttachment")}
								aria-label={t("composer.addAttachment")}
								onClick={() => fileRef.current?.click()}
								className="ly-composer-control flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
							>
								<Plus size={16} strokeWidth={1.9} />
							</button>
							{settings?.screenshot?.enabled !== false && settings?.screenshot?.showInComposer && (
								<button
									type="button"
									data-ly-tip={`${t("composer.screenshot")} ${settings?.screenshot?.shortcut ? `(${settings.screenshot.shortcut.replace("CommandOrControl", "⌘").replace("Shift", "⇧").replace("Alt", "⌥").replace(/\+/g, "")})` : ""}`}
									aria-label={t("composer.screenshot")}
									onClick={() => void takeScreenshot()}
									className="ly-composer-control flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
								>
									<Camera size={15} strokeWidth={1.9} />
								</button>
							)}
							<input
								ref={fileRef}
								type="file"
								multiple
								hidden
								onChange={(e) => {
									void addFiles(e.target.files);
									e.target.value = "";
								}}
							/>

							<button
								type="button"
								/* The app's own tooltip, so the icon-only form still says what it is. */
								data-ly-tip={permissionLabel}
								data-ly-tip-side="top"
								aria-label={permissionLabel}
								onClick={permissionMenu.toggle}
								aria-haspopup="menu"
								aria-expanded={permissionMenu.open}
								className={`ly-composer-control flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-label transition-colors duration-[var(--ly-t-quick)] ${
									permissionMode === "full"
										? // Red, not the accent: this is the one mode that hands over the machine.
											`text-danger ${permissionMenu.open ? "bg-danger/10" : "hover:bg-danger/10"}`
										: permissionMenu.open
											? "bg-card-hover text-ink"
											: "text-ink-muted hover:bg-card-hover hover:text-ink"
								}`}
							>
								<CircleAlert size={13.5} strokeWidth={1.9} className="shrink-0" />
								{/*
								 * The label is the first thing to go when space runs out.
								 *
								 * Full access used to keep its words at every width, on the grounds
								 * that it must never be quietly on. But a label that refuses to
								 * yield just pushes the rest of the row out; the mark carries that
								 * meaning on its own now that it is red, and the tooltip says the
								 * word for anyone unsure.
								 *
								 * Measured against the field rather than the window: with a sidebar
								 * It was `@max-[420px]:hidden` — a width standing in for 「does this fit」,
								 * which it cannot: what fits depends on how long the model's name is, and
								 * those run from `gpt-5` to `claude-opus-4-6-thinking`. The words went at
								 * 419px with clear air still in the row, and having gone they freed width
								 * that nothing then claimed.
								 *
								 * And it goes before the meter rather than after it. This is a mode you set
								 * once and leave set; the meter and the name are about the turn being composed
								 * right now — see the ranking in `composer/fit.ts`.
								 */}
								<span data-ly-fit-drop="1" className="shrink-0 whitespace-nowrap">
									<RollingText>{permissionLabel}</RollingText>
								</span>
							</button>
						</>
					}
					right={
						<>
							{/*
							 * Beside the model it is measured against — the window is a property of that model.
							 *
							 * The last thing the row gives up, and it used to be the first — at a fixed
							 * `@max-[480px]`, which on a real window dropped it while the two halves of the
							 * row still had 54px of clear air between them. It costs about 24px, so it now
							 * goes only when those 24px are the ones missing, and only after 「完全访问」 has
							 * already given up its words for a larger saving.
							 */}
							<div data-ly-fit-drop="2" className="flex shrink-0 items-center">
								<ContextMeter messages={messages} settings={settings} modelId={modelId} sessionId={activeSessionId} />
							</div>

							<button
								type="button"
								onClick={modelMenu.toggle}
								data-ly-tip={modelTooltip(identity, formatWindow)}
								aria-haspopup="menu"
								aria-expanded={modelMenu.open}
								className={`ly-composer-control flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-label transition-colors ${
									modelMenu.open ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover hover:text-ink"
								}`}
							>
								{/* Keyed on the model, so picking a different house turns the mark over with
								    the label beside it rather than swapping under it. */}
								<ModelIcon
									key={modelId}
									model={model?.modelId}
									name={modelName}
									className={modelRolls ? "ly-roll" : ""}
								/>
								{/*
								 * The one thing in the row that yields, so it is also what says the row is out of
								 * room: everything else is `shrink-0`, and this truncating is exactly the moment
								 * there was not enough width to go round. `fit.ts` reads this element — the class is the handle — which is why a short
								 * name keeps its meter at any width.
								 */}
								<RollingText className="ly-fit-probe min-w-0 truncate">{modelName ?? t("composer.selectModel")}</RollingText>
							</button>
							<button
								type="button"
								onClick={effortMenu.toggle}
								aria-haspopup="menu"
								aria-expanded={effortMenu.open}
								data-ly-tip={t("composer.thinking", { level: effortLabel(sessionThinking(meta, settings), model, t) })}
								className={`ly-composer-control mr-1.5 flex h-7 shrink-0 items-center rounded-md px-2 text-label transition-colors ${
									effortMenu.open ? "bg-card-hover text-ink" : "text-ink-faint hover:bg-card-hover hover:text-ink"
								}`}
							>
								<RollingText>{effortLabel(sessionThinking(meta, settings), model, t)}</RollingText>
							</button>

							{/* 正忙时按下去是排队而不是插话，所以它说的也不再是「发送」——见 `submitOnce`。 */}
							{running && (text.trim() || attachments.length > 0) && <ComposerSend running={false} tip={t("composer.queueWaiting")} onSend={() => void submit()} onStop={() => void abort()} />}
							<ComposerSend
								running={running}
								continueReady={continueReady}
								// 说的和转录下面那行「继续」一样，因为按下去是同一件事。
								tip={continueReady ? translate("composer.finishUnfinished") : undefined}
								disabled={!continueReady && !text.trim() && attachments.length === 0 && sessionRefs.length === 0}
								onSend={() => void submit()}
								onStop={() => void abort()}
							/>
						</>
					}
				/>
				</div>
			</div>

			{permissionMenu.open && <PermissionPicker anchor={permissionMenu.anchor} onClose={permissionMenu.close} />}
			{projectMenu.open && <ProjectPicker anchor={projectMenu.anchor} onClose={projectMenu.close} />}
			{branchMenu.open && <BranchMenu anchor={branchMenu.anchor} onClose={branchMenu.close} />}
			{modelMenu.open && <ModelMenu anchor={modelMenu.anchor} onClose={modelMenu.close} />}
			{effortMenu.open && <EffortMenu anchor={effortMenu.anchor} onClose={effortMenu.close} />}
		</div>
	);
}

function Chip({
	icon,
	label,
	onClick,
	active,
	busy,
}: {
	icon: React.ReactNode;
	label: string;
	onClick: (event: React.MouseEvent<HTMLElement>) => void;
	active?: boolean;
	/** Something is being changed about what this names; the label is held until it lands. */
	busy?: boolean;
}) {
	const { t } = useI18n();
	const rolls = useRolled(label);

	return (
		<button
			type="button"
			data-ly-tip={busy ? t("composer.switchingBranch") : label}
			aria-haspopup="menu"
			aria-expanded={active}
			aria-busy={busy || undefined}
			onClick={onClick}
			/* Dimmed while it is being changed, so the name reads as "still this, for now". */
			className={`ly-composer-control ly-scroll flex h-[26px] min-w-0 items-center gap-1.5 rounded-md px-2 text-label transition-[color,background-color,opacity] duration-[var(--ly-t-quick)] ${
				busy ? "opacity-60" : ""
			} ${active ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover hover:text-ink"}`}
		>
			<span className="shrink-0 text-ink-faint">{icon}</span>
			{/* Keyed on the label so switching project or branch rolls the new one in. `ScrollText`
			    cannot take `RollingText` as a child — it measures the string to decide whether the
			    chip scrolls on hover — so the remount happens around it instead, on the same terms. */}
			<ScrollText key={label} text={label} className={`min-w-0 ${rolls ? "ly-roll" : ""}`} />
		</button>
	);
}

/** btoa cannot take a raw byte array; chunk it so large images do not blow the call stack. */
function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/**
 * Split an annotated `data:` URL back into the shape an attachment is stored in.
 *
 * The annotator always hands back PNG, whatever went in — flattening a JPEG with marks on it and
 * calling it a JPEG would re-compress the original a second time.
 */
function fromDataUrl(dataUrl: string, previous: { mimeType: string }): { data: string; mimeType: string } {
	const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
	if (!match) return { data: "", mimeType: previous.mimeType };
	return { mimeType: match[1], data: match[2] };
}
