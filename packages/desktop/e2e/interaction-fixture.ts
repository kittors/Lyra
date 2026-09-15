import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * 跑 git 用的环境。
 *
 * macOS 上 `xcode-select` 可能指着完整的 Xcode，而它的许可协议没人同意过——那样**任何** git 命令
 * 都直接退出 69，报 "You have not agreed to the Xcode license agreements"。同意它要 sudo，而这个
 * fixture 只是想 init 一个空仓库。
 *
 * 命令行工具那份 git 不受这条约束，所以存在就指过去。不存在（CI 上常常如此）就什么都不改，用
 * 原来的环境——所以这一段在 CI 上是个空操作，不会把构建机指向一个不存在的目录。
 */
function gitEnv(): NodeJS.ProcessEnv {
	const clt = "/Library/Developer/CommandLineTools";
	return existsSync(clt) ? { ...process.env, DEVELOPER_DIR: clt } : process.env;
}

/** Synthetic logs and candidate data, read by the real app through its normal filesystem paths. */
export async function seedInteractions(home: string, modelPort?: number): Promise<void> {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(cwd);
	const git = async (...args: string[]) => promisify(execFile)("git", args, { cwd, env: gitEnv() });
	await git("init", "-q");
	await git("config", "user.email", "test@example.com");
	await git("config", "user.name", "Lyra test");
	await writeFile(join(cwd, "README.md"), "# QA fixture\n");
	await git("add", "README.md"); await git("commit", "-qm", "seed");
	await writeFile(join(cwd, "Hello.cs"), 'using System;\npublic class Hello {\n public string Text = "before";\n}\n');
	await git("add", "Hello.cs");
	await writeFile(join(cwd, "Hello.cs"), 'using System;\npublic class Hello {\n public string Text = "after";\n}\n');
	await git("branch", "feature/a-long-branch-name-for-hover-scrolling-and-alignment-verification");
	await git("worktree", "add", "-qb", "qa-checkout", join(home, "second-checkout-with-a-long-name-for-multiline-tooltip-and-text-alignment-verification"));
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const metas = [];
	for (const id of ["qa-long", "qa-short"]) {
		const messages = [];
		for (let i = 0; i < (id === "qa-long" ? 120 : 5); i++) {
			messages.push({ role: "user", content: [{ type: "text", text: `${id} 第 ${i + 1} 个问题：检查会话导航、缓存与滚动位置。` }], timestamp: i * 10 });
			messages.push({ role: "assistant", content: [{ type: "text", text: `第 ${i + 1} 个回答\n\n${"真实应用加载的隔离测试文本，验证长内容的换行和稳定布局。".repeat(5 + i % 9)}` }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "stop", timestamp: i * 10 + 1 });
		}
		const meta = { id, title: id, projectId, projectName: "交互验证", cwd, createdAt: 1, updatedAt: 2, modelId: "qa/model", messageCount: messages.length, usage, seq: messages.length + 1 };
		metas.push(meta);
		await writeFile(join(home, "sessions", projectId, `${id}.jsonl`), [JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }), ...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 1, ts: 1 })), JSON.stringify({ type: "meta", meta, seq: meta.seq, ts: 2 })].join("\n") + "\n");
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
	const pending = join(home, "projects", projectId, "memory", "skills", ".pending");
	await mkdir(pending, { recursive: true });
	await writeFile(join(pending, "portable-release-verification.md"), `---\nname: portable-release-verification\ndescription: 验证发布流程前，先发现当前仓库的实际脚本与门禁。\nstatus: pending\nscope: portable\nsourceSessions: ["qa-long", "qa-short"]\n---\n\n## 适用范围\n适用于声明了发布脚本的项目。\n\n## 输入与前置检查\n读取当前的 AGENTS.md、package.json 和工作区清单。\n\n## 执行步骤\n${Array.from({ length: 35 }, (_, i) => `${i + 1}. 发现当前项目的验证命令并核对结果，保留失败日志。`).join("\n")}\n\n## 验证与失败处理\n门禁未通过则停止，不推送任何版本。\n`);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1200, height: 800 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({ providers: modelPort ? [{ id: "qa", name: "隔离测试模型", api: "anthropic-messages", baseUrl: `http://127.0.0.1:${modelPort}`, apiKey: "test", enabled: true,
		models: [{ id: "qa/model", providerId: "qa", modelId: "model", name: "QA", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: true, supportsTools: true, supportsThinking: false }] }] : [], defaultModelId: "qa/model", mcpServers: [], hooks: [], sync: { enabled: false },
		projects: [{ id: projectId, path: cwd, name: "交互验证", pinned: true, lastOpenedAt: 1 }] }));
}
