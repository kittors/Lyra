import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { ErrorBoundary } from "./ui/layout/ErrorBoundary.tsx";
import { ScreenshotOverlay } from "./features/image/ScreenshotOverlay.tsx";
import { installTooltips } from "./ui/overlay/tooltip.ts";
import "./styles.css";

installTooltips();

const isOverlay = window.location.hash.startsWith("#/screenshot-overlay");

/*
 * The capture overlay is a hole in the screen, and `body` is opaque.
 *
 * Both windows load this same document, so the overlay inherits the shell's own background —
 * `--color-shell`, a solid dark. The window itself is transparent, so what shows through for the
 * frame or two before the snapshot is composited is that colour: the capture opens with a dark
 * rectangle where the desktop should be, which reads as the screen flashing or resizing. The
 * snapshot is painted onto a canvas that covers everything, so nothing here needs a background at
 * any point.
 */
if (isOverlay) {
	document.documentElement.style.background = "transparent";
	document.body.style.background = "transparent";
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		{/* Outside `App`, so a throw during its own setup is caught too — that is the case where
		    the window would otherwise be empty grey with nothing to read at all. */}
		<ErrorBoundary>
			{isOverlay ? <ScreenshotOverlay /> : <App />}
		</ErrorBoundary>
	</StrictMode>,
);
