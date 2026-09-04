/**
 * The failure omp's design cannot survive: an extension that never returns control.
 *
 * A thrown error is easy — any host catches that. An infinite loop is the one that separates a
 * convention from a boundary: in-process there is no way to take the thread back, and the session
 * is gone. This checks that the host outlives it, and that the session's own work continues.
 */
const say = (s = "") => process.stderr.write(s + "\n");
const B = "/Users/kittors/Developer/opensource/Lyra-tool-quality";
const { ExtensionHost } = await import(`${B}/packages/core/src/extensions/host.ts`);
const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

const root = await mkdtemp(join(tmpdir(), "ext-crash-"));
const dir = join(root, "spinner");
await mkdir(dir, { recursive: true });
await writeFile(join(dir, "extension.json"), JSON.stringify({ name: "spinner", main: "index.mjs", events: ["tool_call"], intercepts: true }));
/* A busy loop: no await, no I/O, nothing that yields. */
await writeFile(join(dir, "index.mjs"), `export default { tool_call: () => { while (true) {} } };`);

const host = new ExtensionHost();
await host.load(dir);

say("\n扩展里写了一个死循环（`while (true) {}`），然后正常调用它：\n");
const started = Date.now();
const result = await host.intercept("tool_call", { toolName: "bash" });
const elapsed = Date.now() - started;

say(`  宿主拿回控制权   ${elapsed}ms  ${elapsed < 5000 ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"}`);
say(`  这次调用被拦了吗 ${result.block ? "是" : "否"}  ${result.block ? "\x1b[31m✗ 死循环不该有发言权\x1b[0m" : "\x1b[32m✓\x1b[0m"}`);
say(`  记下了原因       ${host.diagnostics.some((d) => /没有响应/.test(d.message)) ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"}`);

/* And the session keeps working — the whole point. */
say(`  会话还活着       \x1b[32m✓ 这一行就是它打印的\x1b[0m`);
await host.dispose();
say(`  dispose 之后进程能退出（下面这行之后不该挂住）`);
