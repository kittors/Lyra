/**
 * The keyboard in a menu.
 *
 * ↑ and ↓ move between rows, wrapping; Home and End jump to the ends; → on a row that opens a
 * submenu opens it and moves into it; ← in a submenu closes it and goes back to the row it came
 * from. Enter and Space are each row's own: every row is a button.
 *
 * Menus had none of this — only Escape. Opened with the mouse, focus stayed on the trigger and ↓
 * went nowhere, and Enter pressed the trigger again; on Windows, where menus are walked with the
 * arrow keys, choosing 「向右移动分屏」 by keyboard did nothing at all. So ↓ with focus outside the
 * menu (on its trigger, or nowhere) moves into the first row.
 *
 * A menu with a search field keeps the caret in it: there the arrows move a highlight
 * (`data-ly-active`) and Enter presses the highlighted row. Focus in an editable field outside the
 * menu — the composer, with its own slash and mention lists — is that field's business, never ours.
 */

const ROW = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';

export const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft", "Enter"]);

/** The rows a menu's keys move between: enabled, not hidden, in document order. */
export function menuRows(card: ParentNode): HTMLElement[] {
	return [...card.querySelectorAll<HTMLElement>(ROW)].filter(
		(row) => !(row as HTMLButtonElement).disabled && row.getAttribute("aria-disabled") !== "true" && !row.closest("[hidden],[inert]"),
	);
}

/** The row a navigation key leads to from `current`; null when there is nowhere to go. */
export function stepRow(rows: readonly HTMLElement[], current: HTMLElement | null, key: string): HTMLElement | null {
	if (rows.length === 0) return null;
	const at = current ? rows.indexOf(current) : -1;
	if (key === "Home") return rows[0] ?? null;
	if (key === "End") return rows[rows.length - 1] ?? null;
	if (key === "ArrowDown") return rows[at < 0 ? 0 : (at + 1) % rows.length] ?? null;
	if (key === "ArrowUp") return rows[at < 0 ? rows.length - 1 : (at - 1 + rows.length) % rows.length] ?? null;
	return null;
}

/** The row a submenu was opened from, if this popover is one. */
export function parentRowOf(anchor: unknown): HTMLElement | null {
	if (!(anchor instanceof HTMLElement) || !anchor.closest("[data-ly-popover]")) return null;
	return anchor.matches(ROW) ? anchor : anchor.querySelector<HTMLElement>(ROW);
}

function editable(element: Element): boolean {
	return element.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

export interface MenuKeyTarget {
	card: HTMLElement;
	/** What opened the menu; focus left there by a mouse press still counts as in the menu. */
	anchor: HTMLElement | null;
	/** Set for a submenu: ← closes it and returns here. */
	parentRow: HTMLElement | null;
	depth: number;
	close(): void;
}

/** Act on a key for this menu. True when it was the menu's to take. */
export function handleMenuKey(key: string, menu: MenuKeyTarget): boolean {
	const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const inside = Boolean(active && menu.card.contains(active));
	const onAnchor = Boolean(active && menu.anchor && (menu.anchor === active || menu.anchor.contains(active)));
	if (!inside && !onAnchor && active && active !== document.body && editable(active)) return false;
	const rows = menuRows(menu.card);
	if (rows.length === 0) return false;

	if (inside && active && editable(active)) {
		const lit = rows.find((row) => row.dataset.lyActive === "true") ?? null;
		if (key === "Enter") {
			if (!lit) return false;
			lit.click();
			return true;
		}
		if (key !== "ArrowDown" && key !== "ArrowUp") return false;
		const next = stepRow(rows, lit, key);
		for (const row of rows) row.removeAttribute("data-ly-active");
		if (!next) return false;
		next.dataset.lyActive = "true";
		next.scrollIntoView({ block: "nearest" });
		return true;
	}

	const current = inside && active && rows.includes(active) ? active : null;
	if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
		const next = stepRow(rows, current, key);
		if (!next) return false;
		next.focus();
		next.scrollIntoView({ block: "nearest" });
		return true;
	}
	if (key === "ArrowRight") {
		if (!current || current.getAttribute("aria-haspopup") !== "menu") return false;
		current.click();
		focusFirstRow(menu.depth + 1);
		return true;
	}
	if (key === "ArrowLeft") {
		if (!menu.parentRow) return false;
		const row = menu.parentRow;
		menu.close();
		row.focus();
		return true;
	}
	return false;
}

/** Into a submenu once it has drawn: it mounts on the click, a frame or two after it. */
function focusFirstRow(depth: number, tries = 12): void {
	requestAnimationFrame(() => {
		const card = document.querySelector<HTMLElement>(`[data-ly-popover="${depth}"]`);
		const first = card ? menuRows(card)[0] : undefined;
		if (first) first.focus();
		else if (tries > 0) focusFirstRow(depth, tries - 1);
	});
}
