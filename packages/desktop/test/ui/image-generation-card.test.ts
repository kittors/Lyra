/**
 * The card an `image_generate` call draws in the conversation, in each state it can be found in.
 *
 * It is the only trace of the picture in the transcript, so each wrong state is a wrong statement:
 * dots that do not hold the picture's shape (the transcript jumps when it lands), a finished card
 * with no picture, a spent quota said as a bare "error", a refusal of bad arguments drawn as a card
 * for a picture that was never going to exist.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { ImageGenerationDetails, ToolCallContent } from "@lyra/core";
import { ImageGenerationCards } from "../../src/features/conversation/ImageGenerationCard.tsx";
import { translate } from "../../src/i18n/translate.ts";
import { useApp, type ToolRun } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

afterEach(() => {
	useApp.setState({ toolRuns: {}, activeSessionId: null });
});

const MEDIA = "a".repeat(40) + ".jpg";

/** The frame's `aspect-ratio`, which the style object spells `w / 1`. */
const ratio = (element: Element) => Number.parseFloat((element as HTMLElement).style.aspectRatio);

function call(id: string, args: Record<string, unknown> = {}): ToolCallContent {
	return { type: "toolCall", id, name: "image_generate", arguments: { prompt: "a red paper boat", ...args } };
}

function details(extra: Partial<ImageGenerationDetails> = {}): ImageGenerationDetails {
	return {
		kind: "image_generation",
		status: "running",
		model: { id: "relay/gemini-3.1-flash-image", name: "gemini-3.1-flash-image", provider: "Relay" },
		prompt: "a red paper boat",
		count: 1,
		edit: false,
		startedAt: Date.now() - 3000,
		...extra,
	};
}

function run(id: string, status: ToolRun["status"], detail?: ImageGenerationDetails, content: NonNullable<ToolRun["result"]>["content"] = []): ToolRun {
	return { toolCallId: id, toolName: "image_generate", summary: "Image a red paper boat", args: {}, status, startedAt: Date.now() - 3000, result: detail || content.length ? { content, details: detail } : undefined };
}

test("while drawing: dots at the asked shape, the stage in words, and a percentage", async () => {
	useApp.setState({ toolRuns: { c1: run("c1", "running", details({ aspectRatio: "16:9" })) } });
	const view = await mount(h(ImageGenerationCards, { calls: [call("c1", { aspect_ratio: "16:9" })] }));
	try {
		const frame = view.find("[data-ly-image-frame]");
		assert.equal(frame.getAttribute("data-ly-image-frame"), "drawing");
		assert.ok(frame.querySelector("canvas"), "the dots");
		assert.equal(ratio(frame), 16 / 9, "the picture's shape before the picture exists");
		const percent = view.find("[data-ly-image-progress]").textContent ?? "";
		assert.match(percent, /^\d+%$/);
		assert.ok(Number.parseInt(percent, 10) > 0 && Number.parseInt(percent, 10) < 100, percent);
		const caption = view.find("figcaption").textContent ?? "";
		assert.ok(caption.length > 0 && !caption.includes("gemini"), `a stage, not the model: ${caption}`);
	} finally {
		await view.unmount();
	}
});

test("before the first progress report the call's own arguments shape the card", async () => {
	useApp.setState({ toolRuns: { c1: run("c1", "running") } });
	const view = await mount(h(ImageGenerationCards, { calls: [call("c1", { aspect_ratio: "9:16", count: 2 })] }));
	try {
		const frames = view.all("[data-ly-image-frame]");
		assert.equal(frames.length, 2, "one place per picture asked for");
		assert.equal(ratio(frames[0]), 9 / 16);
		assert.equal(view.all("[data-ly-image-progress]").length, 1, "one reading for the whole card");
	} finally {
		await view.unmount();
	}
});

test("finished: the picture from session media, at its own shape, captioned with what drew it", async () => {
	const done = details({ status: "done", aspectRatio: "16:9", images: [{ media: MEDIA, mimeType: "image/jpeg", width: 1408, height: 792 }], durationMs: 9000 });
	useApp.setState({ toolRuns: { c1: run("c1", "done", done) } });
	const view = await mount(h(ImageGenerationCards, { calls: [call("c1", { aspect_ratio: "16:9" })] }));
	try {
		assert.equal(view.find("[data-ly-image-card]").getAttribute("data-ly-image-card"), "done");
		assert.equal(view.find("[data-ly-image-frame] img").getAttribute("src"), `ly-media://m/${MEDIA}`);
		assert.equal(ratio(view.find("[data-ly-image-frame]")), 1408 / 792);
		assert.equal(view.find("figcaption").textContent, "gemini-3.1-flash-image · 1408×792");
		assert.ok(!view.find("[data-ly-image-frame]").querySelector("canvas"), "a reopened conversation shows the picture, not the drawing");
		assert.ok(!view.find("[data-ly-image-frame]").querySelector("[data-ly-image-progress]"), "and no percentage");
	} finally {
		await view.unmount();
	}
});

test("several asked for and fewer arrived: the ones that did, and how many did not", async () => {
	const done = details({ status: "done", count: 3, images: [{ media: MEDIA, mimeType: "image/jpeg" }, { media: "b".repeat(40) + ".jpg", mimeType: "image/jpeg" }] });
	useApp.setState({ toolRuns: { c1: run("c1", "done", done) } });
	const view = await mount(h(ImageGenerationCards, { calls: [call("c1", { count: 3 })] }));
	try {
		assert.equal(view.all("[data-ly-image-frame]").length, 2);
		assert.ok(view.find("figcaption").textContent?.includes(translate("imageGen.partial", { n: 1 })), view.find("figcaption").textContent ?? "");
	} finally {
		await view.unmount();
	}
});

test("a spent quota says so, and when it comes back", async () => {
	const failed = details({ status: "error", error: { summary: "被限流", hint: "check-billing", retryAfterMs: 6_765_000 } });
	useApp.setState({ toolRuns: { c1: run("c1", "error", failed) } });
	const view = await mount(h(ImageGenerationCards, { calls: [call("c1")] }));
	try {
		const card = view.find('[data-ly-image-card="error"]');
		assert.ok(card.textContent?.includes(translate("imageGen.quotaSpent", { model: "gemini-3.1-flash-image" })), card.textContent ?? "");
		assert.ok(card.textContent?.includes(translate("imageGen.resetsIn", { time: "1h 53m" })), card.textContent ?? "");
	} finally {
		await view.unmount();
	}
});

test("stopped by the person reads as stopped, not as a failure", async () => {
	useApp.setState({ toolRuns: { c1: run("c1", "error", undefined, [{ type: "text", text: "Tool execution was cancelled." }]) } });
	const view = await mount(h(ImageGenerationCards, { calls: [call("c1")] }));
	try {
		assert.ok(view.find('[data-ly-image-card="stopped"]').textContent?.includes(translate("imageGen.stopped")));
	} finally {
		await view.unmount();
	}
});

test("a call refused before it started leaves no card: its own row says why", async () => {
	useApp.setState({ toolRuns: { c1: run("c1", "error", undefined, [{ type: "text", text: "No image model is configured." }]) } });
	const view = await mount(h(ImageGenerationCards, { calls: [call("c1")] }));
	try {
		assert.equal(view.all("[data-ly-image-card]").length, 0);
	} finally {
		await view.unmount();
	}
});

test("drawing then done in one place: the frame is kept, and the dots stay until the picture has decoded", async () => {
	useApp.setState({ toolRuns: { c1: run("c1", "running", details({ aspectRatio: "1:1" })) } });
	const view = await mount(h(ImageGenerationCards, { calls: [call("c1", { aspect_ratio: "1:1" })] }));
	try {
		const before = view.find("[data-ly-image-frame]");
		const done = details({ status: "done", aspectRatio: "1:1", images: [{ media: MEDIA, mimeType: "image/jpeg", width: 1024, height: 1024 }] });
		await act(async () => useApp.setState({ toolRuns: { c1: run("c1", "done", done) } }));
		const after = view.find("[data-ly-image-frame]");
		assert.ok(before === after, "the same element, so nothing is torn down and rebuilt under the reader");
		assert.ok(after.querySelector("canvas"), "the dots wait for the picture to decode before they fade");
		assert.equal(after.querySelector("[data-ly-image-progress]")?.textContent, "100%");
	} finally {
		await view.unmount();
	}
});
