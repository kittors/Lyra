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
import { useEffect, useRef, useState } from "react";
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

	if (!settings) return null;

	const keys = settings.searchApiKeys ?? {};
	const selected = settings.searchProvider ?? null;

	/*
	 * 每次落盘都从 store 现读，不用这一次渲染闭包里的 `settings`。
	 *
	 * 三个 key 各自防抖提交，第二个框的写入完全可能落在第一个框之后一瞬。合并进渲染时那份副本，
	 * 会把刚存好的另一个 key 悄悄改回原值。
	 */
	const setKey = (which: "tavily" | "exa" | "brave", value: string) => {
		const current = useApp.getState().settings;
		if (!current) return;
		const now = current.searchApiKeys ?? {};
		if ((now[which] ?? "") === value) return;
		void saveSettings({ ...current, searchApiKeys: { ...now, [which]: value } });
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
								/* 探针和 e2e 靠它认出这五条，而不是靠文字或者「带个圆圈的按钮」这种碰运气的选择器。 */
								data-search-provider={choice.id}
								data-selected={active || undefined}
								onClick={() => void saveSettings({ ...settings, searchProvider: active ? null : choice.id })}
								/*
								 * `items-center`：圈落在整条的中线上，不是贴着第一行文字。
								 *
								 * 一条里是「名字 + 一到两行说明」，说明有多长是各家自己的事——`items-start`
								 * 把圈钉在标题那一行，于是这一列圈的高度全跟着各自那条说明的行数走，一整
								 * 张卡片看下来是一列参差的点。
								 */
								className="ly-scroll group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card-hover"
							>
								{/*
								 * 没选中的圈在 hover 底色上要更重一档。
								 *
								 * `--color-line` 是 #2e2e2e，`--color-card-hover` 是 #2a2a2a——差四级灰。
								 * 鼠标一进这一条，圈就和底色化在一起，看上去像是「指过去反而没得选了」。
								 */}
								<span
									className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${
										active ? "border-accent bg-accent text-shell" : "border-line group-hover:border-ink-faint"
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
									{t("common.apply")}
									<ExternalLink size={10} strokeWidth={2} />
								</a>
							)}
						</div>
						<KeyField
							value={keys[choice.key!] ?? ""}
							onCommit={(value) => setKey(choice.key!, value)}
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
				{t("search.trustNote")}
			</p>
		</div>
	);
}

/**
 * 停下来才写出去的一把 key，而且写完不吭声。
 *
 * 之前是每一次按键都 `saveSettings`：粘贴一把 40 位的 key 就是四十次整份设置的序列化和落盘，
 * 而设置写盘会带着整个 store 走一遍——手打的时候能感觉到输入框在顿。旁边那句「已保存」还给每一
 * 次按键各挂一个 1500ms 的定时器，于是它在打字过程中一直亮着。
 *
 * 亮着这件事本身也是多余的。这一页上没有保存按钮，每一处改动都是当场生效的；一个恒亮的「已保存」
 * 没有回答任何人的问题——真正会让人担心的是「我关掉这一页它还在不在」，而那要靠下次打开时框里
 * 有东西来回答，不是靠一行绿字。上面那份列表里的「已填 key / 未填 key」已经在说这件事了。
 *
 * 所以：有焦点时文本是本地的，停手 400ms 后落盘，失焦时立刻落盘。跟并发数那个框同一套做法。
 */
function KeyField({
	value,
	onCommit,
	placeholder,
}: {
	value: string;
	onCommit: (value: string) => void;
	placeholder?: string;
}) {
	const [typed, setTyped] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	const commit = (raw: string, now: boolean) => {
		clearTimeout(timer.current);
		// 两头的空白是粘贴带进来的，不是 key 的一部分——留着它，请求会带上一把服务商不认识的凭据。
		const cleaned = raw.trim();
		if (now) onCommit(cleaned);
		else timer.current = setTimeout(() => onCommit(cleaned), 400);
	};

	return (
		<SecretInput
			value={typed ?? value}
			onChange={(next) => {
				setTyped(next);
				commit(next, false);
			}}
			onBlur={(next) => {
				commit(next, true);
				setTyped(null);
			}}
			placeholder={placeholder}
		/>
	);
}
