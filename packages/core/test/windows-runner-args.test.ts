/**
 * The runner's argv contract.
 *
 * This is a trust boundary in a quiet way: the backend builds this command line, but a runner that
 * accepted a malformed one would confine differently than intended and say nothing about it. So
 * every field is required to be exactly what it claims, and anything else is refused before a
 * token is built — which, given the failure contract, means the command never runs at all.
 *
 * Runnable anywhere. Parsing is parsing; the Win32 calls behind it are not exercised here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, RUNNER_FAILURE_EXIT, RUNNER_FAILURE_PREFIX } from "../src/sandbox/windows/runner.ts";

const base = ["--workspace", "C:\\work\\app", "--mode", "read-only", "--", "cmd.exe", "/c", "echo hi"];

test("the contract parses into its parts", () => {
	const args = parseArgs(base);
	assert.equal(args.workspace, "C:\\work\\app");
	assert.equal(args.mode, "read-only");
	assert.deepEqual(args.command, ["cmd.exe", "/c", "echo hi"]);
});

test("workspace-write carries its capability SID", () => {
	const args = parseArgs([
		"--workspace", "C:\\work\\app",
		"--mode", "workspace-write",
		"--write-sid", "S-1-4-123-456",
		"--", "node", "-e", "1",
	]);
	assert.equal(args.writeSid, "S-1-4-123-456");
	assert.deepEqual(args.command, ["node", "-e", "1"]);
});

test("a temp capability's three-part SID is accepted too", () => {
	const args = parseArgs(["--workspace", "C:\\w", "--mode", "workspace-write", "--write-sid", "S-1-4-1-2-1", "--", "x"]);
	assert.equal(args.writeSid, "S-1-4-1-2-1");
});

test("read-only takes a private temp too, and still no workspace grant", () => {
	// Without a writable temp, PowerShell — the shell a confined command runs in here — runs constrained.
	const args = parseArgs(["--workspace", "C:\\w", "--mode", "read-only", "--temp", "C:\\t", "--temp-sid", "S-1-4-1-2-1", "--", "x"]);
	assert.equal(args.temp, "C:\\t");
	assert.equal(args.writeSid, undefined);
});

// ---------------------------------------------------------------------------
// What must be refused, each for its own reason
// ---------------------------------------------------------------------------

test("workspace-write without a capability is refused", () => {
	// A token restricted to nothing writable fails every write, and the failure would look like a
	// sandbox bug rather than a command line that was built wrong.
	assert.throws(
		() => parseArgs(["--workspace", "C:\\w", "--mode", "workspace-write", "--", "x"]),
		/必须带 --write-sid/,
	);
});

test("a capability SID that is not one is refused", () => {
	// This value names an identity. Anything that is not the derived shape either does not exist —
	// in which case the grant is inert and the confinement silently tighter than intended — or
	// names somebody else's.
	for (const bad of [
		"S-1-5-32-544", // a real, powerful group
		"S-1-4-abc-def",
		"S-1-4-1",
		"not-a-sid",
		"S-1-4-1-2-3-4",
		"",
	]) {
		assert.throws(
			() => parseArgs(["--workspace", "C:\\w", "--mode", "workspace-write", "--write-sid", bad, "--", "x"]),
			/格式不对|必须带/,
			bad,
		);
	}
});

test("an unknown mode is refused rather than defaulted", () => {
	// Defaulting would pick a confinement nobody asked for; guessing wrong in the loose direction
	// is the whole class of bug this design is trying not to have.
	assert.throws(() => parseArgs(["--workspace", "C:\\w", "--mode", "danger-full-access", "--", "x"]), /--mode 只能是/);
	assert.throws(() => parseArgs(["--workspace", "C:\\w", "--mode", "", "--", "x"]), /--mode 只能是/);
});

test("a missing workspace is refused", () => {
	assert.throws(() => parseArgs(["--mode", "read-only", "--", "x"]), /缺少 --workspace/);
});

test("no separator means no command", () => {
	assert.throws(() => parseArgs(["--workspace", "C:\\w", "--mode", "read-only"]), /缺少 `--`/);
});

test("a separator with nothing after it is refused", () => {
	assert.throws(() => parseArgs(["--workspace", "C:\\w", "--mode", "read-only", "--"]), /没有命令/);
});

test("a flag with no value is refused rather than read as the next flag", () => {
	// Refused where the mistake is, not downstream: reading `--mode` as the workspace path happens
	// to fail later given this ordering, but that is luck rather than a rule.
	assert.throws(() => parseArgs(["--workspace", "--mode", "read-only", "--", "x"]), /缺少值/);
	assert.throws(() => parseArgs(["--workspace", "C:\\w", "--mode", "--write-sid", "--", "x"]), /缺少值/);
});

test("something that is not a flag where a flag belongs is refused", () => {
	assert.throws(() => parseArgs(["workspace", "C:\\w", "--", "x"]), /认不出的参数/);
});

test("everything after the separator is the command, flags included", () => {
	// The command's own arguments must never be parsed as ours.
	const args = parseArgs(["--workspace", "C:\\w", "--mode", "read-only", "--", "node", "--mode", "weird", "--"]);
	assert.deepEqual(args.command, ["node", "--mode", "weird", "--"]);
	assert.equal(args.mode, "read-only");
});

test("the failure contract is a distinguishable prefix and a code a command will not use", () => {
	// The backend matches on these to tell "could not confine" from "the command failed", and
	// treating the first as the second would mean running unconfined and calling it a bad command.
	assert.equal(RUNNER_FAILURE_PREFIX, "windows-acl-run:");
	assert.equal(RUNNER_FAILURE_EXIT, 127);
});
