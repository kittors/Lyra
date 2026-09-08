import type {
  UserContent,
  UserMessage as UserMessageType,
} from "@lyra/core";
import { MessageSquarePlus, Pencil, Boxes, MessagesSquare } from "lucide-react";
import { openFromEvent } from "../image/index.ts";
import { useState } from "react";
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

  const rawText = message.content
    .filter(
      (block): block is Extract<UserContent, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");

  const skillRef = message.skillRef;
  const hasCapsules = Boolean(skillRef || message.sessionRefs?.length);
  const text = message.displayText ?? rawText;
  const images = message.content.filter((block) => block.type === "image");

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
    // Images are carried over: the edit is to the wording, not to what was attached.
    void editMessage(index, [...images, { type: "text", text: trimmed }]);
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
          来自侧边聊天
        </span>
      )}

        {/*
         * Thumbnails in a row, not a stack of full-size pictures.
         *
         * What a sent image needs to do here is say which image it was; looking at it properly is
         * a click away, and the viewer is much better at it than a message bubble. At full height
         * three screenshots pushed the reply that followed them off the screen — the picture took
         * the space, and the conversation lost it.
         */}
        {images.length > 0 && (
          <div className="ly-user-images mb-2 flex max-w-[85%] flex-wrap justify-end gap-2">
            {images.map((block, i) => (
              /*
               * Openable, but not replaceable: this one has already been sent. The viewer notices
               * the missing `onReplace` and offers the annotated copy for the clipboard instead of
               * silently rewriting a message that is part of the record.
               */
              <button
                key={i}
                type="button"
                aria-label={t("userMessage.previewImage")}
                onClick={(event) =>
                  openFromEvent(
                    event,
                    images.map((img) => ({ src: `data:${img.mimeType};base64,${img.data}` })),
                    i,
                  )
                }
                className="block h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-line transition-[opacity,transform] duration-[var(--ly-t-quick)] hover:opacity-88 active:scale-[0.97]"
              >
                {/* `cover`: a row of equal squares reads as a set. Letterboxed thumbnails of mixed
                    aspect ratios read as a layout that gave up. */}
                <img
                  src={`data:${block.mimeType};base64,${block.data}`}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      {(text || hasCapsules) && <div className="ly-user-bubble max-w-[85%] rounded-2xl bg-card px-4 py-2.5 sm:max-w-[75%]">
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

        {text && <p className="text-body leading-relaxed whitespace-pre-wrap break-words text-ink">{text}</p>}
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
