/**
 * The sandbox runner, as the desktop build emits it: `out/main/sandbox-runner.js`.
 *
 * A second entry of the main build rather than a branch inside `main.ts`, because the runner is
 * started as `<this executable> sandbox-runner.js --lyra-sandbox-runner …` in Node mode and must do
 * nothing but confine and run the command — no app, no single-instance lock, no window. `main.ts`
 * registers this file's path with core at startup; everything the runner does is in
 * `core/sandbox/runner-entry.ts`.
 */
import "@lyra/core/sandbox-runner";
