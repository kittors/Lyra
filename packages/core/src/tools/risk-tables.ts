/**
 * What counts as dangerous, as data.
 *
 * Kept apart from the judging so that the lists can be read — and argued with — without reading the
 * logic around them. That matters more here than almost anywhere else in the app: these tables are
 * the difference between a prompt that fires when it should and one people learn to click through.
 *
 * Every entry is something you cannot take back. Writing files is not on the list; writing is the
 * job.
 */

/** Programs that are dangerous whatever their arguments. */
export const NEVER_UNATTENDED = new Map<string, string>([
	["sudo", "以管理员身份执行"],
	["doas", "以管理员身份执行"],
	["su", "切换用户"],
	["shutdown", "关机或重启"],
	["reboot", "关机或重启"],
	["halt", "关机或重启"],
	["mkfs", "格式化磁盘"],
	["fdisk", "修改磁盘分区"],
	["diskutil", "修改磁盘"],
	["dd", "按块写设备，可能覆盖磁盘"],
	["shred", "不可恢复地擦除文件"],
	["chown", "更改文件归属"],
	["launchctl", "改动系统服务"],
	["systemctl", "改动系统服务"],
	["crontab", "改动定时任务"],
	["killall", "批量结束进程"],
]);

/** Subcommands that discard work or rewrite shared history. */
export const RISKY_SUBCOMMANDS = new Map<string, Map<string, string>>([
	[
		"git",
		new Map([
			["reset", "可能丢弃未提交的改动"],
			["clean", "删除未跟踪的文件"],
			["rebase", "重写提交历史"],
			["filter-branch", "重写提交历史"],
			["checkout", "可能覆盖未提交的改动"],
			["restore", "可能丢弃未提交的改动"],
		]),
	],
	["npm", new Map([["publish", "发布到公共仓库"]])],
	["pnpm", new Map([["publish", "发布到公共仓库"]])],
	["yarn", new Map([["publish", "发布到公共仓库"]])],
	["docker", new Map([["system", "可能清理镜像与卷"]])],
	["kubectl", new Map([["delete", "删除集群资源"]])],
]);

/** Paths that are never the project, so writing to them is out of scope by definition. */
export const PROTECTED_PATH = /(^|\s)(\/(bin|sbin|usr|etc|var|System|Library|Applications)\b|~\/\.(ssh|aws|gnupg|config\/gh)\b)/;

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
 */
export const SECRET_PATH =
	/(~|\$HOME|\/Users\/[^/\s]+|\/home\/[^/\s]+)?\/?\.(lyra\/(vault\.key|credentials\.json)|ssh\/id_[A-Za-z0-9_]+|aws\/credentials|gnupg\b|netrc|config\/gh\/hosts\.yml)/;

/**
 * Shells, which run whatever string they are handed.
 *
 * Named here rather than inline because two rules need the same list: "what does `bash -c` run"
 * and "what is on the far end of a `curl … |`".
 */
export const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);

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
]);

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
