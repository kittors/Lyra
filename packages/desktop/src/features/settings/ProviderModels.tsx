/**
 * The models one provider offers.
 *
 * Separate from the provider's own fields because they answer different questions. The fields
 * above are "how do I reach this thing"; this is "what can it do" — which is also the order you
 * fill them in, and the part you come back to later.
 */

import { CircleAlert, CloudDownload, Image, Lightbulb, MoreHorizontal, Pencil, Play, Plus, Star, Trash2, Wrench } from "lucide-react";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import type { ModelConfig } from "@lyra/core";
import type { ProviderTestResult } from "../../../electron/ipc-types.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { MenuBody, MenuItem, MenuSeparator, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { ModelIcon } from "../models/index.ts";
import { formatWindow } from "../models/index.ts";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Badge } from "./controls.tsx";
import { Card } from "./layout.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { useI18n, type MessageKey } from "../../i18n/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";

export function ProviderModels({
	models,
	defaultModelId,
	testing,
	testingModelId,
	modelTestResults,
	fetchingModels,
	fetchModelsError,
	onFetchModels,
	onTestModel,
	onEdit,
	onRemove,
	onSetDefault,
}: {
	models: ModelConfig[];
	defaultModelId: string | null;
	/** The provider's own connection test, which a fetch should not race. */
	testing: boolean;
	testingModelId?: string | null;
	modelTestResults?: Record<string, ProviderTestResult>;
	fetchingModels?: boolean;
	fetchModelsError?: string | null;
	onFetchModels?: () => void;
	onTestModel?: (modelId: string) => void;
	/** `null` adds a new one. */
	onEdit: (model: ModelConfig | null) => void;
	onRemove: (modelId: string) => void;
	onSetDefault: (modelId: string) => void;
}) {
	const { t } = useI18n();
	return (
		<section className="pt-7">
			{/* `SectionTitle`'s size and spacing, with room on the line for the two actions. */}
			<div className="mb-3 flex h-7 items-center gap-1">
				<Text as="h2" size="title" weight="semibold">{t("providerModels.list")}</Text>
				{models.length > 0 && <span className="ml-1 text-caption text-ink-faint tabular-nums">{models.length}</span>}
				<span className="flex-1" />
				{/*
				 * Both carry words and neither draws a frame: `subtle` exists for a row of actions like this.
				 * The words are there because nobody guesses that a cloud-download icon means "fetch models";
				 * the tooltip keeps only the explanation that the icon and the label together cannot give.
				 */}
				{onFetchModels && (
					<Button
						variant="subtle"
						size="sm"
						onClick={onFetchModels}
						disabled={fetchingModels || testing}
						label={t("providerModels.fetchDetail")}
						icon={fetchingModels
							? <ActionSpinner size={13} className="text-accent" />
							: <CloudDownload size={13.5} strokeWidth={1.8} aria-hidden />}
					>
						{fetchingModels ? t("providerModels.fetching") : t("providerModels.fetch")}
					</Button>
				)}
				<Button variant="subtle" size="sm" onClick={() => onEdit(null)} icon={<Plus size={13.5} strokeWidth={1.9} aria-hidden />} data-ly-add-model="">
					{t("providerModels.add")}
				</Button>
			</div>

			{fetchModelsError && (
				<div className="mb-2 flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-caption text-danger">
					<CircleAlert size={13} className="shrink-0" />
					<span className="truncate">{fetchModelsError}</span>
				</div>
			)}

			<Card data-ly-model-list="">
				{models.length > 0 ? (
					models.map((model) => (
						<ModelRow
							key={model.id}
							model={model}
							isDefault={defaultModelId === model.id}
							testing={testingModelId === model.id}
							testResult={modelTestResults?.[model.id]}
							onTest={() => onTestModel?.(model.id)}
							onEdit={() => onEdit(model)}
							onRemove={() => onRemove(model.id)}
							onSetDefault={() => onSetDefault(model.id)}
						/>
					))
				) : (
					<p className="px-4 py-6 text-center text-label text-ink-muted">{t("providerModels.empty")}</p>
				)}
			</Card>
		</section>
	);
}

/*
 * What a model can do, as three marks in a fixed-width column so the context sizes after it line
 * up down the list whichever of them a row has.
 */
const CAPABILITIES: { has: (model: ModelConfig) => boolean; label: MessageKey; Icon: typeof Lightbulb; tone: string }[] = [
	{ has: (m) => m.supportsThinking, label: "modelEditor.thinking", Icon: Lightbulb, tone: "bg-violet/12 text-violet" },
	{ has: (m) => m.supportsImages, label: "modelEditor.images", Icon: Image, tone: "bg-ok/12 text-ok" },
	{ has: (m) => m.supportsTools, label: "modelEditor.toolCalls", Icon: Wrench, tone: "bg-info/12 text-info" },
];

function ModelRow({
	model,
	isDefault,
	testing,
	testResult,
	onTest,
	onEdit,
	onRemove,
	onSetDefault,
}: {
	model: ModelConfig;
	isDefault: boolean;
	testing: boolean;
	testResult?: ProviderTestResult;
	onTest: () => void;
	onEdit: () => void;
	onRemove: () => void;
	onSetDefault: () => void;
}) {
	const { t } = useI18n();
	const confirm = useConfirmer();
	const menu = usePopover();
	const alias = model.name && model.name !== model.modelId ? model.name : null;

	return (
		// Ruled like `Row` on the other pages; the hover fills edge to edge, as `ListRow` does inside a card.
		<div className="group/row border-b border-line-soft transition-colors last:border-b-0 hover:bg-card-hover">
			<div className="flex h-12 items-center gap-3 pr-2 pl-4">
				{/* The whole name is the way in to editing; the two buttons at the end are the only other doors. */}
				<button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left" data-ly-model-row={model.modelId}>
					<span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-card">
						<ModelIcon model={model.modelId} name={model.name} size={13} />
					</span>
					<ScrollText text={model.modelId} className="min-w-0 shrink font-mono text-label text-ink" />
					{alias && <span className="min-w-0 shrink-[2] truncate text-detail text-ink-muted">{alias}</span>}
					{isDefault && <Badge tone="accent">{t("common.default")}</Badge>}
				</button>

				{testResult && !testing && (
					<span
						data-ly-tip={`${testResult.ok ? t("providerModels.testPassed") : t("providerModels.testFailed")} · ${testResult.message}`}
						className={`flex shrink-0 items-center gap-1.5 font-mono text-caption tabular-nums ${testResult.ok ? "text-ink-muted" : "text-danger"}`}
					>
						<span className={`h-1.5 w-1.5 rounded-full ${testResult.ok ? "bg-ok" : "bg-danger"}`} />
						{testResult.ok
							? testResult.latencyMs > 0 ? `${testResult.latencyMs}ms` : t("providerModels.testPassed")
							: t("providerModels.testFailed")}
					</span>
				)}

				<span className="hidden w-[68px] shrink-0 justify-end gap-1 @md:flex">
					{CAPABILITIES.filter((capability) => capability.has(model)).map(({ label, Icon, tone }) => (
						<span key={label} role="img" aria-label={t(label)} data-ly-tip={t(label)} className={`grid h-5 w-5 place-items-center rounded-[5px] ${tone}`}>
							<Icon size={11} strokeWidth={2} />
						</span>
					))}
				</span>

				<span className="grid h-5 w-[46px] shrink-0 place-items-center rounded-[5px] bg-card font-mono text-caption text-ink-muted tabular-nums">
					{formatWindow(model.contextWindow)}
				</span>

				<span className="flex shrink-0 items-center">
					<IconButton
						label={testing ? t("providerModels.connecting") : t("providerModels.testOne")}
						disabled={testing}
						explainDisabled
						onClick={onTest}
						className="text-ink-faint group-hover/row:text-ink-muted"
						icon={testing ? <ActionSpinner size={13} className="text-accent" /> : <Play size={13} strokeWidth={1.9} className="ml-0.5" />}
					/>
					<IconButton
						label={t("common.more")}
						menu={menu.open}
						onClick={menu.toggle}
						className="text-ink-faint group-hover/row:text-ink-muted aria-expanded:bg-card-hover aria-expanded:text-ink"
						icon={<MoreHorizontal size={15} strokeWidth={1.8} />}
					/>
				</span>
			</div>

			{testResult && !testResult.ok && !testing && (
				<div className="-mt-1 pr-4 pb-3 pl-[52px] text-detail break-words text-danger">
					<span className="font-medium">{t("providerModels.connectFailed")} </span>
					{testResult.message}
				</div>
			)}

			{menu.open && (
				<Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="end" width="compact" role="menu" label={model.modelId}>
					<MenuBody>
						<MenuItem
							icon={<Star size={13} strokeWidth={1.8} />}
							disabled={isDefault}
							onClick={() => {
								menu.close();
								onSetDefault();
							}}
						>
							{t("providerModels.makeDefault")}
						</MenuItem>
						<MenuItem
							icon={<Pencil size={13} strokeWidth={1.8} />}
							onClick={() => {
								menu.close();
								onEdit();
							}}
						>
							{t("providerModels.editOne")}
						</MenuItem>
						<MenuSeparator />
						<MenuItem
							danger
							icon={<Trash2 size={13} strokeWidth={1.8} />}
							onClick={() => {
								menu.close();
								confirm.ask({
									title: t("providerModels.deleteConfirm", { id: model.modelId }),
									detail: isDefault ? t("providerModels.deleteDefaultDetail") : undefined,
									confirmLabel: t("common.delete"),
									onConfirm: onRemove,
								});
							}}
						>
							{t("providerModels.deleteOne")}
						</MenuItem>
					</MenuBody>
				</Popover>
			)}

			{confirm.element}
		</div>
	);
}
