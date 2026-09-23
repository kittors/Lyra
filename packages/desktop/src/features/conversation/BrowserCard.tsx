/**
 * 对话里的那张浏览器卡片：agent 在后台打开的页面，想看的时候从这里点开。
 *
 * agent 调试网页时，浏览器面板不再自己弹出来（见主进程的 `openBrowser`）——它曾经在每次打开、每次
 * 点击时盖到对话上，关掉了，下一次点击又弹回来。页面照样在后台跑，这张卡片是它在对话里留下的痕迹：
 * 页面长什么样、叫什么、在哪，和一颗「打开」。不发 toast：浮在角落、几秒就消失的一条提示，对「后台
 * 开了个网页」这件事来说声音太大，又留不住。
 *
 * 一张卡代表一个标签页，从它的一次 `browser_open` 起，到同一个标签页下一次 `browser_open` 之前。
 * 中间 agent 每点一下、输一段，卡片上的图、标题和地址就换成最新的——隔着几句话也一样，因为卡片说的
 * 是这个标签页，不是它恰好挂在下面的那一段工具调用。
 *
 * 放在对话这一侧、只经 `bridge` 跟浏览器说话，不从浏览器那个域拿东西：那边的状态模块连着 dock，
 * dock 的内置面板又连回对话，从这里引过去就是一个环（`pnpm arch`）。卡片要的也确实只有两件事——
 * 标签页还在不在、打开它——都问主进程就够了，它本来就是标签页的事实来源。
 */

import { Globe, PanelRightOpen } from "lucide-react";
import { useState } from "react";
import type { BrowserResultDetails } from "../../../shared/browser.ts";
import { sessionMediaUrl } from "../../../shared/session-image.ts";
import { useScopedSessionId } from "../../app/session-scope.tsx";
import { useI18n } from "../../i18n/index.ts";
import { bridge } from "../../services/index.ts";
import { useApp, type ToolRun } from "../../store/index.ts";
import { Button } from "../../ui/primitives/Button.tsx";

interface CardView {
	status: ToolRun["status"];
	tabId: string;
	url: string;
	title: string;
	thumbnail: string;
}

/**
 * 一张卡该画什么：按调用顺序读工具记录，从自己那次 `browser_open` 读到同一标签页的下一次为止，
 * 每一样取最新的。
 *
 * 返回字符串，好让选择器按值比较——工具输出每流进来一行，整张记录表就换一份，每次返回一个新对象
 * 会让每张卡片跟着重画一遍。
 */
function viewOf(runs: Record<string, ToolRun>, callId: string): string {
	const entries = Object.values(runs);
	const start = entries.findIndex((run) => run.toolCallId === callId);
	const first = entries[start];
	if (!first) return "";
	const opened = first.result?.details as BrowserResultDetails | undefined;
	const view: CardView = {
		status: first.status,
		tabId: opened?.tabId ?? "",
		url: opened?.url || (typeof first.args.url === "string" ? first.args.url : ""),
		title: opened?.title ?? "",
		thumbnail: opened?.thumbnail ?? "",
	};
	if (view.tabId) {
		for (const run of entries.slice(start + 1)) {
			const details = run.result?.details as BrowserResultDetails | undefined;
			if (details?.kind !== "browser" || details.tabId !== view.tabId) continue;
			if (details.opened) break;
			if (details.url) view.url = details.url;
			if (details.title) view.title = details.title;
			if (details.thumbnail) view.thumbnail = details.thumbnail;
		}
	}
	return JSON.stringify(view);
}

/** 只给网页地址写主机名。本地预览的地址里是一串会话 id，写出来只是噪音。 */
function hostOf(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.host : "";
	} catch {
		return "";
	}
}

/**
 * 一段过程里打开过的页面，一个标签页一张。
 *
 * 同一个标签页在这一段里导航了两次，就只是一个页面、画它最后的样子——前一次打开会被后一次盖掉，
 * 在卡片上也就不必再占一张。
 */
export function BrowserCards({ calls }: { calls: string[] }) {
	const tabs = useApp((s) => calls.map((id) => (s.toolRuns[id]?.result?.details as BrowserResultDetails | undefined)?.tabId ?? "").join("\n"));
	const ids = tabs.split("\n");
	const shown = calls.filter((_, i) => !ids[i] || !ids.slice(i + 1).includes(ids[i]));
	if (shown.length === 0) return null;
	return (
		<div className="flex flex-col gap-2.5">
			{shown.map((id) => <BrowserCard key={id} callId={id} />)}
		</div>
	);
}

function BrowserCard({ callId }: { callId: string }) {
	const { t } = useI18n();
	const sessionId = useScopedSessionId();
	const raw = useApp((s) => viewOf(s.toolRuns, callId));
	// 记的是哪一张图坏了，而不是「坏了」：换成下一张图时它自然就不作数了。
	const [broken, setBroken] = useState("");
	if (!raw) return null;
	const view = JSON.parse(raw) as CardView;
	// 没打开的页面不留卡片：失败本身已经写在工具那一行里了。
	if (view.status === "error") return null;
	const opening = view.status === "running" && !view.tabId;
	const host = hostOf(view.url);
	const title = view.title || host || view.url;
	const picture = view.thumbnail && view.thumbnail !== broken ? view.thumbnail : "";

	/*
	 * 标签页还在就选中它，不在了（关掉了、应用重启过）就按地址重开一个。「还在」只算这个对话自己的：
	 * 同一个 id 落在别的对话名下，那是别人的页面。
	 *
	 * 面板由主进程那一侧展开：这里发出去的命令是人按的，带着 `reveal`——跟地址栏、预览链接是同一条路。
	 */
	const open = async () => {
		try {
			const { tabs } = await bridge.browser.state();
			const alive = tabs.some((entry) => entry.id === view.tabId && (entry.sessionId ?? null) === (sessionId ?? null));
			if (alive) await bridge.browser.command({ type: "select", id: view.tabId });
			else if (view.url) await bridge.browser.command({ type: "open", url: view.url, sessionId, newTab: true });
		} catch (error) {
			useApp.getState().notify(String(error), "error");
		}
	};

	return (
		<section data-browser-card aria-label={title} className="w-full max-w-[420px] overflow-hidden rounded-xl border border-line bg-card/30 text-label">
			{picture && (
				<button
					type="button"
					onClick={() => void open()}
					aria-label={t("browser.card.show")}
					data-ly-tip={t("browser.card.show")}
					className="block w-full border-b border-line-soft"
				>
					<img
						src={sessionMediaUrl(picture)}
						alt=""
						draggable={false}
						onError={() => setBroken(picture)}
						className="aspect-[2/1] w-full object-cover object-top"
					/>
				</button>
			)}
			<div className="flex items-center gap-3 px-3 py-2.5" data-browser-card-row>
				{!picture && (
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card-hover text-ink-muted">
						<Globe size={19} strokeWidth={1.7} className={opening ? "ly-pulse" : ""} />
					</span>
				)}
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-ink" data-ly-tip={view.url || undefined}>{title}</p>
					<p className="truncate text-caption text-ink-faint">
						{host ? `${host} · ` : ""}{opening ? t("browser.card.opening") : t("browser.card.opened")}
					</p>
				</div>
				{!opening && (
					<Button size="sm" variant="subtle" icon={<PanelRightOpen size={14} />} label={t("browser.card.show")} onClick={() => void open()}>
						{t("common.open")}
					</Button>
				)}
			</div>
		</section>
	);
}
