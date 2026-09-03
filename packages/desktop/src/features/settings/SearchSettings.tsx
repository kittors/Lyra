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

interface Choice {
	id: string;
	name: string;
	/** What using it costs you, in one line. */
	cost: string;
	detail: string;
	/** Absent for the keyless one. */
	key?: "tavily" | "exa" | "brave";
	signup?: string;
}

const CHOICES: Choice[] = [
	{
		id: "tavily",
		name: "Tavily",
		cost: "需要 API key · 每月 1000 次免费",
		detail: "为 agent 设计的搜索，会连带返回一段总结，通常是这里最省事的选择。",
		key: "tavily",
		signup: "https://tavily.com",
	},
	{
		id: "brave",
		name: "Brave Search",
		cost: "需要 API key · 每月 2000 次免费",
		detail: "独立索引，不转手给别家。免费额度是这几个里最大的。",
		key: "brave",
		signup: "https://brave.com/search/api/",
	},
	{
		id: "exa",
		name: "Exa",
		cost: "需要 API key · 有免费额度",
		detail: "语义检索，找概念和相似内容比找关键词强。",
		key: "exa",
		signup: "https://exa.ai",
	},
	{
		id: "ddg-instant",
		name: "DuckDuckGo 速答",
		cost: "免配置 · 稳定",
		detail:
			"官方接口，不用注册也不会被限流。但只有百科式答案，不是网页结果列表，而且**基本只对英文词条有效** —— 中文提问多半查不到东西。",
	},
	{
		id: "duckduckgo",
		name: "DuckDuckGo",
		cost: "免配置 · 经常被限流",
		detail:
			"不用注册任何账号，直接抓它的无脚本页面。但它会挡自动访问 —— 拿不到结果时不是这里坏了，是对方在限流，隔一阵子才好。当正经搜索用不可靠。",
	},
];

export function SearchSettings() {
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
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">网页搜索</h1>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				给 agent 一个 <code className="font-mono text-detail">web_search</code> 工具。
				说实话：<strong className="font-medium text-ink">中文搜索想好用，得填一个 key</strong> ——
				免配置那两个要么被限流，要么只认英文词条。下面三家都有免费额度，日常用量够。
			</p>

			<SectionTitle>用哪一个</SectionTitle>
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
										<span className="text-label font-medium text-ink">{choice.name}</span>
										<span className="text-caption text-ink-faint">{choice.cost}</span>
										{/* Says whether it *could* run, which is the thing that is easy to get
										    wrong: a selected provider with no key is a search that fails later. */}
										{choice.key && (
											<span className={`text-caption ${configured ? "text-ok" : "text-ink-faint"}`}>
												{configured ? "已填 key" : "未填 key"}
											</span>
										)}
									</span>
									<span className="mt-1 block text-detail leading-relaxed text-ink-muted">{choice.detail}</span>
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
							<span className="text-label text-ink">{choice.name}</span>
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
							{saved === choice.key && <span className="text-caption text-ok">已保存</span>}
						</div>
						<SecretInput
							value={keys[choice.key!] ?? ""}
							onChange={(value) => setKey(choice.key!, value)}
							placeholder="粘贴 API key"
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
