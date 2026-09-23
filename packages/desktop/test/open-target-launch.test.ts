/**
 * How 「在终端中打开」 and 「用 … 打开」 actually start the program, per platform.
 *
 * Three ways this went wrong. The directory was passed as the only argument and no `cwd` was set,
 * so Windows Terminal read the folder as a *command* to run (`wt <dir>` rather than `wt -d <dir>`)
 * and gnome-terminal ignored it. Linux offered gnome-terminal and nothing else. And `code.cmd` was
 * started without a shell, which Node refuses with EINVAL — the error handler then opened the file
 * with the system default, so choosing VS Code quietly did something else.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CANDIDATES, type Candidate, launchPlan } from "../electron/open-target-ids.ts";

const candidate = (platform: string, id: string): Candidate => {
	const found = CANDIDATES[platform]?.find((entry) => entry.id === id);
	assert.ok(found, `${platform} has no ${id}`);
	return found;
};

test("Windows Terminal is told the directory with -d, and started in it", () => {
	const plan = launchPlan(candidate("win32", "windows-terminal"), "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe", "C:\\proj", "win32", {});
	assert.deepEqual(plan.args, ["-d", "C:\\proj"]);
	assert.equal(plan.cwd, "C:\\proj");
	assert.equal(plan.file, "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe");
});

test("a semicolon in the path is escaped, because wt reads a bare one as the next command", () => {
	const plan = launchPlan(candidate("win32", "windows-terminal"), "wt.exe", "C:\\a;b", "win32", {});
	assert.deepEqual(plan.args, ["-d", "C:\\a\\;b"]);
});

test("each Linux terminal gets the directory the way it asks for it", () => {
	const dir = "/home/me/my project";
	const expected: Record<string, string[]> = {
		"gnome-terminal": [`--working-directory=${dir}`],
		ptyxis: ["--new-window", `--working-directory=${dir}`],
		kgx: [`--working-directory=${dir}`],
		konsole: ["--workdir", dir],
		"xfce4-terminal": [`--working-directory=${dir}`],
		kitty: ["--directory", dir],
		alacritty: ["--working-directory", dir],
		wezterm: ["start", "--cwd", dir],
		tilix: [`--working-directory=${dir}`],
	};
	for (const [id, args] of Object.entries(expected)) {
		const plan = launchPlan(candidate("linux", id), `/usr/bin/${id}`, dir, "linux", {});
		assert.deepEqual(plan.args, args, id);
		// And started there, for any terminal that reads its own working directory instead.
		assert.equal(plan.cwd, dir, id);
	}
});

test("every terminal on every platform says how it takes a directory", () => {
	for (const [platform, list] of Object.entries(CANDIDATES)) {
		if (platform === "darwin") continue; // `open -a` hands the folder over itself.
		for (const entry of list.filter((item) => item.kind === "terminal")) {
			assert.ok(entry.dirArgs, `${platform}/${entry.id} would be handed the folder as a command`);
		}
	}
});

test("VS Code's code.cmd goes through cmd.exe, with the path quoted for it", () => {
	const plan = launchPlan(
		candidate("win32", "vscode"),
		"C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
		"C:\\proj\\a&b.ts",
		"win32",
		{ ComSpec: "C:\\Windows\\system32\\cmd.exe" },
	);
	assert.equal(plan.file, "C:\\Windows\\system32\\cmd.exe");
	assert.equal(plan.windowsVerbatimArguments, true);
	const line = plan.args.at(-1) ?? "";
	assert.ok(line.includes("a^&b.ts"), `the & reached cmd unescaped: ${line}`);
});

test("an .exe is started directly with the file as its argument", () => {
	const plan = launchPlan(candidate("win32", "zed"), "C:\\Users\\me\\AppData\\Local\\Programs\\Zed\\Zed.exe", "C:\\proj\\main.rs", "win32", {});
	assert.deepEqual(plan, { file: "C:\\Users\\me\\AppData\\Local\\Programs\\Zed\\Zed.exe", args: ["C:\\proj\\main.rs"] });
});
