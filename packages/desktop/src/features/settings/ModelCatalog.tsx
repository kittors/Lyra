import { activeLocale, translate } from "../../i18n/translate.ts";
import { MODEL_CATALOG_PROVIDERS, MODEL_CATALOG_SOURCE, type CatalogMatch } from "@lyra/core/model-catalog";
import { useMemo, useState } from "react";
import { TextInput } from "./inputs.tsx";
import { useI18n } from "../../i18n/index.ts";

const PRIMARY = new Set(["openai", "anthropic", "google", "moonshotai", "alibaba", "zai", "deepseek", "xai", "minimax", "openrouter"]);

export function ModelCatalog({ match, onApply }: { match: CatalogMatch | null; onApply: (match: CatalogMatch) => void }) {
	const { t } = useI18n();
	const [query, setQuery] = useState("");
	const results = useMemo(() => {
		const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return [];
		return MODEL_CATALOG_PROVIDERS.flatMap((provider) => provider.models
			.filter((model) => words.every((word) => `${provider.name} ${provider.id} ${model.id} ${model.name}`.toLowerCase().includes(word)))
			.map((model) => ({ provider, model, match: "binding" } satisfies CatalogMatch)))
			.sort((a, b) => Number(PRIMARY.has(b.provider.id)) - Number(PRIMARY.has(a.provider.id)))
			.slice(0, 30);
	}, [query]);
	return (
		<div className="space-y-2 rounded-[10px] border border-line px-3 py-2.5">
			<div className="flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<div className="text-label font-medium text-ink">{match ? t("catalog.matched") : t("catalog.unmatched")}</div>
					<div className="break-words text-detail text-ink-faint">
						{match ? `${match.provider.name} · ${match.model.id}` : t("catalog.bindDetail")}
					</div>
				</div>
				{match && <button type="button" onClick={() => onApply(match)} className="shrink-0 rounded-lg px-2.5 py-1.5 text-label font-medium text-accent hover:bg-accent/10">{t("catalog.sync")}</button>}
			</div>
			<TextInput value={query} onChange={setQuery} aria-label={t("catalog.search")} placeholder={t("catalog.searchPlaceholder")} />
			{query.trim() && <div className="max-h-48 overflow-y-auto" aria-label={t("catalog.results")}>
				{results.length === 0 ? <p className="py-2 text-detail text-ink-muted">{t("catalog.missing")}</p> : results.map((entry) => (
					<button type="button" key={`${entry.provider.id}/${entry.model.id}`} onClick={() => { onApply(entry); setQuery(""); }}
						className="block w-full rounded-lg px-2 py-2 text-left hover:bg-accent/10">
						<span className="block break-all text-label text-ink">{entry.model.id}</span>
						<span className="text-detail text-ink-muted">{entry.provider.name} · {entry.model.inputPrice === undefined || entry.model.outputPrice === undefined ? t("usage.noPrice") : t("catalog.price", { input: entry.model.inputPrice, output: entry.model.outputPrice })}</span>
					</button>
				))}
			</div>}
			<p className="text-detail text-ink-faint">{translate("modelCatalog.line", {
					date: new Date(MODEL_CATALOG_SOURCE.updatedAt).toLocaleDateString(activeLocale()),
					n: MODEL_CATALOG_PROVIDERS.length,
				})}</p>
		</div>
	);
}
