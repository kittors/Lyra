/* oxlint-disable no-console, react-hooks/rules-of-hooks -- a probe that reports what it found; `useToolRegistry` installs a tool list and has nothing to do with React */
/**
 * 市场上的每一个条目，真的装一遍、真的跑一遍。
 *
 * 用法：
 *   node --import ./test/setup.ts --experimental-strip-types test/market-verify-probe.ts <plan.json> <输出目录> [--only a,b] [--no-model] [--model <id>]
 *
 * plan.json：{ entries: [{ entry: RegistryEntry, test?: { prompt, expect: "mcp" | "skill", keys?: {NAME: "值或 $环境变量"} } }] }
 *
 * 每个条目一个全新的 LYRA_HOME，走的是应用自己的那几条路，不是替身：
 *
 *   1. 装：`installEntry`——克隆（或下载包）、按内容认种类、放进对应目录、记账；
 *   2. 读：`loadPlugins` / `loadSkills`——扫出来的种类、技能数、有没有读不出来的；
 *   3. 起（MCP）：先不给钥匙，看它是不是被拦在「缺什么」上而不是带着空位起来；再填上钥匙（没有真钥匙
 *      就填一个占位值，只验证能起、能列工具），用 `McpManager` 连上、`tools/list`；
 *   4. 用（可选，--no-model 跳过）：用这台机器上配好的真实模型开一个会话，问一个只有这个插件能答好的
 *      问题，看模型是不是真的调了它的工具 / 读了它的技能，工具有没有报错。
 *
 * 模型那一步读的是 `~/.lyra` 里的供应商配置：把 settings.json、credentials.json、vault.key 拷进临时
 * 目录，密钥在保险箱里解开，这个脚本从不打印它们。权限用 `full`（不问人），工具只给只读的那几个加上
 * 被测的 MCP 服务——不会碰这台机器上的任何真实文件。
 */

import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
	AgentSession,
	globTool,
	grepTool,
	installEntry,
	loadPlugins,
	loadSettings,
	loadSkills,
	lsTool,
	McpManager,
	missingFor,
	primeCommandPath,
	readTool,
	resetVault,
	SessionStore,
	skillTool,
	useToolRegistry,
	type AgentEvent,
	type McpServerConfig,
	type RegistryEntry,
	type Settings,
	type Tool,
} from "../src/index.ts";
import { commandEnv } from "../src/sandbox/login-path.ts";

interface PlanItem {
	entry: RegistryEntry;
	test?: { prompt?: string; expect?: "mcp" | "skill"; keys?: Record<string, string>; model?: boolean; gitRepo?: boolean };
}

interface Result {
	id: string;
	name: string;
	kind: string;
	install: { ok: boolean; ms: number; kind?: string; error?: string };
	load: { ok: boolean; skills: number; skillNames: string[]; problems: string[] };
	mcp?: {
		declared: string[];
		missingWithoutKeys: string[];
		blockedWithoutKeys: boolean;
		keysUsed: "real" | "placeholder" | "none";
		ok: boolean;
		ms: number;
		tools: string[];
		error?: string;
	};
	model?: {
		ok: boolean;
		ms: number;
		model: string;
		toolCalls: { name: string; isError: boolean }[];
		used: boolean;
		answer: string;
		error?: string;
	};
	verdict: "pass" | "fail" | "partial";
	notes: string[];
}

const argv = process.argv.slice(2);
const planPath = argv[0];
const outDir = argv[1];
if (!planPath || !outDir) {
	console.error("用法：market-verify-probe.ts <plan.json> <输出目录> [--only a,b] [--no-model] [--model <id>]");
	process.exit(2);
}
const only = argv.includes("--only") ? new Set(argv[argv.indexOf("--only") + 1]!.split(",")) : null;
const withModel = !argv.includes("--no-model");
const modelOverride = argv.includes("--model") ? argv[argv.indexOf("--model") + 1] : undefined;
const REAL_HOME = process.env.LYRA_REAL_HOME ?? join(homedir(), ".lyra");
const MCP_TIMEOUT_MS = 240_000;
const MODEL_TIMEOUT_MS = 300_000;

await main(planPath, outDir);

async function main(planPath: string, outDir: string): Promise<void> {
const plan = JSON.parse(await (await import("node:fs/promises")).readFile(planPath, "utf8")) as { entries: PlanItem[] };
await mkdir(outDir, { recursive: true });
await primeCommandPath();
const results: Result[] = [];

for (const item of plan.entries) {
	if (only && !only.has(item.entry.id)) continue;
	console.log(`\n━━ ${item.entry.id}（${item.entry.name}，${item.entry.kind}）`);
	const result = await verify(item).catch((error: unknown): Result => ({
		id: item.entry.id,
		name: item.entry.name,
		kind: item.entry.kind,
		install: { ok: false, ms: 0, error: error instanceof Error ? error.message : String(error) },
		load: { ok: false, skills: 0, skillNames: [], problems: [] },
		verdict: "fail",
		notes: ["探针自己抛了异常"],
	}));
	results.push(result);
	console.log(`   → ${result.verdict === "pass" ? "✅ 通过" : result.verdict === "partial" ? "🟡 部分" : "❌ 失败"}  ${result.notes.join("；")}`);
	await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2));
}

await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2));
await writeFile(join(outDir, "report.md"), report(results));
console.log(`\n通过 ${results.filter((r) => r.verdict === "pass").length} / ${results.length}，报告：${join(outDir, "report.md")}`);
// MCP 子进程、会话里的定时器都可能还挂着：结果已经写完，不等它们。
process.exit(0);
}

async function verify(item: PlanItem): Promise<Result> {
	const { entry, test } = item;
	const notes: string[] = [];
	const home = await mkdtemp(join(tmpdir(), `lyra-verify-${entry.id}-`));
	process.env.LYRA_HOME = home;
	resetVault();
	if (withModel && test?.prompt && test.model !== false) {
		for (const file of ["settings.json", "credentials.json", "vault.key"]) {
			await copyFile(join(REAL_HOME, file), join(home, file)).catch(() => undefined);
		}
	}

	// 1. 装
	const started = Date.now();
	let installed: Awaited<ReturnType<typeof installEntry>>;
	try {
		installed = await installEntry(entry, "verify");
	} catch (error) {
		return {
			id: entry.id,
			name: entry.name,
			kind: entry.kind,
			install: { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) },
			load: { ok: false, skills: 0, skillNames: [], problems: [] },
			verdict: "fail",
			notes: ["安装失败"],
		};
	}
	const install = { ok: true, ms: Date.now() - started, kind: installed.kind };
	console.log(`   装好了：${installed.kind}，${install.ms}ms，${installed.dir}`);
	if (installed.kind !== entry.kind) notes.push(`索引说是 ${entry.kind}，装下来是 ${installed.kind}`);

	// 2. 读
	const scan = await loadPlugins([
		{ dir: join(home, "plugins"), source: "user" },
		{ dir: join(home, "mcp"), source: "user" },
	]);
	// 技能集现在整个装成 plugins/<id>；零散技能目录里的只可能是旧版装法留下的，一并算上。
	const loose = await loadSkills([{ dir: join(home, "skills"), source: "user" }]);
	const skills = [...scan.plugins.flatMap((plugin) => plugin.skills), ...loose.skills];
	const problems = [...scan.diagnostics, ...loose.diagnostics].filter((d) => !("severity" in d) || d.severity !== "warning").map((d) => `${d.path}: ${d.message}`);
	const load = { ok: problems.length === 0 && (installed.kind === "mcp" ? scan.mcpBundles.length === 1 : skills.length > 0), skills: skills.length, skillNames: skills.map((s) => s.name), problems };
	console.log(`   读出来：${skills.length} 个技能，${scan.mcpBundles.length} 个 MCP 包，${problems.length} 个问题`);
	if (!load.ok) notes.push(problems.length > 0 ? `读取问题：${problems[0]}` : "没读出东西");

	// 3. 起
	let mcp: Result["mcp"];
	const rows: McpServerConfig[] = [];
	if (installed.kind === "mcp") {
		const environment = commandEnv(process.env);
		const declared = installed.servers.flatMap((server) => missingFor(server, {}));
		const missingWithoutKeys = [...new Set(installed.servers.flatMap((server) => missingFor(server, environment)))];
		// 不给钥匙：应当被拦下，而不是启动一个带着空位的进程。
		let blockedWithoutKeys = true;
		if (missingWithoutKeys.length > 0) {
			const manager = new McpManager({ timeoutMs: 20_000 });
			const statuses = await manager.connectAll(installed.servers.map((server) => ({ ...server, enabled: true })));
			await manager.dispose();
			blockedWithoutKeys = statuses.every((status) => status.state === "failed" && (status.missing?.length ?? 0) > 0);
			if (!blockedWithoutKeys) notes.push("缺钥匙时没有被拦下");
		}
		const keys: Record<string, string> = {};
		let keysUsed: "real" | "placeholder" | "none" = "none";
		for (const name of missingWithoutKeys) {
			const wanted = test?.keys?.[name];
			const real = wanted?.startsWith("$") ? environment[wanted.slice(1)] : wanted;
			if (real) {
				keys[name] = real;
				keysUsed = "real";
			} else {
				keys[name] = "lyra-verify-placeholder";
				if (keysUsed === "none") keysUsed = "placeholder";
			}
		}
		for (const server of installed.servers) rows.push({ ...server, enabled: true, env: { ...server.env, ...keys } } as McpServerConfig);
		const connectStarted = Date.now();
		const manager = new McpManager({ timeoutMs: MCP_TIMEOUT_MS });
		const statuses = await manager.connectAll(rows);
		await manager.dispose();
		const ok = statuses.length > 0 && statuses.every((status) => status.state === "connected");
		mcp = {
			declared: [...new Set(declared)],
			missingWithoutKeys,
			blockedWithoutKeys,
			keysUsed,
			ok,
			ms: Date.now() - connectStarted,
			tools: statuses.flatMap((status) => status.tools.map((tool) => tool.name)),
			...(ok ? {} : { error: statuses.map((status) => status.error).filter(Boolean).join("; ").slice(0, 400) }),
		};
		console.log(`   起来了：${ok ? "是" : "否"}，${mcp.tools.length} 个工具，${mcp.ms}ms${keysUsed !== "none" ? `，钥匙：${keysUsed === "real" ? "真的" : "占位"}` : ""}${mcp.error ? `，${mcp.error.slice(0, 120)}` : ""}`);
		if (!ok) notes.push("MCP 服务没连上");
	}

	// 4. 用
	let model: Result["model"];
	if (withModel && test?.prompt && test.model !== false && (installed.kind !== "mcp" || (mcp?.ok && mcp.keysUsed !== "placeholder"))) {
		model = await tryWithModel(entry, installed.kind, rows, skills.map((s) => s.name), test.prompt, home, test.gitRepo === true);
		console.log(`   模型：${model.ok && model.used ? "用上了" : "没用上"}（${model.model}，${model.ms}ms），调用：${model.toolCalls.map((c) => `${c.name}${c.isError ? "✗" : ""}`).join("、") || "无"}`);
		console.log(`   回答：${model.answer.replace(/\s+/g, " ").slice(0, 160)}`);
		if (!model.used) notes.push("模型没有用上它");
	} else if (withModel && mcp?.keysUsed === "placeholder") {
		notes.push("要真钥匙才能让模型用，这里只验证到能启动、能列工具");
	}

	await rm(home, { recursive: true, force: true }).catch(() => undefined);
	const passed = install.ok && load.ok && (mcp ? mcp.ok && mcp.blockedWithoutKeys : true) && (model ? model.ok && model.used : true);
	return {
		id: entry.id,
		name: entry.name,
		kind: entry.kind,
		install,
		load,
		...(mcp ? { mcp } : {}),
		...(model ? { model } : {}),
		verdict: passed ? "pass" : install.ok && load.ok ? "partial" : "fail",
		notes,
	};
}

async function tryWithModel(
	entry: RegistryEntry,
	kind: string,
	rows: McpServerConfig[],
	skillNames: string[],
	prompt: string,
	home: string,
	gitRepo: boolean,
): Promise<NonNullable<Result["model"]>> {
	const started = Date.now();
	useToolRegistry({ all: () => [readTool, lsTool, globTool, grepTool, skillTool] as unknown as Tool[] });
	const loaded = await loadSettings();
	const modelId = modelOverride ?? loaded.defaultModelId ?? "";
	const settings: Settings = {
		...loaded,
		defaultModelId: modelId,
		mcpServers: rows,
		permissionMode: "full",
		disabledPlugins: [],
		hooks: [],
		scheduledTasks: [],
		maxConcurrentSubAgents: 1,
	};
	const calls: { id: string; name: string; isError: boolean; args: Record<string, unknown> }[] = [];
	let answer = "";
	let failure: string | undefined;
	const work = join(home, "work");
	await mkdir(work, { recursive: true });
	// 要一个仓库才能问「有哪些改动」的，给它一个：提交过一次、又改了一个文件。
	if (gitRepo) {
		const { execFileSync } = await import("node:child_process");
		const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: work });
		await writeFile(join(work, "README.md"), "# demo\n\n第一版。\n");
		git("init", "-q");
		git("add", "-A");
		git("commit", "-qm", "init");
		await writeFile(join(work, "README.md"), "# demo\n\n第二版：加了安装说明。\n");
		await writeFile(join(work, "notes.txt"), "新文件\n");
	}
	const session = new AgentSession({
		cwd: work,
		settings,
		store: new SessionStore(join(home, "sessions")),
		emit: (event: AgentEvent) => {
			if (event.type === "tool_start") calls.push({ id: event.toolCallId, name: event.toolName, isError: false, args: event.args });
			if (event.type === "tool_end") {
				const call = calls.find((c) => c.id === event.toolCallId);
				if (call) call.isError = event.isError;
			}
			if (event.type === "message_end" && event.message.role === "assistant") {
				const text = event.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
				if (text.trim()) answer = text;
			}
			if (event.type === "agent_end" && event.reason === "error") failure = event.error;
		},
	});
	try {
		await session.initialize();
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			session.prompt([{ type: "text", text: prompt }]),
			new Promise<void>((_, reject) => {
				timer = setTimeout(() => {
					session.abort();
					reject(new Error(`超过 ${MODEL_TIMEOUT_MS / 1000} 秒`));
				}, MODEL_TIMEOUT_MS);
			}),
		]).finally(() => clearTimeout(timer));
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	} finally {
		await session.dispose().catch(() => undefined);
	}
	const prefix = rows.map((row) => `mcp__${row.id.replace(/[^a-zA-Z0-9_-]/g, "_")}__`);
	const used =
		kind === "mcp"
			? calls.some((call) => prefix.some((p) => call.name.startsWith(p)) && !call.isError)
			: calls.some(
					(call) =>
						(call.name === "skill" && skillNames.includes(String(call.args.name ?? ""))) ||
						(call.name === "read" && String(call.args.path ?? call.args.file_path ?? "").includes(entry.id)),
				);
	return {
		ok: !failure && answer.trim().length > 0,
		ms: Date.now() - started,
		model: modelId,
		toolCalls: calls.map(({ name, isError }) => ({ name, isError })),
		used,
		answer: answer.slice(0, 1200),
		...(failure ? { error: failure } : {}),
	};
}

function report(all: Result[]): string {
	const pass = all.filter((r) => r.verdict === "pass").length;
	const lines = [
		"# 插件市场逐项实测报告",
		"",
		`时间：${new Date().toISOString()}　通过 ${pass} / ${all.length}`,
		"",
		"| 条目 | 种类 | 安装 | 读取 | MCP 启动 / 工具数 | 缺钥匙时被拦下 | 模型实测 | 结论 |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
	];
	for (const r of all) {
		lines.push(
			`| ${r.name}（${r.id}） | ${r.install.kind ?? r.kind} | ${r.install.ok ? `✅ ${(r.install.ms / 1000).toFixed(1)}s` : `❌ ${r.install.error ?? ""}`} | ${r.load.ok ? `✅ ${r.load.skills} 技能` : `❌ ${r.load.problems[0] ?? ""}`} | ${
				r.mcp ? (r.mcp.ok ? `✅ ${r.mcp.tools.length}（${(r.mcp.ms / 1000).toFixed(1)}s${r.mcp.keysUsed === "placeholder" ? "，占位钥匙" : ""}）` : `❌ ${(r.mcp.error ?? "").slice(0, 80)}`) : "—"
			} | ${r.mcp ? (r.mcp.missingWithoutKeys.length === 0 ? "不需要钥匙" : r.mcp.blockedWithoutKeys ? `✅ 缺 ${r.mcp.missingWithoutKeys.join("、")}` : "❌") : "—"} | ${
				r.model ? (r.model.used ? `✅ ${r.model.toolCalls.filter((c) => !c.isError).length} 次调用` : `❌ ${r.model.error ?? "没用上"}`) : "—"
			} | ${r.verdict === "pass" ? "通过" : r.verdict === "partial" ? "部分" : "失败"} |`,
		);
	}
	lines.push("", "## 细节", "");
	for (const r of all) {
		lines.push(`### ${r.name}（${r.id}）`, "");
		if (r.load.skillNames.length) lines.push(`- 技能：${r.load.skillNames.slice(0, 30).join("、")}${r.load.skillNames.length > 30 ? "…" : ""}`);
		if (r.mcp) lines.push(`- 工具：${r.mcp.tools.join("、") || "（无）"}`);
		if (r.model) {
			lines.push(`- 模型（${r.model.model}）调用：${r.model.toolCalls.map((c) => `${c.name}${c.isError ? "（出错）" : ""}`).join("、") || "无"}`);
			lines.push(`- 模型回答：${r.model.answer.replace(/\n+/g, " ").slice(0, 400)}`);
		}
		if (r.notes.length) lines.push(`- 备注：${r.notes.join("；")}`);
		lines.push("");
	}
	return lines.join("\n");
}

