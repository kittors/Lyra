import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { named } from "./named.ts";

let app: RunningApp;
const usage = { input: 0, output: 0, total: 0, cost: { input: 0, output: 0, total: 0 } };

// Synthetic session logs are loaded through the real session reader and renderer.
async function seed(home: string): Promise<void> {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(cwd);
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			providers: [],
			mcpServers: [],
			hooks: [],
			sync: { enabled: false },
			projects: [{ id: projectId, path: cwd, name: "Scroll QA", pinned: true, lastOpenedAt: 1 }],
		}),
	);
	const metas = [];
	for (const id of ["scroll-a", "scroll-b", "scroll-c", "scroll-d"]) {
		const messages: object[] = [];
		for (let i = 0; i < (id === "scroll-a" ? 42 : 5); i++) {
			messages.push({
				role: "user",
				content: [{ type: "text", text: `${id} question ${i}` }],
				timestamp: i * 10,
			});
			messages.push({
				role: "assistant",
				content: [
					{
						type: "text",
						text: `${id} answer ${i}\n\n${"Paragraph of variable height. ".repeat(2 + (i % 8) * 14)}`,
					},
				],
				api: "anthropic-messages",
				provider: "test",
				model: "test",
				usage,
				stopReason: "stop",
				timestamp: i * 10 + 1,
			});
		}
		messages.push({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Read the file" },
				{ type: "toolCall", id: `${id}-call`, name: "read", arguments: { path: "one.ts" } },
			],
			api: "anthropic-messages",
			provider: "test",
			model: "test",
			usage,
			stopReason: "toolUse",
			timestamp: 500,
		});
		messages.push({
			role: "toolResult",
			toolCallId: `${id}-call`,
			toolName: "read",
			content: [{ type: "text", text: "export const one = 1;" }],
			isError: false,
			timestamp: 501,
		});
		messages.push({
			role: "assistant",
			content: [
				{ type: "thinking", thinking: `${id} final reasoning` },
				{ type: "text", text: `${id} complete` },
			],
			api: "anthropic-messages",
			provider: "test",
			model: "test",
			usage,
			stopReason: "stop",
			timestamp: 502,
		});
		const meta = {
			id,
			title: id,
			cwd,
			projectId,
			projectName: "Scroll QA",
			createdAt: 1,
			updatedAt: 2,
			modelId: "test",
			messageCount: messages.length,
			usage,
			seq: messages.length + 1,
		};
		metas.push(meta);
		await writeFile(
			join(home, "sessions", projectId, `${id}.jsonl`),
			[
				JSON.stringify({ seq: 0, ts: 1, type: "meta", meta }),
				...messages.map((message, i) => JSON.stringify({ seq: i + 1, ts: i + 1, type: "message", message })),
				JSON.stringify({ seq: meta.seq, ts: 2, type: "meta", meta }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
}

before(async () => {
	app = await startApp({ port: 9597, seed });
});
after(async () => {
	await app?.stop();
});

const UI = `
	const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
	const visibleTranscripts = () => [...document.querySelectorAll("main .ly-transcript")].filter(el => el.checkVisibility({visibilityProperty:true}));
	const currentTranscript = () => {
		const shown = visibleTranscripts();
		if (shown.length !== 1) throw new Error("expected one visible transcript, got " + shown.length);
		return shown[0];
	};
	const currentPage = () => currentTranscript().closest('[data-view][data-active="true"]');
	const viewport = () => currentTranscript().closest('.ly-scroll-view');
	const open = async (id) => {
		document.querySelector('[data-ly-row="' + id + '"] > button').click();
		for (let i = 0; i < 180; i++) {
			await frame();
			if (visibleTranscripts().length === 1 && currentTranscript().textContent.includes(id + " complete")) break;
			if (i === 179) throw new Error("transcript did not arrive: " + id);
		}
		for (let i = 0; i < 15; i++) await frame();
	};
`;

test("switching split reasoning and answers never accumulates orphan DOM rows", async () => {
	const counts = await app.evaluate<{ process: number[]; thinking: number[]; opened: number[] }>(`(async () => { ${UI}
		const process = [];
		const thinking = [];
		const opened = [];
		for (let i = 0; i < 8; i++) {
			await open(i % 2 ? "scroll-b" : "scroll-a");
			process.push(currentPage().querySelectorAll("[data-ly-turn-process]").length);
			thinking.push(currentPage().querySelectorAll("[data-ly-thinking]").length);
			currentPage().querySelector('[data-ly-turn-process] > button')?.click();
			for (let n = 0; n < 20; n++) await frame();
			opened.push(currentPage().querySelectorAll("[data-ly-thinking]").length);
			currentPage().querySelector('[data-ly-turn-process] > button')?.click();
			// Leave during the closing transition: Activity must release its cancelled body.
			await frame();
		}
		return { process, thinking, opened };
	})()`);
	/*
	 * Finished turns fold think+tools into one process row. The fixture still reasons twice —
	 * once before the call, once before the answer — and both come back when that row is opened.
	 * Count the active page: retained hidden conversations deliberately keep their own rows.
	 * The visible transcript must never acquire rows left over from another conversation.
	 */
	assert.deepEqual(counts.process, Array(8).fill(1));
	assert.deepEqual(counts.thinking, Array(8).fill(0));
	assert.deepEqual(counts.opened, Array(8).fill(2));
});

test("scrolling an unchanged transcript leaves the scrollbar range constant", async () => {
	const heights = await app.evaluate<number[]>(`(async () => { ${UI}
		await open("scroll-a");
		const el = viewport();
		const heights = [el.scrollHeight];
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
		for (let i = 0; i < 24; i++) {
			el.scrollTop = Math.max(0, el.scrollTop - 600);
			await frame(); await frame();
			heights.push(el.scrollHeight);
		}
		return heights;
	})()`);
	assert.ok(heights[0] > 3000, "the fixture really overflows");
	assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, JSON.stringify(heights));
});

test("expanded history and disclosures return at the same reading position", async () => {
	const result = await app.evaluate<{
		before: number;
		after: number;
		initial: number;
		rowsBefore: number;
		rowsAfter: number;
		open: boolean;
	}>(`(async () => { ${UI}
		await open("scroll-a");
		const initial = currentPage().querySelectorAll('[data-ly-transcript-rows] > *').length;
		const earlier = [...currentTranscript().querySelectorAll("button")].find(b => ${named("显示更早", "starts", "b")});
		if (!earlier) throw new Error("fixture must have hidden history");
		earlier.click();
		for (let i = 0; i < 20; i++) await frame();
		currentPage().querySelector('[data-ly-turn-process] > button')?.click();
		for (let i = 0; i < 20; i++) await frame();
		const think = currentPage().querySelector('[data-ly-thinking] > button');
		if (!think) throw new Error("fixture must expose thinking after the process row opens");
		think.click();
		for (let i = 0; i < 20; i++) await frame();
		const el = viewport();
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -800, bubbles: true }));
		el.scrollTop = 800;
		for (let i = 0; i < 4; i++) await frame();
		const before = el.scrollTop;
		const rowsBefore = currentPage().querySelectorAll('[data-ly-transcript-rows] > *').length;
		await open("scroll-b");
		await open("scroll-a");
		return { before, after: viewport().scrollTop, initial, rowsBefore,
			rowsAfter: currentPage().querySelectorAll('[data-ly-transcript-rows] > *').length,
			open: currentPage().querySelector('[data-ly-thinking] > button').getAttribute('aria-expanded') === 'true' };
	})()`);
	assert.ok(result.rowsBefore > result.initial, `history was expanded: ${result.initial} → ${result.rowsBefore}`);
	assert.equal(result.rowsAfter, result.rowsBefore);
	assert.equal(result.open, true);
	assert.ok(Math.abs(result.after - result.before) <= 1, JSON.stringify(result));
});

test("a warm transcript is stable from its first painted frame", async () => {
	const samples = await app.evaluate<{ top: number; height: number; row: number }[]>(`(async () => { ${UI}
		await open("scroll-b");
		document.querySelector('[data-ly-row="scroll-a"] > button').click();
		const samples = [];
		for (let i = 0; i < 24; i++) {
			await frame();
			const transcript = currentTranscript();
			if (!transcript?.textContent.includes('scroll-a complete')) throw new Error('warm content missed a frame');
			const el = viewport();
			samples.push({ top: el.scrollTop, height: el.scrollHeight, row: transcript.firstElementChild.getBoundingClientRect().top });
		}
		return samples;
	})()`);
	assert.equal(samples.length, 24);
	for (const sample of samples) {
		assert.ok(Math.abs(sample.top - samples[0].top) <= 1, "reading position moved between frames");
		assert.equal(sample.height, samples[0].height);
		assert.ok(Math.abs(sample.row - samples[0].row) <= 1, "historical row replayed an entrance animation");
	}
});

test("visited transcript trees stay bounded while exactly one conversation remains visible", async () => {
	const retained = await app.evaluate<{ total: number; visible: number; pages: string[] }[]>(`(async () => { ${UI}
		const samples = [];
		for (const id of ["scroll-a", "scroll-b", "scroll-c", "scroll-d", "scroll-a", "scroll-d"]) {
			await open(id);
			const transcripts = [...document.querySelectorAll('main .ly-transcript')];
			samples.push({total:transcripts.length,visible:visibleTranscripts().length,
				pages:transcripts.map(el=>el.closest('[data-view]').dataset.view)});
		}
		return samples;
	})()`);
	assert.equal(retained.length, 6);
	for (const sample of retained) {
		assert.equal(sample.visible, 1);
		assert.ok(sample.total >= 1 && sample.total <= 3, JSON.stringify(sample));
		assert.equal(new Set(sample.pages).size, sample.total, "a session must not leave duplicate retained trees");
	}
	assert.equal(retained.at(-1)?.total, 3, "the test must exercise cache eviction after more than three visits");
});
