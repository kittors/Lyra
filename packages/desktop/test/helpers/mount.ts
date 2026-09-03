/**
 * Mounting a component and getting at what it rendered.
 *
 * Every call goes through `act`, which is what makes the assertion afterwards see a settled tree
 * rather than one still being committed. Without it React warns on every render, and the effects a
 * component runs on mount have not happened yet when the test looks at the DOM.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

export interface Mounted {
	/** The element the component was rendered into. */
	host: HTMLElement;
	/** Render something else into the same root, as a re-render rather than a fresh mount. */
	rerender(element: ReactNode): Promise<void>;
	/** Unmount and remove the host. Call it, or the next test inherits this tree. */
	unmount(): Promise<void>;
	/** The first element matching `selector`, or a failure naming what was actually rendered. */
	find<T extends Element = HTMLElement>(selector: string): T;
	/** Every element matching `selector`. */
	all<T extends Element = HTMLElement>(selector: string): T[];
	/** The rendered text, whitespace-collapsed — what someone reading the screen would see. */
	text(): string;
}

export async function mount(element: ReactNode): Promise<Mounted> {
	const host = document.createElement("div");
	document.body.append(host);

	let root!: Root;
	await act(async () => {
		root = createRoot(host);
		root.render(element);
	});

	return {
		host,
		rerender: (next) => act(async () => root.render(next)),
		unmount: () =>
			act(async () => {
				root.unmount();
				host.remove();
			}),
		find<T extends Element = HTMLElement>(selector: string): T {
			const found = host.querySelector<T>(selector);
			if (!found) {
				/*
				 * The markup goes in the message, because the alternative is a bare "expected
				 * Element, got null" and a second run with a `console.log` in it. Truncated, or a
				 * component that renders a transcript would bury the assertion it belongs to.
				 */
				const markup = host.innerHTML.length > 600 ? `${host.innerHTML.slice(0, 600)}…` : host.innerHTML;
				throw new Error(`no element matched ${selector}\nrendered:\n${markup}`);
			}
			return found;
		},
		all: <T extends Element = HTMLElement>(selector: string) => [...host.querySelectorAll<T>(selector)],
		text: () => (host.textContent ?? "").replace(/\s+/g, " ").trim(),
	};
}

/**
 * Dispatch an event and let React finish reacting to it.
 *
 * `element.click()` on its own returns before the state update it caused has been committed, so an
 * assertion on the next line reads the tree as it was. Wrapping it in `act` is the difference
 * between a test that passes and one that describes what happens.
 */
export async function fire(element: Element, event: Event): Promise<void> {
	await act(async () => {
		element.dispatchEvent(event);
	});
}

/** A click React will have finished handling by the time this resolves. */
export function click(element: Element): Promise<void> {
	return fire(element, new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** A key press, for the components whose behaviour is keyboard-first. */
export function press(element: Element, key: string, init: KeyboardEventInit = {}): Promise<void> {
	return fire(element, new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}
