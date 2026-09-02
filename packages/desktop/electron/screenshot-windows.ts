/**
 * Where the windows on screen are, so a capture can offer one whole.
 *
 * Pointing at a window and getting exactly that window is what everyone expects of a screenshot
 * tool, and it needs something Electron does not expose: `desktopCapturer` will hand over a
 * window's *picture* but never says where it sits. macOS knows — `CGWindowListCopyWindowInfo` is
 * the list the Window Server keeps — and the question is only how to ask from here.
 *
 * Through `osascript -l JavaScript`, which reaches CoreGraphics over the ObjC bridge. The
 * alternatives are worse in specific ways: a native addon is a compiler and a build matrix for one
 * function; `koffi` means hand-rolling CFArray and CFDictionary access and shipping a platform
 * binary that `electron-builder` currently leaves out; and System Events, the obvious AppleScript
 * route, needs accessibility permission — a second scary dialog for something the screen recording
 * permission already covers.
 *
 * Read once when a capture starts rather than polled. The desktop does not rearrange itself while
 * the overlay is up: it is a frozen picture of that exact moment, so a list from that same moment
 * is the one that matches it.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listWin32Windows } from "./screenshot-windows-win32.ts";

const execFileAsync = promisify(execFile);

export interface WindowRect {
	x: number;
	y: number;
	width: number;
	height: number;
	/** The owning application, kept for the label and for leaving our own overlay out. */
	app: string;
}

/**
 * `kCGWindowLayer === 0` is the ordinary window layer.
 *
 * Everything else is furniture — the menu bar, the Dock, notification banners, the wallpaper — and
 * offering to capture "the Dock" as if it were a document window is not useful. The size floor
 * drops the one-pixel helper windows that several apps keep around, which would otherwise be
 * plausible-looking targets that highlight and cover nothing.
 */
const SCRIPT = `
ObjC.import("CoreGraphics");
ObjC.import("Foundation");
const ref = $.CGWindowListCopyWindowInfo(
  $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements,
  $.kCGNullWindowID,
);
const all = ObjC.deepUnwrap(ObjC.castRefToObject(ref)) || [];
JSON.stringify(
  all
    .filter((w) => w.kCGWindowLayer === 0 && w.kCGWindowBounds && w.kCGWindowBounds.Width > 60 && w.kCGWindowBounds.Height > 60)
    .map((w) => ({
      x: w.kCGWindowBounds.X,
      y: w.kCGWindowBounds.Y,
      width: w.kCGWindowBounds.Width,
      height: w.kCGWindowBounds.Height,
      app: String(w.kCGWindowOwnerName || ""),
    })),
);
`;

/**
 * The on-screen windows, front to back, in coordinates local to the given display.
 *
 * Front to back is the order the Window Server returns and the order that matters: the window under
 * the pointer is the first one in the list that contains it, exactly as clicking would decide.
 *
 * Never throws. A capture that cannot enumerate windows is a capture without the window-picking
 * convenience, not a broken one — so a failure here returns nothing and the overlay carries on as
 * a plain drag-to-select.
 */
export async function listWindows(display: { x: number; y: number; width: number; height: number; scaleFactor?: number }): Promise<WindowRect[]> {
	if (process.platform === "win32") {
		return listWin32Windows(display);
	}
	if (process.platform !== "darwin") return [];
	try {
		const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", SCRIPT], {
			timeout: 2000,
			maxBuffer: 4 * 1024 * 1024,
		});
		const raw = JSON.parse(stdout.trim() || "[]") as WindowRect[];
		return raw
			// Into the overlay's own coordinate space: it covers one display, whose origin is not
			// necessarily the origin of the desktop.
			.map((w) => ({ ...w, x: w.x - display.x, y: w.y - display.y }))
			// Anything wholly off this display belongs to another one and cannot be pointed at here.
			.filter((w) => w.x < display.width && w.y < display.height && w.x + w.width > 0 && w.y + w.height > 0);
	} catch (err) {
		console.error("[screenshot] 读取窗口列表失败，将只能手动框选:", err);
		return [];
	}
}
