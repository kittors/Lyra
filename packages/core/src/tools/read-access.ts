/**
 * Whether a path may be read — one answer, for every way of reading one.
 *
 * This exists because there used to be two answers. The file tools resolved a path against the
 * workspace and refused anything outside it (`resolveWorkspacePath`), while `bash` asked a
 * different question entirely: the sandbox modes govern *writes* (`sandbox/policy.ts` denies
 * `file-write*` and nothing else), and `isReadOnlyCommand` waves `cat`/`head`/`grep` past the
 * approval path altogether. So `read ../other-project/x` was refused and `cat ../other-project/x`
 * succeeded silently, in every permission mode including the strictest one.
 *
 * That gap was not theoretical. It cost a credential rule its teeth — `SECRET_PATH` correctly
 * judges `cat ~/.ssh/id_ed25519` risky, and nobody was ever asked, because the only caller sits
 * behind the read-only table. And it taught the model to route around the file tools: refusing a
 * read it can obviously perform is an instruction to find another way, which is exactly what
 * `paths.ts` records happening once before with an MCP filesystem server.
 *
 * The shape of the fix is a judgement that does not know which tool is asking:
 *
 *   - `allow` — the workspace, scratch, installed skills, files the user attached, and the system
 *     directories a toolchain reads to function. No prompt, because a prompt that fires on
 *     `ls /usr/bin` is one people learn to click through.
 *   - `ask` — anywhere else. Not a refusal: a refusal is what left the user with no way to say
 *     "yes, read my other project" and left the model with a reason to reach for a shell. The
 *     grant is a directory rather than a file, so approving once opens the project the user meant.
 *
 * Credentials are judged before the workspace rather than after. A key is not damaged by being
 * read, it is spent, and "it happened to be inside the project" is not a reason to hand one over
 * without asking. The grant for one is the file itself — approving a key must never widen to the
 * directory holding the rest of them.
 */

import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { scratchHome } from "../runtime/previews.ts";
import { lyraHome } from "../session/store.ts";
import { home } from "../platform.ts";
import type { ToolContext } from "../types/tool.ts";
import { displayPath } from "./paths.ts";
import { SECRET_PATH } from "./risk-tables.ts";
import { splitCommands, splitWords } from "./shell-split.ts";

export type ReadVerdict =
	| { decision: "allow" }
	| {
			/** Needs a person. `reason` is shown to them; `grant` is what approving covers. */
			decision: "ask";
			reason: string;
			/** `file` narrows the grant to this path alone, for credentials. */
			scope: "file" | "tree";
	  };

export interface ReadAccessOptions {
	/** Files outside the workspace this turn was explicitly given; see `ToolContext.allowedPaths`. */
	allowedPaths?: ReadonlySet<string> | readonly string[];
	/**
	 * The other source folders of the project this session runs in; see `projectRootsFor`.
	 *
	 * "Outside the workspace" is a question about the project, and a project is allowed to be more
	 * than one directory. Someone who put the API repo and the app repo in the same project has
	 * already said those belong together — asking again on the first file read across the pair is
	 * asking them to repeat themselves, which is how a boundary stops being read as a boundary.
	 *
	 * Deliberately not the same lever as `allowedPaths`: that is per-turn and per-file (an
	 * attachment), this is per-project and per-tree, and it is configured in a dialog rather than
	 * implied by a drag.
	 */
	projectRoots?: readonly string[];
	/** Installed skill files the system prompt tells the model to open by absolute path. */
	allowSkillReads?: boolean;
	/** Overridable so a test does not depend on the machine it runs on. */
	lyraHomeDir?: string;
}

/**
 * Directories a working toolchain reads, which are not "somebody's other project".
 *
 * The distinction this list draws is between the machine and the user's work. `ls /usr/bin` and
 * `cat /etc/hosts` are the agent looking at the box it is running on; `cat ~/Developer/thing/x`
 * is it looking at something of yours. Only the second is a question worth putting in front of
 * anyone, and folding them together would produce a prompt on almost every command — which is the
 * failure mode this whole file is trying to avoid, arriving from the other direction.
 *
 * Note what is *not* here: no part of the user's home directory. A toolchain cache under `~` is
 * read by a child process rather than named on a command line, so it never reaches this judgement
 * — and the things under `~` that are named on a command line are precisely the ones worth asking
 * about.
 */
const SYSTEM_ROOTS = [
	"/usr",
	"/bin",
	"/sbin",
	"/opt",
	"/etc",
	"/dev",
	"/proc",
	"/sys",
	"/System",
	"/Library",
	"/Applications",
	"/var/folders",
	"/private/var/folders",
	"/tmp",
	"/private/tmp",
	"C:\\Windows",
	"C:\\Program Files",
	"C:\\Program Files (x86)",
];

function contains(root: string, absolute: string): boolean {
	const rel = relative(resolve(root), absolute);
	return rel === "" || !(rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel));
}

/** The same skill rule `paths.ts` applies, kept in step with it deliberately. */
function isInstalledSkillFile(absolute: string, homeDir: string): boolean {
	if (contains(join(homeDir, "skills"), absolute)) return true;
	const plugins = join(homeDir, "plugins");
	if (!contains(plugins, absolute)) return false;
	return relative(plugins, absolute).split(sep).indexOf("skills") >= 1;
}

/** `~/x` as an absolute path, and anything already absolute resolved against the session's cwd. */
export function toAbsolute(cwd: string, input: string): string {
	const expanded = input.startsWith("~/") || input === "~" ? input.replace("~", home()) : input;
	return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

/**
 * Whether reading this path needs a person, and what approving it should cover.
 *
 * Pure, and it takes an already-absolute path: the caller knows whether `~` meant this user, and
 * a judgement that resolves paths itself is one that cannot be tested without a home directory.
 */
export function assessRead(absolute: string, cwd: string, options: ReadAccessOptions = {}): ReadVerdict {
	const homeDir = options.lyraHomeDir ?? lyraHome();

	/*
	 * What the user handed over is theirs to hand over.
	 *
	 * Before the credential rule, not after: dragging a key into the conversation is an explicit
	 * act by the person the rule exists to protect, and asking them to confirm the thing they just
	 * did is how a safeguard turns into a formality.
	 */
	if (options.allowedPaths) {
		const allowed = options.allowedPaths instanceof Set ? options.allowedPaths : new Set(options.allowedPaths);
		if (allowed.has(absolute)) return { decision: "allow" };
	}

	if (SECRET_PATH.test(absolute)) return { decision: "ask", reason: "读取本机密钥文件", scope: "file" };

	if (contains(cwd, absolute)) return { decision: "allow" };
	// After the credential rule, like the cwd above it: naming a folder in a project says "this is
	// mine to work on", which is not the same as "read the keys I keep in it".
	for (const root of options.projectRoots ?? []) if (contains(root, absolute)) return { decision: "allow" };
	if (contains(scratchHome(homeDir), absolute)) return { decision: "allow" };
	if (options.allowSkillReads && isInstalledSkillFile(absolute, homeDir)) return { decision: "allow" };

	const temp = tmpdir();
	if (contains(temp, absolute)) return { decision: "allow" };
	for (const root of SYSTEM_ROOTS) if (contains(root, absolute)) return { decision: "allow" };

	return { decision: "ask", reason: "读取当前项目之外的位置", scope: "tree" };
}

/**
 * Paths a command line names, for the same judgement to be applied to a shell.
 *
 * Deliberately literal. A word that needs a shell to know what it means — `$DIR/key`, a glob, a
 * substitution — is not resolved here, because guessing produces both false grants and false
 * prompts. What this catches is what a model actually writes, which is the path spelled out.
 *
 * Words that resolve inside the workspace are dropped rather than returned: nearly every word on
 * a command line is not a path at all (`git commit -m fix`, `ssh user@host`), and resolving those
 * against the cwd lands them harmlessly inside it. That is what keeps this from being noisy —
 * only `/absolute`, `~/home` and `../climbing` paths can leave the workspace, and those are the
 * three shapes worth judging.
 */
export function commandReadTargets(command: string, cwd: string): string[] {
	const found = new Set<string>();
	/*
	 * A here-document's body is data the command is fed, not paths it opens — `python3 - <<'EOF'`
	 * and `cat > file <<'EOF'` carry whole programs and file contents. Replaying real sessions, that
	 * is where most of the paths that are not paths came from: a `/` from inside a Go import block,
	 * a `/dist` from a script being written out. `splitCommands` leaves bodies out, the way bash
	 * reads them — except for a `$(…)` in an unquoted one, which bash runs and so is judged here.
	 */
	for (const piece of splitCommands(command)) {
		const words = splitWords(piece);
		for (let i = 0; i < words.length; i++) {
			// The first word is the program, not something it reads.
			if (i === 0) continue;
			const word = words[i];
			/*
			 * A redirection target is written, not read.
			 *
			 * `echo hi > ~/notes.txt` names a path outside the workspace and reads nothing at all,
			 * and judging it here asked "may this be read?" about a file being created. Worse, it
			 * answered before the sandbox got to refuse the write — so the layer that actually
			 * enforces the boundary was no longer the layer being exercised. Writes have their own
			 * rules (`assessWrite`, and the sandbox underneath it); this one is about reads.
			 */
			if (REDIRECT_WRITE.test(word)) continue;
			if (i > 0 && REDIRECT_WRITE.test(words[i - 1])) continue;
			// `< input` is a read, and the operator may be stuck to the path.
			const bare = word.replace(/^<+/, "");
			if (!bare || bare.startsWith("-")) continue;
			// A word the shell would rewrite is a word we cannot judge; see above.
			if (/[$*?`]/.test(bare)) continue;
			/*
			 * A script is not a path, however long it is.
			 *
			 * `python3 -c "<twenty lines>"` is one word to the splitter, and resolving it produced a
			 * "path" made of an entire program. Nothing that contains a newline is a filename worth
			 * judging, and neither is something longer than any real path.
			 */
			if (bare.includes("\n") || bare.length > 400) continue;
			found.add(toAbsolute(cwd, bare));
		}
	}
	return [...found];
}

/** `>`, `>>`, `2>`, `&>` — alone or stuck to the path that follows. */
const REDIRECT_WRITE = /^\d*(>>?|&>)/;

/**
 * The directory an approval should cover, walked up to the project it belongs to.
 *
 * Touches the filesystem, so it is separate from `assessRead` — which stays pure and testable.
 * A repository root is what the user has in mind when they say "read my other project", and
 * granting the containing directory of one file instead would ask them again for the next file.
 *
 * The walk stops at the home directory. A grant covering `~` is not a grant anybody meant to give.
 */
export function readGrantRoot(absolute: string, isDirectory: boolean, exists: (path: string) => boolean): string {
	const start = isDirectory ? absolute : resolve(absolute, "..");
	const ceiling = resolve(home());
	const root = resolve(start, "/");

	/*
	 * The home directory and the filesystem root are never grants.
	 *
	 * Replaying real sessions produced `/Users/<me>` 271 times and `/` 148 times as the directory
	 * an approval would have covered — because a file sitting directly in either has that as its
	 * parent. "Always allow" on one of those is the whole machine, granted by a click meant for
	 * one file. When the walk cannot find a project, the grant narrows to the file instead of
	 * widening to everything above it.
	 */
	if (start === ceiling || start === root) return absolute;

	let current = start;
	for (let depth = 0; depth < 40; depth++) {
		if (current === ceiling || current === resolve(current, "..")) break;
		if (exists(join(current, ".git"))) return current;
		const parent = resolve(current, "..");
		if (parent === ceiling || parent === root) break;
		current = parent;
	}
	return start;
}

export type ReadAuthorization = { ok: true; absolute: string } | { ok: false; message: string };

/**
 * The stable key an "always allow" answer is remembered under.
 *
 * Persisted verbatim into `Settings.alwaysAllow`, so the shape is a compatibility surface: an
 * answer given today has to still mean the same grant after an update. The `read:` prefix keeps it
 * from colliding with the `bash` subjects, which are raw command strings.
 */
function readGrantSubject(grant: string): string {
	return `read:${grant}`;
}

/**
 * Resolve a path a tool was asked to read, asking the user when it leaves the workspace.
 *
 * Every read goes through here — `read`, `ls`, `grep`, `glob`, `lsp` and the paths named on a
 * `bash` command line — which is the entire point: one judgement, applied wherever a read starts,
 * so no tool is the easy way around another.
 *
 * With no approval channel (the CLI, a test, a sub-agent given no way to ask) this refuses rather
 * than allows. A host that cannot put the question to anyone has not been given permission by
 * anyone, and ADR-0004 already settled which direction that fails in.
 */
export async function authorizeRead(
	ctx: ToolContext,
	input: string,
	options: { allowSkillReads?: boolean } = {},
): Promise<ReadAuthorization> {
	if (!input || typeof input !== "string") return { ok: false, message: "A path is required." };
	const absolute = toAbsolute(ctx.cwd, input);
	const verdict = assessRead(absolute, ctx.cwd, {
		allowedPaths: ctx.allowedPaths,
		projectRoots: ctx.projectRoots,
		allowSkillReads: options.allowSkillReads,
	});
	if (verdict.decision === "allow" || !worthAsking(absolute)) return { ok: true, absolute };

	const approved = await askForRead(ctx, absolute, verdict);
	return approved.ok ? { ok: true, absolute } : approved;
}

/**
 * Whether there is anything there to disclose.
 *
 * A path that does not exist cannot be read, so asking about one buys no safety and costs a
 * prompt. It costs a lot of them: replaying real sessions, most of what a command line looks like
 * a path is not one — `/api/auth` from a URL, a word from a commit message — and every one of
 * those was a question about a file that was never going to be opened. The tool's own "not found"
 * is the honest answer to those.
 *
 * The race this ignores (absent when judged, present when opened) needs someone to win a
 * millisecond-wide window on the user's own machine, which is not the threat this boundary is for.
 */
function worthAsking(absolute: string): boolean {
	return existsSync(absolute);
}

/**
 * The same judgement, applied to the paths a shell command names.
 *
 * This runs *before* `isReadOnlyCommand`, and that ordering is the entire repair. That table is
 * documented in `bash.ts` as the one path around the whole risk classifier: a command on it never
 * reaches `requestApproval`, in any permission mode. `cat` is on it. So the credential rule that
 * `SECRET_PATH` encodes — the one the 2026-09-12 audit raised as H2 and the fix log marked done —
 * was being asked about commands that could never arrive, while `cat ~/.ssh/id_ed25519` went
 * straight through. Judging reads ahead of the table is what puts it back in the path.
 *
 * Returns the refusal to report, or `null` when every path named is allowed or approved.
 */
export async function authorizeCommandReads(command: string, ctx: ToolContext): Promise<string | null> {
	/*
	 * One question per grant, not per path.
	 *
	 * `grep -r x ../other/a ../other/b` names two files in one project, and asking twice about the
	 * same project is how people learn to stop reading the question.
	 */
	const asked = new Map<string, { absolute: string; verdict: Extract<ReadVerdict, { decision: "ask" }> }>();
	for (const absolute of commandReadTargets(command, ctx.cwd)) {
		/*
		 * `allowSkillReads` here too, because it is a fact about the file rather than about the
		 * tool. The system prompt hands the model absolute paths into installed skills; opening one
		 * with `cat` instead of `read` does not make it a different file.
		 */
		const verdict = assessRead(absolute, ctx.cwd, {
			allowedPaths: ctx.allowedPaths,
			projectRoots: ctx.projectRoots,
			allowSkillReads: true,
		});
		if (verdict.decision === "allow" || !worthAsking(absolute)) continue;
		const grant = grantFor(absolute, verdict);
		if (!asked.has(grant)) asked.set(grant, { absolute, verdict });
	}

	for (const { absolute, verdict } of asked.values()) {
		const approved = await askForRead(ctx, absolute, verdict);
		if (!approved.ok) return approved.message;
	}
	return null;
}

/**
 * A credential is granted as itself; anything else as the project it belongs to.
 *
 * The asymmetry is the point. "Read my other project" means all of it, and asking per file would
 * be answered by turning the prompt off. "Read this key" means this key, and widening it to
 * `~/.ssh` would hand over the rest of them on one click.
 */
function grantFor(absolute: string, verdict: Extract<ReadVerdict, { decision: "ask" }>): string {
	if (verdict.scope === "file") return absolute;
	return readGrantRoot(absolute, directoryLike(absolute), (path) => existsSync(path));
}

async function askForRead(
	ctx: ToolContext,
	absolute: string,
	verdict: Extract<ReadVerdict, { decision: "ask" }>,
): Promise<{ ok: true } | { ok: false; message: string }> {
	const shown = displayPath(ctx.cwd, absolute);
	if (!ctx.requestApproval) {
		return { ok: false, message: `${verdict.reason}需要用户批准，而这个会话没有可以询问的人：${shown}` };
	}

	const grant = grantFor(absolute, verdict);
	/*
	 * 三样东西，三个字段，各自去它该去的地方——这是在真窗口里定下来的，不是想出来的。
	 *
	 * `title` 只给文件名：整条绝对路径当标题会折成两行。`detail` 只给那条路径，它在卡片上是
	 * 等宽字体，路径正合适。`reason` 给「批准意味着什么」，它渲染成正常字体的独立段落——把这
	 * 句话塞进 `detail` 的结果是一行等宽中文，难看，而且和路径挤成一团分不出层次。
	 *
	 * 第一版还犯过另一个错：`reason` 填的是判定理由，与 `title` 前半句一字不差。
	 * `approvalReason()` 只比对 reason 和 detail，比不出这种重复，于是同一句话在卡片上出现
	 * 两次。这个字段是用来补充标题说不完的事的，复述标题不是它的活。
	 */
	const decision = await ctx.requestApproval({
		kind: "read",
		title: `${verdict.reason}：${basename(absolute) || shown}`,
		detail: absolute,
		reason: verdict.scope === "file"
			? "密钥按文件单独批准；同一目录下的其他密钥仍会再问一次。"
			: `批准后，这个会话读取 ${grant} 里的文件不再询问。`,
		subject: readGrantSubject(grant),
	});
	if (decision === "once" || decision === "always") return { ok: true };
	return { ok: false, message: `用户拒绝了这次读取：${shown}` };
}

/** Whether to treat the path as a directory for grant purposes; a missing path is not one. */
function directoryLike(absolute: string): boolean {
	try {
		return statSync(absolute).isDirectory();
	} catch {
		return false;
	}
}
