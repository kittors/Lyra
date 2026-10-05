/**
 * The model settings page: a list of providers on one side, the selected one on the other.
 *
 * Only the layout lives here. What editing a provider actually does — and the consequences that
 * are easy to miss, like a removed provider orphaning the default model — is in `useProviders`,
 * and what a provider looks like is in `ProviderEditor`. Three files, three questions.
 *
 * The list and the editor share one settings card, split by a rule; the editor's own sections are
 * the same titled cards every other settings page is made of.
 */

import { useI18n } from "../../i18n/index.ts";
import type { ModelConfig } from "@lyra/core";
import { Download, MoreHorizontal, Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { DialogAction } from "../../ui/overlay/Dialog.tsx";
import { MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Card } from "./layout.tsx";
import { FetchModelsModal } from "./FetchModelsModal.tsx";
import { ModelEditor } from "./ModelEditor.tsx";
import { ProviderAvatar } from "./ProviderAvatar.tsx";
import { ProviderEditor } from "./ProviderEditor.tsx";
import { ProviderImportModal } from "./ProviderImportModal.tsx";
import { useProviders } from "./useProviders.ts";
import { useProviderTransfer } from "./useProviderTransfer.ts";

export function ModelSettings() {
	const { t } = useI18n();
	const p = useProviders();
	const transfer = useProviderTransfer();
	const confirm = useConfirmer();
	const transferMenu = usePopover();
	const fileRef = useRef<HTMLInputElement>(null);
	const [editingModel, setEditingModel] = useState<{
		providerId: string;
		model: ModelConfig | null;
	} | null>(null);

	return (
		// Keep the provider editor usable when a short window cannot fit its minimum height.
		<Scroller className="flex-1" contentClassName="flex flex-col">
			<header className="flex shrink-0 items-start justify-between gap-4 pt-2 pb-6">
				<div>
					<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">
						{t("modelSettings.title")}
					</h1>
					<p className="mt-2 text-label text-ink-muted">
						{t("modelSettings.intro")}
					</p>
				</div>
				{/*
				 * Carrying the list to another machine is something done once a year, so it goes
				 * behind ⋯ with its words spelled out — as two bare arrows it was a guess which one
				 * imports. Testing moved next to the key it tests.
				 */}
				<div className="mt-1 flex shrink-0 items-center gap-1.5">
					<IconButton
						label={t("common.more")}
						menu={transferMenu.open}
						onClick={transferMenu.toggle}
						className="aria-expanded:bg-card-hover aria-expanded:text-ink"
						icon={<MoreHorizontal size={16} strokeWidth={1.8} />}
					/>
					{/* 添加供应商放在页面右上角：列表底部那颗会被一长串供应商挤出视野。 */}
					<DialogAction tone="primary" onClick={() => void p.add()} data-ly-add-provider="">
						<Plus size={14} strokeWidth={2} aria-hidden />
						{t("modelSettings.addProvider")}
					</DialogAction>
				</div>

				{transferMenu.open && (
					<Popover anchor={transferMenu.anchor} onClose={transferMenu.close} placement="bottom" align="end" width="compact" role="menu" label={t("common.more")}>
						<MenuBody>
							<MenuItem
								icon={<Upload size={13} strokeWidth={1.8} />}
								onClick={() => {
									transferMenu.close();
									fileRef.current?.click();
								}}
							>
								{t("providerTransfer.importTip")}
							</MenuItem>
							<MenuItem
								icon={<Download size={13} strokeWidth={1.8} />}
								disabled={!transfer.canExport}
								onClick={() => {
									transferMenu.close();
									confirm.ask({
										title: t("providerTransfer.exportConfirm"),
										detail: t("providerTransfer.exportConfirmDetail"),
										confirmLabel: t("providerTransfer.exportAction"),
										onConfirm: transfer.exportAll,
									});
								}}
							>
								{t("providerTransfer.exportTip")}
							</MenuItem>
						</MenuBody>
					</Popover>
				)}

				{/* Reset after every pick, or choosing the same file twice fires no change event. */}
				<input
					ref={fileRef}
					type="file"
					accept="application/json,.json"
					hidden
					onChange={(e) => {
						const file = e.target.files?.[0];
						e.target.value = "";
						if (file) void transfer.offer(file);
					}}
				/>
			</header>

			{/*
			 * Side by side when there is room, stacked when there is not.
			 *
			 * The list used to be a fixed 268px that never gave any of it back, so in a narrow
			 * window the editor beside it was left with whatever remained — at 420px that was
			 * 70px, and every field became a slot with one character in it. Measured against
			 * this container rather than the window, because the settings pane is the full width
			 * of a narrow window and a fraction of a wide one.
			 *
			 * From `@xl` (576px) rather than `@2xl`: at 672 a window about a thousand pixels wide stacked
			 * the two with its settings navigation open and put them side by side with it closed, so the
			 * page rearranged every time the navigation was toggled. At 576 the editor still keeps about 340px
			 * — every field fits, a long model name truncates first — and that window stays side by side
			 * either way.
			 */}
			{/* The query element and the queried element cannot be the same one: a container is
			    sized by its contents, so it is only ever asked about by its descendants. */}
			<div className="@container flex min-h-[340px] flex-1">
				<Card className="mb-6 flex min-h-0 flex-1 flex-col @xl:flex-row" data-ly-provider-panes="">
					{/* Each pane scrolls on its own, so a long provider list never moves the editor. */}
					{/* The rule between the panes runs the card's full height, so the padding lives in each pane rather than on the card. */}
					<Scroller
						className="max-h-[168px] shrink-0 border-b border-line-soft @xl:max-h-none @xl:w-[232px] @xl:border-r @xl:border-b-0"
						contentClassName="flex flex-col gap-0.5 p-3"
					>
						{p.providers.map((provider) => (
							<button
								key={provider.id}
								type="button"
								onClick={() => p.select(provider.id)}
								aria-current={p.selected?.id === provider.id ? "true" : undefined}
								// Picked with a fill, not an outline — an outline is one more line on a page that had too many.
								className={`flex h-9 w-full shrink-0 items-center gap-2.5 rounded-lg pr-2.5 pl-2 text-left transition-colors ${
									p.selected?.id === provider.id ? "bg-card-hover" : "hover:bg-card-hover/50"
								}`}
							>
								<ProviderAvatar name={provider.name} size="sm" className={provider.enabled ? "" : "opacity-50"} />
								<ScrollText
									text={provider.name}
									className={`min-w-0 flex-1 text-label ${provider.enabled ? "text-ink" : "text-ink-muted"}`}
								/>
								{provider.enabled ? (
									<span className="h-[6px] w-[6px] shrink-0 rounded-full bg-ok" />
								) : (
									<span className="shrink-0 text-caption text-ink-faint">{t("common.disabled")}</span>
								)}
							</button>
						))}
					</Scroller>

					<Scroller className="min-w-0 flex-1" contentClassName="p-4 @xl:px-6 @xl:py-5">
						{!p.selected ? (
							<div className="flex h-full flex-col items-center justify-center gap-3 text-center">
								<p className="text-label text-ink-muted">
									{t("modelSettings.noProviders")}
								</p>
								<DialogAction tone="primary" onClick={() => void p.add()} data-ly-add-provider="">
									<Plus size={14} strokeWidth={2} aria-hidden />
									{t("modelSettings.addFirst")}
								</DialogAction>
							</div>
						) : (
							/*
							 * Keyed, so switching provider resets the fields rather than carrying them over.
							 *
							 * The import counter is in the key for the same reason, and it is not decoration:
							 * an import replaces the provider under the same id, so nothing about the key
							 * changes and the URL and API Key boxes — which read their initial value once, on
							 * mount — go on showing what was there before. The file said one thing, the form
							 * says another, and the form is the one being read.
							 */
							<ProviderEditor
								key={`${p.selected.id}:${transfer.imports}`}
								provider={p.selected}
								defaultModelId={p.defaultModelId}
								testResult={p.testResult}
								testing={p.testing}
								testingModelId={p.testingModelId}
								modelTestResults={p.modelTestResults}
								fetchingModels={p.fetchingModels}
								fetchModelsError={p.fetchModelsError}
								onFetchModels={() => void p.fetchModelsFromEndpoint()}
								onTest={() => void p.test()}
								onTestModel={(modelId) => void p.test(modelId)}
								onChange={(patch) => void p.update(p.selected!.id, patch)}
								onRemove={() => void p.remove(p.selected!.id)}
								onEditModel={(model) =>
									setEditingModel({ providerId: p.selected!.id, model })
								}
								onRemoveModel={(modelId) =>
									void p.removeModel(p.selected!.id, modelId)
								}
								onSetDefault={(modelId) => void p.setDefaultModel(modelId)}
							/>
						)}
					</Scroller>
				</Card>
			</div>


			{editingModel && (
				<ModelEditor
					provider={
						p.providers.find((provider) => provider.id === editingModel.providerId) ?? {
							id: editingModel.providerId,
							baseUrl: "",
						}
					}
					model={editingModel.model}
					onCancel={() => setEditingModel(null)}
					onSave={(model) => {
						void p.saveModel(editingModel.providerId, model, editingModel.model);
						setEditingModel(null);
					}}
				/>
			)}

			{p.discoveredModels && (
				<FetchModelsModal
					open={Boolean(p.discoveredModels)}
					models={p.discoveredModels}
					existingModelIds={new Set(p.selected?.models.map((m) => m.modelId) ?? [])}
					onClose={p.closeDiscoveredModal}
					onImport={(selectedIds) => void p.importDiscoveredModels(selectedIds)}
				/>
			)}

			{transfer.pending && (
				<ProviderImportModal
					entries={transfer.pending.entries}
					dropped={transfer.pending.dropped}
					onCancel={transfer.cancelImport}
					onImport={(chosen) => void transfer.confirmImport(chosen)}
				/>
			)}

			{confirm.element}
		</Scroller>
	);
}
