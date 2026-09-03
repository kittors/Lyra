/**
 * The two lists that decide what gets asked and what gets refused.
 *
 * Both exist because of the same idea: a prompt that fires constantly stops being a safeguard.
 * So the app asks less — and the price of asking less is that the answers it stops asking for
 * have to be visible and revocable somewhere. This is that somewhere.
 *
 * **Always-allowed** is what you said yes to permanently. Until now it could only grow: every
 * 「始终允许」 added a line nobody could ever see again, which is a permission granted and then
 * lost track of.
 *
 * **Internal hosts** is the other direction. Private addresses are refused outright rather than
 * asked about, because a prompt showing `169.254.169.254` is a question almost nobody can answer
 * correctly. Somebody who really does run a service on their own network needs a way to say so,
 * and it should be a decision made here, deliberately, rather than one made under a prompt in the
 * middle of a turn.
 */

import { Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../store/index.ts";
import { TextInput } from "./inputs.tsx";
import { Card, SectionTitle } from "./layout.tsx";
import { EmptyHint, GhostButton } from "./controls.tsx";

export function AccessSettings() {
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const [host, setHost] = useState("");

	if (!settings) return null;

	const allowed = settings.alwaysAllow ?? [];
	const hosts = settings.allowedHosts ?? [];

	const addHost = () => {
		const value = host.trim().toLowerCase();
		if (!value || hosts.includes(value)) return;
		void saveSettings({ ...settings, allowedHosts: [...hosts, value] });
		setHost("");
	};

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">访问授权</h1>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				你点过「始终允许」的，和你允许 agent 访问的内网地址。都可以随时收回。
			</p>

			<SectionTitle>始终允许</SectionTitle>
			<Card className="mb-6">
				{allowed.length === 0 ? (
					<div className="px-4 py-6">
						<EmptyHint>还没有。批准弹窗上点「始终允许」就会记在这里。</EmptyHint>
					</div>
				) : (
					allowed.map((subject, index) => (
						<div
							key={subject}
							className={`group/row flex items-center gap-3 px-4 py-2.5 ${index === 0 ? "" : "border-t border-line-soft"}`}
						>
							<ShieldCheck size={14} strokeWidth={1.8} className="shrink-0 text-ok" />
							{/* The whole subject, wrapped rather than cut: these are commands and origins, and
							    the end of one is often the part that tells you what it was. */}
							<span className="min-w-0 flex-1 font-mono text-detail leading-relaxed break-all text-ink">{subject}</span>
							<button
								type="button"
								data-ly-tip="不再自动允许"
								aria-label={`不再自动允许 ${subject}`}
								onClick={() =>
									void saveSettings({ ...settings, alwaysAllow: allowed.filter((entry) => entry !== subject) })
								}
								className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition-all group-hover/row:opacity-100 hover:text-danger focus-visible:opacity-100"
							>
								<Trash2 size={13} strokeWidth={1.8} />
							</button>
						</div>
					))
				)}
			</Card>

			<SectionTitle>内网地址</SectionTitle>
			<p className="mb-2 max-w-[600px] text-detail leading-relaxed text-ink-faint">
				私有网段和云元数据地址默认一律拒绝，不会来问你 —— 那种地址光看 URL 判断不了好坏。
				如果你确实有自建服务要让 agent 访问，在这里按主机名加进来。
			</p>
			<Card className="mb-6">
				<div className="flex items-center gap-2 px-4 py-3">
					<TextInput
						value={host}
						onChange={setHost}
						placeholder="例如 nas.local 或 gitlab.internal"
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								addHost();
							}
						}}
					/>
					<GhostButton onClick={addHost} disabled={!host.trim()}>
						<Plus size={13} strokeWidth={2} />
						添加
					</GhostButton>
				</div>

				{hosts.length > 0 && (
					<div className="flex flex-wrap gap-1.5 border-t border-line-soft px-4 py-3">
						{hosts.map((entry) => (
							<span
								key={entry}
								className="flex items-center gap-1.5 rounded-md border border-line bg-card px-2 py-1 font-mono text-caption text-ink"
							>
								{entry}
								<button
									type="button"
									aria-label={`移除 ${entry}`}
									onClick={() =>
										void saveSettings({ ...settings, allowedHosts: hosts.filter((h) => h !== entry) })
									}
									className="text-ink-faint transition-colors hover:text-danger"
								>
									<X size={11} strokeWidth={2.4} />
								</button>
							</span>
						))}
					</div>
				)}
			</Card>

			{/*
			 * The limit of what a name can buy you, said plainly — otherwise this list reads as a
			 * general override, and somebody would use it as one.
			 */}
			<p className="max-w-[600px] pb-8 text-detail leading-relaxed text-ink-faint">
				按主机名匹配。一个公网域名如果解析到私有地址，仍然会被拒绝 —— 那是攻击的形状，不是配置的形状。
			</p>
		</div>
	);
}
