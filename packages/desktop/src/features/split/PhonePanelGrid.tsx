/**
 * A conversation's panels as a row of tiles, for the top of its sheet on a phone.
 *
 * The desktop reaches them from the title bar — three buttons and a menu for the rest. On a phone
 * those were four 44pt marks along the top edge, read by icon alone; here each one has its name
 * under it and the whole row is in reach of the thumb that opened the sheet. A tile for a panel that
 * is already open says so, and opening one brings it to the front, which on a phone is the screen.
 */

import { useLayout } from "../../app/layout.tsx";
import { translate } from "../../i18n/translate.ts";
// Through the dock's front door, from beside the bar that opens it: inside the dock this sat on the path of a cycle back through the browser's store.
import { emptyDockTree, has, toggleScopedPanel, usePaneDock, usePanelDefinitions } from "../dock/index.ts";

export function PhonePanelGrid({ scope, onPick }: { scope: string; onPick: () => void }) {
	const definitions = usePanelDefinitions();
	const tree = usePaneDock((state) => state.trees[scope] ?? emptyDockTree);
	const { compact } = useLayout();
	const shown = definitions.filter((def) => !def.unavailable && def.listed !== false);
	if (shown.length === 0) return null;
	return (
		<div role="group" aria-label={translate("toolbar.panels")} className="ly-phone-panels">
			{shown.map((def) => (
				<button
					key={def.kind}
					type="button"
					data-open={has(tree, def.kind) || undefined}
					onClick={() => {
						// Open, or brought to the front when it already is — never closed from here.
						if (has(tree, def.kind) && usePaneDock.getState().focused[scope] === def.kind) {
							onPick();
							return;
						}
						toggleScopedPanel(scope, def.kind, { compact });
						onPick();
					}}
					className="ly-phone-panel ly-press"
				>
					<span className="ly-phone-panel-mark">
						<def.icon size={21} strokeWidth={1.7} aria-hidden />
					</span>
					<span className="ly-phone-panel-label">{translate(def.label)}</span>
				</button>
			))}
		</div>
	);
}
