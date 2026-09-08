import { ExternalLink, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { BROWSER_SEARCH_ENGINES, browserSearchCustom, type BrowserSearchEngine } from "../../../shared/browser.ts";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Card, InlineSelect, Row, SectionTitle, TextInput } from "./controls.tsx";
import { useI18n } from "../../i18n/index.ts";

/*
 * 引擎名（Bing、Google…）是牌子，不翻译；最后那个「自定义」是界面词，要跟着语言走。
 *
 * 所以这张表不能在模块加载时定型——那会儿窗口还没说自己是哪种语言。做成函数，渲染时调。
 */
const engineOptions = (custom: string): { value: BrowserSearchEngine; label: string }[] => [
	...BROWSER_SEARCH_ENGINES.map((engine) => ({ value: engine.id as BrowserSearchEngine, label: engine.label })),
	{ value: "custom", label: custom },
];

export function BrowserSettings() {
	const { t } = useI18n();
	const settings = useApp((state) => state.settings);
	const saveSettings = useApp((state) => state.saveSettings);
	const config = settings?.browser ?? {};
	/*
	 * The template is a draft until it can carry a query.
	 *
	 * Saved on every keystroke it would be written half-typed — `https://example.com/?q=` with the
	 * `%s` still to come — and the address bar would silently fall back to Bing for as long as it
	 * took to finish the word. Committed on blur, and only if it parses.
	 */
	const [draft, setDraft] = useState(config.searchUrl ?? "");
	const [error, setError] = useState<string | null>(null);
	useEffect(() => { setDraft(config.searchUrl ?? ""); setError(null); }, [config.searchUrl]);
	if (!settings) return null;
	const patch = (next: Partial<NonNullable<typeof settings.browser>>) => void saveSettings({ ...settings, browser: { ...config, ...next } });
	const commit = () => {
		if (!draft.trim()) { setError(null); patch({ searchUrl: "" }); return; }
		try { patch({ searchUrl: browserSearchCustom(draft) }); setError(null); }
		catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); }
	};
	return <div className="pt-8">
		<h1 className="pb-7 text-display leading-tight font-semibold tracking-tight text-ink">{t("browser.title")}</h1>
		<SectionTitle>{t("browser.habits")}</SectionTitle>
		<Card className="mb-7">
			<Row title={t("browser.openLinksWith")} control={<InlineSelect value={config.openLinks ?? "system"} options={[{ value: "system", label: t("browser.systemBrowser") }, { value: "builtin", label: t("browser.builtin") }]} onChange={(openLinks) => patch({ openLinks })} />} />
			<Row title={t("browser.addressSearch")} detail={t("browser.addressSearchDetail")} control={<InlineSelect value={config.searchEngine ?? "bing"} options={engineOptions(t("common.custom"))} onChange={(searchEngine) => patch({ searchEngine })} ariaLabel={t("browser.searchEngine")} />}>
				{config.searchEngine === "custom" && <div className="mt-3" data-search-custom>
					<TextInput mono value={draft} onChange={setDraft} onBlur={commit} invalid={Boolean(error)} placeholder="https://example.com/search?q=%s" aria-label="自定义搜索地址" spellCheck={false} />
					<p className={`mt-1.5 text-caption ${error ? "text-danger" : "text-ink-faint"}`}>{error ?? t("browser.searchEngineDetail")}</p>
				</div>}
			</Row>
			<Row title={t("browser.zoom")} control={<InlineSelect value={String(config.defaultZoom ?? 1)} options={[0.75,1,1.25,1.5,2].map((factor) => ({ value: String(factor), label: `${factor * 100}%` }))} onChange={(factor) => patch({ defaultZoom: Number(factor) })} />} />
			<Row title={t("browser.agentControl")} detail={t("browser.agentControlDetail")} />
			<Row title={t("browser.inspect")} detail={t("browser.inspectDetail")} />
			<Row title={t("browser.devtools")} detail={t("browser.devtoolsDetail")} />
		</Card>
		<SectionTitle>{t("browser.bookmarks")}</SectionTitle>
		<Card>
			{config.bookmarks?.length ? config.bookmarks.map((bookmark) => <div key={bookmark.url} className="group flex items-center gap-2 px-4 py-2.5">
				<div className="min-w-0 flex-1"><ScrollText text={bookmark.title} className="text-label text-ink" /><ScrollText text={bookmark.url} className="text-caption text-ink-faint" /></div>
				<IconButton label={t("browser.openBookmark")} icon={<ExternalLink size={14} />} onClick={() => { useApp.getState().setView("chat"); void bridge.browser.command({ type: "open", url: bookmark.url, sessionId: useApp.getState().activeSessionId, newTab: true }).catch((error: unknown) => useApp.getState().notify(String(error), "error")); }} />
				<IconButton label={t("browser.deleteBookmark")} tone="danger" icon={<Trash2 size={14} />} onClick={() => patch({ bookmarks: config.bookmarks?.filter((item) => item.url !== bookmark.url) })} />
			</div>) : <p className="p-4 text-detail text-ink-faint">{t("browser.bookmarksEmpty")}</p>}
		</Card>
	</div>;
}
