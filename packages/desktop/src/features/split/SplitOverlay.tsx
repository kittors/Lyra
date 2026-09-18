import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/index.ts";
import { DROP_INSET, regionForSide } from "./drop.ts";
import { layoutPanes, pct } from "./layout.ts";
import { useSplitOverlay } from "./overlay.ts";
import { paneKey } from "./pane-key.ts";
import { useSplit } from "./store.ts";
import { leafCount } from "./tree.ts";

/**
 * The destination of a conversation drop.
 *
 * Painted in the same share space as the tiles, so a drag does not measure the document.
 * Measuring during render forced a layout of every transcript under the pointer, which is
 * what made the frost hitch as it followed the edge.
 *
 * One screen still has the window conversation chrome *above* `[data-ly-split-root]`.
 * Painting the frost only in the root left that strip empty — a title bar with no title
 * sitting over the landing. The first split therefore portals onto the conversation
 * pane so the wash starts at the window top, the same edge the tiles will use.
 *
 * Only a split or a replace paints this frost. Opening another window is not a drop onto
 * a half of this screen, so it must not reuse the overlay — leaving it up is what locked
 * the main conversation after a drag.
 */
export function SplitOverlay() {
	const { t } = useI18n();
	const sessionId = useSplitOverlay((s) => s.sessionId);
	const kind = useSplitOverlay((s) => s.kind);
	const side = useSplitOverlay((s) => s.side);
	const tree = useSplit((s) => s.tree);
	if (!sessionId || !kind) return null;
	const pane = layoutPanes(tree).find((entry) => paneKey(entry.sessionId) === sessionId);
	if (!pane) return null;
	const half = kind === "split" && side ? regionForSide(side) : { left: 0, top: 0, width: 1, height: 1 };
	const label = kind === "replace" ? t("split.replace") : t("split.view");
	const undivided = leafCount(tree) <= 1;
	const host = undivided ? document.querySelector<HTMLElement>('[data-dock-pane="conversation"]') : null;
	const node = (
		<div
			data-ly-split-overlay={kind}
			data-ly-split-side={side ?? ""}
			aria-hidden
			className="pointer-events-none absolute z-30"
			style={
				host
					? { inset: 0 }
					: {
							left: pct(pane.left),
							top: pct(pane.top),
							width: pct(pane.width),
							height: pct(pane.height),
						}
			}
		>
			<div
				className="ly-split-drop absolute flex items-center justify-center"
				style={{
					left: `calc(${half.left * 100}% + ${DROP_INSET}px)`,
					top: `calc(${half.top * 100}% + ${DROP_INSET}px)`,
					width: `calc(${half.width * 100}% - ${DROP_INSET * 2}px)`,
					height: `calc(${half.height * 100}% - ${DROP_INSET * 2}px)`,
				}}
			>
				<span className="rounded-full bg-accent px-3 py-1.5 text-[13px] leading-none font-medium text-white shadow-sm">
					{label}
				</span>
			</div>
		</div>
	);
	return host ? createPortal(node, host) : node;
}
