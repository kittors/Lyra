/**
 * The card a `video_generate` call draws in the conversation, and the composer's mark for the image
 * and video models — each in the states a person can find them in.
 *
 * A video takes minutes, so the card's running line is what the person watches: where the task is
 * and for how long. A finished card without a player, or a task that vanished said as a bare
 * "error", are wrong statements about something the person paid for.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement as h } from "react";
import type { ModelConfig, ProviderConfig, Settings, ToolCallContent, VideoGenerationDetails } from "@lyra/core";
import { VideoGenerationCards } from "../../src/features/conversation/VideoGenerationCard.tsx";
import { MediaModelButton } from "../../src/features/models/index.ts";
import { translate } from "../../src/i18n/translate.ts";
import { useApp, type ToolRun } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

const initial = useApp.getState();
afterEach(() => {
	useApp.setState({ toolRuns: {}, activeSessionId: null, settings: initial.settings, meta: initial.meta });
});

const MEDIA = "b".repeat(40) + ".mp4";
const ratio = (element: Element) => Number.parseFloat((element as HTMLElement).style.aspectRatio);

function call(id: string, args: Record<string, unknown> = {}): ToolCallContent {
	return { type: "toolCall", id, name: "video_generate", arguments: { prompt: "a fox runs through snow", ...args } };
}

function details(extra: Partial<VideoGenerationDetails> = {}): VideoGenerationDetails {
	return {
		kind: "video_generation",
		status: "running",
		model: { id: "grok/grok-imagine-video-1.5", name: "grok-imagine-video-1.5", provider: "grok" },
		prompt: "a fox runs through snow",
		count: 1,
		startedAt: Date.now() - 65_000,
		...extra,
	};
}

function run(id: string, status: ToolRun["status"], detail?: VideoGenerationDetails): ToolRun {
	return { toolCallId: id, toolName: "video_generate", summary: "Video a fox", args: {}, status, startedAt: Date.now() - 65_000, result: detail ? { content: [], details: detail } : undefined };
}

test("while it is made: dots at the asked shape, the stage and the time waited, the provider's own percentage", async () => {
	useApp.setState({ toolRuns: { v1: run("v1", "running", details({ aspectRatio: "9:16", stage: "running", progress: 40 })) } });
	const view = await mount(h(VideoGenerationCards, { calls: [call("v1", { aspect_ratio: "9:16" })] }));
	try {
		const frame = view.find("[data-ly-video-frame]");
		assert.equal(frame.getAttribute("data-ly-video-frame"), "making");
		assert.equal(ratio(frame), 9 / 16);
		assert.equal(view.find("[data-ly-image-progress]").textContent, "40%");
		const caption = view.find("figcaption").textContent ?? "";
		assert.ok(caption.includes(translate("videoGen.stage.running")), caption);
		assert.match(caption, /1m 5s|1m 6s/, "how long it has been");
	} finally {
		await view.unmount();
	}
});

test("done: a player with the first frame as its poster, the model, the size and the length", async () => {
	useApp.setState({ toolRuns: { v1: run("v1", "done", details({ status: "done", videos: [{ media: MEDIA, mimeType: "video/mp4", width: 1280, height: 720, seconds: 6 }] })) } });
	const view = await mount(h(VideoGenerationCards, { calls: [call("v1")] }));
	try {
		const video = view.find("video");
		assert.match(video.getAttribute("src") ?? "", new RegExp(`${MEDIA}#t=0\\.001$`));
		assert.equal(video.hasAttribute("controls"), false, "the app's player, not the system's controls");
		assert.ok(view.find("[data-ly-video-player]"));
		assert.equal(ratio(view.find("[data-ly-video-frame]")), 1280 / 720);
		assert.equal(view.find("figcaption").textContent, "grok-imagine-video-1.5 · 1280×720 · 6s");
	} finally {
		await view.unmount();
	}
});

test("a task that is gone, or past its time, is said as that — not as a bare failure", async () => {
	useApp.setState({ toolRuns: { v1: run("v1", "error", details({ status: "error", error: { summary: "生成任务找不到了", reason: "lost" } })) } });
	const view = await mount(h(VideoGenerationCards, { calls: [call("v1")] }));
	try {
		assert.equal(view.find("[data-ly-video-card]").getAttribute("data-ly-video-card"), "error");
		assert.ok((view.find("[data-ly-video-card]").textContent ?? "").includes(translate("videoGen.lost")));
	} finally {
		await view.unmount();
	}
});

const model = (providerId: string, modelId: string): ModelConfig => ({ id: `${providerId}/${modelId}`, providerId, modelId, name: modelId, contextWindow: 0, maxOutputTokens: 0, supportsThinking: false, supportsImages: true, supportsTools: false });
const provider = (id: string, models: ModelConfig[]): ProviderConfig => ({ id, name: id, baseUrl: "https://relay.example", api: "openai-responses", apiKey: "", enabled: true, models });
const settingsWith = (models: ModelConfig[]) => ({ ...initial.settings, providers: [provider("grok", models)] }) as Settings;

test("the composer's mark is there only when there is a choice, and turns accent for a conversation's own pick", async () => {
	useApp.setState({ settings: settingsWith([model("grok", "grok-4.7"), model("grok", "grok-imagine-image")]) });
	const single = await mount(h(MediaModelButton));
	try {
		assert.equal(single.host.querySelector("[data-ly-media-button]"), null, "one image model: nothing to switch");
	} finally {
		await single.unmount();
	}

	useApp.setState({ settings: settingsWith([model("grok", "grok-imagine-image"), model("grok", "grok-imagine-image-quality")]) });
	const both = await mount(h(MediaModelButton));
	try {
		const button = both.find("[data-ly-media-button]");
		assert.equal(button.getAttribute("data-own"), null);
		assert.match(button.getAttribute("data-ly-tip") ?? "", /grok-imagine-image/);
	} finally {
		await both.unmount();
	}
});
