/**
 * The pull request list: what is in it, which of it you are looking at, and keeping both current.
 *
 * Fetching is one call for the whole list — across every signed-in account — and one more for
 * whichever row is open. The list call brings as much as each host will give up in a single
 * search; the description, the comments and the per-check names arrive with the detail, since
 * paying for those thirty times to decorate rows nobody clicked is how a list becomes slow to
 * open.
 *
 * It refreshes itself. The three rules that make that bearable rather than distracting live next
 * door in `pr-sync`: an unchanged row keeps its object so nothing re-renders, an unchanged detail
 * is not swapped in under the reader, and what did change is marked instead of announced.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PullRequestDetail, PullRequestSummary } from "../../../electron/ipc-types.ts";
import { prefetchAvatars } from "./avatar-cache.ts";
import { readDetail, readList, readSeen, rowId, writeDetail, writeList, writeSeen } from "./pr-cache.ts";
import { type Filter, groupFor } from "./pr-groups.ts";
import { reloadAccounts, useForgeAccounts } from "./useForgeAccounts.ts";
import { acknowledge, baseline, mergeLists, pruneSeen, sameDetail, sameSeen, unseenOf } from "./pr-sync.ts";
import { type RefreshReason, useLiveRefresh } from "./useLiveRefresh.ts";
import { bridge } from "../../services/index.ts";

export type { Filter, Group } from "./pr-groups.ts";

/**
 * Enough to find one pull request again: the account it was seen through, and where it lives.
 *
 * The account is not optional. `owner/name` collides across hosts, and every call made about a
 * pull request afterwards has to go back out through the token that could see it in the first
 * place.
 */
export interface PrRef {
	accountId: string;
	repo: string;
	number: number;
}

const sameRef = (a: PrRef, b: PrRef) => a.accountId === b.accountId && a.repo === b.repo && a.number === b.number;

/**
 * How often the list re-asks while it is on screen.
 *
 * The whole search costs one point of a five-thousand-point hourly budget, so the ceiling is not
 * the API — it is how often a person wants rows moving under them. Slower than a chat window,
 * faster than the time it takes to wonder whether this is up to date.
 */
const POLL_MS = 45_000;

/**
 * When the list last came back, shared by every mount of this hook.
 *
 * Module scope on purpose: what triggers a needless fetch is leaving this screen and coming back,
 * which unmounts it. Not persisted, because a fetch on the first visit after launch is one worth
 * making.
 */
let lastFetch = 0;
const FRESH_MS = 20_000;

/** Long enough to be seen, short enough that a row is not still glowing at the next refresh. */
const FLASH_MS = 1400;

/** One empty set, so "nothing is highlighted" is the same value every time. */
const NONE: Set<string> = new Set();

export function usePullRequests({
	/**
	 * Whether landing here should open the first row.
	 *
	 * True beside a detail pane, where leaving it blank wastes half the screen on nothing. False
	 * when the two are stacked and the list *is* the screen — choosing one there is a navigation,
	 * and doing it on the user's behalf means the pane opens on a pull request nobody asked for.
	 */
	autoSelect = true,
}: { autoSelect?: boolean } = {}) {
	const [items, setItems] = useState<PullRequestSummary[]>(readList);
	const [seen, setSeen] = useState<Record<string, string> | null>(readSeen);
	const [touched, setTouched] = useState<Set<string>>(NONE);
	const [error, setError] = useState<string | null>(null);
	/** What each account had to say for itself, so a tab can explain its own empty list. */
	const [accountErrors, setAccountErrors] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(false);

	const { accounts, ready: accountsReady } = useForgeAccounts();
	/**
	 * Which account's rows are shown. Null is all of them, which is the resting state.
	 *
	 * Not persisted. Whose work you are looking at follows what you are doing right now, and
	 * arriving at this screen filtered to one host because of something you did last Tuesday is
	 * the kind of stale state that reads as rows having disappeared.
	 */
	const [account, setAccount] = useState<string | null>(null);
	const [filter, setFilter] = useState<Filter>("all");
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<PrRef | null>(null);

	const [detail, setDetail] = useState<PullRequestDetail | null>(null);
	const [detailError, setDetailError] = useState<string | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	/** Bumped to re-read the open one without pretending the selection changed. */
	const [reload, setReload] = useState(0);

	/*
	 * What is on screen right now, readable from a callback that must not be rebuilt.
	 *
	 * The refresh runs on a timer created once; it needs the current list to compare against and
	 * the current selection to decide what counts as read, and depending on either would restart
	 * the timer on every keystroke in the search field.
	 */
	const shown = useRef(items);
	shown.current = items;
	const acked = useRef(seen);
	acked.current = seen;
	const open = useRef(selected);
	open.current = selected;
	const showing = useRef(detail);
	const flashTimer = useRef(0);

	useEffect(() => () => window.clearTimeout(flashTimer.current), []);

	/** One answer from GitHub, reconciled against what is already here. */
	const apply = useCallback((incoming: PullRequestSummary[]) => {
		/*
		 * Asked for on every answer, not only on a changed one.
		 *
		 * A picture that timed out during a cold start is the common case, and it belongs to a row
		 * that is not going to change again — so tying the retry to the list changing would mean it
		 * never happens. `avatar-cache` holds the window that stops this being a loop.
		 */
		prefetchAvatars(incoming);

		const merged = mergeLists(shown.current, incoming);
		if (merged.items !== shown.current) {
			shown.current = merged.items;
			setItems(merged.items);
			writeList(merged.items);
		}

		let next = acked.current === null ? baseline(merged.items) : pruneSeen(acked.current, merged.items);
		// Whatever is open is being read as this arrives, so it cannot also be unread — otherwise a
		// comment landing on the pull request you have in front of you marks it as news.
		const current = open.current;
		const row = current && merged.items.find((pr) => sameRef(current, pr));
		if (row) next = acknowledge(next, row);

		if (!sameSeen(acked.current, next)) {
			acked.current = next;
			setSeen(next);
			writeSeen(next);
		}

		if (merged.touched.size > 0) {
			setTouched(merged.touched);
			window.clearTimeout(flashTimer.current);
			flashTimer.current = window.setTimeout(() => setTouched(NONE), FLASH_MS);
		}
	}, []);

	const refresh = useCallback(
		async ({ stale = false } = {}) => {
			// Coming back to this screen is not a reason to ask again. The list is a few dozen pull
			// requests that change over hours, and returning to it seconds later already has the answer.
			if (stale && Date.now() - lastFetch < FRESH_MS) return;
			setLoading(true);
			try {
				const result = await bridge.git.myPullRequests();
				/*
				 * The accounts are re-read on the same beat.
				 *
				 * They carry the last failure per account, which is what a tab draws when its rows
				 * are missing — and an account added in settings while this pane was open should
				 * grow a tab here without anybody reloading anything.
				 */
				void reloadAccounts();
				setAccountErrors(result.errors ?? {});
				/*
				 * A failed refresh keeps what is already on screen.
				 *
				 * A total failure arrives as an empty list and a message, so replacing the rows
				 * unconditionally meant one expired token, one flaky network or one rate limit wiped a
				 * list that was still perfectly good — and now that this runs on a timer it would do it
				 * unprompted. A *partial* failure is not caught here: those rows are real, and the
				 * account that failed says so on its own tab.
				 */
				if (result.error && result.pullRequests.length === 0) {
					setError(result.error);
					return;
				}
				lastFetch = Date.now();
				setError(result.error ?? null);
				apply(result.pullRequests);
				// The open one is re-read on the same beat, so a pane left on screen is current in both
				// halves rather than only in the list.
				if (open.current) setReload((n) => n + 1);
			} finally {
				setLoading(false);
			}
		},
		[apply],
	);

	useEffect(() => {
		void refresh({ stale: true });
	}, [refresh]);

	useLiveRefresh(
		useCallback(
			(reason: RefreshReason) => {
				void refresh({ stale: reason === "wake" });
			},
			[refresh],
		),
		POLL_MS,
	);

	/*
	 * The detail for whatever is selected: shown from cache at once, then refreshed underneath.
	 *
	 * Blanking the pane before every fetch is what made switching rows feel slow even when the
	 * answer was already known. A pull request that has been opened before is drawn on the same
	 * frame as the click, and the request that follows only ever replaces it with something newer.
	 *
	 * `cancelled` matters here: clicking down a list faster than GitHub answers would otherwise
	 * leave whichever request happened to finish last on screen, which is not the one you clicked.
	 */
	useEffect(() => {
		if (!selected) {
			showing.current = null;
			setDetail(null);
			setDetailError(null);
			setDetailLoading(false);
			return;
		}
		let cancelled = false;
		const id = rowId(selected);

		// Only reach for the cache when what is on screen is not already this pull request: a
		// periodic re-read must not swap the reader back to an older copy of what they are reading.
		const already = showing.current;
		const start = already && rowId(already) === id ? already : readDetail(id);
		if (start !== already) {
			showing.current = start;
			setDetail(start);
		}
		setDetailError(null);
		// Only a pane with nothing in it is loading. With a copy up, the header's spinner carries the
		// refresh and the content stays readable throughout.
		setDetailLoading(!start);

		void bridge.git
			.pullRequest(selected.accountId, selected.repo, selected.number)
			.then((result) => {
				if (cancelled) return;
				if (result.detail) {
					writeDetail(id, result.detail);
					if (!showing.current || !sameDetail(showing.current, result.detail)) {
						showing.current = result.detail;
						setDetail(result.detail);
					}
					setDetailError(null);
					return;
				}
				// A failure with something already on screen is reported by leaving it there: the
				// cached review is still the truth as of the last time anyone could reach GitHub.
				if (!start) setDetailError(result.error ?? null);
			})
			.finally(() => {
				if (!cancelled) setDetailLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [selected, reload]);

	/*
	 * The account tab narrows the list before anything else looks at it.
	 *
	 * Ahead of the relation filter and the search, so both of those describe what is on screen
	 * rather than what exists — a count of "3 等你审查" under a tab showing one account has to be
	 * three in that account.
	 */
	const visible = useMemo(
		() => (account ? items.filter((pr) => pr.accountId === account) : items),
		[items, account],
	);
	const groups = useMemo(() => groupFor(visible, filter, query), [visible, filter, query]);
	const unseen = useMemo(() => unseenOf(items, seen), [items, seen]);

	useEffect(() => {
		if (!autoSelect || selected || groups.length === 0) return;
		const first = groups[0].items[0];
		// Not through `select`: nobody opened this one, so it is not one of the ones you have read.
		// The next refresh will record it, because by then it has been on screen the whole time.
		if (first) setSelected({ accountId: first.accountId, repo: first.repo, number: first.number });
	}, [autoSelect, groups, selected]);

	/**
	 * Opening a row is what marks it read — locally, and only here.
	 *
	 * GitHub has its own notion of read and it belongs to the website; reading a pull request in
	 * this app should not clear a notification badge somewhere else.
	 */
	const select = useCallback((pr: PullRequestSummary) => {
		setSelected((current) =>
			current && sameRef(current, pr) ? current : { accountId: pr.accountId, repo: pr.repo, number: pr.number },
		);
		const next = acknowledge(acked.current, pr);
		if (sameSeen(acked.current, next)) return;
		acked.current = next;
		setSeen(next);
		writeSeen(next);
	}, []);

	return {
		items,
		groups,
		unseen,
		touched,
		error,
		accountErrors,
		accounts,
		accountsReady,
		account,
		setAccount,
		loading,
		filter,
		setFilter,
		query,
		setQuery,
		selected,
		select,
		clearSelection: useCallback(() => setSelected(null), []),
		detail,
		detailError,
		detailLoading,
		refresh: useCallback(() => void refresh(), [refresh]),
		/** Re-read the open one, for after a comment or a review lands. */
		refreshDetail: useCallback(() => setReload((n) => n + 1), []),
	};
}
