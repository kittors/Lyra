import { isAbsolute } from "node:path";
import { withinOrIs } from "../platform.ts";
import { SAFE, risky, scratchRoots, underScratchRoot, wipesScratchRoot, type RiskVerdict } from "./risk-shared.ts";
import {
	COMMAND_PREFIXES,
	INTERPRETERS,
	NEVER_UNATTENDED,
	PLACES_FILES,
	PROTECTED_PATH,
	RISKY_SUBCOMMANDS,
	SECRET_PATH,
	SHELLS,
} from "./risk-tables.ts";
import { pipelines, splitCommands, splitWords } from "./shell-split.ts";
/**
 * How dangerous an operation is, so that "帮我批准" can mean what it says.
 *
 * The first version of this was an allow-list: a command was waved through only if its first
 * word was one of about thirty read-only programs, and *any* shell metacharacter disqualified
 * it outright. The reasoning was sound in isolation — `ls && rm -rf /` really does start with
 * `ls` — but the effect was that a mode advertised as "only ask about risky things" asked about
 * nearly everything, because models write `cd x && git log; echo ---` rather than bare `ls`.
 * A permission prompt that fires constantly is not a safety feature; it is something people
 * learn to click through, which is strictly worse than not having it.
 *
 * So this inverts: everything is allowed unless it matches something genuinely destructive.
 * The list below is not "things that write" — writing is the job — but "things you cannot take
 * back": deleting, force-pushing, rewriting history, escalating privileges, piping the network
 * into a shell, touching anything outside the project.
 */




function firstWord(command: string): string {
	// Leading `VAR=value` assignments are not the program being run.
	const program = command.split(/\s+/).find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
	return (program ?? "").replace(/^.*\//, "");
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * What a wrapper wraps, or null if this command is not one.
 *
 * `firstWord` answers "what program is this", and for `env`, `xargs`, `nohup`, `timeout` and the
 * shells themselves the answer is not the program that does anything. So every rule below was
 * looking at the wrapper: `env rm -rf ~` was judged as `env` and `bash -c "rm -rf ~"` as `bash`,
 * and neither is on any list, so both were safe. That is not a gap in the tables — the tables are
 * about `rm` — it is a gap in deciding what to look up.
 */
function wrappedCommand(command: string): string | null {
	const words = splitWords(command);
	if (words.length < 2) return null;
	const head = words[0].replace(/^.*\//, "");

	// A shell takes its command as one string, after `-c`. `-lc`, `-ec` and friends count.
	if (SHELLS.has(head)) {
		const at = words.findIndex((word, index) => index > 0 && /^-[A-Za-z]*c$/.test(word));
		return at === -1 || at + 1 >= words.length ? null : words[at + 1];
	}
	// `eval` takes it as the rest of the line, however many words that is.
	if (head === "eval") return words.slice(1).join(" ");

	if (!COMMAND_PREFIXES.has(head)) return null;

	let i = 1;
	// The wrapper's own options and any `VAR=value` it is setting.
	while (i < words.length && (words[i].startsWith("-") || ASSIGNMENT.test(words[i]))) {
		// `nice -n 10 cmd`, `timeout -k 5 …`, `xargs -n 1 cmd`: the option takes an argument.
		if (/^-[nPILsEek]$/.test(words[i]) && i + 1 < words.length) i += 1;
		i += 1;
	}
	// `timeout 30s cmd` and `watch 2 cmd`: a bare duration belongs to the wrapper.
	if ((head === "timeout" || head === "watch") && i < words.length && /^\d+(\.\d+)?[smhd]?$/.test(words[i])) i += 1;
	if (i >= words.length) return null;

	const inner = words.slice(i).join(" ");
	// A wrapper that wrapped nothing but itself would recurse forever.
	return inner === command.trim() ? null : inner;
}

/**
 * Git's subcommand, after its global options.
 *
 * Taken as `words[1]` before, which is the option rather than the subcommand the moment anything
 * global is present — and `git -c protocol.ext.allow=always push --force` is a force push whose
 * "subcommand" read as `-c`. Every git rule below then declined to apply.
 */
function gitSubcommand(words: string[]): string {
	const TAKES_VALUE = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);
	let i = 1;
	while (i < words.length) {
		const word = words[i];
		if (TAKES_VALUE.has(word)) {
			i += 2;
			continue;
		}
		if (word.startsWith("-")) {
			i += 1;
			continue;
		}
		return word;
	}
	return "";
}

/**
 * Judge one command — no chaining, no substitution; `assessCommand` splits those first.
 */
/**
 * A wildcard with nothing in front of it.
 *
 * `rm -rf *` is the working directory and everything in it — the command people mean when they
 * warn you about `rm -rf`. `rm -rf server/data/uploads/*` is a named directory being emptied,
 * which is what re-seeding a database or clearing an upload folder looks like, and is no more
 * dangerous than deleting that directory. Treating the two as the same thing meant ordinary
 * housekeeping stopped an unattended run.
 *
 * The test is whether anything survives removing the wildcard segments: `*` and `./*` leave
 * nothing; `a/b/*` leaves `a/b`.
 */
function bareGlob(target: string): boolean {
	if (!/[*?]/.test(target)) return false;
	const prefix = target
		.split("/")
		.filter((segment) => !/[*?]/.test(segment))
		.filter((segment) => segment !== "" && segment !== ".");
	return prefix.length === 0 || prefix.includes("..");
}




function judgeSingle(command: string, contained = false, cwd?: string): RiskVerdict {
	const head = firstWord(command);
	if (!head) return SAFE;

	const never = NEVER_UNATTENDED.get(head);
	if (never) return risky(never);

	// `rm` is the one worth reading closely: removing a file is routine, removing a tree is not.
	if (head === "rm") {
		/*
		 * A recursive delete is judged by its target, at the user's direction.
		 *
		 * Clearing `src/data` to reseed a database, or `dist` to rebuild, is a step inside work
		 * that was asked for, and stopping at each one is what stops an unattended run being
		 * unattended. The user chose this trade explicitly: relative paths inside the workspace
		 * proceed; the workspace itself (`.`), a bare wildcard, a home or absolute path, anything
		 * climbing out with `..`, and any chain that has `cd`-ed elsewhere first still ask.
		 */
		// Long options too: `--recursive` is `-r`, and it was not recognised as one. The short form
		// is deliberately unanchored at its end — `-rf` is one word carrying both flags.
		if (/(^|\s)(-[a-zA-Z]*[rR]|--recursive(\s|$))/.test(command)) {
			const targets = command.split(/\s+/).slice(1).filter((word) => !word.startsWith("-"));
			const reckless = targets.some(
				(t) =>
					!t ||
					t.startsWith("~") ||
					t === "." ||
					t === ".." ||
					bareGlob(t) ||
					wipesScratchRoot(t, cwd) ||
					(isAbsolute(t) && !underScratchRoot(t, cwd)),
			);
			const climbs = targets.some((t) => t.split("/").includes(".."));
			if (targets.length === 0 || reckless || climbs || !contained) return risky("递归删除目录");
		}
		/*
		 * A glob delete is judged by where it points, not by the glob.
		 *
		 * Rebuilding a database or clearing a build directory is ordinary work — and it is what
		 * `rm -f data/blog.db*` is. What cannot be taken back is the same command aimed outside
		 * the project, so that is what this asks about: an absolute or home-relative target, or
		 * a chain that has stepped out of the workspace first.
		 */
		if (/(^|\s)(-[a-zA-Z]*f|--force(\s|$))/.test(command) && /[*?]/.test(command)) {
			const targets = command.split(/\s+/).slice(1).filter((word) => !word.startsWith("-"));
			const outside = targets.some(
				(t) => t.startsWith("~") || wipesScratchRoot(t, cwd) || (isAbsolute(t) && !underScratchRoot(t, cwd)),
			);
			if (outside || !contained) return risky("强制删除通配匹配的文件");
		}
		if (/(^|\s)\/(\s|$)|\s~\/?(\s|$)/.test(command)) return risky("删除根目录或主目录");
	}

	if (head === "git") {
		const sub = gitSubcommand(splitWords(command));
		// A force push replaces what other people have; a plain push does not.
		// `--force-with-lease` is the careful form, but it still replaces the remote branch.
		if (sub === "push" && /(--force|(^|\s)-f(\s|$))/.test(command)) return risky("强制推送会覆盖远程历史");
		if (sub === "reset" && /--hard/.test(command)) return risky("丢弃所有未提交的改动");
		const table = RISKY_SUBCOMMANDS.get("git");
		const reason = table?.get(sub);
		// `git checkout -b` and `git restore --staged` take nothing away.
		if (sub === "checkout" && /\s-b(\s|$)/.test(command)) return SAFE;
		if (sub === "restore" && /--staged/.test(command) && !/--worktree/.test(command)) return SAFE;
		if (sub === "reset" || sub === "clean") return reason ? risky(reason) : SAFE;
		if (reason && (sub === "rebase" || sub === "filter-branch")) return risky(reason);
		return SAFE;
	}

	const table = RISKY_SUBCOMMANDS.get(head);
	if (table) {
		const reason = table.get(command.split(/\s+/)[1] ?? "");
		if (reason) return risky(reason);
	}

	/*
	 * A credential named anywhere in the command, read or written.
	 *
	 * Checked before the write rules rather than folded into them, because for a key the read is
	 * the loss: `cat ~/.lyra/vault.key` does no damage and hands over every stored credential,
	 * and `curl -d @~/.ssh/id_ed25519` is the same sentence with somewhere to send it. Both were
	 * safe, because the only path rule in here fired on a redirect.
	 */
	if (SECRET_PATH.test(command)) return risky("读写本机密钥文件");

	// A redirect into a system location, or an edit of the shell's own startup files.
	if (/>\s*[^&\s]/.test(command) && PROTECTED_PATH.test(command)) return risky("写入项目之外的系统路径");
	if (/>\s*~?\/?\.(zshrc|bashrc|profile|zprofile)\b/.test(command)) return risky("修改 shell 启动文件");
	// And the same destination reached without one: `cp payload /usr/local/bin/git`.
	if (PLACES_FILES.has(head) && PROTECTED_PATH.test(command)) return risky("写入项目之外的系统路径");

	/*
	 * A local file going out over the network.
	 *
	 * Uploading is not a step in writing code, and it is the one effect on this list that cannot
	 * be undone by any means at all — a file that has left the machine has left it. `@` is curl's
	 * "read this from a file" marker, which is what separates sending a file from sending a
	 * string the model composed.
	 */
	if (head === "curl" || head === "wget") {
		/*
		 * The `@` has to sit where a filename would: at the start of the value, or just after the
		 * field name in curl's `-F name=@file`. Anywhere else it is ordinary text, and
		 * `-d 'email=a@b.test'` is a string being posted, not a file being uploaded.
		 */
		const uploads = /(^|\s)(-d|--data(-binary|-raw)?|-F|--form)(\s+|=)['"]?([A-Za-z0-9_.-]+=)?@/;
		const puts = /(^|\s)(-T|--upload-file)(\s|=)/;
		if (uploads.test(command) || puts.test(command)) return risky("把本机文件上传到网络");
	}

	return SAFE;
}

/**
 * Judge a whole command line, including everything it chains or substitutes.
 *
 * A pipeline is risky if any stage is: `cat x | sudo tee /etc/hosts` is not made safe by
 * starting with `cat`.
 */
export function assessCommand(command: string, cwd?: string, depth = 0): RiskVerdict {
	/*
	 * Downloading something and handing it to an interpreter.
	 *
	 * The classic way to run code nobody has read, and invisible once the line is flattened,
	 * because `curl url` and `python3` are each unremarkable on their own. The danger is in the
	 * join — so this asks the pipeline view rather than a regular expression over the whole line.
	 *
	 * That regular expression matched a shell directly after the pipe and nothing else, so it
	 * covered `curl u | sh` and missed both `curl u | python3` (any other interpreter) and
	 * `curl u | tail -n +2 | sh` (anything in between). Both are the same sentence.
	 */
	for (const stages of pipelines(command)) {
		const heads = stages.map((stage) => firstWord(stage));
		const fetched = heads.findIndex((head) => head === "curl" || head === "wget" || head === "fetch");
		if (fetched === -1) continue;
		const ran = heads.findIndex((head, index) => index > fetched && INTERPRETERS.has(head));
		if (ran !== -1) return risky("下载并直接执行脚本");
	}

	/*
	 * Whether the command stays inside the project.
	 *
	 * `cd` is what makes a relative path ambiguous: `rm -f build/*` is housekeeping, and
	 * `cd /etc && rm -f *` is the same three characters somewhere it must never happen. If every
	 * `cd` in the chain lands inside the workspace, a relative path is a path within it.
	 */
	const contained = cwd ? staysInside(command, cwd) : false;

	for (const piece of splitCommands(command)) {
		const verdict = judgeSingle(piece, contained, cwd);
		if (verdict.risky) return verdict;

		/*
		 * And whatever this piece wraps.
		 *
		 * Bounded because the nesting can be: `bash -c "bash -c '…'"` is legal and a model that
		 * produced it by accident should get an answer rather than a stack overflow. Four is past
		 * anything written on purpose; the depth is what stops it, not the shape.
		 */
		if (depth >= 4) continue;
		const inner = wrappedCommand(piece);
		if (!inner) continue;
		const nested = assessCommand(inner, cwd, depth + 1);
		if (nested.risky) return nested;
	}
	return SAFE;
}


/**
 * Whether every directory the command changes into is within the workspace.
 *
 * Conservative by construction: a `cd` whose destination cannot be read literally — a variable,
 * a substitution, `-` — counts as leaving, because what it resolves to is not knowable here.
 */
function staysInside(command: string, cwd: string): boolean {
	const root = cwd.replace(/\/+$/, "");
	for (const piece of splitCommands(command)) {
		const match = /^\s*cd\s+(\S+)/.exec(piece);
		if (!match) continue;
		const target = match[1].replace(/^['"]|['"]$/g, "");
		if (target.startsWith("~") || target === "-" || /[$`]/.test(target)) return false;
		/*
		 * `isAbsolute`, so this recognises `C:\…` as well as `/…`.
		 *
		 * With `startsWith("/")` every Windows path fell straight past every one of these checks —
		 * so `rm -rf C:\Users\…\Temp` was not merely misjudged, it was never judged at all. A
		 * classifier that answers "safe" because it did not recognise the shape of the path is the
		 * worst failure mode available to it.
		 */
		if (isAbsolute(target)) {
			if (withinOrIs(root, target)) continue;
			/*
			 * A scratch directory is somewhere work legitimately happens, not somewhere it escaped
			 * to — and here the root itself counts. `cd /tmp` is working there; `rm -rf /tmp` is
			 * something else entirely, and that is judged separately.
			 */
			if (underScratchRoot(target, cwd) || scratchRoots(cwd).includes(target.replace(/\/+$/, ""))) continue;
			return false;
		}
		// A relative `cd` can still climb out with `..`.
		if (target.split("/").includes("..")) return false;
	}
	return true;
}

export { splitCommands } from "./shell-split.ts";

export { assessWrite } from "./risk-paths.ts";
export { assessNetwork } from "./risk-network.ts";
