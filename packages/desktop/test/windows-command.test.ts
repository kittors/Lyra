/**
 * Running a `.cmd` or `.bat` on Windows, which Node will not do by itself.
 *
 * Since the fix for CVE-2024-27980 Node refuses to spawn a batch file without a shell, so
 * `execFile("code.cmd", …)` throws EINVAL and the caller's fallback quietly opens the file with
 * whatever the system associates with it — 「用 VS Code 打开」 that never opened VS Code. The way
 * through is `cmd.exe`, and the danger on that way is the command line: a folder named `a&calc`
 * handed to cmd unquoted runs `calc`. What is checked is the exact text cmd receives.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cmdInvocation, needsCmdShell } from "../electron/windows-command.ts";

test("only batch files need cmd.exe", () => {
	assert.equal(needsCmdShell("C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd"), true);
	assert.equal(needsCmdShell("C:\\tools\\build.BAT"), true);
	assert.equal(needsCmdShell("C:\\Program Files\\Zed\\Zed.exe"), false);
	assert.equal(needsCmdShell("/usr/bin/code"), false);
});

test("cmd.exe gets /d /s /c and one quoted line, and Node is told not to re-quote it", () => {
	const plan = cmdInvocation("C:\\bin\\code.cmd", ["C:\\proj\\main.ts"], { ComSpec: "C:\\Windows\\system32\\cmd.exe" });
	assert.equal(plan.file, "C:\\Windows\\system32\\cmd.exe");
	assert.equal(plan.windowsVerbatimArguments, true);
	assert.deepEqual(plan.args.slice(0, 4), ["/d", "/v:off", "/s", "/c"]);
	// The argument's own quotes are caret-escaped, so cmd's quote tracking never sees them as its own.
	assert.equal(plan.args[4], '"C:\\bin\\code.cmd ^"C:\\proj\\main.ts^""');
});

test("a folder called `a&calc` is an argument, not a second command", () => {
	const line = cmdInvocation("C:\\bin\\code.cmd", ["C:\\proj\\a&calc"], {}).args[4];
	// Quoted, and the ampersand escaped as well: `^&` inside the quotes cmd strips back to `&`.
	assert.ok(line.includes('^"C:\\proj\\a^&calc^"'), line);
	assert.ok(!/[^^]&/.test(line), `an unescaped & reached cmd: ${line}`);
});

test("every character cmd treats specially is escaped", () => {
	const line = cmdInvocation("C:\\bin\\x.cmd", ["100% (a|b) <c> !d! ^e"], {}).args[4];
	for (const special of ["%", "(", ")", "|", "<", ">", "!", "^e"]) {
		const at = line.indexOf(special === "^e" ? "e" : special, line.indexOf("100"));
		assert.equal(line[at - 1], "^", `${special} is not escaped in ${line}`);
	}
});

test("quotes and trailing backslashes survive the trip", () => {
	const line = cmdInvocation("C:\\bin\\x.cmd", ['say "hi"', "C:\\dir\\"], {}).args[4];
	// An embedded quote becomes \" (escaped for cmd as ^"), spaces are escaped like any other
	// separator, and a trailing backslash is doubled so it does not escape the closing quote.
	assert.ok(line.includes('^"say^ \\^"hi\\^"^"'), line);
	assert.ok(line.includes('^"C:\\dir\\\\^"'), line);
});

test("an npm shim goes through cmd twice, so its arguments are escaped twice", () => {
	const once = cmdInvocation("C:\\tools\\x.cmd", ["a&b"], {}).args[4];
	const twice = cmdInvocation("C:\\proj\\node_modules\\.bin\\sql-formatter.cmd", ["a&b"], {}).args[4];
	assert.ok(once.includes("a^&b"));
	assert.ok(twice.includes("a^^^&b"), twice);
});

test("a line break cannot be passed through cmd.exe at all, so it is refused", () => {
	assert.throws(() => cmdInvocation("C:\\bin\\code.cmd", ["a\r\nb"], {}), /line break/);
});

test("ComSpec is found whatever its case, and cmd.exe is the fallback", () => {
	assert.equal(cmdInvocation("x.cmd", [], { COMSPEC: "D:\\cmd.exe" }).file, "D:\\cmd.exe");
	assert.equal(cmdInvocation("x.cmd", [], {}).file, "cmd.exe");
});
