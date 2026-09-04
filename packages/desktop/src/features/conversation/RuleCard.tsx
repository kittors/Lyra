/**
 * A rule firing, shown where it happened.
 *
 * Until this existed a rule correction was invisible. Synthetic messages render as nothing, so a
 * rule that cut the model off mid-sentence and made it start again showed up as the model simply
 * having said something different — and "why did it suddenly change its mind" is exactly the
 * question a person asks afterwards, when a toast that might have explained it is long gone.
 *
 * Collapsed by default, because a rule working is not news. What is worth a click is the pair of
 * facts underneath: which rule, and **what text it caught** — a pattern written too broadly is
 * only visible next to the thing it grabbed, and that is the first thing anybody wants when a
 * rule misfires.
 */

import { useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import type { Message } from "@lyra/core";

type RuleMatch = NonNullable<Extract<Message, { role: "user" }>["ruleMatch"]>;

/** Where the rule was watching, in words rather than in the scope's own vocabulary. */
function where(rule: RuleMatch["rules"][number]): string {
  if (rule.source === "tool") return rule.toolName ? `${rule.toolName} 的参数里` : "工具调用里";
  if (rule.source === "thinking") return "思考里";
  return "回复里";
}

export function RuleCard({ match }: { match: RuleMatch }) {
  const [open, setOpen] = useState(false);
  const names = match.rules.map((rule) => rule.name).join("、");

  return (
    <div className="my-2 overflow-hidden rounded-md border border-line-soft">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-detail text-ink-muted transition-colors hover:bg-card-hover"
      >
        <ShieldCheck size={13} className="shrink-0 text-ink-faint" aria-hidden />
        {/*
         * The two cases are worded differently because they are different events. An interrupt
         * discarded what was being written; a deferred match did not, and saying "已重来" there
         * would describe something that never happened.
         */}
        <span>{match.interrupted ? `规则 ${names} 中止了这段输出，已重来` : `规则 ${names} 命中，提醒已带到下一轮`}</span>
        <ChevronDown
          size={12}
          aria-hidden
          className={`ml-auto shrink-0 text-ink-faint transition-transform${open ? " rotate-180" : ""}`}
        />
      </button>

      {/* Indented past the icon so the detail lines up under the summary's text, not under its icon. */}
      {open && (
        <div className="flex flex-col gap-3 py-2 pr-3 pl-[2.0625rem]">
          {match.rules.map((rule) => (
            <div key={`${rule.name}-${rule.excerpt}`} className="flex flex-col gap-1">
              <p className="text-detail text-ink-muted">
                <code>{rule.name}</code> · 监视{where(rule)}
              </p>
              {/*
               * The excerpt is the reason to open this at all. Wrapping rather than scrolling:
               * a horizontal scrollbar on the one line somebody came here to read is a way of
               * hiding it.
               */}
              <pre className="ly-rule-excerpt m-0 whitespace-pre-wrap break-words rounded p-2 font-mono text-detail leading-relaxed">
                {rule.excerpt}
              </pre>
              <p className="text-detail text-ink-faint">{rule.path}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
