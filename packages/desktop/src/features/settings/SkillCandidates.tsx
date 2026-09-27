import type { SkillCandidate } from "@lyra/core";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";

import { useI18n } from "../../i18n/index.ts";
import { Collapse } from "../../ui/layout/Collapse.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Markdown } from "../conversation/index.ts";

/** How many show before the rest are folded away. */
const SHOWN = 3;

/**
 * Skills drawn out of recent conversations, waiting for someone to say yes.
 *
 * Above the list rather than in it: none of these is in effect yet, and every row below is. An
 * approved one changes what the agent does in every later session, and the person who sees that
 * happen will not remember approving anything — so the whole point of this block is that the
 * approval really happened.
 *
 * It used to make that point by printing every candidate's full body as raw markdown in a scrolling
 * box — eleven candidates, eleven walls of `## 验证与失败处理` and `1.` and backticks, before the
 * first button. Nobody read that; they scrolled past it. So each candidate is now what it is for —
 * its name, the one line the model decides by, where it came from — and the body is one click away,
 * *rendered*: headings as headings, steps as a list, which is the form in which it can actually be
 * read before it is approved.
 */
export function SkillCandidates({
	candidates,
	onDecide,
}: {
	candidates: SkillCandidate[];
	onDecide: (name: string, keep: boolean) => Promise<void>;
}) {
	const { t } = useI18n();
	/*
	 * The first few, and the rest a click away. Twelve at once pushed the skills that are actually
	 * in effect a screen and a half down the page — this block is a to-do list, and a to-do list
	 * that is taller than the page it sits on stops being read from the top.
	 */
	const [all, setAll] = useState(false);
	const first = candidates.slice(0, SHOWN);
	const rest = candidates.slice(SHOWN);
	return (
		<section className="ly-swap-in mb-6 overflow-hidden rounded-[12px] bg-accent/6" data-skill-candidates="">
			<header className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
				<span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
					<Sparkles size={14} strokeWidth={1.9} aria-hidden />
				</span>
				<div className="min-w-0">
					<h3 className="text-label font-medium text-ink">{t("skillsSettings.pending", { n: candidates.length })}</h3>
					<p className="text-detail text-ink-muted">{t("skillsSettings.pendingDetail")}</p>
				</div>
			</header>
			<ul className="px-2 pb-2 pl-[46px]">
				{first.map((candidate, index) => (
					<Candidate key={candidate.name} candidate={candidate} index={index} onDecide={onDecide} />
				))}
			</ul>
			{rest.length > 0 && (
				<>
					<Collapse open={all}>
						<ul className="px-2 pb-2 pl-[46px]">
							{rest.map((candidate) => (
								<Candidate key={candidate.name} candidate={candidate} index={0} onDecide={onDecide} />
							))}
						</ul>
					</Collapse>
					<button
						type="button"
						aria-expanded={all}
						onClick={() => setAll((was) => !was)}
						className="flex w-full items-center justify-center gap-1 border-t border-accent/10 py-2.5 text-detail text-accent transition-colors duration-[var(--ly-t-quick)] hover:bg-accent/6"
					>
						{all ? t("common.collapse") : t("skillsSettings.showAll", { n: candidates.length })}
						<ChevronDown size={13} strokeWidth={2} aria-hidden className={`transition-transform duration-[var(--ly-t-base)] ease-[var(--ly-e-out)] ${all ? "rotate-180" : ""}`} />
					</button>
				</>
			)}
		</section>
	);
}

function Candidate({
	candidate,
	index,
	onDecide,
}: {
	candidate: SkillCandidate;
	index: number;
	onDecide: (name: string, keep: boolean) => Promise<void>;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState<"keep" | "drop" | null>(null);
	const decide = async (keep: boolean) => {
		setBusy(keep ? "keep" : "drop");
		try {
			await onDecide(candidate.name, keep);
		} finally {
			setBusy(null);
		}
	};
	const origin = `${candidate.scope === "portable" ? t("skills.reusable") : t("skills.candidates")}${
		candidate.sourceSessions ? t("skills.fromSessions", { n: candidate.sourceSessions.length }) : ""
	}`;

	return (
		<li className="ly-rise-in group/candidate rounded-lg transition-colors duration-[var(--ly-t-quick)] hover:bg-accent/5" style={{ "--ly-i": index } as React.CSSProperties}>
			<div className="relative flex items-start gap-3 px-2 py-2.5">
				{/* The row itself opens the preview; the buttons on it sit above this and take their own clicks. */}
				<button type="button" aria-expanded={open} aria-label={candidate.name} onClick={() => setOpen((was) => !was)} className="absolute inset-0 rounded-lg" />
				<div className="pointer-events-none relative min-w-0 flex-1">
					<div className="truncate font-mono text-label text-ink">{candidate.name}</div>
					<p className="mt-0.5 line-clamp-2 text-detail leading-relaxed text-ink-muted">{candidate.description}</p>
					<p className="mt-1 text-caption text-ink-faint">{origin}</p>
				</div>
				{/*
				 * 预览 and 不要 wait for the pointer (or focus): twelve rows of three buttons was a column of
				 * thirty-six things to read past. 启用 stays — it is the decision this list exists for — and
				 * an open row keeps all three, since that is a row somebody is in the middle of.
				 */}
				<div className="relative flex shrink-0 items-center gap-1.5 pt-0.5">
					<div
						data-held={open || busy !== null || undefined}
						className="flex items-center gap-1.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/candidate:opacity-100 focus-within:opacity-100 data-[held]:opacity-100"
					>
					<button
						type="button"
						aria-expanded={open}
						onClick={() => setOpen((was) => !was)}
						className="flex h-[28px] items-center gap-1 rounded-lg px-2.5 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink aria-expanded:text-ink"
					>
						{open ? t("common.hide") : t("common.preview")}
						<ChevronDown
							size={13}
							strokeWidth={2}
							aria-hidden
							className={`transition-transform duration-[var(--ly-t-base)] ease-[var(--ly-e-out)] ${open ? "rotate-180" : ""}`}
						/>
					</button>
					<Button variant="subtle" size="sm" loading={busy === "drop"} disabled={busy !== null} onClick={() => void decide(false)}>
						{t("skillsSettings.reject")}
					</Button>
					</div>
					{/* In the accent rather than black: a column of twelve solid black buttons was the heaviest thing on the page. */}
					<Button
						variant="subtle"
						size="sm"
						loading={busy === "keep"}
						disabled={busy !== null}
						onClick={() => void decide(true)}
						icon={<Check size={13} strokeWidth={2.2} aria-hidden />}
						className="bg-accent/12 font-medium text-accent hover:bg-accent/20 hover:text-accent"
					>
						{t("common.enable")}
					</Button>
				</div>
			</div>
			<Collapse open={open}>
				<Scroller className="mx-2 mb-2.5 max-h-[320px] rounded-lg bg-shell/70" contentClassName="px-4 py-3" overscroll="auto">
					<Markdown text={candidate.body} className="text-label" />
				</Scroller>
			</Collapse>
		</li>
	);
}
