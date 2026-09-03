import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./ui/layout/ErrorBoundary.tsx";
import { installTooltips } from "./ui/overlay/tooltip.ts";
import "./styles.css";

installTooltips();

/*
 * The two things this entry can be, each fetched only if it is the one.
 *
 * A screenshot overlay window and the main window are mutually exclusive — the hash decides, at
 * load, and neither ever becomes the other. Importing both statically meant every screenshot
 * window paid for the whole application, and every application window paid for the annotator.
 */
const App = lazy(() => import("./app/App.tsx").then((m) => ({ default: m.App })));
const ScreenshotOverlay = lazy(() =>
	import("./features/image/ScreenshotOverlay.tsx").then((m) => ({ default: m.ScreenshotOverlay })),
);

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
			{/* No fallback: the boot screen is already painted underneath by the preload, and a
			    second loading state on top of it would be a flash rather than an answer. */}
			<Suspense fallback={null}>{isOverlay ? <ScreenshotOverlay /> : <App />}</Suspense>
		</ErrorBoundary>
	</StrictMode>,
);
