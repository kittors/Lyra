/**
 * Every check, not just how many passed.
 *
 * The header answers "is it green"; this answers "which one is not", which is the only question
 * anybody has once the answer to the first is no. It used to say `4 项全部通过` and stop there,
 * on the reasoning that the names were a click away on the web — but that click is the moment a
 * review tool hands you back to the browser, and the name of the one red check is the single most
 * useful string on the page.
 *
 * Ordered failures first, then pending, then passes. A list sorted the way GitHub returns it puts
 * the one thing you need somewhere in the middle of nineteen greens.
 */

import { Check, CircleDashed, ExternalLink, X } from "lucide-react";
import type { PullRequestCheck } from "../../../electron/ipc-types.ts";
import { bridge } from "../../services/index.ts";

const RANK: Record<PullRequestCheck["state"], number> = { fail: 0, pending: 1, pass: 2 };

const LOOK: Record<PullRequestCheck["state"], { icon: typeof Check; tone: string; label: string }> = {
	pass: { icon: Check, tone: "text-ok", label: "已通过" },
	fail: { icon: X, tone: "text-danger", label: "失败" },
	pending: { icon: CircleDashed, tone: "text-ink-faint", label: "进行中" },
};

export function PullRequestChecks({ checks }: { checks: PullRequestCheck[] | undefined }) {
	/*
	 * Tolerates a missing list rather than trusting the type.
	 *
	 * This is fed from a cache that outlives the code reading it — an entry written before checks
	 * carried their names has the summary and no list at all. TypeScript is describing what the
	 * server sends today; storage holds what it sent whenever the user last looked.
	 */
	const ordered = [...(checks ?? [])].sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name));

	if (ordered.length === 0) return <p className="px-1 text-detail text-ink-faint">这次没有拿到明细，刷新可以重新读取。</p>;

	return (
		<div className="flex flex-col">
			{ordered.map((check, index) => {
				const look = LOOK[check.state];
				return (
					<div
						key={`${check.name}-${index}`}
						className="group/check flex h-8 items-center gap-2.5 rounded-md px-1 transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover"
					>
						<look.icon size={13} strokeWidth={2.4} className={`shrink-0 ${look.tone}`} />
						<span className="min-w-0 flex-1 truncate text-label text-ink">{check.name}</span>

						{/*
						 * The link is only drawn on hover: twenty of them down the right-hand side is a
						 * column of icons competing with the names, and the name is what is being read.
						 */}
						{check.url && (
							<button
								type="button"
								data-ly-tip="查看这项检查"
								aria-label={`查看 ${check.name}`}
								onClick={() => void bridge.system.openExternal(check.url as string)}
								className="shrink-0 text-ink-faint opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/check:opacity-100 hover:text-ink"
							>
								<ExternalLink size={12} strokeWidth={1.9} />
							</button>
						)}

						<span className={`shrink-0 text-detail ${check.state === "pass" ? "text-ink-faint" : look.tone}`}>
							{look.label}
						</span>
					</div>
				);
			})}
		</div>
	);
}
