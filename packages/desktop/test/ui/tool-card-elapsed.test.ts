/**
 * How long the card says a command has been running.
 *
 * It used to count from its own mount — `useRef(Date.now())` — which is the same as the truth only
 * while the card stays mounted for the whole call, and it does not: scrolling it out of the
 * transcript and back, or any re-key of the list, restarted the count at zero. What that looked
 * like in the wild was a screenshot of a `git push` seven and a half minutes into a turn, with the
 * card underneath it reporting `142s`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { ToolCard } from "../../src/features/conversation/ToolCard.tsx";
import { mount } from "../helpers/mount.ts";

const running = (extra: Record<string, unknown>) =>
	h(ToolCard, {
		toolName: "bash",
		summary: "推送已确认的任务分支",
		args: { command: "git push origin HEAD" },
		status: "running" as const,
		...extra,
	} as never);

/** The elapsed counter is the only `\d+s` the header draws. */
const seconds = (text: string): number | null => {
	const match = text.match(/(\d+)s/);
	return match ? Number(match[1]) : null;
};

test("a card mounted late still counts from when the command started", async () => {
	// Mounted now, for a call that started three minutes ago — a card scrolled back into view.
	const view = await mount(running({ startedAt: Date.now() - 180_000 }));
	const shown = seconds(view.text());
	assert.ok(shown !== null, `no elapsed time drawn: ${view.text()}`);
	assert.ok(shown >= 179 && shown <= 182, `expected ~180s, got ${shown}s`);
	await view.unmount();
});

test("remounting does not restart the count", async () => {
	const startedAt = Date.now() - 300_000;
	const first = await mount(running({ startedAt }));
	await first.unmount();
	// The same call, drawn again by a fresh component — the exact case that produced `142s`.
	const second = await mount(running({ startedAt }));
	const shown = seconds(second.text());
	assert.ok(shown !== null && shown >= 299, `the count restarted: ${shown}s`);
	await second.unmount();
});

test("without a start time it falls back to its own mount rather than drawing nonsense", async () => {
	/*
	 * The sub-agent panel rebuilds its records from a transcript and has no `startedAt` for them.
	 * A missing value must read as "just started", never as 1970.
	 */
	const view = await mount(running({}));
	const shown = seconds(view.text());
	assert.ok(shown === null || shown < 5, `expected ~0s from a fresh mount, got ${shown}s`);
	await view.unmount();
});

test("a finished call is not still counting", async () => {
	const view = await mount(
		h(ToolCard, {
			toolName: "bash",
			summary: "推送已确认的任务分支",
			args: { command: "git push origin HEAD" },
			status: "done" as const,
			startedAt: Date.now() - 180_000,
		} as never),
	);
	// Whatever it shows, it must not be advertising a live timer on something that has finished.
	assert.ok(!/\d+s/.test(view.text()), `a finished card is still counting: ${view.text()}`);
	await view.unmount();
});
