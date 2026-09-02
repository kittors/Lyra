/**
 * Native Win32 window detection for screenshot snapping.
 *
 * Traverses top-level windows in Z-order using Win32 API via Koffi,
 * filtering cloaked/hidden/child windows and converting physical coordinates
 * to display-relative logical coordinates.
 */

import koffi from "koffi";
import type { WindowRect } from "./screenshot-windows.ts";

interface Win32Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

let win32Api: {
	enumWindows: (cb: unknown, lparam: bigint) => boolean;
	isWindowVisible: (hwnd: bigint) => boolean;
	isIconic: (hwnd: bigint) => boolean;
	getWindowRect: (hwnd: bigint, outRect: Win32Rect) => boolean;
	getWindowTextW: (hwnd: bigint, buffer: Buffer, maxCount: number) => number;
	getWindowLongW: (hwnd: bigint, index: number) => number;
	getAncestor: (hwnd: bigint, flags: number) => bigint;
	dwmGetWindowAttribute: (hwnd: bigint, dwAttribute: number, pvAttribute: Buffer, cbAttribute: number) => number;
} | null = null;

function getWin32Api() {
	if (win32Api) return win32Api;
	try {
		const user32 = koffi.load("user32.dll");
		const dwmapi = koffi.load("dwmapi.dll");

		koffi.struct("RECT", {
			left: "long",
			top: "long",
			right: "long",
			bottom: "long",
		});

		koffi.proto("bool __stdcall EnumWindowsProc(void* hwnd, intptr_t lparam)");

		win32Api = {
			enumWindows: user32.func("bool __stdcall EnumWindows(EnumWindowsProc* lpEnumFunc, intptr_t lParam)"),
			isWindowVisible: user32.func("bool __stdcall IsWindowVisible(void* hWnd)"),
			isIconic: user32.func("bool __stdcall IsIconic(void* hWnd)"),
			getWindowRect: user32.func("bool __stdcall GetWindowRect(void* hWnd, _Out_ RECT* lpRect)"),
			getWindowTextW: user32.func("int __stdcall GetWindowTextW(void* hWnd, _Out_ uint8_t* lpString, int nMaxCount)"),
			getWindowLongW: user32.func("long __stdcall GetWindowLongW(void* hWnd, int nIndex)"),
			getAncestor: user32.func("void* __stdcall GetAncestor(void* hWnd, uint32_t gaFlags)"),
			dwmGetWindowAttribute: dwmapi.func("long __stdcall DwmGetWindowAttribute(void* hwnd, uint32_t dwAttribute, _Out_ uint8_t* pvAttribute, uint32_t cbAttribute)"),
		};
		return win32Api;
	} catch (err) {
		console.warn("[screenshot-win32] Failed to initialize Win32 APIs:", err);
		return null;
	}
}

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_EX_TOOLWINDOW = 0x00000080;
const DWMWA_CLOAKED = 14;
const GA_ROOTOWNER = 3;

/**
 * List on-screen top-level windows in Z-order on Windows.
 */
export function listWin32Windows(display: { x: number; y: number; width: number; height: number; scaleFactor?: number }): WindowRect[] {
	const api = getWin32Api();
	if (!api) return [];

	const results: WindowRect[] = [];
	const scale = display.scaleFactor || 1;
	const titleBuffer = Buffer.alloc(512);
	const cloakedBuffer = Buffer.alloc(4);

	const callback = koffi.register((hwnd: bigint) => {
		try {
			if (!api.isWindowVisible(hwnd) || api.isIconic(hwnd)) {
				return true;
			}

			const style = api.getWindowLongW(hwnd, GWL_STYLE);
			if (style & WS_CHILD) {
				return true;
			}

			const exStyle = api.getWindowLongW(hwnd, GWL_EXSTYLE);
			if (exStyle & WS_EX_TOOLWINDOW) {
				return true;
			}

			const hr = api.dwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloakedBuffer, 4);
			if (hr === 0 && cloakedBuffer.readInt32LE(0) !== 0) {
				return true;
			}

			const root = api.getAncestor(hwnd, GA_ROOTOWNER);
			if (root && root !== hwnd) {
				const rootStyle = api.getWindowLongW(root, GWL_STYLE);
				if (rootStyle & WS_CHILD) return true;
			}

			const rect: Win32Rect = { left: 0, top: 0, right: 0, bottom: 0 };
			if (!api.getWindowRect(hwnd, rect)) {
				return true;
			}

			const physWidth = rect.right - rect.left;
			const physHeight = rect.bottom - rect.top;

			// Minimum size threshold (logical px > 60)
			if (physWidth < 60 * scale || physHeight < 60 * scale) {
				return true;
			}

			const len = api.getWindowTextW(hwnd, titleBuffer, 256);
			const title = len > 0 ? titleBuffer.subarray(0, len * 2).toString("utf16le").trim() : "";

			// Convert physical screen pixels to logical display-relative coordinates
			const logicalX = Math.round(rect.left / scale) - display.x;
			const logicalY = Math.round(rect.top / scale) - display.y;
			const logicalW = Math.round(physWidth / scale);
			const logicalH = Math.round(physHeight / scale);

			// Intersects with target display
			if (
				logicalX < display.width &&
				logicalY < display.height &&
				logicalX + logicalW > 0 &&
				logicalY + logicalH > 0
			) {
				results.push({
					x: logicalX,
					y: logicalY,
					width: logicalW,
					height: logicalH,
					app: title || "Window",
				});
			}
		} catch {
			// Skip problematic window
		}
		return true;
	}, "EnumWindowsProc*");

	try {
		api.enumWindows(callback, 0n);
	} finally {
		koffi.unregister(callback);
	}

	return results;
}
