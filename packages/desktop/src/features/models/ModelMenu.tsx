import { Check, ChevronRight, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelIcon } from "./ModelIcon.tsx";
import { RollingText } from "../../ui/motion/RollingText.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { MenuBody, MenuItem, MenuSearch, MenuSeparator, Popover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { useApp } from "../../store/index.ts";
import { sessionThinking } from "../../lib/thinking.ts";
import {
	ambiguousNames,
	favouriteRows,
	filterGroups,
	flattenGroups,
	groupModels,
	toggleFavourite,
	type ModelRow,
} from "../../lib/model-grouping.ts";

export function formatWindow(tokens: number): string {
	if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
	if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
	return String(tokens);
}

/** How many rows the number keys reach, counting through the sections in drawing order. */
const SHORTCUTS = 4;

/**
 * How tall this menu may get.
 *
 * Deliberately its own number rather than the shared `MENU_MAX_HEIGHT`: with a search field pinned
 * above the list and two switches pinned below it, 340 leaves five rows visible. This leaves about
 * nine, which is enough to recognise a list rather than only to scroll one.
 */
const MODEL_MENU_MAX_HEIGHT = 420;

/**
 * Past this the list is something you search rather than something you read, and the field earns
 * the 36px it costs. Below it, a search box over six rows is furniture.
 */
const SEARCH_FROM = 8;

/**
 * Which provider groups are folded shut, remembered across launches.
 *
 * In `localStorage` rather than in settings: it is about what this window shows, like a sidebar
 * width, not about how the app runs — and it should not travel to the phone, where the same list
 * is a different length on a different screen.
 */
const COLLAPSED_KEY = "lyra.modelMenu.collapsed";

function storedCollapsed(): string[] {
	try {
		const raw = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]") as unknown;
		return Array.isArray(raw) ? raw.filter((each): each is string => typeof each === "string") : [];
	} catch {
		return [];
	}
}

/** One drawn block: the starred shortlist, or one provider. */
interface Section {
	key: string;
	title: string;
	rows: ModelRow[];
	/** The shortlist is not foldable — it is already the short version. */
	foldable: boolean;
}

export function ModelMenu({ anchor, onClose }: { anchor: Anchor; onClose: () => void }) {
	const settings = useApp((s) => s.settings);
	const meta = useApp((s) => s.meta);
	const setModel = useApp((s) => s.setModel);
	const setThinking = useApp((s) => s.setThinking);
	const saveSettings = useApp((s) => s.saveSettings);
	const setView = useApp((s) => s.setView);
	const setSection = useApp((s) => s.setSettingsSection);
	const [query, setQuery] = useState("");
	const [collapsed, setCollapsed] = useState<string[]>(storedCollapsed);

	const current = meta?.modelId ?? settings?.defaultModelId ?? null;
	const favourites = settings?.favoriteModelIds;
	const groups = useMemo(() => groupModels(settings?.providers), [settings?.providers]);
	const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
	/*
	 * Which names need their house said out loud.
	 *
	 * Computed over every group rather than the filtered ones: a search that happens to narrow to
	 * one of two identical names would otherwise drop the very mark that tells them apart.
	 */
	const clashes = useMemo(() => ambiguousNames(groups), [groups]);
	const total = useMemo(() => flattenGroups(groups).length, [groups]);
	/*
	 * Whether this list is long enough to be searched, which decides who owns the number keys.
	 *
	 * They cannot both have them. A search field takes focus the moment the menu opens, and model
	 * names are mostly version numbers — `claude-opus-4`, `gemini-3.7`, `grok-4.6` — so typing a
	 * digit is an ordinary way to start looking for one. While the shortcut also claimed them, the
	 * first digit of a query picked the model on that row and shut the menu, which does not make
	 * searching awkward so much as impossible: you never get to the second character.
	 *
	 * So the field wins wherever there is a field, and the digits are not drawn on the rows when
	 * they are not there to be pressed. A shortcut you cannot use is worse than no shortcut: it is
	 * the menu telling you about a key that does something else entirely.
	 */
	const searchable = total >= SEARCH_FROM;
	const fastMode = sessionThinking(meta, settings) === "off";
	const isDefault = settings?.defaultModelId === current;

	/*
	 * The shortlist, then the houses.
	 *
	 * Starred models are drawn twice on purpose — once at the top and once under the provider they
	 * belong to. Removing them from their group would make a group's count wrong and move rows
	 * around as you star things, which is the opposite of what a shortlist is for.
	 */
	const sections = useMemo<Section[]>(() => {
		const starred = query ? [] : favouriteRows(groups, favourites);
		return [
			...(starred.length > 0 ? [{ key: "__favourites__", title: "收藏", rows: starred, foldable: false }] : []),
			...shown.map((group) => ({
				key: group.provider.id,
				title: group.provider.name,
				rows: group.models.map((model) => ({ provider: group.provider, model })),
				foldable: true,
			})),
		];
	}, [groups, favourites, shown, query]);

	/** The rows a number key can reach: what is on screen, in the order it is drawn. */
	const reachable = useMemo(
		() => sections.filter((section) => !collapsed.includes(section.key)).flatMap((section) => section.rows),
		[sections, collapsed],
	);

	const choose = (modelId: string) => {
		void setModel(modelId);
		onClose();
	};

	const fold = useCallback((key: string) => {
		setCollapsed((current) => {
			const next = current.includes(key) ? current.filter((each) => each !== key) : [...current, key];
			try {
				window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
			} catch {
				/* A preference that cannot be stored is still a preference for this session. */
			}
			return next;
		});
	}, []);

	const star = useCallback(
		(id: string) => {
			if (!settings) return;
			void saveSettings({ ...settings, favoriteModelIds: toggleFavourite(settings.favoriteModelIds, id) });
		},
		[settings, saveSettings],
	);

	// Number keys pick from the first rows, matching the digits drawn on them.
	useEffect(() => {
		// A searchable list has given the digits to the field; see `searchable`.
		if (searchable) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			/*
			 * Anything being typed into owns what is typed into it.
			 *
			 * This used to read 「is the query non-empty」, which is a different question and false for
			 * the first character of every query — the field opens focused and empty, so the 「4」 of
			 * `claude-opus-4` picked the model on row four and shut the menu before a second character
			 * could be typed. `searchable` above is what settles the general case; this stays as the
			 * rule it was always meant to be, and covers any field a menu grows later.
			 */
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
			)
				return;
			const index = Number(event.key) - 1;
			if (!Number.isInteger(index) || index < 0 || index >= Math.min(SHORTCUTS, reachable.length)) return;
			event.preventDefault();
			choose(reachable[index].model.id);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	return (
		<Popover
			anchor={anchor}
			onClose={onClose}
			placement="top"
			align="start"
			width="wide"
			label="选择模型"
			/*
			 * A ceiling, so a relay with thirty models does not draw a menu from the composer to the
			 * top of the screen. The body scrolls inside it; the search field above and the switches
			 * below stay put, which is the whole reason they are in the other two slots.
			 *
			 * Higher than `MENU_MAX_HEIGHT`, and only here: this is the one menu with all three
			 * slots filled, so the shared 340 would leave about five rows between a search field
			 * and two switches — a list you can only read through a slot.
			 */
			maxHeight={MODEL_MENU_MAX_HEIGHT}
			header={
				searchable ? (
					<MenuSearch value={query} onChange={setQuery} placeholder="搜索模型或供应商" />
				) : undefined
			}
			footer={
				<div className="p-1">
					<MenuItem
						detail={meta ? "跳过推理直接作答，只影响当前会话" : "跳过推理直接作答，明显更快"}
						trailing={
							/*
							 * Indicator, not a control: the whole row is the switch. A real Toggle here
							 * would be a button inside a button — invalid markup, and the click would
							 * fire both handlers and cancel itself out.
							 */
							<span
								aria-hidden
								className={`mt-[3px] relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors duration-[var(--ly-t-base)] ${
									fastMode ? "bg-info" : "bg-line"
								}`}
							>
								<span
									className="absolute top-[3px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-[left] duration-[var(--ly-t-base)]"
									style={{ left: fastMode ? 17 : 3 }}
								/>
							</span>
						}
						onClick={() => {
							if (!settings) return;
							// Per conversation, like the level itself; `lastThinking` is what it restores.
							void setThinking(fastMode ? (settings.lastThinking ?? "medium") : "off");
						}}
					>
						关闭思考
					</MenuItem>
					<MenuItem
						trailing={<ChevronRight size={13} strokeWidth={2} className="shrink-0 text-ink-faint" />}
						onClick={() => {
							setView("settings");
							setSection("models");
							onClose();
						}}
					>
						<RollingText>管理供应商与模型</RollingText>
					</MenuItem>
				</div>
			}
		>
			<MenuBody>
				{total === 0 && (
					<MenuItem
						onClick={() => {
							setView("settings");
							setSection("models");
							onClose();
						}}
					>
						还没有可用模型，去添加供应商
					</MenuItem>
				)}

				{total > 0 && sections.length === 0 && (
					<p className="px-2 py-6 text-center text-detail text-ink-faint">没有匹配的模型</p>
				)}

				{sections.map((section) => {
					const folded = collapsed.includes(section.key);
					return (
						<div key={section.key}>
							<SectionHead
								title={section.title}
								count={section.rows.length}
								folded={folded}
								foldable={section.foldable}
								onFold={() => fold(section.key)}
							/>

							{!folded &&
								section.rows.map((row) => {
									const at = reachable.findIndex((each) => each.model.id === row.model.id);
									return (
										<ModelItem
											key={`${section.key}:${row.model.id}`}
											row={row}
											selected={current === row.model.id}
											starred={Boolean(favourites?.includes(row.model.id))}
											// Two houses offering one name: say which, on both rows.
											showProvider={clashes.has(row.model.name.trim().toLowerCase())}
											// Drawn only where the key it names actually does this; see `searchable`.
											shortcut={!searchable && !query && at >= 0 && at < SHORTCUTS ? at + 1 : null}
											onChoose={() => choose(row.model.id)}
											onStar={() => star(row.model.id)}
										/>
									);
								})}
						</div>
					);
				})}

				{current && (
					<>
						<MenuSeparator />
						{/*
						 * Making this the model new conversations start on, which picking one no
						 * longer does on its own.
						 *
						 * It used to be silent and automatic: trying a cheap model on one question
						 * re-aimed every conversation started afterwards, and nothing said so. Now
						 * it is a row you press, and it says what it already is.
						 */}
						<MenuItem
							icon={<Star size={13} strokeWidth={1.8} className={isDefault ? "fill-current" : ""} />}
							disabled={isDefault}
							onClick={() => {
								void setModel(current, { asDefault: true });
								onClose();
							}}
						>
							{isDefault ? "已是新会话的默认模型" : "设为新会话的默认模型"}
						</MenuItem>
					</>
				)}
			</MenuBody>
		</Popover>
	);
}

/**
 * A group's heading, which is also its fold.
 *
 * The count stays visible while folded — that is the only thing a shut group can say about
 * itself — and the chevron is the only mark that moves, so the row reads the same open or shut.
 */
function SectionHead({
	title,
	count,
	folded,
	foldable,
	onFold,
}: {
	title: string;
	count: number;
	folded: boolean;
	foldable: boolean;
	onFold: () => void;
}) {
	if (!foldable) {
		return (
			<div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-caption text-ink-faint">
				<Star size={10} strokeWidth={2} className="fill-current" />
				{title}
				<span className="text-ink-faint/70">{count}</span>
			</div>
		);
	}

	return (
		<button
			type="button"
			aria-expanded={!folded}
			onClick={onFold}
			className="ly-item flex w-full items-center gap-1.5 px-2 py-1 text-caption text-ink-faint hover:text-ink-muted"
		>
			<ChevronRight
				size={11}
				strokeWidth={2.4}
				className={`shrink-0 transition-transform duration-[var(--ly-t-quick)] ${folded ? "" : "rotate-90"}`}
			/>
			<span className="min-w-0 flex-1 truncate text-left">{title}</span>
			<span className="shrink-0 tabular-nums">{count}</span>
		</button>
	);
}

/**
 * One model.
 *
 * A row rather than a `MenuItem` because it holds two targets: choosing the model, and starring
 * it. A star inside the row's own button would be a button inside a button — invalid markup, and
 * a click that fires both handlers. So the fill belongs to the row and the two controls sit in it,
 * the same arrangement the session rows in the sidebar use.
 */
function ModelItem({
	row,
	selected,
	starred,
	showProvider,
	shortcut,
	onChoose,
	onStar,
}: {
	row: ModelRow;
	selected: boolean;
	starred: boolean;
	showProvider: boolean;
	shortcut: number | null;
	onChoose: () => void;
	onStar: () => void;
}) {
	const { model, provider } = row;

	return (
		/*
		 * `data-model` is the handle the end-to-end tests aim at, the same way session rows carry
		 * `data-ly-row`: a menu row is otherwise indistinguishable from the switches below it.
		 *
		 * `ly-scroll` is what makes the name read itself out on hover. The `ScrollText` below has
		 * always been able to — it measures its own overflow and lays out the second copy that makes
		 * the loop seamless — but the animation is keyed off a hovered ancestor carrying this class,
		 * and this row never carried it. So every name too long for the row simply sat there faded
		 * at the edge, with no way to see the rest of it: `claude-opus-4-…` and `claude-opus-4-…`
		 * being two different models you could not tell apart.
		 */
		<div data-model={model.id} className="ly-scroll ly-item group/model flex h-[28px] items-center">
			<button
				type="button"
				role="menuitem"
				data-selected={selected ? "true" : undefined}
				onClick={onChoose}
				className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2 text-left text-label"
			>
				{/* The house, not the provider: one relay serves models from five of them, so a
				    provider icon here would draw the same mark on every row. */}
				<span className="flex w-[18px] shrink-0 items-center justify-center">
					<ModelIcon model={model.modelId} name={model.name} size={14} />
				</span>
				<span className="min-w-0 flex-1">
					<ScrollText text={showProvider ? `${model.name} · ${provider.name}` : model.name} />
				</span>
				{/*
				 * The window, and nothing else.
				 *
				 * 「视觉 · 」 used to sit in front of it on every model that takes images, which is most
				 * of them — so it was four characters of near-constant text charged to the one column
				 * that is always short of room. The name is what tells two models apart and it was
				 * being truncated to pay for a word that rarely varies. Image support is still on the
				 * model in settings, where it is a property being managed rather than a label being
				 * skimmed.
				 */}
				<span className="shrink-0 font-mono text-caption text-ink-faint">
					{formatWindow(model.contextWindow)}
				</span>
			</button>

			{/*
			 * Two fixed columns, never one shared one.
			 *
			 * They were stacked at first — star on hover, digit otherwise — and that hid the digit
			 * on every starred row, so a menu whose first three rows were starred or selected drew
			 * a single 「4」 with nothing above it to count from. Two columns of reserved width
			 * cost 13px and make the numbering readable as a sequence.
			 */}
			<span className="flex h-full w-[13px] shrink-0 items-center justify-center">
				{selected ? (
					<Check size={13} strokeWidth={2.2} className="text-ink" />
				) : shortcut !== null ? (
					<span className="font-mono text-caption text-ink-faint">{shortcut}</span>
				) : null}
			</span>
			<button
				type="button"
				aria-label={starred ? `取消收藏 ${model.name}` : `收藏 ${model.name}`}
				aria-pressed={starred}
				data-ly-tip={starred ? "取消收藏" : "收藏"}
				onClick={onStar}
				className={`mr-1 ml-0.5 flex h-full w-[18px] shrink-0 items-center justify-center rounded transition-opacity duration-[var(--ly-t-quick)] ${
					starred
						? "text-accent opacity-100"
						: "text-ink-faint opacity-0 group-hover/model:opacity-100 hover:text-ink"
				}`}
			>
				<Star size={12} strokeWidth={1.9} className={starred ? "fill-current" : ""} />
			</button>
		</div>
	);
}
