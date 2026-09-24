/* oxlint-disable no-console -- probe CLI that writes frames and prints where it put them */
/**
 * A strip of frames across one conversation switch, for looking at rather than asserting on.
 *
 * `node e2e/switch-film.ts <out-dir>` — boots the app the way the tests do, seeds two
 * conversations with different dock layouts, and captures a screenshot every few frames while
 * moving from the one with a panel to the one without.
 *
 * The measurements say the entrance no longer replays and the transcript no longer waits on git.
 * This is the picture: whether what a person actually sees is a clean cut or a flicker.
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "./app.ts";

const exec = promisify(execFile);
const out = process.argv[2] ?? "/tmp/lyra-switch-film";
const IDS = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];

const usage = {
	input: 10,
	output: 10,
	cacheRead: 0,
	cacheWrite: 0,
	total: 20,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** A dirty repository, because that is the case the whole report is about. */
async function makeRepo(): Promise<string> {
	const root = join(tmpdir(), "lyra-film-repo");
	await rm(root, { recursive: true, force: true });
	await mkdir(root, { recursive: true });
	await exec("git", ["init", "-q"], { cwd: root });
	await exec("git", ["config", "user.email", "f@example.com"], { cwd: root });
	await exec("git", ["config", "user.name", "f"], { cwd: root });
	for (let i = 0; i < 80; i++) {
		await writeFile(join(root, `src${i}.ts`), Array.from({ length: 90 }, (_, l) => `export const v${i}_${l} = ${l};`).join("\n"));
	}
	await exec("git", ["add", "-A"], { cwd: root });
	await exec("git", ["commit", "-qm", "baseline"], { cwd: root });
	for (let i = 0; i < 80; i++) {
		const body = Array.from({ length: 100 }, (_, l) => `export const v${i}_${l} = ${l + 1};`).join("\n");
		await writeFile(join(root, `src${i}.ts`), body);
		await writeFile(join(root, `new${i}.ts`), body);
	}
	return root;
}

async function seedSessions(home: string, cwd: string): Promise<void> {
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const dir = join(home, "sessions", projectId);
	await mkdir(dir, { recursive: true });

	for (const [i, id] of IDS.entries()) {
		const meta = {
			id,
			title: i === 0 ? "带面板的会话" : "只有对话的会话",
			cwd,
			projectId,
			projectName: "film",
			createdAt: 1_700_000_000_000 + i,
			updatedAt: 1_700_000_000_000 + i,
			modelId: "film",
			messageCount: 24,
			usage,
			seq: 24,
		};
		const lines = [JSON.stringify({ seq: 0, ts: meta.createdAt, type: "meta", meta })];
		for (let m = 0; m < 24; m++) {
			const message =
				m % 2 === 0
					? { role: "user", content: [{ type: "text", text: `第 ${m / 2 + 1} 个问题，来自${meta.title}。` }], timestamp: meta.createdAt + m }
					: {
							role: "assistant",
							content: [{ type: "text", text: `### 回答 ${(m + 1) / 2}\n\n${"这一段用来让转录有真实的排版工作量。".repeat(6)}\n` }],
							api: "anthropic",
							provider: "film",
							model: "film",
							usage,
							stopReason: "stop",
							timestamp: meta.createdAt + m,
						};
			lines.push(JSON.stringify({ seq: m + 1, ts: meta.createdAt + m, type: "message", message }));
		}
		// A closing `meta` with the final seq, which is what the index reads a session's shape from.
		lines.push(JSON.stringify({ seq: 25, ts: meta.createdAt, type: "meta", meta: { ...meta, seq: 25 } }));
		await writeFile(join(dir, `${id}.jsonl`), `${lines.join("\n")}\n`);
	}

	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));
	// Only what this needs; everything else takes its default, the way `switch-probe` does.
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({ projects: [{ id: cwd, name: "film", path: cwd, pinned: false, lastOpenedAt: Date.now() }] }),
	);
}

async function main() {
	const repo = await makeRepo();
	await mkdir(out, { recursive: true });
	const app = await startApp({ port: 9339, seed: (home) => seedSessions(home, repo) });

	try {
		// The first conversation opens with the Git panel beside it; the second has nothing.
		await app.evaluate(`(() => {
			window.localStorage.setItem(${JSON.stringify(`dw:panedock:${IDS[0]}`)}, JSON.stringify({
				v: 1,
				tree: {
					type: "split", dir: "row",
					children: [{ type: "leaf", kind: "conversation" }, { type: "leaf", kind: "review" }],
					sizes: [0.62, 0.38],
				},
			}));
			window.localStorage.removeItem(${JSON.stringify(`dw:panedock:${IDS[1]}`)});
			return 1;
		})()`);

		// The list arrives a round trip after the shell paints, so wait for the row rather than
		// racing it — and say what was there if it never turns up.
		const click = (title: string) =>
			app.evaluate(`(async () => {
				for (let i = 0; i < 100; i++) {
					const row = [...document.querySelectorAll("[data-ly-row] > button")]
						.find((b) => b.textContent.includes(${JSON.stringify(title)}));
					if (row) { row.click(); return 1; }
					await new Promise((r) => setTimeout(r, 100));
				}
				const rows = [...document.querySelectorAll("[data-ly-row] > button")].map((b) => b.textContent.trim());
				throw new Error("no row for " + ${JSON.stringify(title)} + "; rows are: " + JSON.stringify(rows));
			})()`);

		// Into the one with a panel, and let it settle completely.
		await click("带面板的会话");
		await new Promise((r) => setTimeout(r, 3000));
		const panes = await app.evaluate<string[]>(
			`[...document.querySelectorAll("[data-dock-pane]")].map((el) => el.dataset.dockPane)`,
		);
		console.log(`panes in the dock: ${panes.join(", ") || "(none)"}`);
		if (!panes.includes("review")) {
			const stored = await app.evaluate<string | null>(
				`window.localStorage.getItem(${JSON.stringify(`dw:panedock:${IDS[0]}`)})`,
			);
			throw new Error(`the panel never opened. Stored layout was: ${stored}`);
		}
		await shoot("00-before-with-panel");

		// Out to the one with none, sampling as fast as screenshots can be taken.
		await click("只有对话的会话");
		for (let i = 1; i <= 8; i++) {
			await shoot(`${String(i).padStart(2, "0")}-switching`);
		}
		await new Promise((r) => setTimeout(r, 1500));
		await shoot("09-after-no-panel");

		console.log(`\nwrote frames to ${out}`);

		async function shoot(name: string) {
			const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
			await writeFile(join(out, `${name}.png`), Buffer.from(shot.data, "base64"));
		}
	} finally {
		await app.stop();
		await rm(repo, { recursive: true, force: true }).catch(() => {});
	}
}

await main();
