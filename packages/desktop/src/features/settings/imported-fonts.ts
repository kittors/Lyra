import type { ImportedFontData } from "../../../shared/custom-fonts.ts";
import { bridge, onPhone } from "../../services/index.ts";

const IMPORTED_FAMILY = /Lyra Imported ([a-f0-9]{64})(?![a-f0-9])/u;
const loadingFonts = new Map<string, Promise<void>>();
const loadedFamilies = new Map<string, string>();
let selectionVersion = 0;

export const DEFAULT_UI_FONT_STACK =
	'"Inter Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

export function importedUiFontStack(family: string): string {
	return `"${family}", "PingFang SC", "Microsoft YaHei", sans-serif`;
}

export function importedFontId(stack: string): string | undefined {
	return IMPORTED_FAMILY.exec(stack)?.[1];
}

async function installFont(font: ImportedFontData): Promise<void> {
	if (typeof FontFace === "undefined") throw new Error("当前渲染环境不支持加载自定义字体");

	try {
		const face = new FontFace(font.family, `url("${font.data}")`);
		const loaded = await face.load();
		if (loaded.status !== "loaded") throw new Error(`FontFace 状态为 ${loaded.status}`);
		document.fonts.add(loaded);
		loadedFamilies.set(font.id, font.family);
	} catch (cause) {
		/*
		 * A data: URL cannot have a network problem, but that is what the browser calls this.
		 *
		 * Chromium answers `NetworkError: A network error occurred` for any face its sanitizer
		 * refuses, and it refuses more than corrupt files: AppleGothic and AppleMyungjo, both
		 * shipped with macOS, are turned down for the Apple-specific tables they carry. Passing
		 * that wording through sends someone who imported a font off their own disk to go and look
		 * at their connection. The container was already checked before the file was stored, so at
		 * this point the browser is the one saying no, and it should say so.
		 */
		const rejected = typeof cause === "object" && cause !== null && "name" in cause && cause.name === "NetworkError";
		const detail = rejected ? "浏览器拒绝了这个字体文件（可能用了它不支持的字体表）" : cause instanceof Error ? cause.message : String(cause);
		throw new Error(`字体“${font.name}”无法加载：${detail}`, { cause });
	}
}

/** Load and register one imported face, sharing an in-flight request for the same file. */
export async function loadImportedFont(font: ImportedFontData): Promise<void> {
	let pending = loadingFonts.get(font.id);
	if (!pending) {
		pending = installFont(font).catch((cause: unknown) => {
			loadingFonts.delete(font.id);
			loadedFamilies.delete(font.id);
			throw cause;
		});
		loadingFonts.set(font.id, pending);
	}
	await pending;
}

/** Keep the body override limited to a selected face that the browser has accepted. */
export function syncImportedUiFont(stack: string): void {
	const root = document.documentElement.style;
	if (onPhone()) {
		root.removeProperty("--ly-imported-ui-font");
		return;
	}
	const id = importedFontId(stack);
	const family = id ? loadedFamilies.get(id) : undefined;
	if (family) root.setProperty("--ly-imported-ui-font", `"${family}"`);
	else root.removeProperty("--ly-imported-ui-font");
}

/** Read only the imported faces named by the saved UI and code stacks. */
export async function loadSelectedFonts(uiFont: string, codeFont: string): Promise<void> {
	const version = ++selectionVersion;
	syncImportedUiFont(uiFont);
	if (onPhone()) return;

	const uiId = importedFontId(uiFont);
	const codeId = importedFontId(codeFont);
	const errors: unknown[] = [];

	if (uiId) {
		try {
			await loadImportedFont(await bridge.fonts.read(uiId));
		} catch (cause) {
			errors.push(cause);
		}
		if (version === selectionVersion) syncImportedUiFont(uiFont);
	}

	if (codeId && codeId !== uiId) {
		try {
			await loadImportedFont(await bridge.fonts.read(codeId));
		} catch (cause) {
			errors.push(cause);
		}
	}

	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, "所选导入字体加载失败");
}
