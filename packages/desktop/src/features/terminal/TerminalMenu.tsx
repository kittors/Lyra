/**
 * Copy and paste on a right-click in the terminal.
 *
 * The app's menu for text fields (`InputMenu`) looks for an input under the pointer, and xterm
 * draws on a canvas with its only input hidden off to the side — so a right-click in the terminal
 * offered nothing at all, and on Windows and Linux, where there is no Edit menu to fall back on,
 * the mouse had no way to copy or paste there. The pane claims the right-click first, so the two
 * menus never both open.
 *
 * The hints name the keys that always work: ⌘ on a Mac, Ctrl+Shift elsewhere — plain Ctrl+C there
 * copies only while something is selected, and is the shell's interrupt otherwise.
 */

import { ClipboardPaste, Copy } from "lucide-react";

import { translate } from "../../i18n/translate.ts";
import { macKeyboard } from "../../ui/keyboard.ts";
import { ContextMenu } from "../../ui/overlay/ContextMenu.tsx";
import { MenuItem } from "../../ui/overlay/Menu.tsx";

const ICON = { size: 13, strokeWidth: 1.8 } as const;

export function TerminalMenu({
	at,
	canCopy,
	onCopy,
	onPaste,
	onClose,
}: {
	at: { x: number; y: number };
	/** Whether anything was selected when the menu opened. */
	canCopy: boolean;
	onCopy(): void;
	onPaste(): void;
	onClose(): void;
}) {
	const mac = macKeyboard();
	return (
		<ContextMenu anchor={at} onClose={onClose} width="compact">
			<MenuItem icon={<Copy {...ICON} />} hint={mac ? "⌘C" : "Ctrl+Shift+C"} disabled={!canCopy} onClick={onCopy}>
				{translate("common.copy")}
			</MenuItem>
			<MenuItem icon={<ClipboardPaste {...ICON} />} hint={mac ? "⌘V" : "Ctrl+Shift+V"} onClick={onPaste}>
				{translate("common.paste")}
			</MenuItem>
		</ContextMenu>
	);
}
