/**
 * Open the component gallery.
 *
 * A script rather than `LYRA_GALLERY=1 electron-vite dev` in the package.json, because that form
 * does not work on Windows — `cmd` reads it as a command called `LYRA_GALLERY=1`. Setting it here
 * works everywhere and needs no extra dependency.
 */

import { spawn } from "node:child_process";

const child = spawn("electron-vite", ["dev"], {
	stdio: "inherit",
	shell: process.platform === "win32",
	env: { ...process.env, LYRA_GALLERY: "1" },
});

child.on("exit", (code) => process.exit(code ?? 0));
