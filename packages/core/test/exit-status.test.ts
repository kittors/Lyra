/**
 * Which non-zero statuses are answers, and which are failures.
 *
 * The session that prompted this was polling CI: `sleep 30; gh pr checks …` five times in a row,
 * every one of them a red cross because `gh pr checks` exits 8 while checks are pending. The cases
 * below are that session's commands and the other idioms whose status is an answer — and, as much
 * as those, the ones that must stay failures however similar they look.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeStatus, readExit } from "../src/tools/exit-status.ts";

const PENDING = [
	"build\tpending\t0\thttps://github.com/acme/app/actions/runs/1/job/2\t",
	"vulncheck\tpass\t41s\thttps://github.com/acme/app/actions/runs/1/job/3\t",
].join("\n");
const FAILED = "build\tfail\t1m21s\thttps://github.com/acme/app/actions/runs/1/job/2\t";

const answer = (command: string, code: number, output = "", meaning?: RegExp) => {
	const reading = readExit(command, code, output);
	assert.equal(reading.failed, false, `应视为回答: ${command} → ${code}`);
	if (meaning) assert.match(reading.meaning ?? "", meaning);
};
const failure = (command: string, code: number | null, output = "") =>
	assert.equal(readExit(command, code, output).failed, true, `应视为失败: ${command} → ${code}`);

test("polling CI is not a string of failures", () => {
	answer("gh pr checks 1072 -R acme/app", 8, PENDING, /pending/);
	answer('sleep 30\necho "=== PR 1072 ==="\ngh pr checks 1072 -R acme/app\necho "=== PR 1073 ==="\ngh pr checks 1073 -R acme/app', 8, PENDING);
	answer("gh pr checks 1073 -R acme/app", 1, FAILED, /failed/);
	// Without the table, the status is about something else: no such PR, not logged in.
	failure("gh pr checks 9999 -R acme/app", 1, "no pull requests found for branch");
	failure("gh pr checks 1072 -R acme/app", 8, "");
	// And a watcher that reports a failed run is reporting a failure.
	failure("gh run watch 123 --exit-status", 1, "X build failed");
});

test("a search that finds nothing has answered", () => {
	answer("grep -rn TODO src", 1, "", /no matches/);
	answer("git config -l --show-origin | grep mailmap", 1);
	answer('git diff main -- a.tsx | grep -E "^\\+[ ]*<Row"', 1);
	answer("rg --files -g '*.snap'", 1);
	answer("FOO=1 timeout 5 grep -q needle haystack.txt", 1);
	// Two means the search itself broke.
	failure("grep -rn TODO missing-dir", 2, "grep: missing-dir: No such file or directory");
});

test("a question answered no is not an error", () => {
	answer("[ -f dist/index.js ] && echo built", 1, "", /false/);
	answer("test -d node_modules", 1);
	answer("[[ -n $CI ]]", 1);
	answer("which git-filter-repo", 1, "", /not found/);
	answer("command -v pnpm", 1, "", /not found/);
	answer("diff -u a.txt b.txt", 1, "--- a.txt\n+++ b.txt", /differ/);
	answer("git diff --quiet", 1, "", /differences/);
	answer("git merge-base --is-ancestor main HEAD", 1);
	answer("git -C ../other rev-parse --verify --quiet refs/heads/x", 1);
	answer("lsof -i :3000", 1, "");
	answer("pgrep -f vite", 1);
	answer("kill -0 4242", 1);
	answer("pnpm outdated", 1, "Package  Current  Latest\nreact    18.0.0   19.0.0");
	answer("find / -name id_rsa.pub 2>/dev/null", 1, "/Users/me/.ssh/id_rsa.pub");
	failure("find /nope -name x", 1, "find: /nope: No such file or directory");
});

test("the status of `a && b` can be a's, and then it counts", () => {
	// A `cd` that failed says so, and is then the failure.
	failure("cd packages/nope && grep -rn x .", 1, "cd: no such file or directory: packages/nope");
	answer("cd packages/core && grep -rn needle .", 1, "");
	// A build that failed before the grep ran is not "no matches".
	failure("pnpm build && grep -q ok dist/log.txt", 1, "ERR_PNPM build failed");
	// After `||` only the right-hand side can be the status.
	failure("grep -q needle file || false", 1);
	// Only the last command of a pipeline decides, unless pipefail is on.
	failure("pnpm test 2>&1 | tail -20", 1);
	failure("set -o pipefail; cat log.txt | grep needle", 1);
});

test("what cannot be followed stays a failure", () => {
	failure("for pr in 1 2; do gh pr diff $pr --stat; done", 1);
	failure("if grep -q x f; then echo yes; fi", 1);
	failure("(cd sub && grep -q x f)", 1);
	failure("set -e; grep -q x f; echo done", 1);
	failure("! grep -q x f", 1);
	failure("npm test", 1, "1 failing");
	failure("git push origin main", 1, "error: failed to push some refs");
	failure("node verify.cjs", null);
	// PowerShell is not read at all: its grammar and its exit codes are its own.
	assert.equal(readExit("Select-String x f", 1, "", "powershell").failed, true);
});

test("the shell's own codes are said in words", () => {
	assert.equal(describeStatus(1), "exit code 1");
	assert.match(describeStatus(127), /command not found/);
	assert.match(describeStatus(126), /not executable/);
	assert.match(describeStatus(137), /SIGKILL/);
	assert.match(describeStatus(null, "SIGTERM"), /terminated by SIGTERM/);
	assert.match(describeStatus(null), /terminated without an exit code/);
});
