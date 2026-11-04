/**
 * Right-click in a transcript: copy the selection, a link's address, a picture.
 *
 * Electron draws no context menu, so right-clicking a reply did nothing. On Windows, where
 * right-click → 复制 is how text leaves a window, a selection could only be copied with Ctrl+C, a
 * link's address not at all, and a generated picture only through the viewer. Only these rows:
 * what any window offers on the surface of a message. Quoting into the composer or asking the side
 * chat would each need a flow of its own, and neither exists to reuse.
 *
 * Whatever has a menu of its own keeps it — a file path, an attachment mark, a delivered file. Their
 * handlers call `preventDefault`, and this listener, on the document, hears the event after them.
 */

import { Copy, Download, Image as ImageIcon, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { translate } from "../../i18n/translate.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { ContextMenu } from "../../ui/overlay/ContextMenu.tsx";
import { MenuItem, MenuSeparator } from "../../ui/overlay/Menu.tsx";
import { saveImageAs } from "../image/index.ts";

const ICON = { size: 13, strokeWidth: 1.8 } as const;

/** The main conversation's rows and the side chat's: the surfaces a message is drawn on. */
const TRANSCRIPT = "[data-ly-transcript-rows]";
/** Smaller than this is an avatar or an icon, not a picture someone wants out of the window. */
const PICTURE_MIN_PX = 40;

interface Aimed {
	point: { x: number; y: number };
	/** The selection when the menu opened; pressing a row must not be what decides what is copied. */
	range: Range | null;
	text: string;
	link: string | null;
	image: string | null;
}

function aimTranscript(event: Pick<MouseEvent, "target" | "clientX" | "clientY" | "defaultPrevented">): Aimed | null {
	if (event.defaultPrevented) return null;
	const target = event.target;
	if (!(target instanceof Element) || !target.closest(TRANSCRIPT)) return null;
	// The fields in a transcript (editing a sent message) have the edit menu.
	if (target.closest("input, textarea, [contenteditable='true'], .cm-editor")) return null;

	const selection = window.getSelection();
	const text = selection?.toString() ?? "";
	// Only a right-click on what is selected copies it: a selection left in another reply is not what a picture's menu is about.
	const selected = text.trim() && selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
	const range = selected?.intersectsNode(target) ? selected.cloneRange() : null;
	const anchor = target.closest<HTMLAnchorElement>("a[href]");
	const link = anchor && /^(https?|mailto):/i.test(anchor.href) ? anchor.href : null;
	const img = target.closest("img");
	const box = img?.getBoundingClientRect();
	const image = img && box && box.width >= PICTURE_MIN_PX && box.height >= PICTURE_MIN_PX ? img.currentSrc || img.src || null : null;
	if (!range && !link && !image) return null;
	return { point: { x: event.clientX, y: event.clientY }, range, text, link, image };
}

/** The picture's bytes as a PNG or JPEG data URL — the only kinds the system clipboard is given. */
async function clipboardImage(src: string): Promise<string | null> {
	let data: string | null = null;
	if (src.startsWith("data:")) data = src;
	// Another origin to this page: drawn, it taints a canvas, and fetched, it is refused.
	else if (src.startsWith("ly-media:")) data = await bridge.files.mediaDataUrl(src);
	else {
		const blob = await fetch(src).then((response) => response.blob());
		data = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
			reader.readAsDataURL(blob);
		});
	}
	if (!data || /^data:image\/(png|jpe?g)[;,]/i.test(data)) return data;
	// WebP and GIF decode to an empty image in the main process; a canvas re-encodes them.
	const picture = new Image();
	picture.src = data;
	await picture.decode();
	const canvas = document.createElement("canvas");
	canvas.width = picture.naturalWidth;
	canvas.height = picture.naturalHeight;
	canvas.getContext("2d")?.drawImage(picture, 0, 0);
	return canvas.toDataURL("image/png");
}

export function TranscriptMenu() {
	const [aimed, setAimed] = useState<Aimed | null>(null);

	useEffect(() => {
		const onMenu = (event: MouseEvent) => {
			const next = aimTranscript(event);
			if (!next) return;
			event.preventDefault();
			setAimed(next);
		};
		document.addEventListener("contextmenu", onMenu);
		return () => document.removeEventListener("contextmenu", onMenu);
	}, []);

	if (!aimed) return null;

	/** Copied as Ctrl+C copies — with its formatting — from the selection as it was when the menu opened. */
	const copyText = () => {
		const selection = window.getSelection();
		if (aimed.range && selection) {
			selection.removeAllRanges();
			selection.addRange(aimed.range);
			if (document.execCommand("copy")) return;
		}
		void bridge.clipboard.write(aimed.text);
	};

	const copyImage = async (src: string) => {
		const data = await clipboardImage(src).catch(() => null);
		if (!data || !(await bridge.clipboard.writeImage(data))) useApp.getState().notify(translate("transcriptMenu.imageNotCopied"), "error");
	};

	return (
		<ContextMenu anchor={aimed.point} onClose={() => setAimed(null)} width="compact">
			{aimed.range && (
				<MenuItem icon={<Copy {...ICON} />} hint="⌘C" onClick={copyText}>
					{translate("common.copy")}
				</MenuItem>
			)}
			{aimed.link && (
				<MenuItem icon={<Link2 {...ICON} />} onClick={() => void bridge.clipboard.write(aimed.link ?? "")}>
					{translate("transcriptMenu.copyLink")}
				</MenuItem>
			)}
			{aimed.image && (aimed.range || aimed.link) && <MenuSeparator />}
			{aimed.image && (
				<MenuItem icon={<ImageIcon {...ICON} />} onClick={() => void copyImage(aimed.image ?? "")}>
					{translate("attachment.copyImage")}
				</MenuItem>
			)}
			{aimed.image && (
				<MenuItem icon={<Download {...ICON} />} onClick={() => saveImageAs(aimed.image ?? "")}>
					{translate("viewer.saveAs")}
				</MenuItem>
			)}
		</ContextMenu>
	);
}
