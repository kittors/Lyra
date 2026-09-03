/**
 * Making CodeMirror look like the rest of the app.
 *
 * Every surface it draws — gutters, the search panel, the completion popup — restyled onto the
 * app's own tokens, so the editor is not a differently-themed rectangle inside it.
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { ATOM } from "../../lib/code/highlight.ts";

/**
 * Chrome colours, taken from the app's own tokens.
 *
 * CodeMirror emits real CSS, so `var(...)` works here — which means the editor follows a theme
 * change with everything else instead of needing to be rebuilt.
 */
export function editorTheme(): Extension {
	return EditorView.theme({
		/*
		 * The code theme's own surface, not the app's.
		 *
		 * This said `transparent` over `--color-ink`, which meant the editor showed whatever panel
		 * was behind it in whatever colour the UI used for body text — so choosing Solarized Light
		 * changed the syntax colours and left the page white underneath them. The theme declares a
		 * background and a foreground; these are them.
		 */
		"&": { backgroundColor: "var(--ly-code-bg)", color: "var(--ly-code-fg)", height: "100%" },
		".cm-content": {
			fontFamily: "var(--ly-code-font)",
			fontSize: "var(--text-code)",
			/*
			 * The other two halves of 代码外观, which this rule was missing.
			 *
			 * Family, size and line height were here; weight and tracking were not, so two of the
			 * five controls in the settings panel moved the preview and changed nothing in the
			 * editor. Same variables the diff viewer and the Markdown blocks read, so all three
			 * agree — and because CodeMirror emits real CSS, `var()` means a settings change
			 * repaints rather than rebuilds.
			 */
			fontWeight: "var(--text-code--weight)",
			letterSpacing: "var(--text-code--tracking)",
			/*
			 * At least as wide as the pane, so the active line's band reaches the right edge.
			 *
			 * Without it the content box is only as wide as its longest line, and the current-line
			 * highlight stops there — a short file in a wide pane gets a stripe across the first
			 * third and bare background after it, which reads as a rendering fault rather than as
			 * a highlight.
			 */
			minWidth: "100%",
			padding: "6px 0 40px",
			caretColor: "var(--color-ink)",
		},
		".cm-scroller": { overflow: "auto", lineHeight: "var(--text-code--line-height)" },
		"&.cm-focused": { outline: "none" },
		/*
		 * Opaque, because the gutter is pinned while the code scrolls under it.
		 *
		 * Transparent was fine for as long as lines always wrapped — nothing ever passed beneath.
		 * With wrapping off, a long line scrolls straight through the line numbers and the two
		 * render on top of each other. The fill has to be the pane's own colour rather than a
		 * tint, or the seam shows as a stripe down the left of every file.
		 */
		".cm-gutters": {
			// One step off the code's surface — see `--ly-code-bg-soft` in `theme.ts`.
			backgroundColor: "var(--ly-code-bg-soft)",
			color: "color-mix(in srgb, var(--ly-code-fg) 55%, var(--ly-code-bg))",
			border: "none",
			fontFamily: "var(--ly-code-font)",
			fontSize: "calc(var(--text-code) - 1px)",
		},
		// Matches `.cm-activeLine` exactly, so the highlight reads as one band across both.
		".cm-activeLineGutter": {
			backgroundColor: "color-mix(in srgb, var(--ly-code-fg) 7%, var(--ly-code-bg-soft))",
			color: "var(--ly-code-fg)",
		},
		".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--ly-code-fg) 5%, transparent)" },
		".cm-selectionBackground, ::selection": {
			backgroundColor: "color-mix(in srgb, var(--color-info) 22%, transparent) !important",
		},
		".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
		".cm-matchingBracket": {
			backgroundColor: "color-mix(in srgb, var(--color-info) 18%, transparent)",
			outline: "none",
		},
		".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--color-info) 12%, transparent)" },
		/*
		 * The find/replace panel, restyled to the app's controls.
		 *
		 * CodeMirror ships a functional panel that looks like a browser dialogue from 2005 —
		 * beige buttons, a 1px inset border, its own font. Everything here maps it onto the
		 * tokens the rest of the app uses, so the one moment you press ⌘F does not open a
		 * different application inside this one.
		 */
		/*
		 * The find bar floats over the code rather than pushing it down.
		 *
		 * As a full-width strip it had to be laid out like one: controls at the left, and a few
		 * hundred pixels of nothing to their right that read as an unfinished toolbar. Every
		 * editor worth copying puts find in a small card in the corner instead — it is a tool you
		 * summon, not a part of the chrome, and it costs the document no vertical space.
		 *
		 * `position: absolute` takes the panel container out of the flex column, so the editor
		 * keeps its full height and the card sits on top of the first line or two.
		 */
		/*
		 * Inset far enough to clear the scrollbar.
		 *
		 * The card used to carry its own margin, which pushed it *out* of this container — its
		 * right edge landed 10px past the editor, directly over the overlay scrollbar's 10px
		 * track. Positioning the container instead keeps the card inside it, and 20px of right
		 * inset leaves the track plus a gap.
		 */
		".cm-panels": {
			position: "absolute",
			top: "8px",
			right: "20px",
			// Bounded on the left too: pinned only by its right edge, a card wider than a narrow
			// pane would hang off the other side of the editor.
			left: "8px",
			display: "flex",
			justifyContent: "flex-end",
			zIndex: 5,
			backgroundColor: "transparent",
			color: "var(--color-ink)",
			border: "none",
		},
		/*
		 * Width is fixed, not fitted.
		 *
		 * `fit-content` on a wrapping flex row resolves towards max-content — the width every
		 * control would need on a single line — which left a stretch of empty card between the
		 * last button and the close corner. A stated width makes both rows end at the same edge,
		 * which is what lets the replace actions line up under the navigation.
		 */
		".cm-panel.cm-search": {
			// The card grows from the corner it is pinned to, not from its own centre.
			transformOrigin: "top right",
			width: "440px",
			maxWidth: "100%",
			borderRadius: "10px",
			border: "1px solid var(--color-line)",
			padding: "6px 26px 6px 7px",
			display: "flex",
			flexWrap: "wrap",
			alignItems: "center",
			gap: "3px",
			fontFamily: "var(--ly-ui-font)",
			fontSize: "var(--text-detail)",
		},
		/*
		 * One zero-height full-width pseudo-element, used as a line break.
		 *
		 * The standard trick for forcing a break in a wrapping flex row. CodeMirror's own `<br>`
		 * sits at roughly the right point in the source but will not take a `flex-basis` — a
		 * replaced element ignores it — so it is hidden and this takes over.
		 */
		".cm-panel.cm-search br": { display: "none" },
		".cm-panel.cm-search::before": { content: '""', flex: "0 0 100%", height: 0, order: 5 },
		/*
		 * Reordered, because the source order is not the reading order.
		 *
		 * CodeMirror emits find, its buttons, the option checkboxes, close, then replace and its
		 * buttons — so laid out plainly the replace field lands in the middle of the checkboxes.
		 * This puts each row with its own controls: find with its options and navigation, then
		 * replace with the two things you can replace.
		 */
		/*
		 * The fields have a width, rather than taking whatever is going.
		 *
		 * Left to grow they filled the pane — in a wide panel that meant a 1,100px box to type a
		 * word into, with its buttons stranded at the far end and nothing in between. A find bar
		 * is a compact group of controls, so it stays one and sits at the left edge whatever the
		 * pane is doing. Both fields get the same cap, so in any pane wide enough to reach it the
		 * two rows line up without a spacer propping them apart.
		 *
		 * A cap rather than a basis: `flex-wrap` breaks the line before it shrinks anything, so a
		 * 240px basis in a narrow pane put each field on a row of its own and made the panel
		 * taller instead of narrower. Growing up to a limit collapses gracefully instead.
		 */
		".cm-panel.cm-search button[name=ly-replace-toggle]": {
			order: 0,
			width: "18px",
			height: "22px",
			padding: 0,
			border: "none",
			background: "transparent",
			color: "var(--color-ink-faint)",
			fontSize: "var(--text-caption)",
			lineHeight: "22px",
		},
		".cm-panel.cm-search button[name=ly-replace-toggle]:hover": { color: "var(--color-ink)" },
		".cm-panel.cm-search input[name=replace], .cm-panel.cm-search button[name=replace], .cm-panel.cm-search button[name=replaceAll], .cm-panel.cm-search::before":
			{ display: "none" },
		".cm-panel.cm-search.ly-replace-open input[name=replace], .cm-panel.cm-search.ly-replace-open button[name=replace], .cm-panel.cm-search.ly-replace-open button[name=replaceAll]":
			{ display: "inline-flex" },
		".cm-panel.cm-search.ly-replace-open::before": { display: "block" },
		".cm-panel.cm-search input[name=search]": { order: 1, flex: "1 1 36px", minWidth: "36px", maxWidth: "236px" },
		".cm-panel.cm-search [name=next], .cm-panel.cm-search [name=prev], .cm-panel.cm-search [name=select]": {
			order: 3,
		},
		".cm-panel.cm-search input[name=replace]": { order: 6, flex: "1 1 36px", minWidth: "36px", maxWidth: "236px", marginLeft: "23px" },
		".cm-panel.cm-search [name=replace], .cm-panel.cm-search [name=replaceAll]": { order: 7 },
		".cm-panel.cm-search button[name=replace]": { marginLeft: "auto" },
		".cm-textfield": {
			// Otherwise the flex basis is the content box and each field silently occupies 24px
			// more than it claims — enough, in a narrow pane, to push the close button off the row.
			boxSizing: "border-box",
			backgroundColor: "var(--color-input)",
			color: "var(--color-ink)",
			border: "1px solid var(--color-line)",
			borderRadius: "7px",
			padding: "0 8px",
			height: "24px",
			fontSize: "var(--text-detail)",
			fontFamily: "var(--ly-ui-font)",
			outline: "none",
		},
		".cm-textfield:focus": { borderColor: "var(--color-ink-faint)" },
		/*
		 * Icons, not sentences.
		 *
		 * Five text buttons and three checkbox labels wrapped onto four rows in a docked panel —
		 * a find bar taller than the code it was searching. The words move into `title` and the
		 * glyph carries the meaning, which is what every editor's find bar does.
		 *
		 * The label text is pushed out of view rather than removed: it is still the button's
		 * accessible name, and `display: none` on it would take that away.
		 */
		/*
		 * The icon buttons are tiles, not boxed buttons.
		 *
		 * CodeMirror tags them `cm-button`, which carries a border meant for a labelled button —
		 * so half the row (find, step, select all) sat in outlines while the other half (the
		 * three options, which are labels) did not. Same treatment for both: no chrome at rest,
		 * a filled tile under the pointer, exactly like the icon buttons elsewhere in the app.
		 */
		".cm-panel.cm-search button[name]": {
			position: "relative",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: "20px",
			height: "20px",
			padding: 0,
			border: "none",
			borderRadius: "6px",
			background: "transparent",
			fontSize: 0,
			color: "var(--color-ink-faint)",
			transition: "background-color 140ms ease, color 140ms ease",
		},
		".cm-panel.cm-search button[name]:hover": { background: "var(--color-card-hover)", color: "var(--color-ink)" },
		".cm-panel.cm-search button[name]:active": { background: "var(--color-elevated)" },

		/*
		 * The options become the three glyphs every find bar uses, on the first row.
		 *
		 * As words they took a row of their own and made the panel taller than the code it
		 * searches. `Aa`, `.*` and `ab` are the conventional marks, so they need no legend — and
		 * the hidden text is still the label the checkbox is announced with.
		 */
		".cm-panel.cm-search label": {
			order: 2,
			position: "relative",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: "20px",
			height: "20px",
			borderRadius: "6px",
			fontSize: 0,
			color: "var(--color-ink-faint)",
			transition: "background-color 140ms ease, color 140ms ease",
		},
		".cm-panel.cm-search label:hover": { background: "var(--color-card-hover)", color: "var(--color-ink)" },
		".cm-panel.cm-search label:active": { background: "var(--color-elevated)" },
		// The checkbox itself is redundant once the tile can show its own state.
		".cm-panel.cm-search label input[type=checkbox]": {
			position: "absolute",
			width: "100%",
			height: "100%",
			margin: 0,
			opacity: 0,
		},
		".cm-panel.cm-search label:has(:checked)": { background: "var(--color-card-hover)", color: "var(--color-accent)" },
		".cm-button": {
			backgroundColor: "transparent",
			backgroundImage: "none",
			color: "var(--color-ink-muted)",
			border: "1px solid var(--color-line)",
			borderRadius: "7px",
			padding: "0 9px",
			height: "26px",
			fontSize: "var(--text-detail)",
			fontFamily: "var(--ly-ui-font)",
		},
		".cm-button:hover": { backgroundColor: "var(--color-card-hover)", color: "var(--color-ink)" },
		".cm-button:active": { backgroundColor: "var(--color-card-hover)" },
		// The close affordance is an icon, not a control that needs a box round it.
		// Absolutely positioned by CodeMirror's base theme, so it sits outside the flex flow.
		/*
		 * Out of the flow and in the corner.
		 *
		 * The card's corner, like any dismissable card. It was in the flow while the panel was a
		 * full-width strip — out there the corner was hundreds of pixels from everything else —
		 * but the card is 250px wide, so the corner is right next to the controls it closes.
		 */
		".cm-panel.cm-search button[name=close]": {
			position: "absolute",
			top: "4px",
			right: "4px",
			width: "20px",
			height: "20px",
			border: "none",
			background: "transparent",
			padding: 0,
		},
		".cm-panel.cm-search button[name=close]:hover": { background: "var(--color-card-hover)", borderRadius: "5px" },
		/* Booleans, nulls and numbers in YAML, marked by the plugin in highlight.ts. */
		/*
		 * The decoration wraps the syntax span rather than the other way round, so colouring only
		 * the outer element leaves the inner one — which carries the grammar's own plain-text
		 * colour — to win. Both, and the value takes the mark's colour either way.
		 */
		".ly-yaml-atom, .ly-yaml-atom span": { color: ATOM },
		".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--color-info) 24%, transparent)" },
		".cm-searchMatch.cm-searchMatch-selected": {
			backgroundColor: "color-mix(in srgb, var(--color-accent) 42%, transparent)",
		},
		".cm-foldPlaceholder": {
			backgroundColor: "var(--color-card)",
			border: "none",
			color: "var(--color-ink-muted)",
			padding: "0 6px",
			borderRadius: "4px",
		},
	});
}
