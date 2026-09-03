/**
 * The list of pull requests, grouped by why each one is there.
 *
 * A flat list sorted by date answers "what changed recently", which is not the question. The
 * question is "what is waiting on me" — so the groups are the relations, in the order they need
 * attention, and the filter above is the same three answers stated as a choice.
 *
 * Each group folds. Two of the three are usually background — what you already reviewed, what you
 * are waiting on — and a heading you can close is what lets somebody make this pane about the one
 * bucket they came for without losing the others. The state is kept, because it is a preference
 * about how you work rather than about this visit.
 */

import { ChevronRight, RefreshCw, Search, UserPlus } from "lucide-react";
import { useState } from "react";
import type { ForgeAccount, PullRequestSummary } from "../../../electron/ipc-types.ts";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { AccountTabs } from "./AccountTabs.tsx";
import { rowId } from "./pr-cache.ts";
import { PullRequestRow } from "./PullRequestRow.tsx";
import { ListSkeleton } from "./PullRequestSkeleton.tsx";
import type { Filter, Group } from "./usePullRequests.ts";

const FILTERS: { key: Filter; label: string }[] = [
	{ key: "all", label: "全部" },
	{ key: "reviewing", label: "正在审查" },
	{ key: "authored", label: "由我创建" },
];

const FOLD_KEY = "lyra.pull-requests.folded.v1";

function readFolded(): Set<string> {
	try {
		const raw = localStorage.getItem(FOLD_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : null;
		return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
	} catch {
		return new Set();
	}
}

export function PullRequestList({
	groups,
	filter,
	onFilter,
	query,
	onQuery,
	selected,
	onSelect,
	unseen,
	touched,
	loading,
	error,
	accountErrors,
	accounts,
	accountsReady,
	account,
	onAccount,
	onAddAccount,
	onRefresh,
}: {
	groups: Group[];
	filter: Filter;
	onFilter: (filter: Filter) => void;
	query: string;
	onQuery: (query: string) => void;
	selected: { accountId: string; repo: string; number: number } | null;
	/** Stable by contract — every row is memoised on it. */
	onSelect: (pr: PullRequestSummary) => void;
	/** Rows that have moved since they were last opened. */
	unseen: Set<string>;
	/** Rows the last refresh changed, highlighted once and then left alone. */
	touched: Set<string>;
	loading: boolean;
	error: string | null;
	/** Per account, so one expired token does not read as "you have no pull requests". */
	accountErrors: Record<string, string>;
	accounts: ForgeAccount[];
	/** False until the account list has actually been read — see the empty state below. */
	accountsReady: boolean;
	account: string | null;
	onAccount: (id: string | null) => void;
	onAddAccount: () => void;
	onRefresh: () => void;
}) {
	const [folded, setFolded] = useState<Set<string>>(readFolded);
	const empty = groups.length === 0;
	/*
	 * Nothing has been added yet, as opposed to nothing having arrived yet.
	 *
	 * Only true once the account list has actually come back. Before that the two are the same
	 * empty array, and showing a "sign in" screen for a quarter of a second on every launch — to
	 * somebody who signed in months ago — would be a worse lie than a blank pane.
	 */
	const signedOut = accountsReady && accounts.length === 0;
	/*
	 * A search sees everything.
	 *
	 * A hit inside a closed group is a row the person asked for and cannot see, and the fold is a
	 * preference about the resting state of the list rather than a filter of its own.
	 */
	const searching = query.trim().length > 0;

	const toggle = (key: string) =>
		setFolded((prev) => {
			const next = new Set(prev);
			if (!next.delete(key)) next.add(key);
			try {
				localStorage.setItem(FOLD_KEY, JSON.stringify([...next]));
			} catch {
				// Nowhere to keep it: the fold still works, it just opens fresh next launch.
			}
			return next;
		});

	/*
	 * With no account, the pane is the sign-in screen rather than an empty list above one.
	 *
	 * Filters, a search field and three empty headings, all inert, above one line of small grey
	 * text is a screen that looks broken. There is exactly one thing to do here and this is it.
	 */
	if (signedOut) return <SignedOut onAddAccount={onAddAccount} />;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/*
			 * Sits in the strip the shell reserves for the window controls, so it lines up with the
			 * sidebar's collapse button rather than starting a second row 44px below it.
			 *
			 * `no-drag` goes on the controls, never on this row. That strip is what moves the window,
			 * and a `no-drag` region is a hole punched in it — one on a full-width container is a
			 * hole the width of the column, which is how this view ended up with a title bar you
			 * could neither drag nor double-click to zoom. The row stays draggable; each control
			 * takes back only its own few pixels. `relative z-50` to come out from under the drag
			 * band, which covers the full width at z-40.
			 */}
			<div className="relative z-50 flex h-11 shrink-0 items-center px-3">
				<div className="no-drag flex items-center gap-0.5">
					{FILTERS.map((option) => (
						<button
							key={option.key}
							type="button"
							onClick={() => onFilter(option.key)}
							className={`h-[26px] shrink-0 rounded-lg px-2.5 text-label whitespace-nowrap transition-colors ${
								filter === option.key ? "bg-card-hover text-ink" : "text-ink-muted hover:text-ink"
							}`}
						>
							{option.label}
						</button>
					))}
				</div>

				<div className="flex-1" />
				<button
					type="button"
					data-ly-tip="刷新"
					aria-label="刷新"
					onClick={onRefresh}
					className="no-drag flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
				>
					<RefreshCw size={13} strokeWidth={1.8} className={loading ? "ly-spin" : undefined} />
				</button>
			</div>

			{/*
			 * Under the filters rather than beside them.
			 *
			 * They answer different questions — "as whom" and "which of mine" — and a 300px column
			 * cannot hold both on one line without one of them becoming an ellipsis. This one also
			 * disappears entirely for the single-account case, and a row that comes and goes is
			 * better at the edge of a group than in the middle of one.
			 */}
			<AccountTabs accounts={accounts} active={account} onSelect={onAccount} errors={accountErrors} />

			<div className="shrink-0 px-3 pt-1 pb-2">
				<label className="flex h-[32px] items-center gap-2 rounded-[9px] border border-line px-2.5 focus-within:border-ink-faint">
					<Search size={13} strokeWidth={1.9} className="shrink-0 text-ink-faint" />
					<input
						value={query}
						onChange={(event) => onQuery(event.target.value)}
						placeholder="搜索 Pull Request"
						spellCheck={false}
						className="min-w-0 flex-1 bg-transparent text-label text-ink placeholder:text-ink-faint focus:outline-none"
					/>
				</label>
			</div>

			<Scroller className="flex-1" contentClassName="px-2 pb-3">
				{/* `break-words`: these messages carry URLs and unspaced identifiers, and a long one
				    with nowhere to break widens the card past the pane it sits in. */}
				{error && (
					<p className="mx-1 mt-2 break-words rounded-[9px] border border-accent/35 bg-accent/8 px-3 py-2 text-detail leading-relaxed text-accent">
						{error}
					</p>
				)}

				{/*
				 * The skeleton is only for a genuinely cold pane. With rows already on screen from
				 * the cache, a refresh says so through the spinning arrow above and leaves the list
				 * alone — replacing readable rows with grey blocks would be a downgrade, not
				 * feedback.
				 */}
				{empty && !error && loading && <ListSkeleton />}

				{empty && !error && !loading && (
					<p className="px-3 py-16 text-center text-label text-ink-faint">
						{query
							? "没有匹配的 Pull Request"
							: accountErrors[account ?? ""]
								? accountErrors[account ?? ""]
								: account
									? "这个账号下没有和你有关的 Pull Request"
									: "没有和你有关的 Pull Request"}
					</p>
				)}

				{groups.map((group) => {
					const open = searching || !folded.has(group.key);
					return (
						<section key={group.key} className="pt-2 first:pt-1">
							<GroupHeading
								label={group.label}
								count={group.items.length}
								unseen={group.items.reduce((n, pr) => n + (unseen.has(rowId(pr)) ? 1 : 0), 0)}
								open={open}
								onToggle={() => toggle(group.key)}
							/>

							{/* Unfolds to its own height rather than appearing — same treatment as every
							    other foldable section in the app. */}
							<div className="ly-reveal" data-open={open} aria-hidden={!open}>
								<div>
									<div>
										{group.items.map((pr) => (
											<PullRequestRow
												key={rowId(pr)}
												pr={pr}
												active={
													selected?.accountId === pr.accountId &&
													selected.repo === pr.repo &&
													selected.number === pr.number
												}
												unseen={unseen.has(rowId(pr))}
												touched={touched.has(rowId(pr))}
												onSelect={onSelect}
											/>
										))}
									</div>
								</div>
							</div>
						</section>
					);
				})}
			</Scroller>
		</div>
	);
}

/**
 * The heading, which is also the fold.
 *
 * The count sits at the far end rather than beside the label: down a column of three headings the
 * numbers line up and can be read as a column, which is what makes "how much is waiting on me"
 * answerable at a glance. A closed group with unread rows says so, because otherwise folding one
 * is a way to stop being told about it.
 */
function GroupHeading({
	label,
	count,
	unseen,
	open,
	onToggle,
}: {
	label: string;
	count: number;
	unseen: number;
	open: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={open}
			className="group/head flex w-full items-center gap-1 rounded-md px-2 py-1 text-detail text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink-muted"
		>
			<span>{label}</span>
			<ChevronRight
				size={11}
				strokeWidth={2.4}
				className="shrink-0 transition-transform duration-[var(--ly-t-base)] ease-[var(--ly-e-out)]"
				style={{ transform: open ? "rotate(90deg)" : undefined }}
			/>
			<span className="flex-1" />
			{!open && unseen > 0 && (
				<span aria-hidden data-ly-tip={`折起来的这 ${unseen} 条有新动静`} className="h-[5px] w-[5px] rounded-full bg-accent" />
			)}
			<span className="tabular-nums opacity-60">{count}</span>
		</button>
	);
}

/**
 * What this pane is before anyone has signed in anywhere.
 *
 * One sentence about what it does, one about what it needs, one button. Naming the four hosts
 * matters more than it looks: this screen used to say "未安装 gh CLI（brew install gh）", which
 * told a GitLab user that the app did not work rather than that they were one token away.
 */
function SignedOut({ onAddAccount }: { onAddAccount: () => void }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* The strip the window controls live in, kept empty so this content clears them. */}
			<div className="h-11 shrink-0" />
			<div className="flex flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
				<p className="text-label text-ink">还没有添加代码托管账号</p>
				<p className="mt-2 max-w-[240px] text-detail leading-relaxed text-ink-faint">
					添加之后，这里会列出 GitHub、GitLab、Gitee、Gitea 上所有等你审查和由你创建的 Pull Request。
				</p>
				<button
					type="button"
					onClick={onAddAccount}
					className="mt-5 flex h-[30px] items-center gap-1.5 rounded-lg border border-line px-3 text-label text-ink-muted transition-colors hover:border-ink-faint hover:bg-card-hover hover:text-ink"
				>
					<UserPlus size={13} strokeWidth={1.8} />
					添加账号
				</button>
			</div>
		</div>
	);
}
