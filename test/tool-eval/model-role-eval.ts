/** Does a sub-agent actually run on the model its definition asked for? */
const say = (s = "") => process.stderr.write(s + "\n");
const B = "/Users/kittors/Developer/opensource/Lyra-tool-quality";
const { loadSettings, resolveModel, DEFAULT_SETTINGS } = await import(`${B}/packages/core/src/config/settings.ts`);
const { runSubAgent } = await import(`${B}/packages/core/src/runtime/sub-agent.ts`);
const { readTool } = await import(`${B}/packages/core/src/tools/read.ts`);
const { mkdtemp, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

const loaded = await loadSettings();
const parent = resolveModel(loaded, "relay/gemini-3.7-flash-high");
const fast = resolveModel(loaded, "relay/gemini-2.5-flash-lite");
if (!parent || !fast) throw new Error("需要两个模型");

const cwd = await mkdtemp(join(tmpdir(), "role-"));
await writeFile(join(cwd, "a.txt"), "内容一\n内容二\n", "utf8");

const settings = {
  ...DEFAULT_SETTINGS,
  providers: [parent.provider],
  mcpServers: [],
  permissionMode: "full" as const,
  modelRoles: { fast: fast.model.id },
};

for (const [label, def] of [
  ["没声明 model（应该跟父一样）", { name: "plain", description: "d", systemPrompt: "读文件并汇报。", tools: ["read"], source: "builtin" as const }],
  ["声明 @fast", { name: "quick", description: "d", systemPrompt: "读文件并汇报。", tools: ["read"], source: "builtin" as const, model: "@fast" }],
  ["声明一个不存在的 → 回落", { name: "gone", description: "d", systemPrompt: "读文件并汇报。", tools: ["read"], source: "builtin" as const, model: ["@deep", "relay/does-not-exist"] }],
] as const) {
  let used = "";
  await runSubAgent(
    {
      sessionId: "role", cwd, settings, tools: [readTool] as never[], skills: [], agents: [def as never],
      requestApproval: async () => "always",
      /*
       * `subagent_message`, not `message_end`.
       *
       * `message_end` is emitted inside `runTurn` and reaches the callback passed to it, not the
       * options.emit handed to `runSubAgent`. Listening to the wrong one reads as every case
       * failing, which is what it did.
       */
      emit: async (e: { type: string; message?: { model?: string } }) => {
        if (e.type === "subagent_message" && e.message?.model) used = e.message.model;
      },
    },
    { description: "读", prompt: "读 a.txt，一句话说里面是什么。", agentType: def.name },
    parent.provider, parent.model, "",
  );
  const expected = label.includes("@fast") ? fast.model.modelId : parent.model.modelId;
  say(`  ${label.padEnd(28)} 实际用了 ${used.padEnd(24)} ${used === expected ? "\x1b[32m✓\x1b[0m" : `\x1b[31m✗ 应该是 ${expected}\x1b[0m`}`);
}
say(`\n  父会话的模型是 ${parent.model.modelId}，@fast 配成了 ${fast.model.modelId}`);
