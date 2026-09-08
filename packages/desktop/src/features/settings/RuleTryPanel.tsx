/**
 * The rule editor's one question, answered before the file is saved: would this pattern fire?
 *
 * Rules are files here — the page says so, and sends you to the file to change one. What the page
 * can do that the file cannot is show a pattern meeting the conversation it is about: type it,
 * and every place it would have hit in the last twenty replies is listed underneath, with the
 * loader's own refusal when the loader would refuse it. A stream rule's row fills this in with
 * its conditions, one input per condition, because a file's `condition` is a list.
 */

import { useI18n } from "../../i18n/index.ts";
import { translate } from "../../i18n/translate.ts";
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
	const { t } = useI18n();
	const outcomes = patterns.map((pattern) => tryCondition(pattern, messages));
	const checked = outcomes[0]?.checked ?? 0;

	return (
		<Card className="mb-6">
			<div className="px-4 py-3" data-rule-try>
				<div className="mb-1 text-label text-ink">{t("ruleTry.title")}</div>
				<p className="mb-3 text-detail leading-relaxed text-ink-muted">
					{t("ruleTry.intro", { n: RECENT_LIMIT })}
					{checked === 0 && t("ruleTry.noMessages")}
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
								placeholder={t("ruleTry.placeholder")}
								aria-label={t("ruleTry.label")}
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
											? t("ruleTry.hits", { n: outcome.hits.length })
											: outcome.checked > 0
												? t("ruleTry.noHits", { n: outcome.checked })
												: t("ruleTry.validNoMessages")}
									</p>
								))}
							{outcome.hits.length > 0 && (
								<ul className="mt-1 space-y-0.5">
									{outcome.hits.map((hit, k) => (
										<li key={k} data-rule-try-hit className="text-detail text-ink-faint">
											<span className="text-ink-muted">
												{t("ruleTry.nthFromEnd", { n: hit.nth })}
												{sourceWord(hit)}
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
	if (hit.source === "text") return translate("ruleTry.body");
	if (hit.source === "thinking") return translate("ruleTry.thinking");
	return translate("ruleTry.toolArgs", { tool: hit.toolName ?? "" });
}
