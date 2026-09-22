/**
 * Modal to select and import discovered models from a provider's /v1/models endpoint.
 *
 * Mounted through `Overlay` like every other dialog in the app, and that is not a style preference.
 * This one used to draw its own `fixed inset-0` scrim in place, and the scrim stopped at the edge of
 * the settings content: the navigation column beside it stayed lit and clickable while the dialog
 * was open. `position: fixed` is only relative to the viewport when nothing above it has taken the
 * job of being the containing block — and a non-`none` `mask` takes it. Every `Scroller` in this
 * application carries one (`.ly-fade-y`), the settings page is two of them deep, so `inset-0`
 * resolved against the scroller rather than the window. `portal.ts` records the same trap from the
 * other direction, which is why the five floating surfaces all go to `document.body`.
 *
 * `Overlay` also brings what a hand-rolled scrim silently did without: Escape, a focus trap, focus
 * returned to where it came from, and an exit animation.
 */

import { translate } from "../../i18n/translate.ts";
import { ChoiceMark } from "../../ui/primitives/ChoiceMark.tsx";
import { useEffect, useMemo, useState } from "react";
import { ModelIcon } from "../models/index.ts";
import { DialogAction, DialogFrame } from "../../ui/overlay/Dialog.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { defaultWindowLabel } from "./model-defaults.ts";
import { useI18n } from "../../i18n/index.ts";

export function FetchModelsModal({
	open,
	models,
	existingModelIds,
	onClose,
	onImport,
}: {
	open: boolean;
	models: string[];
	existingModelIds: Set<string>;
	onClose: () => void;
	onImport: (selectedIds: string[]) => void;
}) {
	const { t } = useI18n();
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<Set<string>>(() => new Set());

	/*
	 * Default: everything not already in the list.
	 *
	 * In an effect rather than a `useState` initialiser, because that runs once for the life of the
	 * component and this list arrives from the network. It happens to work today — the parent only
	 * mounts this once a fetch has landed — but "correct as long as nobody mounts it earlier" is not
	 * something the next reader can see from here.
	 */
	useEffect(() => {
		setSelected(new Set(models.filter((m) => !existingModelIds.has(m))));
	}, [models, existingModelIds]);

	// Filter by search term
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return models;
		return models.filter((m) => m.toLowerCase().includes(q));
	}, [models, search]);

	/*
	 * Only rows that would actually be imported can be selected.
	 *
	 * An already-added model is dropped by `importDiscoveredModels`, so counting it here made the
	 * button promise a number it was not going to deliver — 「导入所选（33）」 adding nine.
	 */
	const selectable = useMemo(() => filtered.filter((m) => !existingModelIds.has(m)), [filtered, existingModelIds]);

	if (!open) return null;

	const allSelected = selectable.length > 0 && selectable.every((m) => selected.has(m));
	const someSelected = selectable.some((m) => selected.has(m));

	function toggleAll() {
		const next = new Set(selected);
		for (const m of selectable) {
			if (allSelected) next.delete(m);
			else next.add(m);
		}
		setSelected(next);
	}

	function toggle(id: string) {
		if (existingModelIds.has(id)) return;
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelected(next);
	}

	return (
		<Overlay onClose={onClose} width={520} label={t("fetchModels.title")}>
			{(dismiss) => (
				<DialogFrame
					title={(
						<span className="flex min-w-0 items-center gap-2">
							<span className="truncate">{t("fetchModels.title")}</span>
							<span className="shrink-0 rounded-full bg-card-hover px-2 py-0.5 text-micro font-medium text-ink-muted">
								{translate("fetchModels.totalCount", { n: models.length })}
							</span>
						</span>
					)}
					bodyClassName="min-h-[220px] max-h-[min(440px,48dvh)]"
					status={(
						<div className="flex items-center gap-2">
							<SearchField
								value={search}
								onChange={setSearch}
								placeholder={t("fetchModels.search")}
								size="comfortable"
								className="flex-1 bg-input"
								/*
								 * Escape 先清搜索，空了就关整张弹窗。
								 *
								 * 必须由这里转交：搜索框自己 `stopPropagation` 了那一下，而 `Overlay` 的
								 * Escape 挂在 `window` 上——事件根本到不了它。以前看不出来，是因为标题栏
								 * 右上角还有一颗 ✕ 排在搜索框前面，开场焦点落在那儿；那颗按钮没了之后，
								 * 焦点落进搜索框，Escape 就成了一个按不动的键。
								 */
								onEscape={() => dismiss()}
							/>
							{/*
							 * 全选说出自己的名字，并且跟搜索框同高同底。
							 *
							 * 它原先是一颗 32px 的圆角方块，里面单放一个勾选框——旁边的搜索框是 34px 的胶囊，于是这
							 * 两件东西高度差 2px、圆角差得更多，看上去不像一排控件，像一个勾选框飘在框边上。而一个
							 * 没有归属对象的勾选框本身就读不出意思：勾选框在这个界面里的含义由它左边那一行给，这一颗
							 * 左边什么都没有。tooltip 答得了「它叫什么」，但那要先把鼠标停上去——先得有理由停上去。
							 */}
							<button
								type="button"
								onClick={toggleAll}
								className="flex h-[var(--ly-control)] shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-field)] bg-input px-3.5 text-label text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
							>
								<ChoiceMark kind="checkbox" checked={allSelected} indeterminate={!allSelected && someSelected} />
								{allSelected ? t("common.deselectAll") : t("common.selectAll")}
							</button>
						</div>
					)}
					actions={(
						<>
							<span className="min-w-0 flex-1 truncate text-caption text-ink-muted">
								{t("fetchModels.selected", { n: selected.size })}
							</span>
							<DialogAction onClick={() => dismiss()}>{t("common.cancel")}</DialogAction>
							<DialogAction
								tone="primary"
								disabled={selected.size === 0}
								// Through `dismiss`, so the import runs on the way out rather than under a dialog
								// that is still on screen — see the completion note in `Overlay`.
								onClick={() => dismiss(() => onImport(Array.from(selected)))}
								className="tabular-nums"
							>
								{t("fetchModels.importSelected", { n: selected.size })}
							</DialogAction>
						</>
					)}
				>
					{/* 行的底色比字宽出去一点，字本身还跟标题左缘对齐。 */}
					<div className="-mx-2.5 space-y-0.5">
					{filtered.length === 0 ? (
						<div className="py-12 text-center text-caption text-ink-faint">{t("fetchModels.noMatch")}</div>
					) : (
						filtered.map((modelId) => {
							const checked = selected.has(modelId);
							const isExisting = existingModelIds.has(modelId);
							/*
							 * 一行就是一行，不是一张卡片。
							 *
							 * 每行原先自带描边和底色，于是三十三个模型是三十三张摞起来的卡片；默认又是「全选」，那
							 * 三十三张卡片同时亮成描边的蓝色——最该看清的是名字，而满屏在说的是边框。
							 *
							 * 选中也不染整行，这一条是拍了图才决定的：这一页打开时就是全选，三十三行一起上色等于
							 * 没上色——一种状态铺满全屏的时候它区分不出任何东西，只是把白底换成了蓝底。勾选框本来
							 * 就是说这件事的，一列蓝勾对着一列名字，比三十三块蓝底清楚。底色留给指针底下那一格：
							 * 那是「你正在看这一行」，同一时刻只有一行成立。
							 */
							return (
								<label
									key={modelId}
									className={`group flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors select-none ${
										isExisting ? "cursor-default opacity-50" : "cursor-pointer hover:bg-card-hover"
									}`}
								>
									<div className="flex items-center gap-3 min-w-0 pr-2">
										{/* An already-added model cannot be imported again, so it cannot be chosen either —
										    otherwise the count in the footer promises rows the import will drop. */}
										<button
											type="button"
											disabled={isExisting}
											aria-checked={checked}
											role="checkbox"
											onClick={(e) => {
												e.stopPropagation();
												toggle(modelId);
											}}
											className="shrink-0 text-ink-muted focus:outline-none cursor-pointer disabled:cursor-default"
										>
											<ChoiceMark kind="checkbox" checked={checked} />
										</button>
										<ModelIcon model={modelId} size={16} />
										<div className="min-w-0">
											<div className="flex items-center gap-1.5">
												<span className="font-mono text-label text-ink truncate">{modelId}</span>
												{isExisting && (
													<span className="shrink-0 rounded bg-ink-faint/10 px-1 py-0.2 text-micro text-ink-faint">
														{translate("fetchModels.added")}
													</span>
												)}
											</div>
										</div>
									</div>
									{/* What the import will actually write, from the same constant it writes it from.
									    This used to be the literal string "200K" on every row — see `model-defaults.ts`. */}
									<span className="shrink-0 text-caption text-ink-faint font-mono">{defaultWindowLabel()}</span>
								</label>
							);
						})
					)}
					</div>
				</DialogFrame>
			)}
		</Overlay>
	);
}
