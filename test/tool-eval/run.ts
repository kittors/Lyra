/**
 * Run the edit-format evaluation and print a comparison.
 *
 *   node --experimental-strip-types test/tool-eval/run.ts
 *   node --experimental-strip-types test/tool-eval/run.ts --models relay/gemini-3.7-flash-high --formats str-replace,hunk-text
 *
 * Every run writes a JSON record under test/tool-eval/results/ so a later change can be compared
 * against it rather than against a memory of what the numbers were.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSettings, resolveModel } from "../../packages/core/src/config/settings.ts";
import type { ModelConfig, ProviderConfig } from "../../packages/core/src/types.ts";
import { CASES } from "./cases.ts";
import { FORMATS, type FormatId } from "./formats.ts";
import { runCase, type CaseResult } from "./harness.ts";

const DEFAULT_MODELS = ["relay/gemini-3.7-flash-high"];
const DEFAULT_FORMATS: FormatId[] = ["str-replace", "hunk-text", "hunk-json"];

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Bounded concurrency: the relay rate-limits, and a 429 storm makes the numbers meaningless. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = Array.from({ length: items.length });
	let cursor = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (true) {
				const index = cursor++;
				if (index >= items.length) return;
				out[index] = await work(items[index]);
			}
		}),
	);
	return out;
}

function pct(n: number, d: number): string {
	return d === 0 ? "  — " : `${((n / d) * 100).toFixed(0).padStart(3)}%`;
}

function summarize(results: CaseResult[]) {
	const total = results.length;
	const first = results.filter((r) => r.firstAttemptPass).length;
	const eventual = results.filter((r) => r.eventualPass).length;
	const tokens = results.reduce((s, r) => s + r.totalOutputTokens, 0);
	const calls = results.reduce((s, r) => s + r.attempts.length, 0);
	const failures: Record<string, number> = {};
	for (const r of results) {
		if (r.firstOutcome !== "pass") failures[r.firstOutcome] = (failures[r.firstOutcome] ?? 0) + 1;
	}
	return { total, first, eventual, tokens, calls, failures };
}

async function main(): Promise<void> {
	const modelIds = (arg("models") ?? DEFAULT_MODELS.join(",")).split(",").filter(Boolean);
	const formatIds = (arg("formats") ?? DEFAULT_FORMATS.join(",")).split(",").filter(Boolean) as FormatId[];
	const caseFilter = arg("cases");
	const concurrency = Number(arg("concurrency") ?? 3);
	const repeats = Number(arg("repeats") ?? 1);

	const cases = caseFilter ? CASES.filter((c) => caseFilter.split(",").some((f) => c.id.includes(f))) : CASES;

	const settings = await loadSettings();
	const models: { provider: ProviderConfig; model: ModelConfig }[] = [];
	for (const id of modelIds) {
		const resolved = resolveModel(settings, id);
		if (!resolved) throw new Error(`Model not found: ${id}`);
		models.push(resolved);
	}

	console.log(`cases=${cases.length} formats=${formatIds.join(",")} models=${modelIds.join(",")} repeats=${repeats} concurrency=${concurrency}\n`);

	type Job = { testCase: (typeof cases)[number]; formatId: FormatId; entry: (typeof models)[number]; run: number };
	const jobs: Job[] = [];
	for (const entry of models) for (const formatId of formatIds) for (const testCase of cases) for (let run = 0; run < repeats; run++) jobs.push({ testCase, formatId, entry, run });

	let done = 0;
	const started = Date.now();
	const results = await pool(jobs, concurrency, async (job) => {
		const result = await runCase(job.testCase, FORMATS[job.formatId], job.entry.provider, job.entry.model);
		done += 1;
		const mark = result.firstAttemptPass ? "✓" : result.eventualPass ? "~" : "✗";
		process.stdout.write(`${mark} [${done}/${jobs.length}] ${job.formatId.padEnd(12)} ${job.testCase.id.padEnd(20)} ${result.firstOutcome}\n`);
		return result;
	});

	// ---- report ----
	console.log(`\n${"=".repeat(96)}`);
	console.log(`编辑格式对照 · ${new Date().toISOString()} · 耗时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
	console.log("=".repeat(96));

	for (const entry of models) {
		console.log(`\n模型 ${entry.model.id}\n`);
		console.log(`  ${"格式".padEnd(14)} ${"首次通过".padStart(9)} ${"三次内".padStart(8)} ${"输出token".padStart(10)} ${"平均调用".padStart(9)}   首次失败分布`);
		console.log(`  ${"-".repeat(92)}`);
		for (const formatId of formatIds) {
			const subset = results.filter((r) => r.modelId === entry.model.id && r.formatId === formatId);
			const s = summarize(subset);
			const failText = Object.entries(s.failures).map(([k, v]) => `${k}:${v}`).join(" ") || "—";
			console.log(
				`  ${formatId.padEnd(14)} ${`${s.first}/${s.total}`.padStart(7)} ${pct(s.first, s.total)} ${`${s.eventual}/${s.total}`.padStart(8)} ${String(s.tokens).padStart(10)} ${(s.calls / Math.max(1, s.total)).toFixed(2).padStart(9)}   ${failText}`,
			);
		}

		// Per-scenario first-attempt pass, so a format that only wins on one shape is visible.
		const scenarios = [...new Set(cases.map((c) => c.scenario))];
		console.log(`\n  按场景的首次通过率`);
		console.log(`  ${"场景".padEnd(14)} ${formatIds.map((f) => f.padStart(12)).join("")}`);
		console.log(`  ${"-".repeat(92)}`);
		for (const scenario of scenarios) {
			const cells = formatIds.map((formatId) => {
				const subset = results.filter((r) => r.modelId === entry.model.id && r.formatId === formatId && r.scenario === scenario);
				const s = summarize(subset);
				return `${s.first}/${s.total}`.padStart(12);
			});
			console.log(`  ${scenario.padEnd(14)} ${cells.join("")}`);
		}
	}

	// Cases that no format got right on the first try — usually a bad case, not a bad format.
	const universallyHard = cases.filter((c) => results.filter((r) => r.caseId === c.id).every((r) => !r.firstAttemptPass));
	if (universallyHard.length > 0) {
		console.log(`\n  ⚠ 所有格式首次都没做对：${universallyHard.map((c) => c.id).join(", ")}`);
		console.log(`     （先怀疑用例本身，再怀疑格式）`);
	}

	const dir = join(import.meta.dirname, "results");
	await mkdir(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const file = join(dir, `${stamp}.json`);
	await writeFile(file, JSON.stringify({ at: Date.now(), modelIds, formatIds, repeats, results }, null, 2));
	console.log(`\n结果已存档：${file.replace(process.cwd() + "/", "")}\n`);
}

await main();
