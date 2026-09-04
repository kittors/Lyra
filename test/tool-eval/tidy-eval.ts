/**
 * Does the per-turn tidy actually fire inside a real run, and does it respect the cache?
 *
 * Driven through `runAgent` with a scripted stream, because what is under test is the loop's own
 * bookkeeping — when it decides history is safe to rewrite — not the pruning arithmetic, which the
 * unit tests already pin.
 */
const say = (s = "") => process.stderr.write(s + "\n");
const B = "/Users/kittors/Developer/opensource/Lyra-tool-quality";
const { runAgent } = await import(`${B}/packages/core/src/agent/loop.ts`);

const EMPTY = "No matches for /nothing/.\n(searched 340 files)".repeat(10);

const grep = {
  name: "grep", snippet: "s", description: "d",
  parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  async execute() { return { content: [{ type: "text", text: EMPTY }], uneventful: true }; },
};

/**
 * Three turns, so the empty result ends up buried rather than at the end.
 *
 * The first draft used two, and both arms "passed" — because the tidy runs before a request, and
 * at that moment the result it would clear is the last message in the history. The suffix below it
 * is empty, so it is always cheap to rewrite, and the cache rule never got a chance to say no.
 * That is the correct behaviour for a result that was just produced; what it does not exercise is
 * the case the rule exists for.
 *
 *   turn 1: grep, which finds nothing
 *   turn 2: a reply of `tailSize` characters — now the empty result has something under it
 *   turn 3: the measurement — was it cleared with that tail in place?
 */
function script(tailSize: number) {
  let turn = 0;
  return async (ctx: { messages: { role: string; content: { type: string; text?: string }[] }[] }) => {
    turn += 1;
    if (turn === 1) {
      return {
        role: "assistant", content: [{ type: "toolCall", id: "c1", name: "grep", arguments: { pattern: "nothing" }, argumentsText: "{}" }],
        api: "openai-responses", provider: "p", model: "m", usage: {}, stopReason: "toolUse", timestamp: Date.now(),
      };
    }
    if (turn === 2) {
      return {
        role: "assistant", content: [{ type: "toolCall", id: "c2", name: "grep", arguments: { pattern: "again" }, argumentsText: "{}" }, { type: "text", text: "x".repeat(tailSize) }],
        api: "openai-responses", provider: "p", model: "m", usage: {}, stopReason: "toolUse", timestamp: Date.now(),
      };
    }
    (globalThis as Record<string, unknown>).__seen = ctx.messages
      .filter((m) => m.role === "toolResult")
      .map((m) => m.content.map((c) => c.text ?? "").join(""));
    return {
      role: "assistant", content: [{ type: "text", text: "好了" }],
      api: "openai-responses", provider: "p", model: "m", usage: {}, stopReason: "stop", timestamp: Date.now(),
    };
  };
}

for (const [label, tail] of [["尾巴很小（缓存损失小）", 10], ["尾巴很大（缓存还热）", 40_000]] as const) {
  (globalThis as Record<string, unknown>).__seen = [];
  await runAgent(
    {
      sessionId: "tidy", cwd: "/tmp",
      provider: { id: "p", name: "P", baseUrl: "x", api: "openai-responses", apiKey: "k", enabled: true, models: [] } as never,
      model: { id: "m", providerId: "p", modelId: "m", name: "M", contextWindow: 100000, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsTools: true } as never,
      systemPrompt: "s", tools: [grep] as never[],
      messages: [{ role: "user", content: [{ type: "text", text: "找一下" }], timestamp: Date.now() }],
      maxTurns: 4, streamFn: script(tail) as never,
    },
    async () => {},
  );
  const seen = (globalThis as Record<string, unknown>).__seen as string[];
  /* The first result is the buried one — it has the reply and a second result under it. */
  const buried = seen[0] ?? "";
  const cleared = buried.includes("无结果");
  /*
   * Both arms clear it, and that is correct.
   *
   * The tidy runs before each request, so the empty result is cleared on the turn after it was
   * produced — at which point it is still the newest message and nothing has ever been cached with
   * it. The tail added later cannot retroactively make that a bad idea. What this probe actually
   * shows is that the tidy fires inside a real loop at all; the cache rule is exercised against a
   * resumed history, which `prune-timing.test.ts` covers.
   */
  const expected = true;
  say(`  ${label.padEnd(26)} 埋在中间的那条 ${cleared ? "已清空" : "原样保留"}  ${cleared === expected ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"}  (${buried.length} 字符)`);
}
say("\n  两者都清了，而且都对——清的是刚产生的结果，那时它还没进过任何缓存。\n  缓存判断真正管的是恢复出来的会话：日志里带着上一次运行留下的空结果，\n  那些才是压在后面所有内容之下的。");
