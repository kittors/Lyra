/**
 * What counts as dangerous, as data.
 *
 * Kept apart from the judging so that the lists can be read — and argued with — without reading the
 * logic around them. That matters more here than almost anywhere else in the app: these tables are
 * the difference between a prompt that fires when it should and one people learn to click through.
 *
 * Every entry is something you cannot take back. Writing files is not on the list; writing is the
 * job.
 *
 * Entries name the rule by its code; what each one says, in any language, is not decided here —
 * see `risk-reasons.ts`.
 */

import type { RiskCode } from "./risk-reasons.ts";

/** Programs that are dangerous whatever their arguments. */
export const NEVER_UNATTENDED = new Map<string, RiskCode>([
	["sudo", "run-as-admin"],
	["doas", "run-as-admin"],
	["su", "switch-user"],
	["shutdown", "shutdown"],
	["reboot", "shutdown"],
	["halt", "shutdown"],
	["mkfs", "format-disk"],
	["fdisk", "partition-disk"],
	["diskutil", "modify-disk"],
	["dd", "raw-disk-write"],
	["shred", "shred"],
	["chown", "change-owner"],
	["launchctl", "system-service"],
	["systemctl", "system-service"],
	["crontab", "crontab"],
	["killall", "kill-all"],
	/*
	 * Windows' spellings of the same things, lower-cased: PowerShell and cmd do not care about
	 * case, so the lookup does not either. They matter where the agent's shell is PowerShell — a
	 * Windows without Git — and they were absent, so `Format-Volume` was as safe as `ls`.
	 */
	["format", "format-disk"],
	["format-volume", "format-disk"],
	["diskpart", "partition-disk"],
	["clear-disk", "clear-disk"],
	["initialize-disk", "partition-disk"],
	["remove-partition", "partition-disk"],
	["stop-computer", "shutdown"],
	["restart-computer", "shutdown"],
	["set-executionpolicy", "execution-policy"],
	["takeown", "change-owner"],
	["bcdedit", "boot-config"],
	["vssadmin", "shadow-copies"],
	["wevtutil", "event-log"],
	["cipher", "wipe-data"],
]);

/** Subcommands that discard work or rewrite shared history. */
export const RISKY_SUBCOMMANDS = new Map<string, Map<string, RiskCode>>([
	[
		"git",
		new Map<string, RiskCode>([
			["reset", "discard-changes"],
			["clean", "delete-untracked"],
			["rebase", "rewrite-history"],
			["filter-branch", "rewrite-history"],
			["checkout", "overwrite-changes"],
			["restore", "discard-changes"],
		]),
	],
	["npm", new Map<string, RiskCode>([["publish", "publish-package"]])],
	["pnpm", new Map<string, RiskCode>([["publish", "publish-package"]])],
	["yarn", new Map<string, RiskCode>([["publish", "publish-package"]])],
	["docker", new Map<string, RiskCode>([["system", "docker-prune"]])],
	["kubectl", new Map<string, RiskCode>([["delete", "delete-cluster-resource"]])],
	// Windows: registry, scheduled tasks, services and the firewall, by their first argument.
	["reg", new Map<string, RiskCode>([["delete", "registry-edit"], ["add", "registry-edit"], ["import", "registry-edit"], ["restore", "registry-edit"]])],
	["schtasks", new Map<string, RiskCode>([["/create", "scheduled-task"], ["/delete", "scheduled-task"], ["/change", "scheduled-task"]])],
	["sc", new Map<string, RiskCode>([["delete", "system-service"], ["create", "system-service"], ["config", "system-service"]])],
	["netsh", new Map<string, RiskCode>([["advfirewall", "firewall"], ["firewall", "firewall"]])],
]);

/** Paths that are never the project, so writing to them is out of scope by definition. */
export const PROTECTED_PATH =
	/(^|\s|['"])(\/(bin|sbin|usr|etc|var|System|Library|Applications)\b|~\/\.(ssh|aws|gnupg|config\/gh)\b|[A-Za-z]:[\\/](Windows|Program Files|ProgramData)\b|\/[a-z]\/(Windows|Program Files|ProgramData)\b)/i;

/**
 * Programs that put a file somewhere, as opposed to a shell redirect.
 *
 * `PROTECTED_PATH` used to be consulted only when the line contained a `>`, so it answered about
 * `echo x > /etc/hosts` and said nothing about `cp payload /etc/hosts`, `mv x /usr/local/bin/`,
 * `tee /etc/hosts` or `ln -sf x /usr/bin/git` — the same effect, reached without a redirect.
 */
export const PLACES_FILES = new Set([
	"cp",
	"mv",
	"tee",
	"install",
	"ln",
	"rsync",
	"truncate",
	"chmod",
	"chflags",
	"xattr",
	"touch",
	"unzip",
	"tar",
	// PowerShell and cmd, lower-cased as the lookup is.
	"copy",
	"xcopy",
	"robocopy",
	"move",
	"copy-item",
	"move-item",
	"new-item",
	"set-content",
	"add-content",
	"out-file",
	"rename-item",
]);

/**
 * Files that are the keys to something, wherever they are read from.
 *
 * The write side of this was covered — `PROTECTED_PATH` includes `~/.ssh` — and the read side was
 * not, which is the half that matters for a credential: a key is not damaged by being read, it is
 * spent. `cat ~/.lyra/vault.key` is the whole vault, and it was not a question anyone was asked.
 *
 * The vault's own two files are named explicitly rather than covered by a `~/.lyra` rule: that
 * directory also holds settings and session logs, and a rule broad enough to include them would
 * stop an agent reading its own configuration.
 *
 * Bounded on both sides by anything that ends a word in a command line, not only by a separator or
 * the end of the string. This is matched against single paths *and* against whole commands, and
 * the Windows fix that bounded it by `[/\\]|$` alone made every command with anything after the
 * path safe: `scp ~/.ssh/id_ed25519 host:`, `cp ~/.lyra/vault.key backup.key`. The same change
 * required a separator in front, which lost `cat .ssh/id_rsa` run from the home directory. What the
 * bound is for is still true — `id_rsa.pub` is a public key, and `.` does not end the word.
 */
export const SECRET_PATH =
	/(?:^|[/\\\s'"`=@:<>(|;&])(?:\.(?:lyra[/\\](?:vault\.key|credentials\.json)|ssh[/\\]id_[A-Za-z0-9_]+|aws[/\\]credentials|gnupg\b|netrc|config[/\\]gh[/\\]hosts\.yml))(?=$|[/\\\s'"`;&|<>)])/i;
/**
 * Shells, which run whatever string they are handed.
 *
 * Named here rather than inline because two rules need the same list: "what does `bash -c` run"
 * and "what is on the far end of a `curl … |`".
 */
export const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh", "powershell", "pwsh", "cmd"]);

/** Anything that runs code it is given, for the pipe-into-interpreter rule. */
export const INTERPRETERS = new Set([
	...SHELLS,
	"python",
	"python2",
	"python3",
	"perl",
	"ruby",
	"node",
	"deno",
	"bun",
	"php",
	"osascript",
	"Rscript",
	"lua",
	"awk",
	"tclsh",
	// PowerShell's own: what `irm url | iex` hands the download to.
	"iex",
	"invoke-expression",
]);

/** PowerShell's `curl` and `wget`, lower-cased, for the same rule. */
export const FETCHERS = new Set(["curl", "wget", "fetch", "invoke-webrequest", "iwr", "invoke-restmethod", "irm"]);

/**
 * Programs whose argument list is another command, once their own options are out of the way.
 *
 * Without this, every one of them was a way to put a command somewhere nothing looked: the first
 * word of `env rm -rf ~` is `env`, of `xargs rm -rf` is `xargs`, and neither is on any list.
 */
export const COMMAND_PREFIXES = new Set([
	"env",
	"nohup",
	"time",
	"nice",
	"ionice",
	"stdbuf",
	"setsid",
	"timeout",
	"command",
	"exec",
	"xargs",
	"watch",
]);
