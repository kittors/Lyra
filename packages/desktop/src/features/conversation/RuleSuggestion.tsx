/**
 * 「要把这次纠正变成一条规则吗？」
 *
 * 计划里把「没人写规则」列为整套设计最脆弱的三个假设之一，这张卡片是它的第二个对策。第一个是
 * 内置规则先能用，第三个是读 Cursor 那些已经写好的。这一个不一样：它抓的是**规则本该被写下来
 * 的那一刻**——一个人正在纠正模型，脑子里想的是那条约定本身，而不是「我要不要去建个规则文件」。
 *
 * 三个决定它是功能还是骚扰的地方，两个在这里：
 *
 *   **默认收起正文，但条件永远露在外面。** 要判断值不值得保存，看的是「以后什么情况会触发」，
 *   不是那两句话怎么写的。
 *
 *   **「编辑」编的就是要落盘的那个文件。** 不是编正文再由别处拼装——那样人批准的东西和写进去的
 *   东西就是两件事，而这两件事一旦分开，分开的方向永远是坏的那一边。
 *
 * （第三个是节流，在 core 的 `OfferBudget` 里：一个会话最多三次，连着拒两次就此打住。）
 */

import { useEffect, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { bridge } from "../../services/host.ts";
import { useApp } from "../../store/index.ts";

/** 触发条件说的是「在哪儿看」，把 scope 翻成人话。 */
function where(scope: string | undefined): string {
  if (!scope || scope === "text") return "回复里";
  if (scope === "thinking") return "思考里";
  if (scope === "tool") return "工具调用里";
  if (scope.startsWith("tool:")) return `${scope.slice(5)} 的参数里`;
  return scope;
}

export function RuleSuggestion() {
  const offer = useApp((s) => s.ruleOffer);
  const sessionId = useApp((s) => s.activeSessionId);
  const notify = useApp((s) => s.notify);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /*
   * 预览由主进程渲染，而且是写文件的那个函数渲染的。
   *
   * 在窗口里再写一遍拼装逻辑，两边迟早会不一致——而不一致的方向是固定的：人看着一份文本点了
   * 保存，落盘的是另一份。
   */
  useEffect(() => {
    if (!offer) {
      setDraft(null);
      setOpen(false);
      return;
    }
    let alive = true;
    void bridge.rules
      .preview({ isCorrection: true, name: offer.name, body: offer.body, condition: offer.condition, scope: offer.scope })
      .then((text) => {
        if (alive) setDraft(text);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [offer]);

  if (!offer || !sessionId) return null;

  const dismiss = () => {
    // 先告诉会话，再从界面上拿掉：预算记在 core 那边，少记一次就是多问一次。
    void bridge.rules.decline(sessionId).catch(() => {});
    useApp.setState({ ruleOffer: null });
  };

  const keep = (scope: "project" | "user") => {
    if (!draft || saving) return;
    setSaving(true);
    void bridge.rules
      .keep(sessionId, scope, offer.name, draft)
      .then((saved) => {
        useApp.setState({ ruleOffer: null });
        /*
         * 说出落到哪儿了，而且要说重命名。
         *
         * 同名规则不覆盖，改存成 `-2`。人以为自己更新了一条规则、实际上多了一条并存的，是这里
         * 唯一一种「看起来成功了的失败」。
         */
        notify(saved.renamed ? `规则已存为 ${saved.renamed}（同名的那条没动）：${saved.path}` : `规则已保存：${saved.path}`);
      })
      .catch((error: unknown) => {
        notify(`规则没能保存：${error instanceof Error ? error.message : String(error)}`, "error");
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className="ly-enter my-2 overflow-hidden rounded-md border border-line-soft">
      <div className="flex items-center gap-2 px-3 py-2 text-detail text-ink-muted">
        <Sparkles size={13} className="shrink-0 text-ink-faint" aria-hidden />
        <span>要把这次纠正变成一条规则吗？</span>
      </div>

      <div className="flex flex-col gap-1.5 pr-3 pb-2 pl-[2.0625rem]">
        {/*
         * 条件在前，正文在后。
         *
         * 值不值得存，判断依据是「以后什么时候会触发」——一个太宽的正则要等看见它抓到的东西才
         * 看得出来，而那正是这一行。没有条件的是规则库条目，模型自己决定要不要读，那就没有
         * 「什么时候触发」可说。
         */}
        {offer.condition ? (
          <p className="text-detail text-ink-muted">
            <span className="text-ink-faint">触发条件</span>　{where(offer.scope)}出现{" "}
            <code className="ly-rule-excerpt rounded px-1 py-0.5 font-mono">{offer.condition}</code>
          </p>
        ) : (
          <p className="text-detail text-ink-faint">没有触发条件，会作为规则库条目由模型按需读取</p>
        )}
        <p className="text-detail text-ink-muted">
          <span className="text-ink-faint">规则正文</span>　{offer.body}
        </p>

        {/* 展开的是完整文件，包括 frontmatter：批准的和写进去的必须是同一段文本。 */}
        {open && (
          <textarea
            value={draft ?? ""}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={Math.min(14, (draft ?? "").split("\n").length + 1)}
            className="ly-rule-excerpt mt-1 w-full resize-y rounded p-2 font-mono text-detail leading-relaxed outline-none"
          />
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-ly-tip="存到 .lyra/rules/，会跟着仓库走"
            disabled={!draft || saving}
            onClick={() => keep("project")}
            className="flex h-7 items-center rounded-lg bg-ink px-3 text-detail font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            保存到项目
          </button>
          <button
            type="button"
            data-ly-tip="存到 ~/.lyra/rules/，只对你生效"
            disabled={!draft || saving}
            onClick={() => keep("user")}
            className="h-7 rounded-lg border border-line px-3 text-detail text-ink-muted transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-40"
          >
            保存到我的
          </button>
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            className="flex h-7 items-center gap-1 rounded-lg px-2 text-detail text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
          >
            编辑
            <ChevronDown size={11} aria-hidden className={`transition-transform${open ? " rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="ml-auto h-7 rounded-lg px-2 text-detail text-ink-faint transition-colors hover:bg-card-hover hover:text-ink-muted"
          >
            不用
          </button>
        </div>
      </div>
    </div>
  );
}
