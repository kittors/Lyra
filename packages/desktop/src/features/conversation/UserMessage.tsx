import { translate } from "../../i18n/translate.ts";
import type {
  UserContent,
  UserMessage as UserMessageType,
} from "@lyra/core";
import { MessageSquarePlus, Pencil, Boxes, MessagesSquare } from "lucide-react";
import { openFromEvent } from "../image/index.ts";
import { AttachmentStrip, fileKind, KIND_LABEL, useAttachmentActions, type FileKind, type StripFile } from "../composer/index.ts";
import { isAttachmentBody, placeAttachments } from "../../lib/attachment-placeholders.ts";
import { useMemo, useState } from "react";
import { MessageActions } from "./MessageActions.tsx";
import { MessageEditor } from "./message/MessageEditor.tsx";
import { useApp } from "../../store/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { useDock } from "../dock/index.ts";
import { bridge } from "../../services/index.ts";
import type { SkillEntry } from "../../../electron/ipc-types.ts";
import { useI18n } from "../../i18n/index.ts";
/**
 * A message you sent, with the two things you want from one afterwards: to copy it, and to
 * take it back.
 *
 * Editing re-runs the conversation from this point. Everything after — the reply it drew, and
 * anything built on that reply — is discarded, because none of it follows from the new
 * wording any more. Leaving it would put an answer to a question nobody asked directly under
 * the question that replaced it.
 */
type ImageBlock = Extract<UserContent, { type: "image" }>;

/**
 * 把一份附件放进右边的文件面板。
 *
 * 写在这里而不是 `attachments/actions.ts` 里，是因为那一层还被气泡那边用着：让它去敲 dock 的门
 * 会绕出一条循环依赖——门后面挂着整棵面板树，最终又回到这个域，而 `pnpm arch` 拦的就是这个。这
 * 两个文件本来就各自有这条边，所以「打开到面板」由它们自己动手，共用的只是前面那一问。
 */
async function openInPane(
	path: string | undefined,
	name: string,
	ensureThere: (file: { name: string; path?: string }) => Promise<boolean>,
) {
	if (!path) return;
	if (!(await ensureThere({ name, path }))) return;
	void useOpenFile.getState().open({ path, name, isDirectory: false, size: 0 });
	useDock.getState().open("file", { kind: "conversation", side: "right", share: 0.45 });
}


/**
 * 带了哪几个文件，认回成一排。
 *
 * 同一批附件在消息里是分开存的：图片的像素在 `content` 的 image 块里，名字和门类在 `attachments`
 * 里，后者故意不带正文（见 `UserMessage.attachments` 的说明）。要画成一排就得先把两边配回去，
 * 按次序：第 n 个门类是图片的附件，配第 n 个图片块。
 *
 * 配不齐也不能把图弄丢。转录里躺着的老消息可能根本没有 `attachments` 这一项，那时只有图片块，
 * 于是剩下的一律补在后面——少画一个附件，比多画一个要命得多。
 */
function attachmentsOf(
  message: UserMessageType,
  images: ImageBlock[],
  label: (kind: FileKind) => string,
): StripFile[] {
  const files: StripFile[] = [];
  let at = 0;
  /* 「图片 2」里的那个 2 数的是同门类里的第几个，和输入框那边、和提示词里是同一个数。 */
  const seen = new Map<FileKind, number>();
  for (const [index, file] of (message.attachments ?? []).entries()) {
    const kind = (file.kind as FileKind | undefined) ?? fileKind(file.name, file.mimeType ?? "");
    const kindIndex = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, kindIndex);
    const block = kind === "image" ? images[at] : undefined;
    if (block) at++;
    files.push({
      key: `${index}-${file.name}`,
      name: file.name,
      kind,
      /*
       * 正文里那枚标记写的名字：「表格 2」，门类加序号。
       *
       * 存下来的优先，没存的按**和输入框同一套规则**现算——这里一度用的是「有真名就用真名」那一套
       * （`displayName`，附件条上写的那个），于是 `【图片 1】` 在气泡里配不上任何一份附件，整句话
       * 里十一枚标记只有一枚被认出来，其余退化成一串方括号。两处规则必须是同一条。
       *
       * 老消息的标记写的是文件名，那一种由 `scanPlaceholders` 一并认（见 `answersTo`）。
       */
      label: file.label ?? `${label(kind)} ${kindIndex}`,
      tip: `${file.name}\n${label(kind)}`,
      ...(block ? { src: `data:${block.mimeType};base64,${block.data}` } : {}),
      /*
       * 发送时它在哪儿。
       *
       * 老消息没有这一项——那时字段还不存在——于是那些附件只剩一个名字，能做的事跟着少几件。这是
       * 对的降级：offer nothing rather than offer something that fails。
       */
      ...(file.path ? { path: file.path } : {}),
    });
  }
  for (; at < images.length; at++) {
    files.push({
      key: `image-${at}`,
      name: "",
      kind: "image",
      src: `data:${images[at].mimeType};base64,${images[at].data}`,
    });
  }
  return files;
}

export function UserMessage({
  message,
  index,
}: {
  message: UserMessageType;
  index: number;
}) {
	const { t } = useI18n();
  const running = useApp((s) => s.running);
  const editMessage = useApp((s) => s.editMessage);
  /** 气泡外那排附件上的动作，和输入框那排共用一套——见 `attachments/actions.ts`。 */
  const { ensureThere } = useAttachmentActions();

  const rawText = message.content
    .filter(
      (block): block is Extract<UserContent, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");

  const skillRef = message.skillRef;
  /*
   * 附件不在这里面了。
   *
   * 它们从前算一份「胶囊」，跟技能和会话引用一样住在气泡里；于是一条只附了几个文件、一个字
   * 没打的消息，气泡里装的全是文件名——气泡是「我说的那句话」的容器，它不该盛这个。附件整体
   * 搬到气泡外面那一排上之后，只剩这两样还要气泡：它们确实是这句话的一部分。
   *
   * 顺带修掉一个空壳：附件还算在里面时，正文为空的那条消息会渲染出一个只有内边距的气泡。
   */
  const hasCapsules = Boolean(skillRef || message.sessionRefs?.length);
  const images = useMemo(
    () => message.content.filter((block): block is ImageBlock => block.type === "image"),
    [message.content],
  );
  const files = useMemo(
    () => attachmentsOf(message, images, (kind) => t(KIND_LABEL[kind])),
    [message, images, t],
  );
  const text = message.displayText ?? rawText;
  /*
   * 认得出的 `【图片 1】` 画成一枚标签，认不出的原样留着。
   *
   * 它一度是被整个剥掉的，理由是「同一个文件说两遍」——气泡里一遍名字，气泡外那排附件上又一遍。
   * 那个理由只在标记是一串裸方括号时成立：外面那排答的是「这条消息带了什么」，句子里这一枚答的是
   * 「我这句话说的是哪一个」，剥掉之后「照着它改一版」里的「它」就没有着落了。
   *
   * 「这个【重要】」不会被误认：方括号在中文里是普通标点，配不上任何一个附件的名字就当作人打的字。
   */
  const spoken = useMemo(
    () => placeAttachments(text, files.map((file) => ({ name: file.name, label: file.label, kind: file.kind }))).segments,
    [text, files],
  );
  const said = text.trim();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  function submit() {
    const trimmed = draft.trim();
    setEditing(false);
    /*
     * Unchanged text still sends.
     *
     * This used to return early when the wording had not moved, on the reasoning that there was
     * nothing to do. But re-sending the same message is exactly what you want after a turn died
     * on a dropped connection — and pressing 发送 and having nothing at all happen reads as a
     * broken button, not as a considerate no-op. Cancel is right there for changing your mind.
     */
    if (!trimmed) return;
    /*
     * Everything that was attached is carried over: the edit is to the wording, not to the files.
     *
     * Images always were. The file bodies are new here and are not optional — the editor works on
     * `displayText`, which deliberately leaves them out, so rebuilding from the edited text alone
     * would resend 【report.md】 with the document gone and the model answering about a file it can
     * no longer see. They go ahead of the new wording rather than back where they were: an edit is
     * a redo, and keeping the contents matters more than keeping the interleaving.
     */
    const bodies = message.content.filter(
      (block): block is Extract<UserContent, { type: "text" }> =>
        block.type === "text" && isAttachmentBody(block.text),
    );
    /*
     * 附了哪几个文件，和气泡里该显示什么，跟着一起过去。
     *
     * 不带的那一版等于每编辑一次就把附件从界面上抹掉一次——文件其实还在 `content` 里，模型照样
     * 读得到，只有人看不见了。而 `displayText` 一旦没有，气泡就退回原文，附件正文重新整个铺进
     * 自己发出的那条消息里，那正是 `displayText` 存在的全部理由。
     */
    void editMessage(index, [...images, ...bodies, { type: "text", text: trimmed }], {
      displayText: trimmed,
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    });
  }

  if (editing) {
    return (
      <div data-question-index={index} className="ly-enter mb-2.5 flex justify-end">
        <MessageEditor
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onCancel={() => {
            setEditing(false);
            setDraft(text);
          }}
        />
      </div>
    );
  }

  return (
    <div data-question-index={index} className="group/msg ly-enter mb-2.5 flex flex-col items-end">
      {/*
       * Always visible, not folded into the hover row below.
       *
       * This message was written by the side chat, not by the person reading it. Finding
       * an instruction in your own voice that you have no memory of writing is disorienting
       * enough that the explanation cannot be something you have to go looking for.
       */}
      {message.origin === "side-chat" && (
        <span className="mb-1 flex items-center gap-1 pr-1 text-caption text-ink-faint">
          <MessageSquarePlus size={11} strokeWidth={1.9} />
          {translate("userMessage.fromSideChat")}
        </span>
      )}

        {/*
         * 全部附件，在气泡外面，一排。
         *
         * 图片是缩略图不是原图：一张已发出的图在这里要回答的只是「是哪一张」，看清楚它是一次
         * 点击的事，而查看器比一个消息气泡称职得多。三张全尺寸的截图会把它们底下的回复整个顶
         * 出屏幕——地方被图占了，对话把它丢了。
         *
         * 文件也在这里，而不是在气泡里当一段行内文字。从前只有图片站在外面，文档的名字嵌在句
         * 子中间，于是同一条消息里两种附件是两种东西；更糟的是图片两样都占：外面一张缩略图，
         * 里面还有一遍它的文件名。现在一个文件只画一次，画在同一个地方。
         *
         * 能点开，但不能改：这一份已经发出去了。查看器认得出没有 `onReplace`，于是把标注过的
         * 那份放进剪贴板，而不是悄悄改写一条已经是记录的消息。
         */}
        {files.length > 0 && (
          <AttachmentStrip
            files={files}
            align="end"
            thumbnail={80}
            /*
             * 铺开，不滚。
             *
             * 这一条已经发出去了：它带了九个文件就该看见九个，下面没有什么在等着被挤走。横滚在这里
             * 还会藏东西——翻旧消息的人不会想到要去横着拨一下。
             */
            layout="wrap"
            className="ly-user-images mb-2 max-w-[85%]"
            onOpen={(index, event) =>
              openFromEvent(
                event,
                images.map((img) => ({ src: `data:${img.mimeType};base64,${img.data}` })),
                index,
              )
            }
            onPreviewFile={(file) => {
              void openInPane(file.path, file.name, ensureThere);
            }}
          />
        )}
      {(said || hasCapsules) && <div className="ly-user-bubble max-w-[85%] rounded-2xl bg-card px-4 py-2.5 sm:max-w-[75%]">
        {/* Render interactive Skill capsule if present */}
        {skillRef && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-ly-tip={t("userMessage.openSkill")}
              onClick={async () => {
                const cmdCwd = useApp.getState().workspace?.path ?? useApp.getState().scratchCwd ?? "";
                const list = await bridge.commands.list(cmdCwd).catch(() => null);
                const targetPath = list?.skills?.find((skill: SkillEntry) => skill.name === skillRef.name && skill.pluginId === skillRef.pluginId)?.path;
                if (targetPath) {
                  const fileName = targetPath.split(/[/\\]/).pop() || `${skillRef?.name} (SKILL.md)`;
                  void useOpenFile.getState().open({
                    path: targetPath,
                    name: fileName,
                    isDirectory: false,
                    size: 0,
                  });
                  useDock.getState().open("file", { kind: "conversation", side: "right", share: 0.45 });
                } else {
                  useApp.getState().notify(t("userMessage.skillMissing", { name: skillRef?.name ?? "" }), "warn");
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card-hover/80 px-2.5 py-1 text-label font-medium text-accent transition-colors hover:bg-card-hover active:scale-[0.98]"
            >
              <Boxes size={13} strokeWidth={2} className="text-accent" />
              <span>{skillRef.name}</span>
            </button>
          </div>
        )}

        {/* Render interactive Session mention capsules if present */}
        {message.sessionRefs && message.sessionRefs.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {message.sessionRefs.map((sRef) => (
              <button
                key={sRef.id}
                type="button"
                data-ly-tip={t("userMessage.jumpToSession")}
                onClick={() => {
                  const target = useApp.getState().sessions.find((s) => s.id === sRef.id);
                  if (target) {
                    void useApp.getState().openSession(target);
                  } else {
                    useApp.getState().notify(t("userMessage.sessionMissing", { title: sRef.title }), "warn");
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card-hover/80 px-2 py-0.5 text-caption font-medium text-ink-muted transition-colors hover:bg-card-hover hover:text-ink active:scale-[0.98]"
              >
                <MessagesSquare size={12} strokeWidth={1.8} className="text-ink-faint" />
                <span className="max-w-[180px] truncate">{sRef.title}</span>
              </button>
            ))}
          </div>
        )}

        {/*
          * 气泡里只有人自己打的那些字。
          *
          * 认不出来的 `【…】` 原样留着：中文里方括号是普通标点，一句「这个【重要】」不是在引用
          * 任何东西。
          */}
        {said && (
          <p className="text-body leading-relaxed whitespace-pre-wrap break-words text-ink">
            {spoken.map((segment, at) =>
              segment.kind === "text" ? (
                segment.text
              ) : (
                <span key={at} className="ly-attachment-token" data-kind={segment.file.kind}>
                  {segment.file.label ?? segment.file.name}
                </span>
              ),
            )}
          </p>
        )}
      </div>}

      {/* Editing is the one thing a sent message offers that a reply does not. */}
      <MessageActions
        timestamp={message.timestamp}
        text={text}
        className="pr-1"
      >
        <button
          type="button"
          data-ly-tip={running ? t("userMessage.turnRunning") : t("userMessage.editResend")}
          aria-label={t("userMessage.editResend")}
          disabled={running}
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Pencil size={12.5} strokeWidth={1.8} />
        </button>
      </MessageActions>
    </div>
  );
}
