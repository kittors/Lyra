/**
 * 什么时候派子智能体，一次能派几个。
 *
 * 跟隔壁的「智能体」页是同一件事的两半：那一页说这个工作区有谁、各自用什么模型跑，这一页说
 * 什么时候把他们派出去。分开是因为改动的理由不同——加一个 agent 是因为多了一类活要干，调这里
 * 是因为账单或者节奏不对。
 *
 * 全局的设置，而且立刻生效：写盘之后下一轮就按新值走，正在跑的那道闸门也会当场改宽度，不需要
 * 重开会话。所以这一页上没有「保存」，也没有任何「重启后生效」的提示——那两样都会把一个已经
 * 生效的改动说成还没生效的。
 *
 * 页面上唯一一次想说得更多、最后又删掉的东西，是「这一轮实际几个」：档位确实会在并发上限底下
 * 再收一道，但把那个推算出来的数字摆在用户填的那个数字旁边，等于把一个设置显示成两个数，而看到
 * 两个数的人第一反应是自己填错了。机制用一句静态的说明交代，数字只留用户自己填的那个。
 */

// 子路径，不是包根：`@lyra/core` 会把整个 kernel 拖进渲染进程，窗口会白屏。见 .dependency-cruiser.cjs。
import {
	delegationTier,
	normalizeDelegationPolicy,
	type DelegationTier,
} from "@lyra/core/delegation";
import type { Settings } from "@lyra/core";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { sessionThinking } from "../../lib/thinking.ts";
import { useApp } from "../../store/index.ts";
import { Card, Row, SectionTitle, Toggle } from "./controls.tsx";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

/**
 * 五档，从不派到放开派。
 *
 * 名字是动词短语而不是「保守／积极」，因为程度副词只说了多与少，而这几档真正的差别是**判断标准**
 * 不同：「省着派」问的是「非派不可吗」，「挑着派」问的是「这活的中间过程我要不要」。两个问题，
 * 不是同一个问题的两个刻度。措辞跟提示词里写给模型的那几段是同一套词，这样界面上读到的和模型
 * 真正收到的对得上。
 */
/*
 * 四档，存的是 key。
 *
 * 和下面的 `THINKING_LABELS` 同一个道理：这张表在模块加载时就成型，那会儿窗口还没说自己是
 * 哪种语言，之后换语言它也不会重算。译发生在渲染的时候。
 */
const TIERS: { id: DelegationTier; nameKey: MessageKey; detailKey: MessageKey; levelsKey?: MessageKey }[] = [
	{
		id: "off",
		nameKey: "delegation.never",
		detailKey: "delegation.neverDetail",
		// 自动模式永远推不出这一档：推理等级再低也只是「少派」，「不派」得有人明说。
		levelsKey: "delegation.customOnly",
	},
	{
		id: "sparing",
		nameKey: "delegation.sparing",
		detailKey: "delegation.sparingDetail",
		levelsKey: "delegation.sparingLevels",
	},
	{
		id: "selective",
		nameKey: "delegation.selective",
		detailKey: "delegation.selectiveDetail",
		levelsKey: "common.medium",
	},
	{
		id: "ready",
		nameKey: "delegation.active",
		detailKey: "delegation.activeDetail",
		levelsKey: "common.high",
	},
	{
		id: "eager",
		nameKey: "delegation.max",
		detailKey: "delegation.maxDetail",
		levelsKey: "delegation.maxLevels",
	},
];

/** 天花板的上限。跟 `normalizeSettings` 里的 `Math.min(16, …)` 是同一个数字——那边是真正拦住它的地方。 */
const MAX_CONCURRENCY = 16;

export function DelegationSettings() {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const meta = useApp((s) => s.meta);
	const [error, setError] = useState("");

	if (!settings) return null;

	const policy = normalizeDelegationPolicy(settings.subAgentDelegation);
	const auto = policy === "auto";
	const thinking = sessionThinking(meta, settings);
	// 自动模式下这是推出来的，自定义模式下这就是用户自己选的那一档。两种情况下它都是「实际生效的」。
	const tier = delegationTier(thinking, policy);

	/*
	 * 每次都从 store 现读，不用这一次渲染闭包里的 `settings`。
	 *
	 * 这一页有三个控件写同一个对象，而数字输入是防抖提交的——它的写入可能落在用户切换档位之后
	 * 一瞬。合并进渲染时那份副本，会把刚切好的档位悄悄改回去。
	 */
	const write = (patch: Partial<Settings>) => {
		const current = useApp.getState().settings;
		if (!current) return;
		setError("");
		void useApp
			.getState()
			.saveSettings({ ...current, ...patch })
			.catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
	};

	return (
		<div className="pt-8" data-delegation-settings>
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("delegation.title")}</h1>
			{/* 一句话，长度对齐隔壁「智能体」页——为什么值得省着派，档位自己的说明里已经写了。 */}
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				{t("delegation.intro")}
			</p>

			{error && (
				<p role="alert" className="mb-3 text-label text-danger">
					{error}
				</p>
			)}

			<SectionTitle>{t("delegation.eagerness")}</SectionTitle>
			<Card className="mb-9">
				<Row
					title={t("delegation.followThinking")}
					detail={
						auto
							? t("delegation.followThinkingDetail", { level: THINKING_LABELS[thinking] ? t(THINKING_LABELS[thinking]) : thinking })
							: t("delegation.pinnedDetail")
					}
					control={
						<Toggle
							ariaLabel={t("delegation.followThinking")}
							checked={auto}
							/*
							 * 关掉时把推断出的那一档写下来，而不是回落到某个默认值。
							 *
							 * 关掉这个开关的人想说的是「就照现在这样，别再自己变」——如果关掉的瞬间档位
							 * 跳到别处，那正好是他要避免的那件事，而且是他亲手按出来的。
							 */
							onChange={(on) => write({ subAgentDelegation: on ? "auto" : tier })}
						/>
					}
				/>
				<div role="radiogroup" aria-label={t("delegation.eagerness")} aria-disabled={auto} className="px-2 py-2">
					{TIERS.map((option) => {
						const selected = option.id === tier;
						return (
							<button
								key={option.id}
								type="button"
								role="radio"
								aria-checked={selected}
								disabled={auto}
								data-delegation-tier={option.id}
								data-selected={selected || undefined}
								onClick={() => write({ subAgentDelegation: option.id })}
								className={`flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-[var(--ly-t-quick)] ${
									auto ? "cursor-default" : "hover:bg-card-hover"
								} ${selected ? "bg-card-hover" : ""}`}
							>
								{/*
								 * 选中的记号一直占着位，没选中的时候是透明的。
								 *
								 * 不占位的话，五行文字会随着选中项在两个缩进之间来回跳——而这一列文字正是
								 * 用户在做选择时逐行读的东西。
								 */}
								<Check
									size={15}
									strokeWidth={2.2}
									className={`mt-[3px] shrink-0 ${selected ? "text-accent" : "opacity-0"}`}
								/>
								<span className="min-w-0 flex-1">
									<span className="flex flex-wrap items-center gap-2">
										<span className={`text-body ${auto && !selected ? "text-ink-faint" : "text-ink"}`}>{t(option.nameKey)}</span>
										{option.id === "selective" && <span className="text-detail text-ink-faint">{t("common.default")}</span>}
										{auto && selected && (
											<span className="rounded-full bg-accent/15 px-2 py-0.5 text-detail leading-[18px] text-accent">{t("common.current")}</span>
										)}
									</span>
									<span className={`mt-0.5 block text-label leading-relaxed ${auto && !selected ? "text-ink-faint" : "text-ink-muted"}`}>
										{t(option.detailKey)}
									</span>
								</span>
								{/*
								 * 只有跟随等级时才说哪些等级落在这一档——钉死之后，等级跟这里再无关系，
								 * 继续显示它就是在指一条已经断掉的因果。
								 */}
								{auto && option.levelsKey && (
									<span className="shrink-0 pt-0.5 text-detail whitespace-nowrap text-ink-faint">{t(option.levelsKey)}</span>
								)}
							</button>
						);
					})}
				</div>
			</Card>

			<SectionTitle>{t("delegation.concurrencyLimit")}</SectionTitle>
			<Card>
				{/*
				 * 一句静态的说明，不报「这一轮实际几个」。
				 *
				 * 那个数字试过，撤了：它把一个设置变成了两个数字——你设的和真正生效的——而看到两个
				 * 数字的人第一反应是自己设错了。低档位会在这个上限底下再收一道是真的，但那是档位那
				 * 张卡片的事，在这里说只会让人对着一个跟着别处变的数字发愣。
				 */}
				<Row
					title={t("delegation.concurrency")}
					detail={t("delegation.overflowDetail")}
					control={
						<ConcurrencyField
							value={settings.maxConcurrentSubAgents}
							onCommit={(maxConcurrentSubAgents) => write({ maxConcurrentSubAgents })}
						/>
					}
				/>
			</Card>
		</div>
	);
}

/*
 * 标准等级的名字，存 key 而不是存译好的字。
 *
 * 跟推理强度菜单里用的是同一套词。这张表在模块加载时成型，那会儿窗口还没说自己是哪种语言，
 * 之后换语言也不会重算——所以译不能发生在这里。自定义等级不在表里，按原样显示。
 */
const THINKING_LABELS: Record<string, MessageKey> = {
	off: "thinking.off",
	minimal: "thinking.minimal",
	low: "thinking.low",
	medium: "thinking.medium",
	high: "thinking.high",
	xhigh: "thinking.xhigh",
	max: "thinking.max",
	ultra: "thinking.ultra",
};

/**
 * 一个停下来才写出去的数字。
 *
 * 跟重试设置里那个同一个道理：每次按键都提交，会在去 `10` 的路上先存一个 `1`——而这个值会立刻
 * 变成正在跑的那道闸门的宽度。只在失焦时提交又会吞掉「改完就关窗」的那次修改。所以：有焦点时
 * 文本是本地的，停手三分之一秒后落盘，失焦时立刻落盘并回到存下来的规范值。
 */
function ConcurrencyField({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
	const { t } = useI18n();
	const [typed, setTyped] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	const commit = (raw: string, now: boolean) => {
		clearTimeout(timer.current);
		const parsed = Number(raw);
		if (raw.trim() === "" || !Number.isFinite(parsed)) return;
		const clamped = Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(parsed)));
		if (now) onCommit(clamped);
		else timer.current = setTimeout(() => onCommit(clamped), 300);
	};

	return (
		<div className="flex items-center gap-2">
			<Input
				type="number"
				aria-label={t("delegation.concurrencyAria")}
				min={1}
				max={MAX_CONCURRENCY}
				step={1}
				value={typed ?? String(value)}
				onChange={(event) => {
					setTyped(event.target.value);
					commit(event.target.value, false);
				}}
				onBlur={(event) => {
					commit(event.target.value, true);
					setTyped(null);
				}}
				className="h-[30px] w-[72px] rounded-lg border border-line bg-input px-2 text-label text-ink tabular-nums"
			/>
			<span className="text-label text-ink-muted">{t("common.countUnit")}</span>
		</div>
	);
}
