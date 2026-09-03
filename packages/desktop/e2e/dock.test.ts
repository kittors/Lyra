/**
 * The dock, dragged for real.
 *
 * Everything here acts through synthesised pointer events and then measures
 * `getBoundingClientRect`. Nothing reads the store, and nothing asserts on a class name: the claim
 * being tested is "the pane ends up *there*", and the only honest evidence for it is where the
 * pane actually is on screen.
 *
 * That matters more than usual for this feature. The tree is already covered by unit tests, so a
 * suite here that checked the tree again would prove nothing new — every remaining way this can
 * break is between the tree and the pixels: a percentage written wrong, a hit test measured
 * against the window instead of the dock, a pane that React quietly remounted.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PANEL_MIN_WIDTH_PX } from "../src/features/dock/geometry.ts";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

before(async () => {
	app = await startApp({ port: 9447 });
	// Every assertion here is geometric, so the viewport has to be a known quantity rather than
	// whatever size this machine happens to open a window at.
	await setViewport(1440, 900);
	await installSettle();
});

after(async () => {
	await app?.stop();
});

interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
	right: number;
	bottom: number;
}

/** Every pane's box, keyed by kind, straight from the layout the user is looking at. */
async function panes(): Promise<Record<string, Rect>> {
	return app.evaluate(`(() => {
		const out = {};
		for (const el of document.querySelectorAll("[data-dock-pane]")) {
			if (el.offsetParent === null) continue;
			const b = el.getBoundingClientRect();
			out[el.dataset.dockPane] = {
				left: b.left, top: b.top, width: b.width, height: b.height, right: b.right, bottom: b.bottom,
			};
		}
		return out;
	})()`);
}

/**
 * Drag a pane by its grip to a point, in steps, and let go.
 *
 * The grip, not the title bar: it is the only thing that starts a drag, which is the point of it.
 *
 * Several moves rather than one, because the drag only begins after the pointer has travelled past
 * its threshold and the landing region is recomputed per move — a single jump would test neither.
 * `pointerdown` carries `buttons: 1`, without which the handler treats it as a hover.
 */
async function dragPane(kind: string, to: { x: number; y: number }): Promise<void> {
	await app.evaluate(`(async () => {
		const header = document.querySelector('[data-dock-grip="${kind}"]');
		if (!header) throw new Error("no grip for ${kind}");
		const box = header.getBoundingClientRect();
		const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
		const send = (type, x, y) => header.dispatchEvent(new PointerEvent(type, {
			pointerId: 1, isPrimary: true, bubbles: true, cancelable: true,
			clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1,
		}));
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

		send("pointerdown", from.x, from.y);
		await frame();
		for (let step = 1; step <= 8; step++) {
			const t = step / 8;
			window.dispatchEvent(new PointerEvent("pointermove", {
				pointerId: 1, isPrimary: true, bubbles: true,
				clientX: from.x + (${to.x} - from.x) * t,
				clientY: from.y + (${to.y} - from.y) * t,
				buttons: 1,
			}));
			await frame();
		}
		window.dispatchEvent(new PointerEvent("pointerup", {
			pointerId: 1, isPrimary: true, bubbles: true, clientX: ${to.x}, clientY: ${to.y}, buttons: 0,
		}));
		/*
		 * Wait for the pane to be handed back to the dock, not for a number of milliseconds.
		 *
		 * Landing is two frames plus a transition, and how long that actually takes depends on the
		 * machine and on how the compositor felt about the last few frames. A fixed wait measured
		 * the geometry 96% of the way through the flight and called a correct layout wrong.
		 */
		/*
		 * Wait for the pane to be handed back to the dock, not for a number of milliseconds.
		 *
		 * Landing is two frames plus a transition, and how long that actually takes depends on the
		 * machine and on how the compositor felt about the last few frames. A fixed wait measured
		 * the geometry most of the way through the flight and called a correct layout wrong.
		 */
		await window.__dockSettled();
	})()`);
}

/**
 * Open a panel the way a person does: the toolbar's panel menu, then the row for it.
 *
 * Deliberately not through the store. A test hook would have skipped the menu, and the menu is
 * the only way to open a panel that has no keyboard shortcut wired up — which, on a fresh profile
 * with no project and no conversation, is every panel that is not disabled.
 */
async function openPane(label: string): Promise<void> {
	await app.evaluate(`(async () => {
		const settle = () => new Promise((r) => setTimeout(r, 60));
		document.querySelector('button[aria-label="面板"]').click();
		await settle();
		const row = [...document.querySelectorAll('[role="menuitem"]')]
			.find((item) => item.textContent.trim().startsWith(${JSON.stringify(label)}));
		if (!row) throw new Error("no menu row for ${label}");
		if (row.disabled) throw new Error("${label} is not available on this profile");
		row.click();
		await new Promise((r) => setTimeout(r, 350));
	})()`);
}

/** Back to one pane, by closing the others the way the ✕ on each header does. */
async function resetDock(): Promise<void> {
	await app.evaluate(`(async () => {
		for (let guard = 0; guard < 12; guard++) {
			const close = document.querySelector('[data-dock-header]:not([data-dock-header="conversation"]) button[aria-label^="关闭"]');
			if (!close) break;
			close.click();
			await new Promise((r) => setTimeout(r, 120));
		}
		await new Promise((r) => setTimeout(r, 300));
	})()`);
}

/** The dock's own box, which is what every drop is measured against. */
async function dockBox(): Promise<Rect> {
	return app.evaluate(`(() => {
		const el = document.querySelector("[data-dock-panes]");
		const b = el.getBoundingClientRect();
		return { left: b.left, top: b.top, width: b.width, height: b.height, right: b.right, bottom: b.bottom };
	})()`);
}

const near = (a: number, b: number, slack = 2) => Math.abs(a - b) <= slack;

/**
 * Wait until the dock stops moving.
 *
 * Every assertion in this file is geometric, so every one of them has to be taken after the
 * animations have finished — and "finished" is not a number of milliseconds. It is a flight home
 * whose start depends on two `requestAnimationFrame`s, plus the rearrangement transition, plus
 * whatever the compositor was busy with. Polling until two consecutive measurements agree waits
 * exactly as long as it needs to, and a fixed wait does not: an earlier version of this suite
 * measured a correct layout 96% of the way through the flight and called it a failure.
 *
 * Installed once as a page function so the drag helper and the assertions can share it.
 */
async function installSettle(): Promise<void> {
	await app.evaluate(`(() => {
		window.__dockSettled = async () => {
			let last = "";
			let steady = 0;
			for (let i = 0; i < 160; i++) {
				const now = [...document.querySelectorAll("[data-dock-pane]")].map((el) => {
					const b = el.getBoundingClientRect();
					return el.dataset.dockPane + ":" + [b.left, b.top, b.width, b.height].map(Math.round).join(",");
				}).join("|");
				const carrying = Boolean(document.querySelector(".ly-dock-pane-carried"));
				// Three agreeing measurements, not two. A transition that has been asked for but has
				// not started yet holds still for a frame, and two samples cannot tell that apart
				// from having finished — which is a test that passes or fails on timing alone.
				if (!carrying && now === last) {
					if (++steady >= 2) return;
				} else {
					steady = 0;
				}
				last = now;
				await new Promise((r) => setTimeout(r, 30));
			}
		};
		return true;
	})()`);
}

/** Take the layout once it has stopped moving. */
async function settledPanes(): Promise<Record<string, Rect>> {
	await app.evaluate(`window.__dockSettled()`);
	return panes();
}

/**
 * Resize the viewport the layout measures itself against.
 *
 * `window.resizeTo` is ignored for an ordinary Electron window, so this goes through the DevTools
 * protocol. Without it the narrow layout — which is half of the dock's behaviour — could not be
 * reached from a test at all.
 */
async function setViewport(width: number, height: number): Promise<void> {
	await app.send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: 0,
		mobile: false,
	});
	await app.evaluate(`new Promise((r) => setTimeout(r, 450))`);
}

test("the dock starts as one pane: the conversation, filling it", async () => {
	await resetDock();
	const boxes = await settledPanes();
	assert.deepEqual(Object.keys(boxes), ["conversation"]);

	const dock = await dockBox();
	assert.ok(near(boxes.conversation.width, dock.width), "it fills the dock across");
	assert.ok(near(boxes.conversation.height, dock.height), "and down");
});

test("the conversation offers neither close nor full screen — it is what the window shows", async () => {
	const controls = await app.evaluate<string[]>(`
		[...document.querySelectorAll('[data-dock-header="conversation"] button')].map((b) => b.getAttribute("aria-label") ?? "")
	`);
	assert.equal(
		controls.some((label) => label.startsWith("关闭")),
		false,
		"the conversation is not a pane you can put away",
	);
	assert.equal(
		controls.some((label) => label.startsWith("全屏")),
		false,
		"nor one you can make fill a window it already fills",
	);
});

test("the title bars move the window, and only the grip moves the pane", async () => {
	/*
	 * This is a regression test with a short and embarrassing history: confining the drag band to
	 * the sidebar left the whole top edge of the window undraggable, because the dock reaches it
	 * now and nothing up there claimed the job. It is checked as computed style because that is
	 * what Electron actually composites — the window manager reads these regions, and no amount of
	 * clicking in a test can observe a window that did or did not move.
	 */
	const regions = await app.evaluate<Record<string, string | null>>(`(() => {
		const region = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).webkitAppRegion : null; };
		return {
			bar: region('[data-dock-header="conversation"]'),
			grip: region('[data-dock-grip="conversation"]'),
			controls: region('[data-dock-header="conversation"] .no-drag'),
		};
	})()`);
	assert.equal(regions.bar, "drag", "the title bar moves the window");
	assert.equal(regions.grip, "no-drag", "the grip moves the pane instead");
	assert.equal(regions.controls, "no-drag", "and the buttons are pressable rather than draggable");
});

test("opening a panel puts it beside the conversation, sharing the dock exactly", async () => {
	await resetDock();
	await openPane("任务");
	const boxes = await settledPanes();
	assert.deepEqual(Object.keys(boxes).sort(), ["conversation", "tasks"]);

	const dock = await dockBox();
	assert.ok(near(boxes.conversation.top, boxes.tasks.top), "same row");
	assert.ok(near(boxes.conversation.height, boxes.tasks.height));
	// Adjacent with no seam and no overlap: the tiling has to be exact, not approximately exact.
	assert.ok(near(boxes.conversation.right, boxes.tasks.left), "no gap between them");
	assert.ok(near(boxes.conversation.width + boxes.tasks.width, dock.width), "and none left over");
	assert.ok(boxes.conversation.width > boxes.tasks.width, "the conversation keeps the larger share");
});

test("a second panel stacks under the first rather than squeezing the conversation again", async () => {
	await openPane("浏览器");
	const boxes = await settledPanes();
	assert.deepEqual(Object.keys(boxes).sort(), ["browser", "conversation", "tasks"]);

	assert.ok(near(boxes.tasks.left, boxes.browser.left), "same column");
	assert.ok(near(boxes.tasks.bottom, boxes.browser.top), "one above the other");
	assert.ok(near(boxes.conversation.right, boxes.tasks.left), "the conversation did not move");
});

test("dragging a pane onto the bottom band of another puts it underneath", async () => {
	await resetDock();
	await openPane("任务");
	const before = await settledPanes();

	// 88% down the conversation is inside its bottom band (28%) and clear of the dock's own edge.
	await dragPane("tasks", {
		x: before.conversation.left + before.conversation.width / 2,
		y: before.conversation.top + before.conversation.height * 0.88,
	});

	const after = await settledPanes();
	const dock = await dockBox();
	assert.ok(near(after.conversation.left, after.tasks.left), "same column now");
	assert.ok(near(after.conversation.width, after.tasks.width));
	assert.ok(near(after.conversation.bottom, after.tasks.top), "and tasks is below");
	assert.ok(near(after.conversation.height + after.tasks.height, dock.height), "filling the dock");
});

test("dragging onto a left band puts the pane in front of the one it landed on", async () => {
	await resetDock();
	await openPane("任务");
	const before = await settledPanes();

	await dragPane("tasks", {
		x: before.conversation.left + before.conversation.width * 0.12,
		y: before.conversation.top + before.conversation.height / 2,
	});

	const after = await settledPanes();
	assert.ok(near(after.tasks.top, after.conversation.top), "same row");
	assert.ok(after.tasks.left < after.conversation.left, "and tasks is now the left-hand one");
	assert.ok(near(after.tasks.right, after.conversation.left), "still tiling exactly");
});



test("a pane picked up and put down over nothing returns to where it was", async () => {
	await resetDock();
	await openPane("任务");
	const before = await settledPanes();
	const dock = await dockBox();

	/*
	 * Out through an edge band and back to the dead centre, which is not a landing region.
	 *
	 * This is the case that used to lose the pane outright: the drag lifts it out of the tree, so
	 * "leave the layout alone" would mean leaving it with the pane missing. Releasing over nothing
	 * has to actively put the whole arrangement back.
	 */
	await dragPane("tasks", { x: dock.left + dock.width / 2, y: dock.top + dock.height / 2 });

	const after = await settledPanes();
	assert.deepEqual(Object.keys(after).sort(), ["conversation", "tasks"], "the pane came back");
	for (const kind of ["conversation", "tasks"]) {
		assert.ok(near(before[kind].left, after[kind].left), `${kind} left`);
		assert.ok(near(before[kind].width, after[kind].width), `${kind} width`);
	}
});

test("a splitter moves the two panes it divides and no others", async () => {
	await resetDock();
	await openPane("任务");
	await openPane("浏览器");
	const before = await settledPanes();

	// The handle between tasks and trajectory: the horizontal boundary in the right-hand column.
	const moved = await app.evaluate<number>(`(async () => {
		const handles = [...document.querySelectorAll('[data-dock-panes] [role="separator"][aria-orientation="horizontal"]')];
		const handle = handles[0];
		if (!handle) throw new Error("no horizontal splitter");
		const b = handle.getBoundingClientRect();
		const x = b.left + b.width / 2;
		const y = b.top + b.height / 2;
		const send = (type, cx, cy) => handle.dispatchEvent(new PointerEvent(type, {
			pointerId: 2, isPrimary: true, bubbles: true, cancelable: true,
			clientX: cx, clientY: cy, buttons: type === "pointerup" ? 0 : 1,
		}));
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		send("pointerdown", x, y);
		await frame();
		for (let step = 1; step <= 6; step++) { send("pointermove", x, y + (60 * step) / 6); await frame(); }
		send("pointerup", x, y + 60);
		await frame();
		return 60;
	})()`);

	const after = await settledPanes();
	assert.ok(near(after.tasks.height, before.tasks.height + moved, 3), "the pane above grew by the drag");
	assert.ok(near(after.browser.height, before.browser.height - moved, 3), "and the one below shrank by it");
	// The pane on the other side of the column boundary is untouched — this is one edge, not a reflow.
	assert.ok(near(after.conversation.height, before.conversation.height), "the conversation's height");
	assert.ok(near(after.conversation.width, before.conversation.width), "and its width");
});

test("squeezing the conversation past its floor moves the squeeze onward, without overlapping", async () => {
	await resetDock();
	await openPane("任务");
	const dock = await dockBox();

	// Drag the boundary between them as far left as it will go.
	await app.evaluate(`(async () => {
		// Scoped to the dock: the sidebar's own resize handle is also a vertical separator, and it
		// comes first in the document — an unscoped query drags the navigation instead.
		const handle = document.querySelector('[data-dock-panes] [role="separator"][aria-orientation="vertical"]');
		if (!handle) throw new Error("no vertical splitter in the dock");
		const b = handle.getBoundingClientRect();
		const x = b.left + b.width / 2;
		const y = b.top + b.height / 2;
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		handle.dispatchEvent(new PointerEvent("pointerdown", {
			pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1,
		}));
		await frame();
		for (let step = 1; step <= 10; step++) {
			window.dispatchEvent(new PointerEvent("pointermove", {
				pointerId: 7, isPrimary: true, bubbles: true, clientX: x - ((x - 1) * step) / 10, clientY: y, buttons: 1,
			}));
			await frame();
		}
		window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, isPrimary: true, bubbles: true, clientX: 1, clientY: y, buttons: 0 }));
		await frame();
	})()`);

	const after = await settledPanes();
	/*
	 * 420 is the conversation's floor. Below it the words start breaking one per line, which is
	 * what dragging this handle used to do — the pane stayed a pane in the tree and stopped being
	 * one on screen.
	 */
	assert.ok(
		after.conversation.width >= 418,
		`the conversation kept a readable width, got ${Math.round(after.conversation.width)}`,
	);
	// And the panel gave way rather than being stacked on top of it: they still tile exactly.
	assert.ok(near(after.conversation.right, after.tasks.left), "no overlap between them");
	assert.ok(near(after.conversation.width + after.tasks.width, dock.width, 3), "and the row still adds up");
	assert.ok(
		after.tasks.width >= PANEL_MIN_WIDTH_PX - 2,
		`the panel kept its own floor, got ${Math.round(after.tasks.width)}`,
	);
});

test("a panel to the left of the conversation never slices it — the near edge holds", async () => {
	/*
	 * The reported bug, in one test.
	 *
	 * With a panel on its left, squeezing the conversation used to make it grow *backwards* to
	 * reach its minimum width — under the panel it had just been squeezed by. Panels draw on top,
	 * so what you saw was the conversation with its left-hand side cut off and its centred content
	 * half-hidden. Overlapping is fine and is the whole design; being sliced is not.
	 */
	await resetDock();
	await openPane("任务");

	// Put the panel on the conversation's left, then drag the seam between them far right.
	await app.evaluate(`(async () => {
		const grip = document.querySelector('[data-dock-grip="tasks"]');
		grip.focus();
		grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true }));
		await new Promise((r) => setTimeout(r, 450));
	})()`);

	const moved = await settledPanes();
	assert.ok(moved.tasks.left < moved.conversation.left, "the panel is on the left now");

	await app.evaluate(`(async () => {
		const handle = document.querySelector('[data-dock-panes] [role="separator"][aria-orientation="vertical"]');
		const b = handle.getBoundingClientRect();
		const x = b.left + b.width / 2;
		const y = b.top + b.height / 2;
		const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		handle.dispatchEvent(new PointerEvent("pointerdown", {
			pointerId: 8, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1,
		}));
		await frame();
		for (let step = 1; step <= 10; step++) {
			window.dispatchEvent(new PointerEvent("pointermove", {
				pointerId: 8, isPrimary: true, bubbles: true, clientX: x + (1400 * step) / 10, clientY: y, buttons: 1,
			}));
			await frame();
		}
		window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 8, isPrimary: true, bubbles: true, clientX: x + 1400, clientY: y, buttons: 0 }));
		await frame();
	})()`);

	const after = await settledPanes();
	assert.ok(
		after.conversation.left >= after.tasks.right - 1,
		`the conversation stayed clear of the panel: it starts at ${Math.round(after.conversation.left)}, the panel ends at ${Math.round(after.tasks.right)}`,
	);
});

test("maximising a pane covers the dock, and Escape gives it back", async () => {
	await resetDock();
	await openPane("任务");
	const before = await settledPanes();
	const dock = await dockBox();

	await app.evaluate(`(async () => {
		const header = document.querySelector('[data-dock-header="tasks"]');
		[...header.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("全屏")).click();
		await new Promise((r) => setTimeout(r, 350));
	})()`);

	let boxes = await settledPanes();
	assert.ok(near(boxes.tasks.width, dock.width), "it takes the whole dock across");
	assert.ok(near(boxes.tasks.height, dock.height), "and down");

	await app.evaluate(`(async () => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		await new Promise((r) => setTimeout(r, 350));
	})()`);

	boxes = await settledPanes();
	assert.ok(near(boxes.tasks.width, before.tasks.width), "and hands the width back");
	assert.ok(near(boxes.conversation.width, before.conversation.width));
});

test("a pane can be moved with the keyboard, which a drag alone would put out of reach", async () => {
	await resetDock();
	await openPane("任务");
	const before = await settledPanes();
	assert.ok(before.tasks.left > before.conversation.left, "it starts on the right");

	// ⌥← sends it to the dock's left edge. Focus the header first, the way Tab would.
	await app.evaluate(`(async () => {
		// The grip is the keyboard route too, and it is a real button, so Tab reaches it.
		const grip = document.querySelector('[data-dock-grip="tasks"]');
		grip.focus();
		grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true }));
		await new Promise((r) => setTimeout(r, 350));
	})()`);

	const after = await settledPanes();
	assert.ok(after.tasks.left < after.conversation.left, "and ends up on the left");
	assert.ok(near(after.tasks.right, after.conversation.left), "still tiling exactly");
	assert.ok(near(after.tasks.top, after.conversation.top), "and still in one row");
});

test("closing a pane gives its room to what is left", async () => {
	await resetDock();
	await openPane("任务");
	await app.evaluate(`(async () => {
		const header = document.querySelector('[data-dock-header="tasks"]');
		[...header.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("关闭")).click();
		await new Promise((r) => setTimeout(r, 350));
	})()`);

	const boxes = await settledPanes();
	const dock = await dockBox();
	assert.deepEqual(Object.keys(boxes), ["conversation"]);
	assert.ok(near(boxes.conversation.width, dock.width), "the conversation is whole again");
});

test("a narrow window shows one pane and a picker, and widening restores the layout", async () => {
	await resetDock();
	await openPane("任务");
	const wide = await settledPanes();

	await setViewport(700, 800);

	const narrow = await settledPanes();
	// Whatever was focused last, which opening a panel makes that panel — not always the
	// conversation. One pane is the claim; which one is the focus rule, tested by its own path.
	assert.equal(Object.keys(narrow).length, 1, "only the focused pane is drawn");
	const chips = await app.evaluate<number>(`document.querySelectorAll("[data-dock-chip]").length`);
	assert.equal(chips, 2, "and both panes are offered in the picker");

	await setViewport(1400, 900);

	const back = await settledPanes();
	assert.deepEqual(Object.keys(back).sort(), ["conversation", "tasks"], "the layout was kept, not rebuilt");
	// Same proportions, even though the window is a different size than it was.
	const dock = await dockBox();
	assert.ok(
		near(back.conversation.width / dock.width, wide.conversation.width / (wide.conversation.width + wide.tasks.width), 0.02),
		"and the same shares",
	);
});

test("the layout survives a reload, which is what per-conversation persistence rests on", async () => {
	await resetDock();
	await openPane("任务");
	await dragPane("tasks", await settledPanes().then((b) => ({
		x: b.conversation.left + b.conversation.width / 2,
		y: b.conversation.top + b.conversation.height * 0.88,
	})));
	const before = await settledPanes();

	await app.evaluate(`(async () => {
		// The debounced write has to land before the document goes away.
		window.dispatchEvent(new Event("beforeunload"));
		await new Promise((r) => setTimeout(r, 120));
		// A mark that cannot survive a real navigation, so the poll below cannot be satisfied by
		// the page that is on its way out.
		window.__leaving = true;
		location.reload();
	})()`);

	// Wait for the app to come back rather than guessing how long a boot takes — the shell holds a
	// deliberate minimum on screen, and a fixed wait would be racing it.
	for (let attempt = 0; attempt < 60; attempt++) {
		const ready = await app
			.evaluate<boolean>(`!window.__leaving && Boolean(document.querySelector("[data-dock-panes]"))`)
			.catch(() => false);
		if (ready) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	// The reload took the page's helpers with it.
	await installSettle();

	const after = await settledPanes();
	assert.deepEqual(Object.keys(after).sort(), ["conversation", "tasks"], "both panes came back");
	assert.ok(near(after.conversation.height, before.conversation.height, 4), "at the height it was left at");
	assert.ok(near(after.tasks.top, before.tasks.top, 4), "and in the same place");
});

test("screens that are not a conversation get the dock to themselves, and give it back", async () => {
	/*
	 * The panels are about the project you are working in — its files, its terminal, its diff. A
	 * pull request is of someone else's branch in a repository this machine may never have cloned;
	 * the schedule and the plugin catalogue are not in a project at all. Leaving a file tree beside
	 * them is not merely unhelpful: it is pointing at somewhere else entirely.
	 *
	 * Hidden, not closed. Coming back to the conversation has to find the layout as it was.
	 */
	await resetDock();
	await openPane("任务");
	const withPanels = await settledPanes();
	assert.deepEqual(Object.keys(withPanels).sort(), ["conversation", "tasks"]);

	const visit = (label: string) =>
		app.evaluate(`(async () => {
			const want = ${JSON.stringify(label)};
			const item = [...document.querySelectorAll("button, a")].find((el) => el.textContent.trim() === want);
			if (!item) throw new Error("no sidebar item " + want);
			item.click();
			await new Promise((r) => setTimeout(r, 600));
		})()`);

	for (const screen of ["拉取请求", "已安排", "插件"]) {
		await visit(screen);
		const alone = await settledPanes();
		assert.deepEqual(Object.keys(alone), ["conversation"], `${screen} has the dock to itself`);
		const button = await app.evaluate<boolean>(`Boolean(document.querySelector('button[aria-label="面板"]'))`);
		assert.equal(button, false, `${screen} does not offer panels either`);
	}

	/*
	 * Back to a conversation — the same one, since the layout belongs to it. Starting a *new*
	 * conversation is a different scope and correctly gets the default layout, which is why this
	 * goes through the sidebar's own entry rather than the new-conversation button.
	 */
	/*
	 * Hidden, not closed — checked against what was written down rather than by navigating back.
	 *
	 * Returning to the conversation would be the fuller test, but the only way back through the UI
	 * is 新对话, and on a profile with no project that opens a directory picker and stays where it
	 * is. What can be established without it is the part that would actually be lost: the panes are
	 * still recorded while the other screen is up, so nothing was closed on the way there.
	 */
	const stored = await app.evaluate<string | null>(`localStorage.getItem("dw:dock:@draft")`);
	assert.ok(stored?.includes("tasks"), "the panes are still on record, so they were hidden and not closed");
});
