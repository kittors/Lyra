/**
 * The rule editor's one question, answered before the file is saved: would this pattern fire?
 *
 * Rules are files here — the page says so, and sends you to the file to change one. What the page
 * can do that the file cannot is show a pattern meeting the conversation it is about: type it,
 * and every place it would have hit in the last twenty replies is listed underneath, with the
 * loader's own refusal when the loader would refuse it. A stream rule's row fills this in with
 * its conditions, one input per condition, because a file's `condition` is a list.
 */

import type { Message } from "@lyra/core";
import { Card } from "./controls.tsx";
import { TextInput } from "./inputs.tsx";
import { RECENT_LIMIT, tryCondition, type TryHit } from "./rule-try.ts";

export function RuleTryPanel({
	patterns,
	onChange,
	messages,
}: {
	/** One per input. A rule with three conditions is three inputs. */
	patterns: string[];
	onChange: (next: string[]) => void;
	/** The active conversation; only its assistant messages are looked at. */
	messages: Message[];
}) {
	const outcomes = patterns.map((pattern) => tryCondition(pattern, messages));
	const checked = outcomes[0]?.checked ?? 0;

	return (
		<Card className="mb-6">
			<div className="px-4 py-3" data-rule-try>
				<div className="mb-1 text-label text-ink">拿最近的对话试一下</div>
				<p className="mb-3 text-detail leading-relaxed text-ink-muted">
					对当前会话最近 {RECENT_LIMIT} 条助手消息跑一遍这个正则，列出它会命中的地方——直接回答「我写宽了吗」。
					{checked === 0 && " 现在没有可试的消息：打开一个有过回复的会话。"}
				</p>
				{patterns.map((pattern, i) => {
					const outcome = outcomes[i];
					const typed = pattern.trim() !== "";
					return (
						// Position is identity here: the inputs are the rule's condition list, in order.
						<div key={i} className="mb-2" data-rule-try-row>
							<TextInput
								mono
								value={pattern}
								invalid={typed && outcome.reason !== undefined}
								placeholder="condition 正则，例如 (?i)rm -rf"
								aria-label="要试的正则"
								onChange={(value) => onChange(patterns.map((p, j) => (j === i ? value : p)))}
							/>
							{typed &&
								(outcome.reason ? (
									<p data-rule-try-status="refused" className="mt-1 text-detail text-danger">
										{outcome.reason}
									</p>
								) : (
									<p data-rule-try-status={outcome.hits.length > 0 ? "hit" : "miss"} className="mt-1 text-detail text-ink-muted">
										{outcome.hits.length > 0
											? `会命中 ${outcome.hits.length} 处`
											: outcome.checked > 0
												? `最近 ${outcome.checked} 条里一处都不命中`
												: "正则没问题；有了对话再来试命中"}
									</p>
								))}
							{outcome.hits.length > 0 && (
								<ul className="mt-1 space-y-0.5">
									{outcome.hits.map((hit, k) => (
										<li key={k} data-rule-try-hit className="text-detail text-ink-faint">
											<span className="text-ink-muted">
												倒数第 {hit.nth} 条 · {sourceWord(hit)}
											</span>{" "}
											<span className="font-mono">{hit.snippet}</span>
										</li>
									))}
								</ul>
							)}
						</div>
					);
				})}
			</div>
		</Card>
	);
}

function sourceWord(hit: TryHit): string {
	if (hit.source === "text") return "正文";
	if (hit.source === "thinking") return "思考";
	return `工具 ${hit.toolName ?? ""} 的参数`;
}
