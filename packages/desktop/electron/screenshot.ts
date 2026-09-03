/**
 * Screen capture overlay window manager for desktop integration.
 *
 * Creates a full-screen, frameless, transparent overlay across active displays,
 * captures background screen snapshot, and lets the user drag-to-select and annotate
 * directly on top of the frozen screen.
 */

import { join } from "node:path";
import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, nativeImage, screen, systemPreferences } from "electron";
import type { ScreenshotSettings, Settings } from "@lyra/core";

import { resolveSaveDirectory } from "./screenshot-path.ts";
import { listWindows } from "./screenshot-windows.ts";
import { beginCaptureLog, captureLog } from "./screenshot-debug.ts";


/**
 * The overlay. One window, built once, hidden and shown for the rest of the process's life.
 *
 * It used to be built and destroyed per capture, and both of the transitions people complained
 * about were that construction cost, measured in `screenshot-debug.log`:
 *
 *   - Going in took 324ms from the shortcut to the window appearing, of which 177ms is the snapshot
 *     — a system cost — and 147ms was creating a window, loading a page and decoding a data URL.
 *     The picture shown is from the *start* of that, so anything that moved on screen in between
 *     jumps back when the overlay lands. That is the "stretch": not a scale, a step backwards in
 *     time, and the only fix is to make the gap small enough that nothing happens inside it.
 *   - Coming out, `app.hide()` on macOS is not synchronous. Destroying the overlay three
 *     milliseconds later uncovered the main window before the hide had landed, and the log has the
 *     window taking focus 6ms after the hide was asked for and losing it 19ms later — one and a
 *     bit frames of Lyra on screen, which is the flash.
 *
 * A window that is never destroyed has neither cost: showing it is one call, and hiding it happens
 * under the cover of a hide that has already taken effect.
 */
let overlay: BrowserWindow | null = null;
/** The window and its page, once. Retried on failure by clearing it. */
let overlayLoading: Promise<BrowserWindow> | null = null;
/**
 * The "show it anyway" timer for the capture in progress.
 *
 * One window now serves every capture, so a timer left over from a finished one would reveal the
 * next — or an empty overlay over a session that has already been cancelled. Cleared when it fires,
 * when the capture ends, and when another begins.
 */
let failsafeTimer: NodeJS.Timeout | null = null;

function clearFailsafe(): void {
	if (failsafeTimer) clearTimeout(failsafeTimer);
	failsafeTimer = null;
	if (paintFallback) clearTimeout(paintFallback);
	paintFallback = null;
	awaitingPaint = null;
}

/** Which capture this is. See the `session` field of the init message. */
let sessionCount = 0;

/**
 * Whether there is a capture on screen that is meant to be there.
 *
 * Kept rather than asked, because `overlay.isVisible()` answers a different question than the one
 * that matters — a window inside a hidden application reports invisible, and a window the system
 * has restored along with the application reports visible without any capture behind it. Neither
 * confusion is hypothetical: the first is what stopped the overlay ever being hidden, and the
 * second is what `dismissStrayOverlay` exists to catch.
 *
 * Set once a capture has a picture to show and cleared by every close, so "the overlay is up but
 * this is false" means precisely: something put that window on screen and it was not a capture.
 */
let captureActive = false;

/**
 * The main window, if this capture put it away.
 *
 * Activating the overlay activates Lyra, and macOS raises *every* window of an application it
 * activates — so the main window comes up above whatever the user was actually looking at and sits
 * there, out of sight underneath the overlay, for the whole capture. Nothing showed it while the
 * frozen picture covered the screen, which is why this took so long to see: it only appears at the
 * moment that picture goes, and then it is Lyra in front of the browser you were screenshotting.
 *
 * A user's recording caught it exactly: the frozen page is replaced by the Lyra window, and the
 * 「已复制色值」 confirmation lands on top of *that* instead of on the page the colour came from.
 *
 * So it is hidden for the duration — but only when the capture did not come from Lyra in the first
 * place, since a capture started from the app is expected to come back to it.
 */
let steppedAsideMain: BrowserWindow | null = null;

/**
 * Hand back the window this capture put away, without deciding what to do with it.
 *
 * It was hidden rather than made transparent — see `stepMainAside` — so there is nothing to undo
 * here: a hidden window is not catching anything and not showing anything. Whether it comes back
 * depends on how the capture ended, and only the caller knows that. Finishing delivers a picture to
 * Lyra and raises it; cancelling and stepping back leave it away, which is where it was when the
 * capture began. `app.on("activate")` brings it back whenever the user asks.
 */
function releaseSteppedAsideMain(): BrowserWindow | null {
	const main = steppedAsideMain;
	steppedAsideMain = null;
	if (!main || main.isDestroyed()) return null;
	captureLog("close: main window released", { visible: main.isVisible() });
	return main;
}

/**
 * How to show each overlay, by the id of the page that will ask for it.
 *
 * Keyed on `webContents.id` so the renderer needs to send nothing but the fact that it is ready —
 * the sender identifies the window. See `revealScreenshotOverlay`.
 */
const revealers = new Map<number, () => void>();
/**
 * Whether Lyra was the application in front when the screenshot started.
 *
 * Decides where the foreground goes afterwards, and the two answers are opposite. Triggered from
 * inside Lyra — the composer's button, the tray — finishing should come back to Lyra, because that
 * is where the picture is going. Triggered by the global shortcut while reading something else, it
 * should not: taking a screenshot of a browser and being thrown into a different application is
 * the app barging in on work it was only meant to observe.
 *
 * What the fix for the disappearing window actually owed was "do not leave Lyra buried behind two
 * other applications with no way back" — not "always jump to the front".
 */
let cameFromApp = false;
/**
 * Escape while a capture is up, for an overlay that has not been activated.
 *
 * The overlay is shown without taking focus — see `reveal` — so the page's own key handler does not
 * hear anything until it has been pressed on. Cancelling has to work before that: registered when a
 * capture starts and released the moment it ends, so it never shadows the key anywhere else.
 */
let escapeGuard = false;

function holdEscape(on: boolean): void {
	if (on === escapeGuard) return;
	try {
		if (on) escapeGuard = globalShortcut.register("Escape", () => closeScreenshotOverlay({ foreground: false }));
		else {
			globalShortcut.unregister("Escape");
			escapeGuard = false;
		}
	} catch {
		escapeGuard = false;
	}
}
let activeShortcut: string | null = null;
let onCaptureTriggered: (() => void) | null = null;
let currentSettingsProvider: (() => Settings | undefined) | null = null;

function generateScreenshotFilename(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const y = now.getFullYear();
	const m = pad(now.getMonth() + 1);
	const d = pad(now.getDate());
	const hh = pad(now.getHours());
	const mm = pad(now.getMinutes());
	const ss = pad(now.getSeconds());
	return `Screenshot ${y}-${m}-${d} at ${hh}.${mm}.${ss}.png`;
}

/**
 * A picture of one display, as raw RGBA pixels.
 *
 * `desktopCapturer` rather than shelling out to `/usr/sbin/screencapture`. The CLI was macOS-only,
 * and the guard that said so — `if (process.platform !== "darwin") return null` — made screenshots
 * silently do nothing on Windows and Linux: the shortcut fired, no overlay appeared, no error was
 * reported. Electron's own capture works on all three.
 *
 * It also removes a round trip through the filesystem. The old path wrote a PNG to the temp
 * directory, read it back and deleted it, which is three chances to fail on a full disk and a file
 * of the user's screen sitting in `/tmp` in between.
 *
 * `thumbnailSize` is the display in *physical* pixels — `desktopCapturer` scales its thumbnail down
 * to fit whatever it is given, and a Retina screen asked for its logical size comes back at half
 * resolution. The name is misleading: this is the capture size, not a preview.
 */
async function captureFullDisplaySnapshot(displayId?: number): Promise<{ pixels: Buffer; width: number; height: number; scaleFactor: number } | null> {
	const targetDisplay = displayId !== undefined
		? screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
		: screen.getPrimaryDisplay();
	const scaleFactor = targetDisplay.scaleFactor || 1;

	/*
	 * Not having the permission yet is a state, not a failure.
	 *
	 * macOS answers a capture attempt without screen recording access by putting up its own dialog
	 * — the one that names the app and offers to open System Settings. That dialog is the whole
	 * message; an error beside it saying `Failed to get sources.` in English adds nothing, and it
	 * arrived as a red toast because the rejection reached `unhandledRejection` in `main.ts`, which
	 * forwards anything it catches to the window.
	 *
	 * So the attempt is still made — it is what asks the system to put that dialog up, and the only
	 * way the user is ever offered the choice — but a refusal returns quietly from here.
	 */
	if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
		// Asking is what triggers the system prompt; the answer arrives on a later attempt, because
		// screen recording access only takes effect for a process that starts after it is granted.
		await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => []);
		return null;
	}

	try {
		const askedAt = Date.now();
		const sources = await desktopCapturer.getSources({
			types: ["screen"],
			thumbnailSize: {
				width: Math.round(targetDisplay.bounds.width * scaleFactor),
				height: Math.round(targetDisplay.bounds.height * scaleFactor),
			},
			fetchWindowIcons: false,
		});
		const gotAt = Date.now();

		if (sources.length === 0) {
			/*
			 * No sources at all is what a refused permission looks like from here.
			 *
			 * macOS does not fail the call; it returns nothing. Said plainly because the symptom
			 * otherwise is a shortcut that appears to do nothing at all.
			 */
			console.error("[screenshot] no screen sources — screen recording permission is most likely not granted");
			return null;
		}

		// `display_id` is a string on every platform, and absent on some Linux setups — falling back
		// to the first source is right there, where there is only one screen to capture.
		const source = sources.find((candidate) => candidate.display_id === String(targetDisplay.id)) ?? sources[0];
		const image = source.thumbnail;
		if (image.isEmpty()) {
			console.error("[screenshot] the captured image was empty");
			return null;
		}

		const size = image.getSize();
		/*
		 * The pixels themselves, not a PNG of them.
		 *
		 * `toDataURL` measured 133ms on this screen and `toBitmap` measures two — the difference is
		 * an entire PNG encode of a 2940×1912 image, done so it could be decoded again at the other
		 * end of an IPC message. That 133ms was the largest thing Lyra itself contributed to the wait
		 * before a capture appears, and the picture is taken *before* the wait: every millisecond of
		 * it is time in which the screen can change and then appear to snap backwards when the frozen
		 * copy lands on top of it.
		 *
		 * The swap is the platform's BGRA into the RGBA that `ImageData` wants. Five milliseconds
		 * here, on a buffer that is about to be handed over anyway; in the renderer it would be a
		 * 22MB loop on the thread that then has to paint the result.
		 */
		const bmpAt = Date.now();
		const pixels = image.toBitmap();
		const bitmapMs = Date.now() - bmpAt;
		const swapAt = Date.now();
		for (let i = 0; i < pixels.length; i += 4) {
			const b = pixels[i]!;
			pixels[i] = pixels[i + 2]!;
			pixels[i + 2] = b;
		}
		const swapMs = Date.now() - swapAt;
		/*
		 * Where the wait before the overlay appears actually goes.
		 *
		 * This is now almost all of it — building the window and loading its page used to be 147ms
		 * of it and is 9ms since the overlay became permanent. Split in two because the halves have
		 * different answers: `getSources` is the system taking the picture and there is nothing to
		 * be done about it, while `toDataURL` is a PNG encode of a full-resolution screen that this
		 * process is choosing to do.
		 */
		captureLog("snapshot: taken", {
			getSources: gotAt - askedAt,
			toBitmap: bitmapMs,
			bgraSwap: swapMs,
			size,
			bytes: pixels.length,
		});
		return {
			pixels,
			width: size.width,
			height: size.height,
			scaleFactor,
		};
	} catch (err) {
		console.error("[screenshot] failed to capture the display:", err);
		return null;
	}
}

/**
 * Show the overlay that has just finished painting its snapshot.
 *
 * Ignores anything that is not an overlay awaiting reveal, so a stray message cannot raise a
 * window; and ignores a second one, because the failsafe timer may already have shown it.
 */
export function revealScreenshotOverlay(webContentsId: number): void {
	const reveal = revealers.get(webContentsId);
	if (!reveal) return;
	revealers.delete(webContentsId);
	reveal();
}

/**
 * Close and destroy all active overlay windows, and give the app back the foreground.
 *
 * The overlay is `alwaysOnTop` at `screen-saver` level and visible on every workspace — it has to
 * be, or it cannot cover a fullscreen app to take a picture of it. What that costs is where the
 * foreground goes when it is destroyed: macOS hands it to whatever is underneath, which is
 * whatever the user happened to have open before Lyra. The main window is not hidden and not
 * closed; it is simply behind two other applications, which reads as the app having vanished —
 * the dock icon is there and clicking it does nothing, because nothing is minimised.
 *
 * So the return is made explicit. `app.focus({ steal: true })` is the part that matters on macOS:
 * showing and focusing a window belonging to an application that is not frontmost raises it within
 * that application, and leaves the application itself behind.
 */
export function closeScreenshotOverlay(options?: { restoreFocus?: boolean; foreground?: boolean }): void {
	const cover = overlay && !overlay.isDestroyed() && overlay.isVisible() ? overlay : null;
	// Before anything can return early: every path out of here ends the capture, and a flag left set
	// by one of them would tell `dismissStrayOverlay` to keep its hands off the window forever.
	captureActive = false;
	holdEscape(false);
	clearFailsafe();
	// Whatever this capture registered, so a reveal cannot arrive after it is over.
	if (overlay && !overlay.isDestroyed()) revealers.delete(overlay.webContents.id);
	captureLog("close: entered", {
		foregroundOption: options?.foreground,
		restoreFocus: options?.restoreFocus,
		cameFromApp,
		covering: Boolean(cover),
	});
	// Whichever window this capture put away, so the paths below can decide about it.
	const steppedAside = releaseSteppedAsideMain();
	if (!cover) {
		captureLog("close: nothing on screen");
		return;
	}

	/*
	 * Stepping back hides the whole application, overlay included, in one operation.
	 *
	 * `app.hide()` is not synchronous on macOS. The log has it asked for at +630ms, the main window
	 * taking focus at +636ms and losing it again at +655ms — the overlay had been destroyed at
	 * +633ms, in between, so for those nineteen milliseconds there was nothing left covering a
	 * window the system had not yet been told to hide. That is the flash, and it happened on every
	 * single capture in the log.
	 *
	 * Nothing is uncovered here at all. The overlay is left on screen and goes down with everything
	 * else; `settle` marks it hidden afterwards, once the hide has actually landed.
	 */
	const stepBack =
		process.platform === "darwin" &&
		options?.restoreFocus !== false &&
		!(options?.foreground ?? cameFromApp) &&
		!cameFromApp;
	captureLog("close: decided", { stepBack });
	if (stepBack) {
		app.hide();
		captureLog("close: app.hide() called");
		// It keeps its place: the whole application is going with it, and it was not what the user
		// was looking at when this capture began either.
		settleOverlayHidden();
		return;
	}

	// Another capture is about to take its place — see the call in `startScreenshotSession`. The
	// overlay stays exactly where it is; the new session will paint over it.
	if (options?.restoreFocus === false) {
		captureLog("close: superseded — overlay kept for the next capture");
		return;
	}

	/*
	 * Whatever window is not the overlay. Found rather than injected: this module is reached from
	 * a global shortcut, from IPC and from the overlay's own completion, and threading the main
	 * window through all three to be used in one place is bookkeeping in three files.
	 */
	const main = steppedAside ?? BrowserWindow.getAllWindows().find((win) => win !== cover && !win.isDestroyed());

	/*
	 * Cancelling moves nothing at all.
	 *
	 * The log settled this. On a cancel from inside Lyra the main window is *already visible* —
	 * `main.showInactive() {wasVisible: true}` — so the call's only effect is to order it in front of
	 * whatever the user was looking at. That is the flash at the end of a capture, and it is worst
	 * after picking a colour, because the eye is in the middle of the screen when a window jumps to
	 * the front of it. Nothing produced, nothing to deliver, nothing to bring forward.
	 *
	 * Hiding the overlay hands focus back to whatever was under it, which is where it came from.
	 */
	if (!(options?.foreground ?? cameFromApp)) {
		captureLog("close: cancelled — leaving every window where it is", { mainVisible: main?.isVisible() });
		cover.hide();
		settleOverlayHidden();
		return;
	}

	/*
	 * Finishing brings Lyra forward, and does it *under* the overlay.
	 *
	 * The order used to be: take the overlay away, then activate. Between the two the main window is
	 * on screen wearing its inactive look, and the log measured how long for — 58ms from
	 * `main.show()` to `browser-window-focus`, three and a half frames of a window visibly changing
	 * appearance. Activating first means the change happens while the overlay is still covering it,
	 * so what appears when the overlay goes is a window that already looks the way it will look.
	 */
	if (main) {
		if (main.isMinimized()) main.restore();
		captureLog("close: bringing forward under the overlay", { wasVisible: main.isVisible() });
		main.show();
		main.focus();
		app.focus({ steal: true });
	}
	cover.hide();
	settleOverlayHidden();
	captureLog("close: done (brought forward)");
}

/**
 * Mark the overlay hidden after `app.hide()` has taken effect.
 *
 * Two things need this. `hide()` on a window inside an application that is being hidden is a
 * visible event if it runs first — that is the flash — so it has to run after. And an application
 * hidden with a visible window *restores* that window when it comes back: click the dock icon and
 * the overlay would reappear over a screenshot nobody asked for.
 *
 * The delay is for the hide animation, not a guess at scheduling: at this point the application is
 * already off screen, so nothing here can be seen either way.
 */
function settleOverlayHidden(): void {
	setTimeout(() => {
		const win = overlay;
		if (!win || win.isDestroyed()) return;
		/*
		 * Unconditionally, and the condition that used to be here is an entire class of bug.
		 *
		 * It read `if (win.isVisible()) win.hide()`. On macOS every window of a hidden application
		 * reports itself invisible — and the branch that reaches this line hides the application. So
		 * the guard was false exactly where the paragraph above says the hide is needed, and the
		 * window was never taken off screen: still ordered in, going down with the app and coming
		 * back up with it. `e2e/overlay-dismiss-probe.ts` reads the three states out of Electron —
		 * visible before `app.hide()`, invisible 250ms after it, visible again after `app.show()`.
		 *
		 * What came back was the worst possible window to have left behind. Full-screen, at
		 * `screen-saver` level so above the menu bar, on every workspace, still opaque to the mouse
		 * from the capture that set it so — and empty, because the message below had already told the
		 * page to drop its picture. Invisible, in front of everything, and swallowing every click on
		 * the machine. `~/.lyra/screenshot-debug.log` caught the whole loop: `did-become-active` (the
		 * dock icon), then `close: entered {covering: true}` a full 34 seconds later when Escape
		 * finally reached the page and closed a capture the user thought had ended minutes ago. Four
		 * more rounds after that one, because closing it this way hid the application again and left
		 * the same window behind.
		 */
		win.hide();
		/*
		 * And let go of the pointer, whatever else becomes of this window.
		 *
		 * A capture turns this off so the overlay can be drawn on, and nothing turned it back on, so
		 * the property that made a leftover window catastrophic rather than merely untidy outlived
		 * every capture. Restored here as the second half of the answer: the window is off screen,
		 * and if anything ever puts it back it can no longer take the machine down with it.
		 * `startScreenshotSession` sets it false again, so a capture costs nothing for this.
		 */
		win.setIgnoreMouseEvents(true);
		/*
		 * And tell the page the capture is over, so it can let go of the picture.
		 *
		 * Only once it is off screen. The page answers this by throwing away its snapshot, which
		 * takes the frozen desktop off the canvas — visible as a white flash if it arrived while the
		 * overlay was still up. Worth doing at all because that bitmap is a full-resolution copy of
		 * the display: over 20MB on this screen, held for the life of the process by a window that
		 * is not being looked at.
		 */
		if (!win.webContents.isDestroyed()) win.webContents.send("screenshot:hidden");
		captureLog("close: overlay settled hidden");
	}, 250);
}

/**
 * The overlay window and its page, built on first use and kept.
 *
 * Resolves when the document has loaded — not when it has anything to show. What it holds is a
 * blank, hidden, full-screen window with the overlay's JavaScript running in it, ready to be handed
 * a snapshot. That is the 147ms this used to spend inside every capture.
 */
function ensureOverlay(): Promise<BrowserWindow> {
	if (overlay && !overlay.isDestroyed()) return Promise.resolve(overlay);
	if (overlayLoading) return overlayLoading;

	const bounds = screen.getPrimaryDisplay().bounds;
	const win = new BrowserWindow({
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		frame: false,
		transparent: true,
		/*
		 * Hidden until the renderer has the snapshot on screen — see `reveal`.
		 *
		 * Without this the whole handshake is dead code: `show` defaults to true, so the window is
		 * already visible by the time anything can ask for it to be revealed, and `reveal` returns
		 * at its own `isVisible()` guard having done nothing. What the user sees in the meantime is
		 * a transparent full-screen window over everything — the flicker the handshake exists to
		 * remove. It is also what keeps this window out of the way between captures.
		 */
		show: false,
		alwaysOnTop: true,
		skipTaskbar: process.platform !== "darwin",
		resizable: false,
		movable: false,
		fullscreenable: false,
		hasShadow: false,
		// The first press goes to the canvas instead of being spent activating the application.
		acceptFirstMouse: true,
		backgroundColor: "#00000000",
		enableLargerThanScreen: true,
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			// Off, because this window spends its life hidden and a throttled renderer wakes up slowly
			// — which would put back the delay this whole arrangement exists to remove.
			backgroundThrottling: false,
		},
	});

	// Level screen-saver makes sure it sits above normal fullscreen apps and menu bar on macOS
	win.setAlwaysOnTop(true, "screen-saver");
	/*
	 * `skipTransformProcessType` is the whole of the disappearing dock icon, and of the flicker.
	 *
	 * Electron's macOS implementation of `setVisibleOnAllWorkspaces(true)` switches the *process*
	 * between `ForegroundApplication` and `UIElementApplication` — its own documentation says so,
	 * and says what it costs: "this will hide the window and dock for a short time every time it is
	 * called". A `UIElement` process has no dock tile by definition, so the icon does not flicker,
	 * it goes; and because the transform is never undone, it stays gone after the capture ends.
	 * Confirmed by asking LaunchServices what it thinks this process is before and after — see
	 * `e2e/dock-policy-probe.ts`.
	 *
	 * Skipping the transform keeps the process a regular application. The overlay still covers
	 * everything it needs to: `visibleOnFullScreen` puts it over a fullscreen app's space, and the
	 * `screen-saver` level above puts it over the menu bar.
	 */
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });

	/*
	 * Say the bounds again, now that the window is allowed to cover the whole display.
	 *
	 * A window is created inside the *work area* — the screen minus the menu bar and the Dock — so
	 * the size asked for in the constructor comes back trimmed, and the full-screen size only takes
	 * effect once the level set above lets it overhang. On this display that is 1470×859 against a
	 * screen of 1470×956.
	 *
	 * It has to happen here, at construction, and not merely before each capture. The window server
	 * allocates this window's surface the first time it is presented, at whatever size it is then —
	 * and a surface that is 97 points short is stretched to fill the window until a correctly-sized
	 * one replaces it, a frame or two later. That is the "whole screen scales for an instant" on the
	 * first captures, caught in a user's recording as macOS's own size HUD reading `1470 × 859`
	 * while the overlay was up.
	 */
	win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
	captureLog("overlay: window built", { asked: bounds, got: win.getBounds() });

	/*
	 * The id is read now, not in the handler.
	 *
	 * By the time `closed` fires the window is gone, and `win.webContents` throws
	 * `TypeError: Object has been destroyed` rather than returning null. It surfaced as an
	 * `uncaughtException` on every quit — harmless, because nothing runs after it, but it also meant
	 * `revealers` kept the entry for a page that no longer exists, and a process that opened the
	 * overlay many times leaked one closure per capture.
	 *
	 * Nothing caught it because it happens during teardown: the tests have finished asserting, the
	 * app is on its way out, and an unhandled rejection there costs nothing visible.
	 */
	const pageId = win.webContents.id;
	win.on("closed", () => {
		if (overlay === win) overlay = null;
		overlayLoading = null;
		revealers.delete(pageId);
	});

	const devServer = process.env.ELECTRON_RENDERER_URL;
	const load = devServer
		? win.loadURL(`${devServer}#/screenshot-overlay`)
		: win.loadFile(join(import.meta.dirname, "../renderer/index.html"), { hash: "/screenshot-overlay" });

	overlayLoading = new Promise<BrowserWindow>((resolve, reject) => {
		win.webContents.once("did-finish-load", () => {
			overlay = win;
			captureLog("overlay: page loaded");
			resolve(win);
		});
		load.catch((err: unknown) => {
			// Cleared so the next capture builds a fresh one rather than awaiting a promise that will
			// never settle.
			overlayLoading = null;
			if (!win.isDestroyed()) win.destroy();
			reject(err instanceof Error ? err : new Error(String(err)));
		});
	});
	return overlayLoading;
}

/**
 * Build the overlay ahead of time, so the first capture is as quick as the rest.
 *
 * Called once the app is up and idle. Without it the first shortcut of the session pays the full
 * window-and-page cost, which is the very delay that makes the desktop appear to jump.
 */
export function warmScreenshotOverlay(): void {
	ensureOverlay().then(warmFirstPresentation).catch((err: unknown) => {
		console.error("[screenshot] 预热截图窗口失败:", err);
	});
	void warmCapturePipeline();
}

/**
 * Show the overlay once, invisibly, so its first real appearance is not its first appearance.
 *
 * What is left after the timing was fixed: the capture log has the first capture landing in 132ms
 * against an average of 130ms, so it is no longer slower than the rest — and it still looked
 * different going in. The one thing that is only ever true once is this: a window that has been
 * created but never shown has no surface on the window server. Presenting it the first time is not
 * the cheap path the later ones take — layers are created, a surface is allocated and the page is
 * rasterised into it — and until that finishes there is nothing correct to put on screen.
 *
 * So it is done here instead, three seconds after launch with nobody waiting, at zero opacity so
 * there is nothing to see. Opacity rather than off-screen coordinates deliberately: a window parked
 * outside the display could be given a surface for a size it will never be shown at, which is the
 * whole problem again, one build later and harder to find.
 */
function warmFirstPresentation(win: BrowserWindow): void {
	if (win.isDestroyed() || win.isVisible()) return;
	win.setOpacity(0);
	// Invisible is not the same as absent: a transparent full-screen window on top of everything
	// still swallows every click on the screen. For these few frames it must not be there at all.
	win.setIgnoreMouseEvents(true);
	win.showInactive();
	// The size the surface is being allocated at. If this is ever short of the display, the first
	// real capture opens stretched — see the note in `ensureOverlay`.
	captureLog("warm: first presentation", { bounds: win.getBounds(), display: screen.getPrimaryDisplay().bounds });
	/*
	 * Long enough for the compositor to produce a frame, which is what allocates the surface —
	 * returning sooner would hide the window again before the work this exists to do has happened.
	 */
	warmingPresentation = setTimeout(() => {
		warmingPresentation = null;
		if (win.isDestroyed()) return;
		win.hide();
		win.setOpacity(1);
		captureLog("warm: first presentation done");
	}, 220);
}

/** The invisible first presentation, while it is on screen. See `warmFirstPresentation`. */
let warmingPresentation: NodeJS.Timeout | null = null;

/** The overlay that is up but still transparent, waiting to be shown to have painted. */
let awaitingPaint: BrowserWindow | null = null;
let paintFallback: NodeJS.Timeout | null = null;

/**
 * The overlay has produced a frame: let it be seen.
 *
 * Called from the renderer inside an animation frame, which is the first moment a composited frame
 * provably exists — see the note in `reveal`. Anything else risks showing the window while its
 * surface is still being rebuilt, and a surface that is not ready is displayed stretched.
 *
 * Idempotent, because the fallback timer may already have run.
 */
export function overlayPainted(): void {
	if (paintFallback) {
		clearTimeout(paintFallback);
		paintFallback = null;
	}
	const win = awaitingPaint;
	awaitingPaint = null;
	if (!win || win.isDestroyed() || !win.isVisible()) return;
	win.setOpacity(1);
	captureLog("reveal: painted — overlay made visible");
	stepMainAside(win);
}

/**
 * Put the main window away for the rest of the capture.
 *
 * Activating the overlay activates Lyra, and macOS raises every window of an application it
 * activates — so the main window arrives above whatever is being screenshotted and waits there,
 * out of sight beneath the frozen picture. It is what the screen shows the moment that picture goes,
 * and during a colour pick, when the overlay is deliberately click-through, it is what catches every
 * press: invisible, in front, and answering nothing. That was reported as Lyra freezing.
 *
 * `hide()`, not `setOpacity(0)`. A transparent window is not an absent one — the window server goes
 * on listing it and goes on hitting it, which `e2e/main-window-hittest-probe.ts` reads straight out
 * of `CGWindowListCopyWindowInfo`: alpha 0, still on screen, still in front. The same distinction is
 * why `warmFirstPresentation` a few lines up pairs its own `setOpacity(0)` with
 * `setIgnoreMouseEvents(true)`.
 *
 * Timing is the other half. Hiding a window is visible if anything can be seen behind it, so this
 * runs from `overlayPainted` — the first moment the overlay is opaque and covering the screen. And
 * hiding a window makes macOS reassign the key window, which the overlay would otherwise lose along
 * with every `mouseMoved` and every keystroke: no window highlighting, ⌘C doing nothing. Both were
 * measured when this ran before the overlay was up. So the focus is taken straight back.
 */
function stepMainAside(overlayWindow: BrowserWindow): void {
	if (cameFromApp || steppedAsideMain) return;
	const main = BrowserWindow.getAllWindows().find(
		(other) => other !== overlayWindow && !other.isDestroyed() && other.isVisible(),
	);
	if (!main) return;
	main.hide();
	steppedAsideMain = main;
	// Immediately, because the hide above just cost the overlay the key window.
	if (!overlayWindow.isDestroyed()) overlayWindow.focus();
	captureLog("reveal: main window stepped aside", { overlayFocused: overlayWindow.isFocused() });
}

/**
 * Stop the invisible warm-up right now, because a real capture wants the window.
 *
 * Without this a shortcut pressed inside that window lands on an overlay that `reveal` considers
 * already shown — so it is never shown properly, and what is on screen is a fully transparent
 * full-screen window: the capture appears not to open at all. Rare, and permanent for that capture.
 */
function endWarmPresentation(): void {
	if (!warmingPresentation) return;
	clearTimeout(warmingPresentation);
	warmingPresentation = null;
	if (!overlay || overlay.isDestroyed()) return;
	overlay.hide();
	overlay.setOpacity(1);
	captureLog("warm: first presentation cut short by a capture");
}

/**
 * Take a picture nobody will look at, so the first real one is quick.
 *
 * The capture log says the rest of this: `getSources` measured 160-180ms on the first capture after
 * launch and 56-80ms on every one after it, while everything Lyra does with the result — the bitmap,
 * the channel swap, the paint — stayed flat. What varies is macOS setting up a ScreenCaptureKit
 * stream: negotiating the configuration and allocating buffers happens once, and the stream is warm
 * afterwards. Reported as "the first two screenshots still jump", which is exactly what an extra
 * hundred milliseconds before the overlay lands looks like: the frozen picture is taken at the start
 * of that wait, so whatever moves on screen during it is undone in one frame.
 *
 * Full size rather than a token 1×1, because a thumbnail small enough to be free may not be the same
 * path through the capturer — and the point is to warm the path that the real capture takes.
 *
 * Only when access has already been granted. Asking for it is what makes macOS put up its permission
 * dialog, and a dialog that appears three seconds after launch, unprompted, is worse than a slow
 * first capture. Nothing is done with the result; it is dropped.
 */
async function warmCapturePipeline(): Promise<void> {
	if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
		/*
		 * Said out loud, because the symptom of skipping it is subtle and the cause is not obvious.
		 *
		 * Without the warm-up the first capture pays the stream setup — 160ms rather than 60ms — and
		 * that shows up as the first screenshot or two appearing to make the desktop jump. Screen
		 * recording access is revoked whenever the app is signed with a different key, which for a
		 * locally-built copy is every install, so this is the ordinary state of a fresh build and
		 * not an error.
		 */
		captureLog("warm: skipped — no screen recording access yet");
		return;
	}
	const display = screen.getPrimaryDisplay();
	const scale = display.scaleFactor || 1;
	const startedAt = Date.now();
	try {
		await desktopCapturer.getSources({
			types: ["screen"],
			thumbnailSize: {
				width: Math.round(display.bounds.width * scale),
				height: Math.round(display.bounds.height * scale),
			},
			fetchWindowIcons: false,
		});
		captureLog("warm: capture pipeline ready", { ms: Date.now() - startedAt });
	} catch {
		// A warm-up that fails costs the first capture its head start and nothing else.
	}
}

/**
 * A colour has been taken: the capture is visually over, the confirmation is not.
 *
 * The overlay stays on screen for another moment holding nothing but 「已复制色值」, and for that
 * moment it must not behave like a capture. Presses go through it to whatever is underneath, so the
 * desktop is usable the instant it looks usable; Escape goes back to meaning whatever it means in
 * the app the user is actually in.
 *
 * Not a close: `screenshot:cancel` follows on the renderer's own clock once the message has faded,
 * and that is what puts the window away and hands the foreground back.
 */
export function overlayPassedThrough(): void {
	holdEscape(false);
	if (!overlay || overlay.isDestroyed()) return;
	overlay.setIgnoreMouseEvents(true);
	captureLog("colour picked — overlay is now click-through");
}

/**
 * Take the overlay off screen if it is up without a capture behind it.
 *
 * The net under `settleOverlayHidden`, and what justifies having one is the shape of the failure
 * rather than its likelihood: this window covers every pixel of the display at `screen-saver` level
 * and shows nothing between captures, so a copy of it left on screen is not a visible bug — it is a
 * machine that has stopped answering the mouse, with nothing to point at. The user cannot dismiss
 * what they cannot see. The one this is named for could only be escaped by pressing Escape, which
 * is not a thing anyone thinks to do at a desktop that looks perfectly normal.
 *
 * Called when the application is activated, because that is the moment any window the system was
 * holding for it comes back. Swept twice: `did-become-active` and the window actually returning are
 * not ordered against each other, and a check that runs first sees nothing to do.
 */
export function dismissStrayOverlay(): void {
	const sweep = (): void => {
		if (captureActive) return;
		const win = overlay;
		if (!win || win.isDestroyed()) return;
		/*
		 * Not `if (win.isVisible())`, which is the mistake this whole file is about and which this
		 * function had in it too until the experiment in `e2e/tmp-dock-revive-check.ts` caught it.
		 *
		 * An application coming back from hidden takes a few hundred milliseconds to restore its
		 * windows, and `isVisible()` is false for the whole of that — so a net that asked first
		 * looked, saw nothing, and let the window through. Hiding a window that is already hidden
		 * costs nothing, so there is no reason to ask at all: hide it and be right in both orders.
		 */
		const wasOnScreen = win.isVisible();
		win.setIgnoreMouseEvents(true);
		win.hide();
		if (wasOnScreen) captureLog("activation: stray overlay taken off screen");
	};
	/*
	 * Three times, spanning the restore.
	 *
	 * The first runs before the window is back and takes it out of the set macOS is about to
	 * restore; the later two catch it if it got there first. The window is hidden and empty
	 * throughout, so a sweep that finds nothing to do is invisible to the user either way.
	 */
	sweep();
	setTimeout(sweep, 150);
	setTimeout(sweep, 600);
}

/**
 * Whether this is the capture overlay rather than a window the user has anything to do with.
 *
 * It exists for the whole life of the process now, so anything that counts windows — "is there
 * still a window open?", "should the app quit?" — has to be able to leave it out. It is not a
 * window anyone can return to: it is hidden, it has no frame, and it is only ever on screen for the
 * few seconds of a capture.
 */
export function isScreenshotOverlay(win: BrowserWindow): boolean {
	return overlay !== null && win === overlay;
}

/** Let go of the overlay for good — the app is quitting. */
export function destroyScreenshotOverlay(): void {
	releaseSteppedAsideMain();
	const win = overlay;
	overlay = null;
	overlayLoading = null;
	if (win && !win.isDestroyed()) win.destroy();
}

/**
 * Open the interactive fullscreen overlay window on the display where the cursor currently is.
 */
export async function startScreenshotSession(customSettings?: ScreenshotSettings): Promise<void> {
	/*
	 * Asked before anything is shown, because in a moment the overlay itself will be the focused
	 * window and the answer will always be yes. See `cameFromApp`.
	 */
	beginCaptureLog();
	cameFromApp = BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused());
	captureLog("session start", {
		cameFromApp,
		windows: BrowserWindow.getAllWindows().map((w) => ({
			id: w.id,
			focused: w.isFocused(),
			visible: w.isVisible(),
			minimized: w.isMinimized(),
			bounds: w.getBounds(),
		})),
	});

	// The invisible warm-up, if it is still up — it would otherwise leave this capture with a window
	// `reveal` thinks is already shown. See `endWarmPresentation`.
	endWarmPresentation();

	// A leftover overlay from a previous session, cleared without handing the foreground back —
	// this one is about to take it.
	closeScreenshotOverlay({ restoreFocus: false });

	const cursorPoint = screen.getCursorScreenPoint();
	const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
	captureLog("display", {
		cursor: cursorPoint,
		id: currentDisplay.id,
		bounds: currentDisplay.bounds,
		workArea: currentDisplay.workArea,
		scaleFactor: currentDisplay.scaleFactor,
		rotation: currentDisplay.rotation,
	});

	const { bounds } = currentDisplay;
	/*
	 * All three at once, because the delay before the overlay lands is what makes the desktop appear
	 * to jump — the picture it shows is from the beginning of this, so everything that happens on
	 * screen while it is running is undone in one frame when the overlay arrives.
	 *
	 * The window list is a separate process, and after the first capture the window is already built
	 * and its page already loaded, so `ensureOverlay` returns immediately. What is left is the
	 * snapshot, which is the system's own cost and about 170ms of it.
	 */
	const [snapshot, windows, win] = await Promise.all([
		captureFullDisplaySnapshot(currentDisplay.id),
		listWindows(bounds),
		ensureOverlay(),
	]);
	if (!snapshot || win.isDestroyed()) return;
	// There is a picture and a window to put it in, so from here the overlay is on screen on purpose.
	// Set before the window is touched rather than when it is shown, so no arrangement of the reveal
	// can leave it up while this still says nobody asked for it.
	captureActive = true;
	captureLog("snapshot + windows ready", {
		windows: windows.length,
		snapshot: { width: snapshot.width, height: snapshot.height, scaleFactor: snapshot.scaleFactor },
		/*
		 * The number that decides whether the frozen picture matches the screen it covers.
		 *
		 * `desktopCapturer` scales its thumbnail to *fit* what it is asked for; it does not promise
		 * to return it. If these ratios differ the snapshot is stretched to fill the overlay and
		 * everything in it shifts, which looks like the whole screen scaling for a moment.
		 */
		aspect: {
			snapshot: snapshot.width / snapshot.height,
			display: bounds.width / bounds.height,
			matches: Math.abs(snapshot.width / snapshot.height - bounds.width / bounds.height) < 0.001,
			expected: { width: Math.round(bounds.width * snapshot.scaleFactor), height: Math.round(bounds.height * snapshot.scaleFactor) },
		},
	});

	/*
	 * Put it over this display, whichever one the pointer is on.
	 *
	 * Said while the window is hidden and again nothing is being moved on screen — the overlay only
	 * ever appears at a size it has already been set to. A window is otherwise placed inside the
	 * *work area*, the screen minus the menu bar and the Dock, so the full-screen size only takes
	 * effect because the `screen-saver` level lets it overhang.
	 */
	win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
	// Undo a colour pick's pass-through, and any opacity left by the warm-up — the same window served
	// those, and this capture is meant to be seen and drawn on.
	win.setIgnoreMouseEvents(false);
	win.setOpacity(1);
	captureLog("after setBounds", { asked: bounds, got: win.getBounds() });

	/*
	 * Shown when the snapshot is on screen, not when the document has loaded.
	 *
	 * `did-finish-load` only means the page exists. What follows it is an IPC hop, an `Image`
	 * decoding a base64 data URL, and a React effect drawing that image to a canvas — all
	 * asynchronous. Showing the window at the start of that sequence puts an empty transparent
	 * overlay over the screen for a few frames, which is the flicker: the screen appears to blink
	 * before freezing.
	 *
	 * The renderer says when it has painted. The timeout is not a fallback for slowness — it is
	 * for a renderer that fails before it gets there, where the alternative is an invisible window
	 * swallowing every click on the screen with nothing to show for it.
	 */
	const reveal = () => {
		clearFailsafe();
		if (win.isDestroyed()) return;
		/*
		 * Already up, because a capture was started while one was on screen — two presses of the
		 * shortcut in quick succession. The window stays where it is and only the picture changes;
		 * all that is left to do is tell the page it is visible, which is what starts its fade.
		 */
		if (win.isVisible()) {
			holdEscape(true);
			/*
			 * Focus too, which this branch used not to do.
			 *
			 * A window that is not the key window receives no `mouseMoved` and no key presses on
			 * macOS — so the capture that reused this window had no window highlighting and no ⌘C.
			 * Reported as "copying a colour sometimes does nothing", and the log named the cases: the
			 * three sessions that took this branch are the three with no `reveal: after focus` line.
			 *
			 * The window is already up, so this is not deferred the way the fresh path defers it: the
			 * activation repaint it guards against has already happened.
			 */
			win.focus();
			if (!win.webContents.isDestroyed()) win.webContents.send("screenshot:shown");
			captureLog("reveal: already on screen", { focused: win.isFocused() });
			return;
		}
		/*
		 * On screen first, activated a couple of frames later.
		 *
		 * `show()` activates the application and then puts the window up, and activation repaints
		 * every other window of the app from its inactive look to its active one. The log caught
		 * that repaint landing 21ms after the overlay was *marked* visible — inside the gap before
		 * Chromium composites its first frame — so it happened in plain sight, and what it looks
		 * like is the desktop shifting.
		 *
		 * Activating at all is not optional: a window that is not the key window receives no mouse
		 * *movement* on macOS, and everything here that follows the pointer depends on it. Escape is
		 * covered by a global shortcut in the meantime, so nothing is unresponsive during the wait.
		 */
		/*
		 * On screen, but transparent until it has actually produced a frame.
		 *
		 * `screenshot:ready` — the handshake that decides this moment — means the snapshot has been
		 * written into the canvas's *bitmap*. That is CPU-side work, and it says nothing about
		 * whether Chromium has composited it. So the window goes up invisible and is made visible by
		 * `overlayPainted`, which the renderer calls from inside an animation frame — the earliest
		 * point at which a frame provably exists. Measured at 4-15ms, so it costs one frame;
		 * `paintFallback` covers a renderer that never gets there.
		 *
		 * This was written for a stronger claim, which turned out to be false: that a window hidden
		 * for a while loses its surface and briefly shows a stale one stretched to fit, explaining why
		 * the first capture after a pause looks different. Measured — first frame after a sixty-second
		 * pause arrives in 4ms, no slower than one taken seconds after the last capture. See
		 * `first frame` in the capture log. What is left here is the cheap guarantee, not that
		 * explanation; the difference on early captures is still unaccounted for.
		 */
		win.setOpacity(0);
		captureLog("reveal: before showInactive", { bounds: win.getBounds(), visible: win.isVisible() });
		win.showInactive();
		captureLog("reveal: after showInactive", { bounds: win.getBounds(), visible: win.isVisible() });
		holdEscape(true);
		awaitingPaint = win;
		paintFallback = setTimeout(() => {
			paintFallback = null;
			captureLog("reveal: shown without a paint report");
			overlayPainted();
		}, 250);
		setTimeout(() => {
			if (win.isDestroyed()) return;
			win.focus();
			captureLog("reveal: after focus", { bounds: win.getBounds(), focused: win.isFocused() });
		}, 32);
		/*
		 * Now that it is on screen, the renderer can fade the dimming in.
		 *
		 * It cannot start that itself: until this line the page is hidden, a hidden page is not
		 * composited, and a CSS transition started there has no frames to run in — it would jump
		 * straight to its end state and the capture would appear fully dimmed, all at once, which
		 * is exactly the abruptness being fixed.
		 */
		if (!win.webContents.isDestroyed()) win.webContents.send("screenshot:shown");
	};
	const webContentsId = win.webContents.id;
	revealers.set(webContentsId, reveal);
	/*
	 * A renderer that fails before it says it has painted, not a slow one.
	 *
	 * The alternative is an invisible full-screen window swallowing every click on the screen with
	 * nothing to show for it.
	 */
	failsafeTimer = setTimeout(reveal, 1500);

	if (win.webContents.isDestroyed()) {
		// Nothing will be sent, so nothing will be shown: give the flag back rather than leave it
		// standing for a capture that never happened.
		captureActive = false;
		return;
	}
	// Straight out: the page is already loaded — that is what `ensureOverlay` waited for — so there
	// is nothing left between here and the renderer having the picture.
	win.webContents.send("screenshot:init", {
		snapshot: { pixels: snapshot.pixels, width: snapshot.width, height: snapshot.height },
		/*
		 * Which capture this is, because the page is no longer new each time.
		 *
		 * One window serves them all now, so the renderer cannot tell "a fresh capture" from "the
		 * same one again" by the fact that it just loaded. It cannot use the picture either: two
		 * captures of a screen that did not change encode identically.
		 */
		session: ++sessionCount,
		bounds,
		// Where every window is, so pointing at one can offer it whole.
		windows,
		/*
		 * Where the pointer already is, in the overlay's own coordinates.
		 *
		 * Without it the first window is only offered once the mouse *moves*: the overlay opens
		 * under a stationary pointer and no `pointermove` is ever delivered.
		 */
		cursor: { x: cursorPoint.x - bounds.x, y: cursorPoint.y - bounds.y },
		scaleFactor: snapshot.scaleFactor,
		settings: customSettings ?? currentSettingsProvider?.()?.screenshot,
	});
}

/**
 * Handle save/finish from overlay renderer
 */
export async function finishScreenshot(dataUrl: string, settings?: ScreenshotSettings): Promise<{ ok: boolean; filePath?: string }> {
	closeScreenshotOverlay();

	const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
	const buffer = Buffer.from(base64Data, "base64");

	// 1. Copy to clipboard
	const copyToClipboard = settings?.copyToClipboard !== false;
	if (copyToClipboard) {
		const img = nativeImage.createFromBuffer(buffer);
		clipboard.writeImage(img);
	}

	// 2. Save to file if saveLocation is configured
	let filePath: string | undefined;
	if (settings?.saveLocation?.trim()) {
		try {
			const saveDir = resolveSaveDirectory(settings.saveLocation, app.getPath("desktop"));
			const filename = generateScreenshotFilename();
			filePath = join(saveDir, filename);
			const { writeFile, mkdir } = await import("node:fs/promises");
			await mkdir(saveDir, { recursive: true });
			await writeFile(filePath, buffer);
		} catch (err) {
			console.error("[screenshot] failed to save screenshot file:", err);
		}
	}

	return { ok: true, filePath };
}

/**
 * Register global shortcut
 */
export function registerScreenshotShortcut(
	getSettings: () => Settings | undefined,
	onTrigger: () => void,
): void {
	// No platform gate: `globalShortcut` and the capture behind it work on all three. This used to
	// return early anywhere but macOS, which left the shortcut unregistered and the setting for it
	// on screen — a key combination the settings page offered to change and nothing would answer.
	currentSettingsProvider = getSettings;
	onCaptureTriggered = onTrigger;

	let shortcut = getSettings()?.screenshot?.shortcut?.trim();
	if (shortcut) {
		shortcut = shortcut.replace(/Option/gi, "Alt");
	}

	if (activeShortcut) {
		try {
			globalShortcut.unregister(activeShortcut);
		} catch {}
		activeShortcut = null;
	}

	if (!shortcut) return;

	try {
		const success = globalShortcut.register(shortcut, () => {
			startScreenshotSession().catch((err: unknown) => {
				console.error("[screenshot] 快捷键触发的截图失败:", err);
			});
			onCaptureTriggered?.();
		});
		if (success) {
			activeShortcut = shortcut;
		} else {
			console.warn(`[screenshot] 快捷键注册失败: ${shortcut}`);
		}
	} catch (err) {
		console.warn(`[screenshot] 快捷键格式错误: ${shortcut}`, err);
	}
}

export function unregisterScreenshotShortcut(): void {
	if (activeShortcut) {
		try {
			globalShortcut.unregister(activeShortcut);
		} catch {}
		activeShortcut = null;
	}
	onCaptureTriggered = null;
}
