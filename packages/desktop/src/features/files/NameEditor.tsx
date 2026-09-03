/**
 * Typing a name where the name will be, rather than in a dialog over the top of it.
 *
 * The same control for renaming and for creating: both are "this row is a name being decided", and
 * a new file is easier to place when the empty row is already sitting between its future siblings.
 * A modal would take the tree off screen at the moment you most want to see it — which sibling is
 * this going next to, and is that name taken.
 *
 * The stem is pre-selected, not the whole name. Renaming `Component.tsx` almost never means
 * retyping `.tsx`, and having to press ⌫ four times before you start is the small tax that makes
 * people rename files in the Finder instead.
 */

import { useEffect, useRef, useState } from "react";

import { nameProblem, splitExtension } from "./paths.ts";

export function NameEditor({
	initial,
	selectStem = true,
	onCommit,
	onCancel,
}: {
	initial: string;
	/** Off for a new file, where there is nothing yet to keep. */
	selectStem?: boolean;
	/** Called with a name that passed the local check. Returning ends the edit either way. */
	onCommit: (name: string) => void;
	onCancel: () => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState(initial);
	/** Set once the edit is over, so a blur arriving after Enter cannot commit a second time. */
	const done = useRef(false);

	useEffect(() => {
		const element = input.current;
		if (!element) return;
		element.focus();
		const [stem] = splitExtension(initial);
		element.setSelectionRange(0, selectStem ? stem.length : initial.length);
	}, [initial, selectStem]);

	// Only complain about what has been typed; an untouched name is not yet wrong.
	const problem = value === initial ? null : nameProblem(value);

	const commit = () => {
		if (done.current) return;
		if (problem || value.trim() === "") return cancel();
		done.current = true;
		onCommit(value.trim());
	};

	const cancel = () => {
		if (done.current) return;
		done.current = true;
		onCancel();
	};

	return (
		<input
			ref={input}
			value={value}
			spellCheck={false}
			data-ly-tip={problem ?? undefined}
			aria-label="名字"
			aria-invalid={problem ? true : undefined}
			onChange={(event) => setValue(event.target.value)}
			/*
			 * Committed on blur, not discarded.
			 *
			 * Clicking away from a rename you have finished typing is the same gesture as pressing
			 * Enter, and the editors that throw the edit away there are the ones people learn to
			 * distrust. Escape is what discards, and it is the only thing that does.
			 *
			 * Except when the *window* lost focus, which Chromium also reports as a blur on the
			 * focused field. Switching to another app in the middle of naming a file is not a
			 * decision about the name — and since an empty one cancels, it silently threw the new
			 * file away every time you looked something up.
			 */
			onBlur={() => {
				if (document.hasFocus()) commit();
			}}
			onKeyDown={(event) => {
				// The tree is listening for arrows, F2 and ⌘⌫; while typing a name, none of those
				// are for it. Only Escape and Enter leave this control.
				event.stopPropagation();
				if (event.key === "Enter") {
					event.preventDefault();
					commit();
				} else if (event.key === "Escape") {
					event.preventDefault();
					cancel();
				}
			}}
			// Clicking inside the field must not reach the row underneath, which would select or open it.
			onClick={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
			className={`ly-name-input min-w-0 flex-1 rounded-[4px] border bg-input px-1 py-px text-detail text-ink outline-none ${
				problem ? "border-danger" : "border-accent"
			}`}
		/>
	);
}
