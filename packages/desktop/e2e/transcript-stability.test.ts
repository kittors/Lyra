import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

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
	for (const id of ["scroll-a", "scroll-b"]) {
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
	const viewport = () => document.querySelector("main .ly-scroll-view");
	const open = async (id) => {
		document.querySelector('[data-ly-row="' + id + '"] > button').click();
		for (let i = 0; i < 180; i++) {
			await frame();
			if (document.querySelector(".ly-transcript")?.textContent.includes(id + " complete")) break;
			if (i === 179) throw new Error("transcript did not arrive: " + id);
		}
		for (let i = 0; i < 15; i++) await frame();
	};
`;

test("switching split reasoning and answers never accumulates orphan DOM rows", async () => {
	const counts = await app.evaluate<number[]>(`(async () => { ${UI}
		const counts = [];
		for (let i = 0; i < 8; i++) {
			await open(i % 2 ? "scroll-b" : "scroll-a");
			counts.push(document.querySelectorAll("main [data-ly-thinking]").length);
		}
		return counts;
	})()`);
	assert.deepEqual(counts, Array(8).fill(1));
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
		rowsBefore: number;
		rowsAfter: number;
		open: boolean;
	}>(`(async () => { ${UI}
		await open("scroll-a");
		const earlier = [...document.querySelectorAll(".ly-transcript > button")].find(b => b.textContent.includes("显示更早"));
		if (!earlier) throw new Error("fixture must have hidden history");
		earlier.click();
		document.querySelector('main [data-ly-thinking] > button').click();
		for (let i = 0; i < 20; i++) await frame();
		const el = viewport();
		el.dispatchEvent(new WheelEvent("wheel", { deltaY: -800, bubbles: true }));
		el.scrollTop = 800;
		for (let i = 0; i < 4; i++) await frame();
		const before = el.scrollTop;
		const rowsBefore = document.querySelector('.ly-transcript').children.length;
		await open("scroll-b");
		await open("scroll-a");
		return { before, after: viewport().scrollTop, rowsBefore,
			rowsAfter: document.querySelector('.ly-transcript').children.length,
			open: document.querySelector('main [data-ly-thinking] > button').getAttribute('aria-expanded') === 'true' };
	})()`);
	assert.ok(result.rowsBefore > 60, "history was expanded");
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
			const transcript = document.querySelector('.ly-transcript');
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
