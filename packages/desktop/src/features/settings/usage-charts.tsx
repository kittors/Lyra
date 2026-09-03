/**
 * The two pictures on the usage page: a day-by-day bar chart, and the model ranking under it.
 *
 * Hand-drawn rather than charted. A library would bring a renderer, a theme system and its own
 * idea of a tooltip for two shapes that are a row of divs and a row of bars — and the app already
 * has a tooltip, a scale and a palette that every other surface reads from.
 */

import { formatCompact } from "./usage-format.ts";
import type { ModelUse } from "./usage-aggregate.ts";

/**
 * Tokens per day, as bars.
 *
 * Scaled against the busiest day in the range rather than an absolute number, because there is no
 * fixed scale that suits both an afternoon of questions and a week of refactoring. Empty days keep
 * their column: a chart that skips them turns a quiet week into no week at all.
 */
export function DailyBars({ series }: { series: { day: string; tokens: number; cost: number }[] }) {
	const busiest = Math.max(1, ...series.map((each) => each.tokens));
	// Past this the bars are thinner than the gaps between them and the chart reads as a comb.
	const dense = series.length > 45;

	return (
		<div className="px-4 pt-4 pb-3">
			<div className="flex h-[120px] items-end gap-[3px]">
				{series.map((each) => {
					const share = each.tokens / busiest;
					return (
						<div
							key={each.day}
							data-ly-tip={tipFor(each)}
							data-ly-tip-side="top"
							className="group/bar flex h-full flex-1 items-end"
						>
							<div
								className={`w-full rounded-[2px] transition-colors duration-[var(--ly-t-quick)] ${
									each.tokens > 0 ? "bg-info/70 group-hover/bar:bg-info" : "bg-ink/[0.06]"
								}`}
								/*
								 * A floor of 2px on any day that had traffic, so a light day is a
								 * mark rather than nothing — the difference between "quiet" and
								 * "nothing happened" is the point of the chart.
								 */
								style={{ height: each.tokens > 0 ? `max(2px, ${(share * 100).toFixed(1)}%)` : "2px" }}
							/>
						</div>
					);
				})}
			</div>

			<div className="mt-2 flex justify-between text-detail text-ink-faint">
				<span>{label(series[0]?.day)}</span>
				{!dense && series.length > 2 && <span>{label(series[Math.floor(series.length / 2)]?.day)}</span>}
				<span>{label(series[series.length - 1]?.day)}</span>
			</div>
		</div>
	);
}

/** Which model spent it, as a bar per model. */
export function ModelBars({ models, providerName }: { models: ModelUse[]; providerName: (id: string) => string }) {
	return (
		<div className="flex flex-col gap-2.5 px-4 py-3.5">
			{models.map((each) => (
				<div key={each.key}>
					<div className="flex items-baseline gap-2 text-label">
						<span className="min-w-0 flex-1 truncate text-ink">{each.model}</span>
						{/* The house it came from, which is the whole reason two rows can share a name. */}
						<span className="shrink-0 text-detail text-ink-faint">{providerName(each.provider)}</span>
						<span className="shrink-0 tabular-nums text-ink-muted">{formatCompact(each.tokens)}</span>
						<span className="w-[42px] shrink-0 text-right text-detail tabular-nums text-ink-faint">
							{(each.share * 100).toFixed(0)}%
						</span>
					</div>
					<div className="mt-1 h-[5px] overflow-hidden rounded-full bg-ink/[0.06]">
						<div
							className="h-full rounded-full bg-info transition-[width] duration-[var(--ly-t-base)]"
							style={{ width: `${Math.max(1, each.share * 100)}%` }}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

function label(day: string | undefined): string {
	if (!day) return "";
	const [, month, date] = day.split("-");
	return `${Number(month)}/${Number(date)}`;
}

function tipFor(each: { day: string; tokens: number; cost: number }): string {
	const [, month, date] = each.day.split("-");
	const when = `${Number(month)}月${Number(date)}日`;
	if (each.tokens === 0) return `${when} · 没有使用`;
	const parts = [`${each.tokens.toLocaleString()} token`];
	if (each.cost > 0) parts.push(`$${each.cost.toFixed(4)}`);
	return `${when} · ${parts.join(" · ")}`;
}
