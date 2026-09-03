/**
 * What you can do to the open file, as marks in the pane's header.
 *
 * They were a labelled toolbar across the top of the viewer: 「在 Zed 中打开」, 「自动换行」, and a
 * couple of others that come and go with the kind of file. That row cost a line of the file for
 * controls that are the same four things every time — worth a glance once, and then furniture. As
 * marks beside the pane's own buttons they take no height at all, and the words they lost are on
 * the tip.
 *
 * Which of them exist depends on the file: 「格式化」 means nothing outside JSON, and Markdown is
 * the only kind with two ways to be read. A control that would do nothing is not drawn disabled —
 * it is not drawn.
 */

import { Braces, Check, ExternalLink, Eye, Pencil, Save, WrapText } from "lucide-react";
import { useEffect, useState } from "react";

import { openLabel, useOpenTarget } from "./open-targets.ts";
import { useApp } from "../../store/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { fileKind } from "./FileViewer.tsx";
import { bridge } from "../../services/index.ts";

/** How long 「已保存」 stays up: long enough to be read, gone before it is furniture. */
const SAVED_NOTICE_MS = 1600;

export function FileActions() {
	const path = useOpenFile((s) => s.path);
	const name = useOpenFile((s) => s.name);
	const contents = useOpenFile((s) => s.contents);
	const draft = useOpenFile((s) => (s.path ? s.drafts[s.path] : undefined));
	const wrap = useOpenFile((s) => s.wrap);
	const showSource = useOpenFile((s) => s.showSource);
	const openTarget = useOpenTarget();

	const [saving, setSaving] = useState(false);
	const [justSaved, setJustSaved] = useState(false);

	useEffect(() => {
		if (!justSaved) return;
		const timer = window.setTimeout(() => setJustSaved(false), SAVED_NOTICE_MS);
		return () => window.clearTimeout(timer);
	}, [justSaved]);

	if (!path || !contents) return null;

	const kind = fileKind(name ?? path, contents);
	const dirty = draft !== undefined && draft !== contents.text;
	const readOnly = contents.truncated;
	const editable = kind === "markdown" || kind === "json" || kind === "text";

	const save = async () => {
		setSaving(true);
		const error = await useOpenFile.getState().save();
		setSaving(false);
		if (error) useApp.getState().notify(error, "error");
		else setJustSaved(true);
	};

	const formatJson = () => {
		const text = draft ?? contents.text;
		try {
			useOpenFile.getState().setDraft(path, `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
		} catch (cause) {
			useApp.getState().notify(`不是合法的 JSON：${cause instanceof Error ? cause.message : String(cause)}`, "error");
		}
	};

	return (
		<>
			{/*
			 * Saved, and then gone.
			 *
			 * A tick where the save button was, for as long as it takes to notice — the alternative
			 * is a button that changes nothing when pressed, which reads as not having worked.
			 */}
			{justSaved && !dirty && (
				<span className="ly-pop flex shrink-0 items-center px-1 text-ok">
					<Check size={12} strokeWidth={2.2} />
				</span>
			)}
			{dirty && !readOnly && (
				<Mark tip={saving ? "保存中…" : "保存 ⌘S"} onClick={() => void save()} disabled={saving} accent>
					<Save size={12} strokeWidth={1.9} />
				</Mark>
			)}
			{readOnly && (
				<span data-ly-tip="文件过大，只读" className="shrink-0 px-1 text-caption text-ink-faint">
					只读
				</span>
			)}

			{kind === "markdown" && (
				<Mark
					tip={showSource ? "预览" : "编辑源码"}
					active={showSource}
					onClick={() => useOpenFile.getState().setShowSource(!showSource)}
				>
					{showSource ? <Eye size={12} strokeWidth={1.9} /> : <Pencil size={12} strokeWidth={1.9} />}
				</Mark>
			)}
			{kind === "json" && !readOnly && (
				<Mark tip="格式化" onClick={formatJson}>
					<Braces size={12} strokeWidth={1.9} />
				</Mark>
			)}
			{/* Not for the Markdown preview, which is prose and wraps regardless. */}
			{editable && !(kind === "markdown" && !showSource) && (
				<Mark tip="自动换行" active={wrap} onClick={() => useOpenFile.getState().setWrap(!wrap)}>
					<WrapText size={12} strokeWidth={1.9} />
				</Mark>
			)}
			{/*
			 * Opens in whatever 「默认文件打开目标」 names.
			 *
			 * That setting existed and was saved, but nothing anywhere read it — the IPC to open a
			 * path in a named app was already there with no caller. This is the one place a file is
			 * on screen with a path in hand, so it is where it belongs.
			 */}
			<Mark tip={openLabel(openTarget)} onClick={() => void bridge.system.openIn(openTarget.id, path)}>
				<ExternalLink size={12} strokeWidth={1.9} />
			</Mark>
		</>
	);
}

/** One mark, sized and coloured like the pane's own header buttons. */
function Mark({
	tip,
	active,
	accent,
	disabled,
	onClick,
	children,
}: {
	tip: string;
	active?: boolean;
	/** For the one that is not a setting but an unfinished action: unsaved edits. */
	accent?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-ly-tip={tip}
			aria-label={tip}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
			className={`flex h-[20px] w-[20px] items-center justify-center rounded-md transition-colors duration-[var(--ly-t-quick)] disabled:opacity-50 ${
				accent
					? "text-accent hover:bg-card-hover"
					: active
						? "bg-card-hover text-ink"
						: "text-ink-faint hover:bg-card-hover hover:text-ink"
			}`}
		>
			{children}
		</button>
	);
}
