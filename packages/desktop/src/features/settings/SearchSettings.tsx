/**
 * Where web search comes from.
 *
 * The honest situation, stated on the page rather than buried: the keyless option works without
 * an account and is rate-limited by the service whenever it feels like it, and the keyed ones are
 * reliable. That is not a failing of this app — every free search endpoint blocks automation, and
 * a page that pretended otherwise would just move the surprise to the first time somebody needed
 * an answer.
 *
 * So the page is arranged around the decision it actually wants from you: pick one, and if it is
 * a keyed one, paste the key. Every service listed has a free tier that covers ordinary use.
 */

import { Check, ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../store/index.ts";
import { Card, SectionTitle } from "./layout.tsx";
import { SecretInput } from "./inputs.tsx";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

interface Choice {
	id: string;
	/** 有译名的用 key；牌子名（Tavily、Brave）不翻译，直接写在 name 上。 */
	name?: string;
	nameKey?: MessageKey;
	/** What using it costs you, in one line — as a key, so the table can be module-level. */
	costKey: MessageKey;
	detailKey: MessageKey;
	/** Absent for the keyless one. */
	key?: "tavily" | "exa" | "brave";
	signup?: string;
}

const CHOICES: Choice[] = [
	{
		id: "tavily",
		name: "Tavily",
		costKey: "search.needsKey1000",
		detailKey: "search.tavily",
		key: "tavily",
		signup: "https://tavily.com",
	},
	{
		id: "brave",
		name: "Brave Search",
		costKey: "search.needsKey2000",
		detailKey: "search.brave",
		key: "brave",
		signup: "https://brave.com/search/api/",
	},
	{
		id: "exa",
		name: "Exa",
		costKey: "search.needsKeyFree",
		detailKey: "search.exa",
		key: "exa",
		signup: "https://exa.ai",
	},
	{
		id: "ddg-instant",
		nameKey: "search.ddgInstant",
		costKey: "search.noSetupStable",
		detailKey: "search.ddgInstantDetail",
	},
	{
		id: "duckduckgo",
		name: "DuckDuckGo",
		costKey: "search.noSetupLimited",
		detailKey: "search.ddgScrapeDetail",
	},
];

/**
 * 一句话里嵌两段有样式的片段，位置由译文说了算。
 *
 * `{tool}` 是工具名，等宽；`{strong}` 是那句要强调的话。拆成前中后三个 key 会把中文的语序
 * 写死进结构——英语里那句强调落在句子的另一头。整句一个 key、两个占位符，译者摆在哪儿就在
 * 哪儿。切分保留分隔符，所以不认识的片段原样穿过去。
 */
function intro(text: string, strong: string): React.ReactNode {
	return text.split(/(\{tool\}|\{strong\})/).map((part, at) =>
		part === "{tool}" ? (
			<code key={at} className="font-mono text-detail">
				web_search
			</code>
		) : part === "{strong}" ? (
			<strong key={at} className="font-medium text-ink">
				{strong}
			</strong>
		) : (
			part
		),
	);
}

export function SearchSettings() {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const [saved, setSaved] = useState<string | null>(null);

	if (!settings) return null;

	const keys = settings.searchApiKeys ?? {};
	const selected = settings.searchProvider ?? null;

	const setKey = (which: "tavily" | "exa" | "brave", value: string) => {
		void saveSettings({ ...settings, searchApiKeys: { ...keys, [which]: value } });
		setSaved(which);
		setTimeout(() => setSaved(null), 1500);
	};

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("search.title")}</h1>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				{intro(t("search.intro"), t("search.introStrong"))}
			</p>

			<SectionTitle>{t("search.which")}</SectionTitle>
			<Card className="mb-6">
				{CHOICES.map((choice, index) => {
					const configured = choice.key ? Boolean(keys[choice.key]?.trim()) : true;
					const active = selected === choice.id;
					return (
						<div key={choice.id} className={index === 0 ? "" : "border-t border-line-soft"}>
							<button
								type="button"
								onClick={() => void saveSettings({ ...settings, searchProvider: active ? null : choice.id })}
								className="ly-scroll flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-card-hover"
							>
								<span
									className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${
										active ? "border-accent bg-accent text-shell" : "border-line"
									}`}
								>
									{active && <Check size={11} strokeWidth={3} />}
								</span>
								<span className="min-w-0 flex-1">
									<span className="flex flex-wrap items-center gap-2">
										<span className="text-label font-medium text-ink">{choice.nameKey ? t(choice.nameKey) : choice.name}</span>
										<span className="text-caption text-ink-faint">{t(choice.costKey)}</span>
										{/* Says whether it *could* run, which is the thing that is easy to get
										    wrong: a selected provider with no key is a search that fails later. */}
										{choice.key && (
											<span className={`text-caption ${configured ? "text-ok" : "text-ink-faint"}`}>
												{configured ? t("search.keySet") : t("search.keyMissing")}
											</span>
										)}
									</span>
									<span className="mt-1 block text-detail leading-relaxed text-ink-muted">{t(choice.detailKey)}</span>
								</span>
							</button>
						</div>
					);
				})}
			</Card>

			<SectionTitle>API key</SectionTitle>
			<Card className="mb-6">
				{CHOICES.filter((c) => c.key).map((choice, index) => (
					<div key={choice.id} className={index === 0 ? "px-4 py-3.5" : "border-t border-line-soft px-4 py-3.5"}>
						<div className="mb-1.5 flex items-center gap-2">
							<span className="text-label text-ink">{choice.nameKey ? t(choice.nameKey) : choice.name}</span>
							{choice.signup && (
								<a
									href={choice.signup}
									target="_blank"
									rel="noreferrer"
									className="flex items-center gap-0.5 text-caption text-ink-faint transition-colors hover:text-ink"
								>
									申请
									<ExternalLink size={10} strokeWidth={2} />
								</a>
							)}
							{saved === choice.key && <span className="text-caption text-ok">{t("common.saved")}</span>}
						</div>
						<SecretInput
							value={keys[choice.key!] ?? ""}
							onChange={(value) => setKey(choice.key!, value)}
							placeholder={t("search.pasteKey")}
						/>
					</div>
				))}
			</Card>

			{/*
			 * The one thing worth saying about what search costs you beyond money: a query leaves
			 * this machine. Said here rather than in a prompt, because it is true of every search
			 * and a prompt on each one would be the thing this whole change was about removing.
			 */}
			<p className="flex max-w-[600px] items-start gap-2 pb-8 text-detail leading-relaxed text-ink-faint">
				<Search size={13} strokeWidth={1.8} className="mt-0.5 shrink-0" />
				搜索会把你的问题发给选中的服务商。结果和网页一样按不可信内容处理 —— agent 不会把搜到的文字当成给它的指令。
			</p>
		</div>
	);
}
