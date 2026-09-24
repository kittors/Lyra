import { useI18n } from "../../i18n/index.ts";
import { DROP_INSET, regionForSide } from "./drop.ts";
import { pct, type PaneBox } from "./layout.ts";
import { useSplitOverlay } from "./overlay.ts";
import { paneKey } from "./pane-key.ts";

/**
 * The destination of a conversation drop.
 *
 * Painted in the same share space as the screens, over the *whole* target screen — its title bar
 * and its panels included, because those move with the conversation. A screen's panels are part of
 * it: halving a screen that has a task panel beside its transcript gives the newcomer half of all
 * of it, and the conversation that was there keeps its task panel in the other half. Painting only
 * the transcript column promised a split that left the panel standing on its own across both.
 *
 * `panes` is the fitted layout the workspace draws, so the wash lands exactly on the screen it
 * names; reading the stored shares instead drew it beside a screen the floors had widened.
 *
 * Measuring during render forced a layout of every transcript under the pointer, which is what made
 * the frost hitch as it followed the edge; the shares need no measurement.
 */
export function SplitOverlay({ panes }: { panes: PaneBox[] }) {
	const { t } = useI18n();
	const sessionId = useSplitOverlay((s) => s.sessionId);
	const kind = useSplitOverlay((s) => s.kind);
	const side = useSplitOverlay((s) => s.side);
	if (!sessionId || !kind) return null;
	const pane = panes.find((entry) => paneKey(entry.sessionId) === sessionId);
	if (!pane) return null;
	const half = (kind === "split" || kind === "move") && side ? regionForSide(side) : { left: 0, top: 0, width: 1, height: 1 };
	const label =
		kind === "replace" ? t("split.replace") : kind === "move" ? t("split.moveHere") : kind === "full" ? t("split.noRoom") : t("split.view");
	return (
		<div
			data-ly-split-overlay={kind}
			data-ly-split-side={side ?? ""}
			aria-hidden
			className="pointer-events-none absolute z-30"
			style={{ left: pct(pane.left), top: pct(pane.top), width: pct(pane.width), height: pct(pane.height) }}
		>
			<div
				className={`ly-split-drop absolute flex items-center justify-center ${kind === "full" ? "ly-split-drop-refused" : ""}`}
				style={{
					left: `calc(${half.left * 100}% + ${DROP_INSET}px)`,
					top: `calc(${half.top * 100}% + ${DROP_INSET}px)`,
					width: `calc(${half.width * 100}% - ${DROP_INSET * 2}px)`,
					height: `calc(${half.height * 100}% - ${DROP_INSET * 2}px)`,
				}}
			>
				<span
					className={`rounded-full px-3 py-1.5 text-[13px] leading-none font-medium shadow-sm ${
						kind === "full" ? "bg-card text-ink-muted" : "bg-accent text-white"
					}`}
				>
					{label}
				</span>
			</div>
		</div>
	);
}
