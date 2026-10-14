/**
 * The askpass helper, as the desktop build emits it: `out/main/askpass.js`.
 *
 * An entry of its own, like the sandbox runner beside it: ssh, sudo and git start it as
 * `<this executable> askpass.js <socket> <prompt>` in Node mode, once per password prompt, and it
 * must do nothing but ask the broker and print the answer. `main.ts` registers this file's path with
 * core at startup; everything it does is in `core/credentials/askpass-entry.ts`.
 */
import "@lyra/core/askpass";
