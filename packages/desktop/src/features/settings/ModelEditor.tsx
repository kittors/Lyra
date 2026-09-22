import type { ModelConfig, ProviderConfig } from "@lyra/core";
import { catalogModelFor, catalogPricing, withCatalogDefaults, type CatalogMatch } from "@lyra/core/model-catalog";
import { ModelCatalog } from "./ModelCatalog.tsx";
import { Box } from "lucide-react";
import { useState } from "react";
import { DialogAction, DialogFrame } from "../../ui/overlay/Dialog.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { isLegalDraft } from "../../lib/number-draft.ts";
import { Field, TextInput, Toggle } from "./controls.tsx";
import { useI18n } from "../../i18n/index.ts";

const CONTEXT = { min: 1, max: 100_000_000, step: 1 };
const OUTPUT = { min: 1, max: 100_000_000, step: 1 };
const PRICE = { min: 0, max: 1_000_000, step: 0.000001 };

export function ModelEditor({
	provider,
	model: savedModel,
	onSave,
	onCancel,
}: {
	provider: Pick<ProviderConfig, "id" | "baseUrl">;
	model: ModelConfig | null;
	onSave: (model: ModelConfig) => void;
	onCancel: () => void;
}) {
	const { t } = useI18n();
	const model = savedModel ? withCatalogDefaults(provider, savedModel) : null;
	const [catalogRef, setCatalogRef] = useState(model?.catalogRef);
	const [metadataSource, setMetadataSource] = useState<ModelConfig["metadataSource"]>(model?.metadataSource ?? "manual");
	const initialCatalog = model ? catalogModelFor(provider, model.modelId, model.catalogRef) : null;
	const initialPricing = model?.pricing ?? (initialCatalog ? catalogPricing(initialCatalog.provider.id, initialCatalog.model) : undefined);
	const [modelId, setModelId] = useState(model?.modelId ?? "");
	const [name, setName] = useState(model?.name ?? "");
	const [contextWindow, setContextWindow] = useState(String(model?.contextWindow ?? 200000));
	const [maxOutput, setMaxOutput] = useState(String(model?.maxOutputTokens ?? 16384));
	/*
	 * 新加一个模型时，三样能力默认都开着。
	 *
	 * 原本默认全关，理由大概是「不知道就别声称」。可这个默认落在的正是「目录不认识这个名字」的
	 * 那一档——中转起的私有名字、刚发布的型号、自建的端点，而如今这些几乎都会思考、看图、调工具。
	 * 于是最常见的一次操作变成了：加完模型，它不会用工具，思考档位是灰的，界面上没有任何一处说
	 * 明为什么，人得先猜到有这么三个开关、再回来打开。
	 *
	 * 猜错的代价也不对等：默认开着而模型其实不支持，会收到一个说得清清楚楚的报错；默认关着而模型
	 * 支持，是能力凭空少了一块，而且不报错。
	 *
	 * 编辑已有模型时走的是它自己存下来的值，这里只管新建。
	 */
	const [supportsThinking, setSupportsThinking] = useState(model?.supportsThinking ?? true);
	const [supportsImages, setSupportsImages] = useState(model?.supportsImages ?? true);
	const [supportsTools, setSupportsTools] = useState(model?.supportsTools ?? true);
	const [priceIn, setPriceIn] = useState(String(initialPricing?.input ?? ""));
	const [priceOut, setPriceOut] = useState(String(initialPricing?.output ?? ""));
	const [priceCacheRead, setPriceCacheRead] = useState(String(initialPricing?.cacheRead ?? ""));
	const [priceCacheWrite, setPriceCacheWrite] = useState(String(initialPricing?.cacheWrite ?? ""));
	const [pricingSource, setPricingSource] = useState<"manual" | "catalog" | null>(
		initialPricing ? initialPricing.source ?? (model?.pricing ? "manual" : "catalog") : null,
	);

	const trimmedId = modelId.trim();
	const window_ = Number(contextWindow);
	const output = Number(maxOutput);
	const windowOk = Number.isInteger(window_) && window_ > 0 && window_ <= 100_000_000;
	const outputOk = Number.isInteger(output) && output > 0 && output <= window_;
	const catalog = catalogModelFor(provider, trimmedId, catalogRef);
	const parsePrice = (value: string) => {
		if (!value.trim()) return null;
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
	};
	const prices = [priceIn, priceOut, priceCacheRead, priceCacheWrite].map(parsePrice);
	const pricingComplete = prices[0] !== null && prices[1] !== null;
	const pricingEmpty = prices.every((price) => price === null);
	const pricingOk = prices.every((price) => price === null || Number.isFinite(price)) && (pricingComplete || pricingEmpty);
	const valid = trimmedId.length > 0 && windowOk && outputOk && pricingOk;

	function changePrice(setter: (value: string) => void, value: string) {
		setter(value);
		setPricingSource("manual");
	}

	function applyCatalog(found: CatalogMatch) {
		const entry = found.model;
		setCatalogRef(found.match === "binding" ? { providerId: found.provider.id, modelId: entry.id } : undefined);
		setMetadataSource("catalog");
		setName(entry.name);
		setContextWindow(String(entry.contextWindow));
		setMaxOutput(String(entry.maxOutputTokens));
		setSupportsThinking(entry.supportsThinking);
		setSupportsImages(entry.supportsImages);
		setSupportsTools(entry.supportsTools);
		setPriceIn(String(entry.inputPrice ?? ""));
		setPriceOut(String(entry.outputPrice ?? ""));
		setPriceCacheRead(entry.cacheReadPrice === undefined ? "" : String(entry.cacheReadPrice));
		setPriceCacheWrite(entry.cacheWritePrice === undefined ? "" : String(entry.cacheWritePrice));
		setPricingSource("catalog");
	}

	function changeModelId(value: string) {
		setModelId(value);
		setCatalogRef(undefined);
		const found = catalogModelFor(provider, value);
		if (found) applyCatalog(found);
		else {
			setName(value); setContextWindow("200000"); setMaxOutput("16384");
			setSupportsThinking(false); setSupportsImages(false); setSupportsTools(false);
			setMetadataSource("manual"); setPricingSource(null);
			setPriceIn(""); setPriceOut(""); setPriceCacheRead(""); setPriceCacheWrite("");
		}
	}

	function changeMetadata<T>(setter: (value: T) => void, value: T) {
		setter(value);
		setMetadataSource("manual");
	}

	function submit() {
		if (!valid) return;
		const [parsedIn, parsedOut, parsedCacheRead, parsedCacheWrite] = prices;
		const cataloguePricing = pricingSource === "catalog" && catalog ? catalogPricing(catalog.provider.id, catalog.model) : null;
		onSave({
			...model,
			id: `${provider.id}/${trimmedId}`,
			providerId: provider.id,
			modelId: trimmedId,
			name: name.trim() || trimmedId,
			contextWindow: window_,
			maxOutputTokens: output,
			supportsThinking,
			supportsImages,
			supportsTools,
			catalogRef,
			metadataSource,
			pricing:
				parsedIn !== null && parsedOut !== null
					? {
						...cataloguePricing,
						input: parsedIn,
						output: parsedOut,
						cacheRead: parsedCacheRead ?? undefined,
						cacheWrite: parsedCacheWrite ?? undefined,
						source: cataloguePricing ? "catalog" : "manual",
					}
					: undefined,
		});
	}

	return (
		<Overlay onClose={onCancel} width={560}>
			{(dismiss) => (
				<DialogFrame
					icon={<Box size={20} className="shrink-0 text-accent" />}
					title={model ? t("modelEditor.edit") : t("modelEditor.add")}
					/* 这是一张表单，不是一个问题——默认那档高度一次只露三个字段。 */
					bodyClassName="max-h-[min(560px,58dvh)]"
					actions={(
						<>
							<div className="flex-1" />
							<DialogAction onClick={() => dismiss()}>{t("common.cancel")}</DialogAction>
							<DialogAction tone="primary" disabled={!valid} onClick={() => dismiss(submit)}>
								{t("common.save")}
							</DialogAction>
						</>
					)}
				>
					<div className="space-y-4">
						<Field label={t("modelEditor.id")} hint={t("modelEditor.idDetail")}>
							<TextInput value={modelId} onChange={changeModelId} placeholder="deepseek-v4-flash" mono spellCheck={false} />
						</Field>

						<Field label={t("modelEditor.displayName")} hint={t("modelEditor.displayNameDetail")}>
							<TextInput value={name} onChange={setName} placeholder="DeepSeek V4 Flash" />
						</Field>

						<ModelCatalog match={catalog} onApply={applyCatalog} />

						<div className="grid grid-cols-2 gap-3">
							<Field label={t("modelEditor.context")}>
								<TextInput value={contextWindow} onChange={(value) => { if (isLegalDraft(value, CONTEXT)) changeMetadata(setContextWindow, value); }} mono inputMode="numeric" />
							</Field>
							<Field label={t("modelEditor.maxOutput")}>
								<TextInput value={maxOutput} onChange={(value) => { if (isLegalDraft(value, OUTPUT)) changeMetadata(setMaxOutput, value); }} mono inputMode="numeric" />
							</Field>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<Field label={t("modelEditor.inputPrice")}>
								<TextInput value={priceIn} onChange={(value) => { if (isLegalDraft(value, PRICE)) changePrice(setPriceIn, value); }} placeholder={t("common.notSet")} mono inputMode="decimal" />
							</Field>
							<Field label={t("modelEditor.outputPrice")}>
								<TextInput value={priceOut} onChange={(value) => { if (isLegalDraft(value, PRICE)) changePrice(setPriceOut, value); }} placeholder={t("common.notSet")} mono inputMode="decimal" />
							</Field>
							<Field label={t("modelEditor.cacheReadPrice")}>
								<TextInput value={priceCacheRead} onChange={(value) => { if (isLegalDraft(value, PRICE)) changePrice(setPriceCacheRead, value); }} placeholder={t("common.notSet")} mono inputMode="decimal" />
							</Field>
							<Field label={t("modelEditor.cacheWritePrice")}>
								<TextInput value={priceCacheWrite} onChange={(value) => { if (isLegalDraft(value, PRICE)) changePrice(setPriceCacheWrite, value); }} placeholder={t("common.notSet")} mono inputMode="decimal" />
							</Field>
						</div>
						<p className="-mt-2 text-detail text-ink-faint">
							{pricingEmpty
								? t("modelEditor.noPriceDetail")
								: pricingSource === "catalog"
									? `${t("modelEditor.catalogPrice")}${catalog?.model.tiers?.length ? t("modelEditor.catalogTiers", { n: catalog.model.tiers.length }) : ""}`
									: t("modelEditor.manualPrice")}
						</p>

						{!catalog && <p className="text-detail text-ink-muted">{t("modelEditor.unverified")}</p>}
						<div className="space-y-3 rounded-[10px] border border-line px-3.5 py-3">
							<Capability label={t("modelEditor.thinking")} checked={supportsThinking} onChange={(value) => changeMetadata(setSupportsThinking, value)} />
							<Capability label={t("modelEditor.images")} checked={supportsImages} onChange={(value) => changeMetadata(setSupportsImages, value)} />
							<Capability label={t("modelEditor.toolCalls")} checked={supportsTools} onChange={(value) => changeMetadata(setSupportsTools, value)} />
						</div>
					</div>
				</DialogFrame>
			)}
		</Overlay>
	);
}

function Capability({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
	return (
		<label className="flex items-center justify-between">
			<span className="text-label text-ink">{label}</span>
			<Toggle checked={checked} onChange={onChange} />
		</label>
	);
}
