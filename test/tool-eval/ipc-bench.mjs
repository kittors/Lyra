/**
 * How expensive is one round trip to an isolated process?
 *
 * The plan makes this the first thing to build, because the answer decides the design: every
 * intercepted tool call has to cross the boundary, and a p99 of 30ms would mean interception is
 * a feature nobody can afford to leave on.
 *
 * Two candidates measured the same way. `utilityProcess` is Electron-only, so it is measured in
 * the app; `worker_threads` is plain Node and is measured here.
 */
import { Worker } from "node:worker_threads";
import { fork } from "node:child_process";
import { writeFileSync } from "node:fs";

const N = 1000;

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) };
}

const fmt = (s) => `p50 ${s.p50.toFixed(3)}ms  p95 ${s.p95.toFixed(3)}ms  p99 ${s.p99.toFixed(3)}ms  max ${s.max.toFixed(3)}ms`;

// --- worker_threads -------------------------------------------------------
writeFileSync("/tmp/bench-worker.mjs", `
import { parentPort } from "node:worker_threads";
parentPort.on("message", (m) => parentPort.postMessage({ id: m.id, result: m.args }));
`);

const worker = new Worker("/tmp/bench-worker.mjs");
const workerSamples = [];
await new Promise((resolve) => {
  let n = 0;
  const pending = new Map();
  worker.on("message", (m) => {
    const started = pending.get(m.id);
    workerSamples.push(Number(process.hrtime.bigint() - started) / 1e6);
    pending.delete(m.id);
    if (++n >= N) return resolve();
    send(n);
  });
  const send = (id) => {
    pending.set(id, process.hrtime.bigint());
    /*
     * This is `worker_threads`'s postMessage, not `window.postMessage` — there is no origin to
     * pass and no other document to reach. The lint rule matches on the method name alone.
     */
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    worker.postMessage({ id, args: { toolName: "bash", command: "echo hi", cwd: "/tmp/project" } });
  };
  send(0);
});
await worker.terminate();

// --- child_process fork (what a utilityProcess costs, minus Electron) -----
writeFileSync("/tmp/bench-child.mjs", `
process.on("message", (m) => process.send({ id: m.id, result: m.args }));
`);

const child = fork("/tmp/bench-child.mjs", [], { stdio: "ignore" });
const childSamples = [];
await new Promise((resolve) => {
  let n = 0;
  const pending = new Map();
  child.on("message", (m) => {
    const started = pending.get(m.id);
    childSamples.push(Number(process.hrtime.bigint() - started) / 1e6);
    pending.delete(m.id);
    if (++n >= N) return resolve();
    send(n);
  });
  const send = (id) => {
    pending.set(id, process.hrtime.bigint());
    child.send({ id, args: { toolName: "bash", command: "echo hi", cwd: "/tmp/project" } });
  };
  send(0);
});
child.kill();

const w = stats(workerSamples);
const c = stats(childSamples);
console.log(`\n${N} 次空往返（拦截一次 tool_call 的最小代价）\n`);
console.log(`  worker_threads   ${fmt(w)}`);
console.log(`  child_process    ${fmt(c)}   ← utilityProcess 的同类形态`);
console.log(`\n计划的门槛：p99 ≤ 5ms 就按计划做；5–15ms 则拦截类事件默认关闭；> 15ms 就不做拦截。`);
console.log(`  worker_threads   ${w.p99 <= 5 ? "✓ 按计划做" : w.p99 <= 15 ? "◐ 拦截默认关" : "✗ 不做拦截"}`);
console.log(`  child_process    ${c.p99 <= 5 ? "✓ 按计划做" : c.p99 <= 15 ? "◐ 拦截默认关" : "✗ 不做拦截"}`);
