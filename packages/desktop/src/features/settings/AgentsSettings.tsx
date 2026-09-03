import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { Badge, Card, EmptyHint, SectionTitle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";

const SOURCE_LABEL: Record<string, string> = { builtin: "内置", workspace: "项目", user: "用户" };

export function AgentsSettings() {
	const activeSessionId = useApp((s) => s.activeSessionId);
	const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(useApp.getState().capabilities);

	useEffect(() => {
		if (!activeSessionId) return;
		void bridge.sessions.capabilities(activeSessionId).then(setCapabilities);
	}, [activeSessionId]);

	const agents = capabilities?.agents ?? [];

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">子智能体</h1>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				子智能体有独立的上下文窗口，只把结论交回主对话。
			</p>

			<SectionTitle>可用（{agents.length}）</SectionTitle>
			<Card className="mb-6">
				{agents.length === 0 ? (
					<EmptyHint>打开一个会话后即可看到可用的子智能体。</EmptyHint>
				) : (
					agents.map((agent) => (
						<div key={agent.name} className="border-b border-line-soft px-4 py-3.5 last:border-b-0">
							<div className="flex items-center gap-2">
								<Bot size={14} strokeWidth={1.8} className="shrink-0 text-info" />
								<span className="font-mono text-label text-ink">{agent.name}</span>
								<Badge tone="muted">{SOURCE_LABEL[agent.source] ?? agent.source}</Badge>
								<Badge tone="muted">
									{agent.tools === "*" ? "全部工具" : `${(agent.tools as string[]).length} 个工具`}
								</Badge>
							</div>
							<p className="mt-1 text-label leading-relaxed text-ink-muted">{agent.description}</p>
						</div>
					))
				)}
			</Card>
		</div>
	);
}
