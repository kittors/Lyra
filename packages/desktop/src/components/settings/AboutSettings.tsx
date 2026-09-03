import {
	ArrowUpRight,
	DownloadCloud,
	Info,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../store.ts";
import { check, useUpdate } from "../../update/store.ts";
import { versionNote } from "../../update/view.ts";
import { UpdateDialog } from "../modals/UpdateDialog.tsx";
import { Markdown } from "../Markdown.tsx";
import { Card, GhostButton, InlineSelect, PrimaryButton, Row, SectionTitle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";

export function AboutSettings() {
	const { info, phase, checking } = useUpdate();
	const [openDialog, setOpenDialog] = useState(false);
	const [platform, setPlatform] = useState("darwin");
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);

	useEffect(() => {
		void bridge.system.platform().then(setPlatform);
	}, []);

	const available = Boolean(info?.available);
	const interval = settings?.updateCheckIntervalHours ?? 6;

	const setIntervalHours = (hours: number) => {
		if (!settings) return;
		void saveSettings({
			...settings,
			updateCheckIntervalHours: hours,
		});
		import("../../update/store.ts").then(({ restartCheckTimer }) => {
			restartCheckTimer(hours);
		}).catch(() => {});
	};

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-title font-semibold text-ink">关于 Lyra</h2>
				<p className="mt-1 text-label text-ink-muted">
					查看当前应用版本、更新日志、手动检查与配置自动更新频率。
				</p>
			</div>

			<SectionTitle>版本与更新</SectionTitle>
			<Card className="mb-6">
				<Row
					title="当前版本"
					detail={
						<div className="flex flex-col gap-1">
							<span>{versionNote(info, phase)}</span>
							{info?.publishedAt && (
								<span className="text-caption text-ink-faint">
									发布于 {new Date(info.publishedAt).toLocaleDateString()}
								</span>
							)}
						</div>
					}
					control={
						<div className="flex items-center gap-2">
							<GhostButton
								onClick={() => void check(true)}
								disabled={checking}
								icon={<RefreshCw size={13} strokeWidth={2} className={checking ? "ly-spin" : ""} />}
							>
								{checking ? "正在检查…" : "检查更新"}
							</GhostButton>
							{available && (
								<PrimaryButton onClick={() => setOpenDialog(true)}>
									<DownloadCloud size={13} className="mr-1.5 inline" />
									立即更新到 v{info?.latest}
								</PrimaryButton>
							)}
						</div>
					}
				/>

				<Row
					title="自动检查更新周期"
					detail="应用在后台定期检查 GitHub 最新版本。无论如何设置，每次启动应用时均会自动检查一次。"
					control={
						<InlineSelect
							value={String(interval)}
							onChange={(v) => setIntervalHours(Number(v))}
							options={[
								{ value: "1", label: "每 1 小时" },
								{ value: "4", label: "每 4 小时" },
								{ value: "6", label: "每 6 小时（默认）" },
								{ value: "8", label: "每 8 小时" },
								{ value: "12", label: "每 12 小时" },
								{ value: "24", label: "每 24 小时" },
							]}
						/>
					}
				/>

				<Row
					title="运行环境"
					detail={`系统架构与平台环境: ${platform}`}
					control={<span className="font-mono text-label text-ink-faint">{platform}</span>}
				/>
			</Card>

			{/* Release notes section */}
			<SectionTitle>当前版本更新内容</SectionTitle>
			<Card className="mb-6">
				<div className="p-4">
					{info?.notes ? (
						<div className="max-h-[380px] overflow-y-auto pr-2">
							<div className="mb-3 flex items-center gap-2">
								<Sparkles size={16} className="text-accent" />
								<span className="font-medium text-ink">
									{info.available ? `v${info.latest} 更新详情` : `v${info.current} 发版说明`}
								</span>
							</div>
							<Markdown text={info.notes} className="text-label" />
						</div>
					) : (
						<div className="flex flex-col items-center justify-center py-6 text-center text-ink-faint">
							<Info size={20} className="mb-2 opacity-60" />
							<div className="text-label">点击上方「检查更新」获取最新版本详情与更新日志</div>
						</div>
					)}
				</div>
			</Card>

			<SectionTitle>项目与支持</SectionTitle>
			<Card>
				<Row
					title="开源仓库"
					detail="访问 Lyra 的 GitHub 仓库提交反馈或贡献代码"
					control={
						<GhostButton
							onClick={() => void bridge.system.openExternal("https://github.com/kittors/Lyra")}
							icon={<ArrowUpRight size={13} />}
						>
							GitHub 仓库
						</GhostButton>
					}
				/>
				<Row
					title="更新日志与发布页面"
					detail="浏览所有历史版本发布与离线安装包"
					control={
						<GhostButton
							onClick={() =>
								void bridge.system.openExternal(info?.url || "https://github.com/kittors/Lyra/releases")
							}
							icon={<ArrowUpRight size={13} />}
						>
							Releases 页面
						</GhostButton>
					}
				/>
			</Card>

			{openDialog && info && <UpdateDialog info={info} phase={phase} onClose={() => setOpenDialog(false)} />}
		</div>
	);
}