import { translate } from "../../i18n/translate.ts";
import type {
  UserContent,
  UserMessage as UserMessageType,
} from "@lyra/core";
import { MessageSquarePlus, Pencil, Boxes, MessagesSquare, Undo2 } from "lucide-react";
import { openFromEvent, openViewer } from "../image/index.ts";
import { AttachmentMenu, AttachmentStrip, displayName, fileKind, KIND_LABEL, type FileKind, type StripFile } from "../composer/index.ts";
import { useAttachmentActions } from "../composer/index.ts";
import { companionOf, openScopedPanel } from "../dock/index.ts";
import { isAttachmentBody } from "../../lib/attachment-placeholders.ts";
import { useMemo, useState } from "react";
import { BubbleText } from "./BubbleText.tsx";
import { Markdown } from "./Markdown.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { MessageEditor } from "./message/MessageEditor.tsx";
import { useApp } from "../../store/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { bridge } from "../../services/index.ts";
import type { SkillEntry } from "../../../electron/ipc-types.ts";
import { useI18n } from "../../i18n/index.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { lastUserMessageIndex } from "../../lib/revert-draft.ts";
import { afterPaint } from "../../lib/after-paint.ts";
import { SESSION_THUMB_EDGE, sessionMediaUrl } from "../../../shared/session-image.ts";
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

function imageSrc(block: ImageBlock | undefined, path: string | undefined): { src?: string; full?: string } {
	if (block?.media) {
		return {
			src: sessionMediaUrl(block.media, SESSION_THUMB_EDGE),
			full: sessionMediaUrl(block.media),
		};
	}
	if (block?.data) {
		const url = `data:${block.mimeType};base64,${block.data}`;
		return { src: url, full: url };
	}
	if (path) {
		const url = bridge.files.mediaUrl(path);
		return { src: url, full: url };
	}
	return {};
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
  regionShot: string,
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
    const refs = imageSrc(block, file.path);
    files.push({
      key: `${index}-${file.name}`,
      name: file.name,
      kind,
      /*
       * 正文里那枚标记写的名字：有真名就是真名，没有（粘贴进来的图）才是「图片 1」。
       *
       * 存下来的优先，没存的按**和输入框同一套规则**现算（见 `Composer` 的 `relabel`）。这条规则错
       * 开过两次，两次的表现是一样的：气泡里那些标记配不上任何一份附件，整句话的标签退化成一串方
       * 括号。两处必须是同一条。
       *
       * 老消息的标记写的是文件名，那一种由 `scanPlaceholders` 一并认（见 `answersTo`）。
       */
      label: file.label ?? displayName({ name: file.name, kindLabel: label(kind), kindIndex }, regionShot),
      tip: `${file.name}\n${label(kind)}`,
      ...(refs.src ? { src: refs.src } : {}),
      ...(refs.full ? { full: refs.full } : {}),
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
    const refs = imageSrc(images[at], undefined);
    files.push({
      key: `image-${at}`,
      name: "",
      kind: "image",
      ...(refs.src ? { src: refs.src } : {}),
      ...(refs.full ? { full: refs.full } : {}),
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
	const revertMessage = useApp((s) => s.revertMessage);
	const lastUser = useApp((s) => lastUserMessageIndex(s.messages));
	const confirm = useConfirmer();
  const attachmentActions = useAttachmentActions();
  /** 从句子里那枚标记打开查看器。起点取气泡外那一排里对应的格子，没有就从点击/右键的位置长。 */
  const previewImage = (src: string, originRect?: DOMRect) => {
    const pictures = files.filter((file) => file.kind === "image" && (file.full || file.src));
    const imgIndex = pictures.findIndex((file) => file.full === src || file.src === src);
    if (imgIndex < 0) return;
    const tile = document.querySelectorAll<HTMLElement>(`[data-question-index="${index}"] .ly-attachment-body`)[imgIndex] ?? null;
    const origin = originRect ?? tile?.getBoundingClientRect() ?? new DOMRect(markMenu?.point.x ?? 0, markMenu?.point.y ?? 0, 1, 1);
    openViewer(
      pictures.map((file) => ({ src: file.full ?? file.src! })),
      imgIndex,
      origin,
      tile,
    );
  };

  /** 右键点在句子里某一枚标记上时，那份附件和菜单该弹在哪儿。 */
  const [markMenu, setMarkMenu] = useState<{
    point: { x: number; y: number };
    file: { name: string; label?: string; path?: string; src?: string };
  } | null>(null);

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
    () =>
      attachmentsOf(
        message,
        images,
        (kind) => t(KIND_LABEL[kind]),
        t("composer.regionShot"),
      ),
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
  /*
   * 气泡外面那一排只有图片。
   *
   * 文件不上这一排，和输入框那边同一条规矩：一份表格的全部信息就是它的名字，而名字已经在句子里那
   * 枚标记上了；再在上面摆一个同样写着名字的格子，是同一件事说两遍。图片留着，因为缩略图答的是
   * 「是哪一张」——那是文件名答不了的。
   */
  const shown = useMemo(() => files.filter((file) => file.src), [files]);
  /*
   * 交给气泡的那份附件清单。
   *
   * 从前这里就地 `placeAttachments` 切好段再画。现在切段在 `BubbleText` 里——它要先知道有没有
   * 标记，才能决定这段正文走 markdown 还是走行内。这里只负责把消息里存的附件整理成它认得的
   * 形状。
   */
  const spokenFiles = useMemo(
    () =>
      (
        files.map((file) => ({
          name: file.name,
          label: file.label,
          kind: file.kind,
          src: file.full ?? file.src,
          /*
           * 它在磁盘上的位置也要带过来。
           *
           * 这一行漏了很久，而漏掉它的表现不是「少一行菜单」：右键点在气泡里一枚文件标记上，弹出
           * 来的是一个**空框**——没有路径就没有「打开」「在访达中显示」「复制路径」，而文件又没有
           * 像素可复制、已经发出去的也没有「移除」，于是一行都不剩。消息里本来就存着这个路径
           * （`MessageAttachment.path`），只是没走到这儿。
           */
          ...(file.path ? { path: file.path } : {}),
          // 图片的像素、文本的正文，两样都没有的才是「只有名字」。
          bodiless: !file.src && file.kind !== "text",
        }))
      ),
    [files],
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
      <div data-question-index={index} className="ly-enter flex justify-end">
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
    <div data-question-index={index} className="group/msg ly-enter flex flex-col items-end">
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
        {shown.length > 0 && (
          <AttachmentStrip
            files={shown}
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
                shown.map((file) => ({ src: file.full ?? file.src! })),
                index,
              )
            }
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
                  openScopedPanel("file", { kind: "conversation", side: "right", share: 0.45 });
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
                    const epoch = useApp.getState().previewSession(target);
                    void afterPaint().then(() => {
                      if (useApp.getState().selectionEpoch !== epoch) return;
                      void useApp.getState().openSession(target);
                    });
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
          <BubbleText
            text={text}
            files={spokenFiles}
            className="text-body leading-relaxed text-ink"
            renderText={(plain) => <Markdown text={plain} />}
            renderFile={(file, at) => {
              const segment = { file };
              return (
                <span
                  key={at}
                  className="ly-attachment-token"
                  data-kind={segment.file.kind}
                  /* 只有名字进了提示词的那些：图标淡一档。气泡里还多一句悬停说明。 */
                  data-bodiless={segment.file.bodiless ? "" : undefined}
                  data-ly-tip={segment.file.bodiless ? t("composer.filenameOnly") : undefined}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    attachmentActions.openOrPreview(
                      {
                        name: segment.file.label ?? segment.file.name,
                        path: segment.file.path,
                        src: segment.file.src,
                        isImage: Boolean(segment.file.src || segment.file.kind === "image"),
                        onPreviewImage: (originRect?: DOMRect) => {
                          if (segment.file.src) {
                            previewImage(segment.file.src, originRect);
                          }
                        },
                        onOpenFile: (filePath: string, name: string) => {
                          void useOpenFile.getState().open({ path: filePath, name, isDirectory: false, size: 0 });
                          openScopedPanel("file", companionOf("file"));
                        },
                      },
                      rect,
                    );
                  }}
                  /*
                   * 右键点这一枚，和右键点输入框里那一枚、点附件条上那一格，弹的是同一份菜单。
                   *
                   * 已经发出去的消息里没有「移除」——那一份是记录。其余几行照旧，靠的是消息里存下的
                   * 路径（`MessageAttachment.path`）；存之前发的那些没有路径，菜单会自己把它们画成
                   * 灰的并说明为什么。
                   */
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMarkMenu({ point: { x: event.clientX, y: event.clientY }, file: segment.file });
                  }}
                >
                  {segment.file.label ?? segment.file.name}
                </span>
              );
            }}
          />
        )}
      </div>}

      <AttachmentMenu
        anchor={markMenu?.point ?? null}
        file={
          markMenu
            ? {
                name: markMenu.file.label ?? markMenu.file.name,
                ...(markMenu.file.path ? { path: markMenu.file.path } : {}),
                ...(markMenu.file.src ? { src: markMenu.file.src } : {}),
                /*
                 * 预览只给图片：像素就在消息里，查看器要的只是一个放大的起点。文件不给——它的预览只
                 * 能是右边那个面板，而面板读不到项目外的东西，而附件绝大多数来自项目外。
                 */
                ...(markMenu.file.src ? { onPreview: () => previewImage(markMenu.file.src ?? "") } : {}),
              }
            : null
        }
        onClose={() => setMarkMenu(null)}
      />

      {/* Editing is the one thing a sent message offers that a reply does not. */}
      <MessageActions
        timestamp={message.timestamp}
        text={text}
        className="pr-1"
      >
        <button
          type="button"
          data-message-undo=""
          data-ly-tip={running ? t("userMessage.undoRunning") : t("userMessage.undo")}
          aria-label={t("userMessage.undo")}
          disabled={running}
          onClick={() => {
            if (running) return;
            const run = () => void revertMessage(index);
            if (index === lastUser) {
              run();
              return;
            }
            confirm.ask({
              title: t("userMessage.undoConfirmTitle"),
              detail: t("userMessage.undoConfirmDetail"),
              confirmLabel: t("userMessage.undoConfirm"),
              onConfirm: run,
            });
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Undo2 size={12.5} strokeWidth={1.8} />
        </button>
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
      {confirm.element}
    </div>
  );
}
