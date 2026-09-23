/**
 * What the capture overlay may do on each platform, as decisions rather than inline checks.
 *
 * `screenshot.ts` was written against macOS and leans on two things Linux does not give it.
 * `BrowserWindow.setOpacity` is a no-op there (Electron implements it on macOS and Windows only),
 * so every "transparent until painted" step shows the window as it is. And `desktopCapturer` on a
 * Wayland session goes through the xdg-desktop-portal screen-cast dialog, so merely *warming* the
 * pipeline asks the user to share their screen — at every launch, unprompted.
 *
 * No Electron here, so the rules are checked per platform in a test.
 */

export interface WarmupPlan {
	/** Build the hidden overlay window and load its page ahead of the first capture. */
	overlay: boolean;
	/** Show it once "invisibly" so the window server allocates its surface — see `warmFirstPresentation`. */
	present: boolean;
	/** Take a throwaway capture so the first real one does not pay the stream setup. */
	capture: boolean;
}

export function warmupPlan(platform: string, enabled: boolean): WarmupPlan {
	/*
	 * Screenshots switched off: nothing. A full-screen window and a screen capture are not worth
	 * preparing for a feature the user turned off — and on Wayland the capture is a dialog.
	 */
	if (!enabled) return { overlay: false, present: false, capture: false };
	if (platform === "linux") {
		/*
		 * The hidden window is kept: it is never mapped, so there is nothing to see or to ask about.
		 *
		 * The first presentation is not: it relies on `setOpacity(0)`, which does nothing here, so
		 * it put a full-screen window up for 220ms — black on an X11 desktop without a compositor.
		 * It exists for macOS's window server anyway.
		 *
		 * The capture is not either. On Wayland it is the portal's 「屏幕共享」 dialog at every launch
		 * (the same bug as VS Code #318759); on X11 it would be harmless, but what it saves was
		 * measured on macOS (ScreenCaptureKit's first stream, 160ms → 60ms) and there is no such
		 * measurement for X11 — not a reason to keep a step that is actively wrong on the other half
		 * of Linux desktops, or to tell the two apart by environment variables that XWayland blurs.
		 */
		return { overlay: true, present: false, capture: false };
	}
	return { overlay: true, present: true, capture: true };
}

/**
 * Whether a capture started over a capture must hide the old overlay, rather than fade it out, to
 * keep it out of the new picture. On Linux fading is a no-op, and the second capture photographed
 * the first one's selection frame, grips and toolbar.
 */
export function hidesOverlayForSnapshot(platform: string): boolean {
	return platform === "linux";
}
