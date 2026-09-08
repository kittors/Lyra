import type { SessionMeta } from "@lyra/core";
import { Archive, ArchiveRestore, Folder, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { GhostButton, InlineSelect } from "./controls.tsx";
import { useApp } from "../../store/index.ts";
import { sessionTitle } from "../../lib/session-title.ts";
import { useI18n } from "../../i18n/index.ts";

/**
 * The archive: everything filed away from the sidebar, grouped by project.
 *
 * Archiving is the reversible action the sidebar offers, so this page has to be where it gets
 * reversed. Deleting stays here too, deliberately one step further from the transcript than
 * the archive button is.
 */
export function ArchivedSettings() {
	const { t } = useI18n();
	const sessions = useApp((s) => s.sessions);
	const setArchived = useApp((s) => s.setSessionArchived);
	const deleteSession = useApp((s) => s.deleteSession);
	const deleteAll = useApp((s) => s.deleteArchivedSessions);
	const setView = useApp((s) => s.setView);
	const openSession = useApp((s) => s.openSession);

	const [query, setQuery] = useState("");
	const [project, setProject] = useState("all");
	const confirm = useConfirmer();

	const archived = useMemo(() => sessions.filter((s) => s.archived), [sessions]);

	const projects = useMemo(() => {
		const byPath = new Map<string, { path: string; name: string; count: number }>();
		for (const session of archived) {
			const entry = byPath.get(session.cwd) ?? { path: session.cwd, name: session.projectName, count: 0 };
			entry.count += 1;
			byPath.set(session.cwd, entry);
		}
		return [...byPath.values()].sort((a, b) => b.count - a.count);
	}, [archived]);

	const groups = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const filtered = archived.filter(
			(s) => (project === "all" || s.cwd === project) && (!needle || s.title.toLowerCase().includes(needle)),
		);
		const byPath = new Map<string, { path: string; name: string; sessions: SessionMeta[] }>();
		for (const session of filtered) {
			const entry = byPath.get(session.cwd) ?? { path: session.cwd, name: session.projectName, sessions: [] };
			entry.sessions.push(session);
			byPath.set(session.cwd, entry);
		}
		return [...byPath.values()]
			.map((g) => ({ ...g, sessions: g.sessions.sort((a, b) => b.updatedAt - a.updatedAt) }))
			.sort((a, b) => b.sessions.length - a.sessions.length);
	}, [archived, query, project]);

	return (
		<div className="pt-8">
			<header className="flex flex-wrap items-start justify-between gap-3 pb-6">
				<div className="min-w-0">
					<h1 className="text-heading leading-tight font-semibold tracking-tight text-ink">{t("archived.title")}</h1>
					<p className="mt-1.5 text-label leading-relaxed text-ink-muted">
						归档只是把会话移出侧边栏，记录和用量都还在。取消归档即可放回原来的项目下。
					</p>
				</div>

				{archived.length > 0 && (
					<button
						type="button"
						onClick={() =>
							confirm.ask({
								title: t("archived.deleteAllConfirm", { n: archived.length }),
								detail: t("archived.deleteAllDetail"),
								confirmLabel: t("archived.deleteN", { n: archived.length }),
								onConfirm: () => void deleteAll(),
							})
						}
						data-ly-tip={t("archived.deleteAll", { n: archived.length })}
						aria-label={t("archived.deleteAll", { n: archived.length })}
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-danger/40 text-danger transition-colors hover:bg-danger/10"
					>
						<Trash2 size={13} strokeWidth={2} />
					</button>
				)}
			</header>

			{archived.length === 0 ? (
				<div className="flex flex-col items-center rounded-[12px] border border-dashed border-line py-14">
					<Archive size={26} strokeWidth={1.5} className="text-ink-faint" />
					<p className="mt-3 text-label text-ink-muted">{t("archived.empty")}</p>
					<p className="mt-1 text-detail text-ink-faint">{t("archived.emptyDetail")}</p>
				</div>
			) : (
				<>
					{/* The shared field and the shared dropdown, as everywhere else. */}
					<div className="flex flex-wrap items-center gap-2 pb-5">
						<SearchField
							size="comfortable"
							value={query}
							onChange={setQuery}
							placeholder={t("archived.search")}
							className="min-w-[180px] flex-1"
						/>
						<InlineSelect
							value={project}
							onChange={setProject}
							options={[
								{ value: "all", label: t("common.allProjects") },
								...projects.map((p) => ({ value: p.path, label: `${p.name}（${p.count}）` })),
							]}
						/>
					</div>

					{groups.length === 0 && (
						<p className="py-10 text-center text-label text-ink-faint">{t("archived.noMatch")}</p>
					)}

					{groups.map((group) => (
						<section key={group.path} className="mb-6">
							<div className="flex items-center gap-2 pb-2">
								<Folder size={14} strokeWidth={1.8} className="shrink-0 text-ink-muted" />
								<ScrollText text={group.name} className="min-w-0 text-label text-ink" />
								<span className="shrink-0 text-detail text-ink-faint">{group.sessions.length} 个聊天</span>
							</div>

							<div className="overflow-hidden rounded-[12px] border border-line">
								{group.sessions.map((session, index) => (
									<Row
										key={session.id}
										session={session}
										first={index === 0}
										onOpen={() => {
											/*
											 * 打开就是打开。
											 *
											 * 从前这里顺手把它取消归档——理由是「开着的对话不该在侧边栏里找不到」。
											 * 那个顾虑已经由 `listableSessions` 接手：当前会话不管归没归档都在列表
											 * 里。归不归档只由旁边那个按钮说了算，两处一致。
											 */
											void openSession(session);
											setView("chat");
										}}
										onRestore={() => void setArchived(session, false)}
										onDelete={() => void deleteSession(session)}
									/>
								))}
							</div>
						</section>
					))}
				</>
			)}

			{confirm.element}
		</div>
	);
}

function Row({
	session,
	first,
	onOpen,
	onRestore,
	onDelete,
}: {
	session: SessionMeta;
	first: boolean;
	onOpen: () => void;
	onRestore: () => void;
	onDelete: () => void;
}) {
	const { t } = useI18n();
	const confirm = useConfirmer();

	return (
		<div
			className={`ly-scroll group/row flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover ${
				first ? "" : "border-t border-line-soft"
			}`}
		>
			<button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" data-ly-tip={t("common.open")}>
				<ScrollText text={sessionTitle(session.title)} className="text-label text-ink" />
				<span className="mt-0.5 block text-detail text-ink-faint">
					{formatDate(session.updatedAt)} · {session.messageCount} 条消息
				</span>
			</button>

			{/*
			 * The app's confirmation, not a pair of buttons that replace the row's own.
			 *
			 * This asked properly long before anything else did — by swapping 删除 for 取消 and
			 * 确认删除 in place, which works and is the only place in the app that does it that way.
			 * Same question, same surface as everywhere else now.
			 */}
			<div className="flex shrink-0 items-center gap-1">
				<button
					type="button"
					data-ly-tip={t("common.delete")}
					aria-label={t("archived.deleteNamed", { title: session.title })}
					onClick={() =>
						confirm.ask({
							title: t("archived.deleteOneConfirm"),
							detail: t("archived.deleteOneDetail", { title: session.title, n: session.messageCount }),
							confirmLabel: t("common.delete"),
							onConfirm: onDelete,
						})
					}
					className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-danger/10 hover:text-danger"
				>
					<Trash2 size={13.5} strokeWidth={1.8} />
				</button>
				<GhostButton onClick={onRestore} icon={<ArchiveRestore size={13} strokeWidth={1.8} />} title={t("common.unarchive")} />
			</div>

			{confirm.element}
		</div>
	);
}

function formatDate(ts: number): string {
	return new Date(ts).toLocaleString("zh-CN", {
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
