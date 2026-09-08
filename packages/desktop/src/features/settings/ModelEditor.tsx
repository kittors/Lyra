import type { ModelConfig, ProviderConfig } from "@lyra/core";
import { catalogModelFor, catalogPricing, withCatalogDefaults, type CatalogMatch } from "@lyra/core/model-catalog";
import { ModelCatalog } from "./ModelCatalog.tsx";
import { Box } from "lucide-react";
import { useState } from "react";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Field, GhostButton, PrimaryButton, TextInput, Toggle } from "./controls.tsx";
import { useI18n } from "../../i18n/index.ts";

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
	const [supportsThinking, setSupportsThinking] = useState(model?.supportsThinking ?? false);
	const [supportsImages, setSupportsImages] = useState(model?.supportsImages ?? false);
	const [supportsTools, setSupportsTools] = useState(model?.supportsTools ?? false);
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
				<>
					<div className="border-b border-line px-5 py-3.5">
						<h3 className="flex items-center gap-2.5 text-body font-semibold text-ink">
							<Box size={20} className="text-accent" />
							{model ? t("modelEditor.edit") : t("modelEditor.add")}
						</h3>
					</div>

					<Scroller className="max-h-[64vh]" contentClassName="space-y-4 px-5 py-4">
						<Field label={t("modelEditor.id")} hint={t("modelEditor.idDetail")}>
							<TextInput value={modelId} onChange={changeModelId} placeholder="deepseek-v4-flash" mono spellCheck={false} />
						</Field>

						<Field label={t("modelEditor.displayName")} hint={t("modelEditor.displayNameDetail")}>
							<TextInput value={name} onChange={setName} placeholder="DeepSeek V4 Flash" />
						</Field>

						<ModelCatalog match={catalog} onApply={applyCatalog} />

						<div className="grid grid-cols-2 gap-3">
							<Field label={t("modelEditor.context")} hint={windowOk ? undefined : t("modelEditor.contextDetail")}>
								<TextInput value={contextWindow} onChange={(value) => changeMetadata(setContextWindow, value)} invalid={!windowOk} mono inputMode="numeric" />
							</Field>
							<Field label={t("modelEditor.maxOutput")} hint={outputOk ? undefined : t("modelEditor.maxOutputDetail")}>
								<TextInput value={maxOutput} onChange={(value) => changeMetadata(setMaxOutput, value)} invalid={!outputOk} mono inputMode="numeric" />
							</Field>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<Field label={t("modelEditor.inputPrice")} hint={!pricingOk && !pricingComplete ? t("modelEditor.priceBothDetail") : undefined}>
								<TextInput value={priceIn} onChange={(value) => changePrice(setPriceIn, value)} placeholder={t("common.notSet")} mono inputMode="decimal" invalid={!pricingOk} />
							</Field>
							<Field label={t("modelEditor.outputPrice")}>
								<TextInput value={priceOut} onChange={(value) => changePrice(setPriceOut, value)} placeholder={t("common.notSet")} mono inputMode="decimal" invalid={!pricingOk} />
							</Field>
							<Field label={t("modelEditor.cacheReadPrice")}>
								<TextInput value={priceCacheRead} onChange={(value) => changePrice(setPriceCacheRead, value)} placeholder={t("common.notSet")} mono inputMode="decimal" invalid={!pricingOk} />
							</Field>
							<Field label={t("modelEditor.cacheWritePrice")}>
								<TextInput value={priceCacheWrite} onChange={(value) => changePrice(setPriceCacheWrite, value)} placeholder={t("common.notSet")} mono inputMode="decimal" invalid={!pricingOk} />
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
					</Scroller>

					<div className="flex justify-end gap-2 border-t border-line px-5 py-3">
						<GhostButton onClick={() => dismiss()}>{t("common.cancel")}</GhostButton>
						<PrimaryButton onClick={() => dismiss(submit)} disabled={!valid}>{t("common.save")}</PrimaryButton>
					</div>
				</>
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
