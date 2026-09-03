import { useState } from "react";
import { useApp } from "../../store.ts";
import { Card, EmptyHint, GhostButton, Row, SectionTitle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";

const TOOLS = [
	{
		name: "browser_open",
		detail: "打开一个网址，等脚本跑完，返回渲染后的文本。web_fetch 只能拿到服务端返回的 HTML，对客户端渲染的页面是一具空壳。",
	},
	{ name: "browser_act", detail: "在已打开的页面上点击、输入、列出链接，或执行一段 JavaScript 取值。" },
	{ name: "browser_screenshot", detail: "把当前页面截图交给模型，让它真正看到页面长什么样。" },
];

export function BrowserSettings() {
	const settings = useApp((s) => s.settings);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const [tools, setTools] = useState<string[] | null>(null);

	if (!settings) return null;

	// The browser tools are contributed by the desktop host, so their presence is only
	// observable through a live session's tool list.
	const check = async () => {
		if (!activeSessionId) return;
		const caps = await bridge.sessions.capabilities(activeSessionId);
		setTools(caps?.toolNames.filter((t) => t.startsWith("browser_")) ?? []);
	};

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">浏览器</h1>
			<p className="mt-2 max-w-[580px] pb-7 text-label leading-relaxed text-ink-muted">
				Agent 驱动真实的浏览器内核，看到的是脚本执行之后、人眼所见的页面。
			</p>

			<SectionTitle>可用工具</SectionTitle>
			<Card className="mb-7">
				{TOOLS.map((tool) => (
					<Row
						key={tool.name}
						title={tool.name}
						detail={tool.detail}
						control={
							tools === null ? null : tools.includes(tool.name) ? (
								<span className="rounded-full bg-ok/15 px-2 py-0.5 text-detail text-ok">已加载</span>
							) : (
								<span className="rounded-full bg-card px-2 py-0.5 text-detail text-ink-faint">未加载</span>
							)
						}
					/>
				))}
				<Row
					title="检查加载状态"
					detail={activeSessionId ? "读取当前会话的工具表" : "先打开一个会话"}
					control={
						<GhostButton disabled={!activeSessionId} onClick={() => void check()}>
							检查
						</GhostButton>
					}
				/>
			</Card>
			{!activeSessionId && (
				<Card className="mt-6">
					<EmptyHint>打开一个会话后即可让 Agent 使用这些工具。</EmptyHint>
				</Card>
			)}
		</div>
	);
}
