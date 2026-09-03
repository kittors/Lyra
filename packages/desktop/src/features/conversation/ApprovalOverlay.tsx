import { Terminal, TriangleAlert } from "lucide-react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";

const KIND_LABEL: Record<string, string> = {
  bash: "执行命令",
  write: "写入文件",
  edit: "修改文件",
  mcp: "调用 MCP 工具",
  network: "访问网络",
};

/**
 * Approval prompt. It blocks the composer rather than the whole window so the user can still
 * read the transcript above while deciding.
 */
export function ApprovalOverlay() {
  const approvals = useApp((s) => s.approvals);
  const respond = useApp((s) => s.respondToApproval);
  const { compact } = useLayout();
  const request = approvals[0];
  if (!request) return null;

  return (
    <div
      /*
       * Anchored to the top edge of the composer, so it never covers it.
       *
       * The fade is still here because the transcript scrolls underneath: without it, a
       * line of code slides out from behind the card with nothing in between.
       */
      className={`pointer-events-none absolute inset-x-0 bottom-full z-20 flex justify-center bg-gradient-to-t from-shell via-shell/95 to-transparent pb-2 ${
        compact ? "px-4 pt-8" : "px-8 pt-16"
      }`}
    >
      {/*
       * The same floating surface as every menu and popover in the app.
       *
       * It used to announce itself with an accent-coloured border and a heavy drop shadow,
       * which made a routine "may I run this" look like an alarm — and looked nothing like the
       * other things that float in this window. What makes it noticeable is where it appears
       * and that it stops the turn; the chrome only has to say "this is a layer above". The one
       * accent left is the warning mark, which is the part that is actually about caution.
       */}
      <div className="ly-glass ly-slide-up pointer-events-auto w-full max-w-[var(--ly-content)] overflow-hidden rounded-[10px] border border-line">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <TriangleAlert
            size={15}
            strokeWidth={1.9}
            className="shrink-0 text-accent"
          />
          <span className="min-w-0 truncate text-label font-medium text-ink">
            {request.title}
          </span>
          <span className="shrink-0 rounded-md bg-card px-1.5 py-0.5 text-caption text-ink-faint">
            {KIND_LABEL[request.kind] ?? request.kind}
          </span>
          {approvals.length > 1 && (
            <span className="ml-auto shrink-0 text-caption text-ink-faint">
              还有 {approvals.length - 1} 个
            </span>
          )}
        </div>

        <Scroller
          className="max-h-[min(280px,30vh)] bg-shell/60"
          bottom="none"
          contentClassName="px-4 py-3"
        >
          {/*
           * Why, before what.
           *
           * When the model asked for this — an escalation after the sandbox refused something —
           * it had to give a reason, and that sentence is the only part of this prompt somebody
           * can actually judge. A path and a mode describe what would happen; this says what it
           * is for. Set in the reading face rather than the code face because it is prose.
           */}
          {request.reason && (
            <p className="mb-2.5 text-label leading-relaxed text-ink">{request.reason}</p>
          )}
          {/* The command itself is code being read before it runs, so it takes 代码字号. */}
          <pre className="font-mono text-code whitespace-pre-wrap text-ink-muted">
            {request.detail}
          </pre>
        </Scroller>

        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5">
          <button
            type="button"
            onClick={() => void respond(request.id, "reject")}
            className="h-8 rounded-lg px-3 text-label text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
          >
            拒绝
          </button>
          {/*
           * A permanent grant should say what it is granting.
           *
           * This was a bare 「始终允许」 — allow what, exactly? The answer is the subject the gate
           * remembers, which for a network request is an origin and for a command is the command
           * itself. Shown in the tooltip rather than the label so the button stays a button, and
           * the label says 「不再问」 because that is the effect: this decision stops the question,
           * it does not widen anything. Revocable in 设置 › 访问授权.
           */}
          <button
            type="button"
            data-ly-tip={request.subject ? `以后不再问：${request.subject}` : "以后不再问这一项"}
            onClick={() => void respond(request.id, "always")}
            className="h-8 rounded-lg border border-line px-3 text-label text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
          >
            以后不再问
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => void respond(request.id, "once")}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-label font-medium text-shell transition-opacity hover:opacity-90"
          >
            <Terminal size={13} strokeWidth={2} />
            允许一次
          </button>
        </div>
      </div>
    </div>
  );
}
