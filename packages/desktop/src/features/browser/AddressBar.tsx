/**
 * The address bar, which is also the search box.
 *
 * Everything typed here used to be sent through `browserUrl`, so a word became a hostname and the
 * page came back `ERR_ADDRESS_UNREACHABLE`. What decides between the two lives in
 * `shared/browser.ts`; what is here is the part you can see — which of the two it will do, before
 * you commit to it, and the bookmarks that match what you have typed so far.
 */

import { translate } from "../../i18n/translate.ts";
import { Bookmark, CornerDownLeft, Globe, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { browserOmnibox, browserSearchLabel, type BrowserSearchSettings } from "../../../shared/browser.ts";
import { useApp } from "../../store/index.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";

interface Choice { kind: "open" | "search" | "bookmark"; url: string; label: string; detail?: string }

/** Bookmarks whose title or address contains what has been typed, minus the one already on top. */
function matchingBookmarks(query: string, bookmarks: { url: string; title: string }[], taken: string): Choice[] {
	const needle = query.toLowerCase();
	return bookmarks
		.filter((entry) => entry.url !== taken && (entry.title.toLowerCase().includes(needle) || entry.url.toLowerCase().includes(needle)))
		.slice(0, 4)
		.map((entry) => ({ kind: "bookmark" as const, url: entry.url, label: entry.title || entry.url, detail: entry.url }));
}

export function AddressBar({ url, bookmarks, search, onOpen, inputRef }: {
	/** The address of the page on screen; `about:blank` shows as an empty field. */
	url: string;
	bookmarks: { url: string; title: string }[];
	search: BrowserSearchSettings | undefined;
	onOpen: (url: string) => void;
	inputRef: React.RefObject<HTMLInputElement | null>;
}) {
	const settled = url === "about:blank" ? "" : url;
	const [value, setValue] = useState(settled);
	const [focused, setFocused] = useState(false);
	// Whether this text is the user's or the page's — a suggestion list over an untouched address
	// bar has nothing to suggest, and re-selecting the page's own address is not a suggestion.
	const [typed, setTyped] = useState(false);
	const [active, setActive] = useState(0);
	const listId = useRef(`ly-omnibox-${Math.random().toString(36).slice(2, 8)}`).current;
	// What was just submitted, held until the page reports it — otherwise the field flashes the
	// previous address for the length of the navigation, and keeps it if the navigation fails.
	const pending = useRef<string | null>(null);

	/*
	 * The page's address wins, except while it is being edited.
	 *
	 * A page that finishes loading — or one an agent navigates — publishes a new URL, and writing
	 * that into the field mid-word takes the sentence away from whoever was typing it.
	 */
	useEffect(() => {
		if (focused && typed) return;
		if (pending.current) {
			if (pending.current !== settled) return;
			pending.current = null;
		}
		setValue(settled);
		setTyped(false);
	}, [settled, focused, typed]);

	const target = useMemo(() => {
		if (!value.trim()) return null;
		try { return browserOmnibox(value, search); } catch { return null; }
	}, [value, search]);

	const engine = browserSearchLabel(search);
	const choices = useMemo<Choice[]>(() => {
		if (!typed || !value.trim()) return [];
		const head: Choice[] = target
			? [target.kind === "search"
				? { kind: "search", url: target.url, label: target.query, detail: translate("address.searchWith", { engine }) }
				: { kind: "open", url: target.url, label: target.url, detail: translate("address.openUrl") }]
			: [];
		return [...head, ...matchingBookmarks(value.trim(), bookmarks, head[0]?.url ?? "")];
	}, [typed, value, target, bookmarks, engine]);

	const open = focused && choices.length > 0;
	// Clamped rather than reset, so typing another letter keeps the row the arrow keys landed on.
	const index = Math.min(active, choices.length - 1);

	const go = (next: string) => {
		let resolved: string;
		try { resolved = browserOmnibox(next, search).url; }
		catch (error) { useApp.getState().notify(String(error), "error"); return; }
		pending.current = resolved;
		setValue(resolved === "about:blank" ? "" : resolved);
		setTyped(false);
		inputRef.current?.blur();
		onOpen(resolved);
	};
	const submit = () => {
		const choice = open ? choices[index] : undefined;
		go(choice ? (choice.kind === "search" ? choice.label : choice.url) : value);
	};

	return <div className="relative min-w-0 flex-1" data-browser-omnibox>
		<span aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" data-omnibox-kind={target?.kind ?? "empty"}>
			{target?.kind === "search" ? <Search size={12} /> : <Globe size={12} />}
		</span>
		<Input
			ref={inputRef}
			role="combobox"
			aria-label={translate("address.label")}
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={open ? `${listId}-${index}` : undefined}
			value={value}
			spellCheck={false}
			placeholder={translate("address.placeholder", { engine })}
			onChange={(event) => { setValue(event.target.value); setTyped(true); setActive(0); }}
			// Selected on arrival, so the next keystroke replaces the address instead of appending
			// to it — the one thing every other address bar does.
			onFocus={(event) => { setFocused(true); event.currentTarget.select(); }}
			onBlur={() => { setFocused(false); setTyped(false); if (!pending.current) setValue(settled); }}
			onKeyDown={(event) => {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					if (!open) return;
					event.preventDefault();
					setActive((current) => (Math.min(current, choices.length - 1) + (event.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length);
					return;
				}
				if (event.key === "Enter") { event.preventDefault(); submit(); return; }
				// Escape hands the field back to the page rather than leaving a half-typed address.
				if (event.key === "Escape") { setValue(settled); setTyped(false); inputRef.current?.blur(); }
			}}
			className="h-[26px] w-full rounded-md border border-line bg-input pl-7 pr-2.5 text-detail text-ink placeholder:text-ink-faint focus:border-ink-faint"
		/>
		{open && <div
			id={listId}
			role="listbox"
			aria-label={translate("address.suggestions")}
			data-omnibox-list
			/*
			 * Opaque, not frosted: the thing underneath is a `<webview>`, which composites outside
			 * this document, so `backdrop-filter` would sample an empty backdrop and blur nothing.
			 */
			className="ly-glass-solid absolute left-0 right-0 top-[30px] z-50 overflow-hidden rounded-[10px] border border-line py-1"
		>
			{choices.map((choice, position) => <div
				key={`${choice.kind}-${choice.url}`}
				id={`${listId}-${position}`}
				role="option"
				// Never focused in practice — the field keeps the focus and points here with
				// `aria-activedescendant` — but an option has to be focusable to be a valid one.
				tabIndex={-1}
				aria-selected={position === index}
				data-omnibox-choice={choice.kind}
				data-active={position === index ? "" : undefined}
				// Keeps the focus in the field: a blur first would unmount this row before its click.
				onMouseDown={(event) => event.preventDefault()}
				onMouseEnter={() => setActive(position)}
				onClick={() => { const next = choice.kind === "search" ? choice.label : choice.url; setValue(next); go(next); }}
				className={`flex cursor-default items-center gap-2 px-2.5 py-1.5 ${position === index ? "bg-card-hover" : ""}`}
			>
				<span className="shrink-0 text-ink-faint">
					{choice.kind === "search" ? <Search size={13} /> : choice.kind === "bookmark" ? <Bookmark size={13} /> : <Globe size={13} />}
				</span>
				{/*
				 * Two lines rather than two columns.
				 *
				 * Side by side, "用必应搜索" took 57 of the 99 pixels the row had for text — in a panel
				 * docked at its usual width, that left 40 for the query itself, so "天气 预报" arrived
				 * as "天气 …". The label is what was typed and cannot be the part that gets cut.
				 */}
				<span className="min-w-0 flex-1">
					<span data-omnibox-label className="block truncate text-detail text-ink">{choice.label}</span>
					{choice.detail && <span data-omnibox-detail className="block truncate text-caption text-ink-faint">{choice.detail}</span>}
				</span>
				{position === index && <CornerDownLeft size={12} className="shrink-0 text-ink-faint" />}
			</div>)}
		</div>}
	</div>;
}
