/**
 * Every method the renderer may call, and where each one may be called from.
 *
 * This list is the answer to three questions that used to be answered in three places:
 *
 *   which channel does this method use      → `preload.ts`, one `invoke` per method
 *   what does it look like                  → `ipc-types.ts`, a hand-written interface
 *   may the phone call it                   → `sync-rpc.ts`, a hand-written allowlist
 *
 * Adding a method meant editing three files. Missing one of them failed differently each time, and
 * the third was the worst: a method absent from the allowlist is not an error on the phone, it is
 * *nothing* — the button is there, the tap does nothing, and no error is raised anywhere.
 *
 * Generated from the three files it replaces, then kept by hand. `test/methods.test.ts` compares it
 * with `preload.ts`, `sync-rpc.ts` and every `ipcMain.handle` in the main process on every run, so
 * none of them can drift apart again. The main process was the last one added and the one that
 * mattered most: it is the end that actually answers, and it was the end nothing looked at.
 */

/** Where a method may be called from, and — when the phone may not — why not. */
export interface Reach {
	/**
	 * Callable from the phone.
	 *
	 * The phone runs the desktop's own renderer over the network, so every method is *reachable*;
	 * this decides which ones answer. It is a security boundary and a product decision at once:
	 * whoever holds the pairing token can call exactly these.
	 */
	remote: boolean;
	/**
	 * Why the phone may not call it.
	 *
	 * Required whenever `remote` is false, because the useful question about any of these is "should
	 * a phone be able to do this" — and a bare `false` reads as "nobody got round to it".
	 */
	why?: string;
}

export interface Method extends Reach {
	/** The IPC channel. It appears here and nowhere else, so it cannot be misspelt at a call site. */
	channel: string;
}

/**
 * The methods, by group.
 *
 * Grouped the way `window.lyra` is grouped, so a reader can hold one subject at a time. Within a
 * group the order is the order they appear in the preload, which is roughly the order they were
 * written.
 */
export const METHODS = {
	agentDefinitions: {
		list: { channel: "agentdefs:list", remote: false, why: "Desktop definition editor reads local configuration." },
		read: { channel: "agentdefs:read", remote: false, why: "Desktop definition editor reads local configuration." },
		save: { channel: "agentdefs:save", remote: false, why: "Local agent definitions require the desktop editor." },
		remove: { channel: "agentdefs:remove", remote: false, why: "Local agent definitions require the desktop editor." },
		restore: { channel: "agentdefs:restore", remote: false, why: "Local agent definitions require the desktop editor." },
	},
	delivery: {
		get: { channel: "delivery:get", remote: false, why: "本机文件差异和实现记录" },
		undo: { channel: "delivery:undo", remote: false, why: "恢复本轮文件，要求本机审阅" },
	},
	services: {
		list: { channel: "services:list", remote: false, why: "读取本机进程和监听端口" },
		stop: { channel: "services:stop", remote: false, why: "停止当前会话拥有的本机进程" },
	},
	browser: {
		state: { channel: "browser:state", remote: false, why: "浏览器在桌面端显示" },
		command: { channel: "browser:command", remote: false, why: "控制本机网页与开发工具" },
		attach: { channel: "browser:attach", remote: false, why: "连接本机窗口的浏览器页面" },
		inspect: { channel: "browser:inspect", remote: false, why: "需要在本机网页中选取元素" },
		cancelInspect: { channel: "browser:cancelInspect", remote: false, why: "本机页面检查状态" },
	},
	settings: {
		get: { channel: "settings:get", remote: true },
		save: { channel: "settings:save", remote: true },
		layers: { channel: "settings:layers", remote: false, why: "读的是本机项目里的配置文件；手机只看有效值" },
	},
	usage: {
		scan: { channel: "usage:scan", remote: false, why: "读本机日志" },
	},
	workspace: {
		pick: { channel: "workspace:pick", remote: false, why: "开的是本机的文件选择对话框" },
		foreignConfigs: { channel: "workspace:foreignConfigs", remote: false, why: "读本机仓库目录；手机上没有这个提示" },
		markForeignConfigsSeen: { channel: "workspace:markForeignConfigsSeen", remote: false, why: "同上" },
		info: { channel: "workspace:info", remote: true },
		reveal: { channel: "workspace:reveal", remote: false, why: "在本机的访达/资源管理器里定位" },
	},
	sessions: {
		list: { channel: "sessions:list", remote: true },
		create: { channel: "sessions:create", remote: true },
		open: { channel: "sessions:open", remote: true },
		transcript: { channel: "sessions:transcript", remote: true },
		trajectory: { channel: "sessions:trajectory", remote: true },
		trajectoryChanges: { channel: "sessions:trajectoryChanges", remote: true },
		exportTrajectory: { channel: "sessions:exportTrajectory", remote: false, why: "生成本机完整轨迹检查文件" },
		fork: { channel: "sessions:fork", remote: true },
		remove: { channel: "sessions:remove", remote: true },
		setArchived: { channel: "sessions:setArchived", remote: true },
		removeArchived: { channel: "sessions:removeArchived", remote: false, why: "批量删除且不可撤销——不该由一部可能丢失的手机发起" },
		capabilities: { channel: "sessions:capabilities", remote: true },
		rename: { channel: "sessions:rename", remote: true },
		compact: { channel: "sessions:compact", remote: true },
		contextBreakdown: { channel: "sessions:contextBreakdown", remote: true },
	},
	agent: {
		prompt: { channel: "agent:prompt", remote: true },
		editMessage: { channel: "agent:editMessage", remote: true },
		abort: { channel: "agent:abort", remote: true },
		approve: { channel: "agent:approve", remote: true },
		setModel: { channel: "agent:setModel", remote: true },
		setThinking: { channel: "agent:setThinking", remote: true },
	},
	subAgents: {
		/*
		 * 只读的那一个给手机，其余不给。
		 *
		 * 这一条曾经写着 `remote: false`，而 `sync-rpc.ts` 里一直实现着它——两边不一致了很久，
		 * 而检查一致性的那条测试因为正则写成 `[a-z]+` 匹配不到 `subAgents` 的大写 A，从来没看
		 * 见过它。以实现为准：手机上要显示一个回合里派出了哪些子智能体，那是只读的。
		 */
		list: { channel: "subagents:list", remote: true },
		detail: { channel: "subagents:detail", remote: true },
		steer: { channel: "subagents:steer", remote: true },
		abort: { channel: "subagents:abort", remote: true },
		dismiss: { channel: "subagents:dismiss", remote: true },
		dismissFinished: { channel: "subagents:dismissFinished", remote: true },
	},
	sideChat: {
		setModel: { channel: "sidechat:setModel", remote: true },
		state: { channel: "sidechat:state", remote: true },
		ask: { channel: "sidechat:ask", remote: true },
		editAndResend: { channel: "sidechat:editAndResend", remote: true },
		abort: { channel: "sidechat:abort", remote: true },
		reset: { channel: "sidechat:reset", remote: true },
	},
	tasks: {
		list: { channel: "tasks:list", remote: true },
		cancel: { channel: "tasks:cancel", remote: true },
		dismiss: { channel: "tasks:dismiss", remote: true },
		resume: { channel: "tasks:resume", remote: true },
	},
	format: {
		external: { channel: "format:external", remote: false, why: "调用本机装的格式化器" },
		available: { channel: "format:available", remote: false, why: "调用本机装的格式化器" },
		config: { channel: "format:config", remote: false, why: "调用本机装的格式化器" },
	},
	files: {
		list: { channel: "files:list", remote: true },
		read: { channel: "files:read", remote: true },
		document: { channel: "files:document", remote: false, why: "读写任意路径" },
		documentText: { channel: "files:documentText", remote: false, why: "把任意字节交给主进程里的解析器" },
		bytes: { channel: "files:bytes", remote: false, why: "读写任意路径" },
		write: { channel: "files:write", remote: false, why: "读写任意路径" },
		create: { channel: "files:create", remote: false, why: "在任意位置建文件" },
		rename: { channel: "files:rename", remote: false, why: "读写任意路径" },
		copy: { channel: "files:copy", remote: false, why: "读写任意路径" },
		trash: { channel: "files:trash", remote: false, why: "读写任意路径" },
		remove: { channel: "files:remove", remote: false, why: "读写任意路径" },
		uniquePath: { channel: "files:uniquePath", remote: false, why: "读写任意路径" },
		exists: { channel: "files:exists", remote: false, why: "读写任意路径" },
		importInto: { channel: "files:import", remote: false, why: "读写任意路径" },
		pick: { channel: "files:pick", remote: false, why: "弹出系统原生文件/目录选择框" },
	},
	clipboard: {
		read: { channel: "clipboard:read", remote: false, why: "手机有自己的剪贴板" },
		write: { channel: "clipboard:write", remote: false, why: "手机有自己的剪贴板" },
	},
	terminal: {
		list: { channel: "terminal:list", remote: false, why: "开的是这台机器上的 shell" },
		listAll: { channel: "terminal:list-all", remote: false, why: "开的是这台机器上的 shell" },
		open: { channel: "terminal:open", remote: false, why: "开的是这台机器上的 shell" },
		attach: { channel: "terminal:attach", remote: false, why: "开的是这台机器上的 shell" },
	},
	providers: {
		test: { channel: "providers:test", remote: false, why: "会拿着 API key 去请求供应商，密钥不出桌面端" },
		fetchModels: { channel: "providers:fetchModels", remote: false, why: "会拿着 API key 去请求供应商，密钥不出桌面端" },
	},
	sync: {
		status: { channel: "sync:status", remote: false, why: "同步服务由桌面端管，手机是它的客户端" },
		start: { channel: "sync:start", remote: false, why: "同步服务由桌面端管，手机是它的客户端" },
		stop: { channel: "sync:stop", remote: false, why: "同步服务由桌面端管，手机是它的客户端" },
		rotateToken: { channel: "sync:rotateToken", remote: false, why: "同步服务由桌面端管，手机是它的客户端" },
	},
	commands: {
		list: { channel: "commands:list", remote: true },
		create: { channel: "commands:create", remote: false, why: "读本机磁盘上的命令定义" },
		reveal: { channel: "commands:reveal", remote: false, why: "读本机磁盘上的命令定义" },
		open: { channel: "commands:open", remote: false, why: "读本机磁盘上的命令定义" },
	},
	plugins: {
		list: { channel: "plugins:list", remote: false, why: "装一个插件等于同意运行它的代码" },
		revealDir: { channel: "plugins:revealDir", remote: false, why: "装一个插件等于同意运行它的代码" },
		fetchRegistry: { channel: "registry:fetch", remote: false, why: "装一个插件等于同意运行它的代码" },
		icon: { channel: "registry:icon", remote: false, why: "装一个插件等于同意运行它的代码" },
		icons: { channel: "registry:icons", remote: false, why: "装一个插件等于同意运行它的代码" },
		installFromRegistry: { channel: "registry:install", remote: false, why: "装一个插件等于同意运行它的代码" },
		uninstall: { channel: "registry:uninstall", remote: false, why: "装一个插件等于同意运行它的代码" },
	},
	updates: {
		check: { channel: "updates:check", remote: false, why: "下载并运行安装包" },
		state: { channel: "updates:state", remote: false, why: "下载并运行安装包" },
		download: { channel: "updates:download", remote: false, why: "下载并运行安装包" },
		pause: { channel: "updates:pause", remote: false, why: "下载并运行安装包" },
		cancel: { channel: "updates:cancel", remote: false, why: "下载并运行安装包" },
		relaunch: { channel: "updates:relaunch", remote: false, why: "下载并运行安装包" },
		reopen: { channel: "updates:reopen", remote: false, why: "下载并运行安装包" },
		open: { channel: "updates:open", remote: false, why: "下载并运行安装包" },
	},
	system: {
		openPath: { channel: "system:openPath", remote: false, why: "把路径或程序交给操作系统去打开" },
		openExternal: { channel: "system:openExternal", remote: false, why: "把路径或程序交给操作系统去打开" },
		openIn: { channel: "system:openIn", remote: false, why: "把路径或程序交给操作系统去打开" },
		openTargets: { channel: "system:openTargets", remote: false, why: "把路径或程序交给操作系统去打开" },
		revealSkillsDir: { channel: "system:revealSkillsDir", remote: false, why: "把路径或程序交给操作系统去打开" },
		platform: { channel: "system:platform", remote: false, why: "把路径或程序交给操作系统去打开" },
		remoteImage: { channel: "system:remoteImage", remote: false, why: "把路径或程序交给操作系统去打开" },
	},
	screenshot: {
		start: { channel: "screenshot:start", remote: false, why: "读取整个屏幕" },
		finish: { channel: "screenshot:finish", remote: false, why: "读取整个屏幕" },
		cancel: { channel: "screenshot:cancel", remote: false, why: "读取整个屏幕" },
		download: { channel: "screenshot:download", remote: false, why: "读取整个屏幕" },
		pin: { channel: "screenshot:pin", remote: false, why: "读取整个屏幕" },
		pinnedCount: { channel: "screenshot:pinnedCount", remote: false, why: "读取整个屏幕" },
		pickDirectory: { channel: "screenshot:pickDirectory", remote: false, why: "读取整个屏幕" },
	},
	/*
	 * 置顶在桌面的那张图片，自己的窗口在问自己的事。
	 *
	 * 单独一组而不是挂在 screenshot 下面：用到它的时候截图早就结束了，剩下的只是一个显示图片的
	 * 小窗口。它拉取而不是被推送——组件是按需加载的，窗口 did-finish-load 时监听还没注册，推过去
	 * 的消息会无声地掉在地上，窗口就空着。
	 */
	pinnedShot: {
		request: { channel: "pin:request", remote: false, why: "置顶窗口是桌面端独有的窗口" },
	},
	index: {
		stats: { channel: "index:stats", remote: false, why: "在整个项目上建索引，耗时且只对本机有意义" },
		rebuild: { channel: "index:rebuild", remote: false, why: "在整个项目上建索引，耗时且只对本机有意义" },
		search: { channel: "index:search", remote: false, why: "在整个项目上建索引，耗时且只对本机有意义" },
	},
	scheduler: {
		runNow: { channel: "scheduler:runNow", remote: false, why: "定时任务在桌面端执行" },
	},
	/*
	 * 回答「要把这次纠正变成一条规则吗」那张卡片。
	 *
	 * 手机能调：卡片跟着转录一起出现在手机上，而一张按不动的卡片比没有卡片更糟——
	 * 它出现在正确的时刻，然后什么也不做。落盘仍然发生在桌面端的项目目录里。
	 */
	extensions: {
		stats: { channel: "extensions:stats", remote: false, why: "扩展宿主跑在桌面端的会话里；手机端的只读展示另做" },
	},
	capabilities: {
		trash: { channel: "capabilities:trash", remote: false, why: "将本机定义文件移入系统废纸篓" },
		diff: { channel: "capabilities:diff", remote: false, why: "读任意路径，且只在桌面端有画 diff 的地方" },
		prefer: { channel: "capabilities:prefer", remote: false, why: "改本机的配置文件" },
	},
	rules: {
		preview: { channel: "rules:preview", remote: true },
		keep: { channel: "rules:keep", remote: true },
		decline: { channel: "rules:decline", remote: true },
		/*
		 * 规则管理页在桌面端。
		 *
		 * 它回答的是「我写的规则为什么没生效」——被谁盖掉了、在哪个文件里、条件长什么样——
		 * 而这些问题的下一步动作是去改那个文件，那件事只能在有编辑器的那台机器上做。
		 */
		list: { channel: "rules:list", remote: false, why: "规则管理在桌面端，改完要去编辑那个文件" },
		/*
		 * 从会话里总结出来的技能候选。
		 *
		 * 批准一个技能是在给这个 agent 加一条以后一直生效的规矩，而手机上没有能看清它正文的
		 * 位置——一个在小屏上被顺手点掉的「启用」，正是这个功能最该防的那种批准。
		 */
		pendingSkills: { channel: "skills:pending", remote: false, why: "批准一个自动生成的技能要看清正文，那是桌面端的事" },
		approveSkill: { channel: "skills:approve", remote: false, why: "同上" },
		rejectSkill: { channel: "skills:reject", remote: false, why: "同上" },
		setDisabled: { channel: "rules:setDisabled", remote: false, why: "规则管理在桌面端" },
		setForeignUser: { channel: "rules:setForeignUser", remote: false, why: "规则管理在桌面端" },
	},
	forge: {
		kinds: { channel: "forge:kinds", remote: false, why: "代码托管的令牌不出桌面端" },
		accounts: { channel: "forge:accounts", remote: false, why: "代码托管的令牌不出桌面端" },
		signIn: { channel: "forge:signIn", remote: false, why: "代码托管的令牌不出桌面端" },
		signOut: { channel: "forge:signOut", remote: false, why: "代码托管的令牌不出桌面端" },
		setEnabled: { channel: "forge:setEnabled", remote: false, why: "代码托管的令牌不出桌面端" },
		rename: { channel: "forge:rename", remote: false, why: "代码托管的令牌不出桌面端" },
	},
	git: {
		myPullRequests: { channel: "git:myPullRequests", remote: false, why: "本机仓库操作" },
		pullRequest: { channel: "git:pullRequest", remote: false, why: "本机仓库操作" },
		pullRequestDiff: { channel: "git:pullRequestDiff", remote: false, why: "本机仓库操作" },
		scratchForPullRequest: { channel: "scratch:forPullRequest", remote: false, why: "本机仓库操作" },
		generalScratch: { channel: "scratch:general", remote: true },
		scratchRoots: { channel: "scratch:roots", remote: true },
		findLocalCheckout: { channel: "git:findLocalCheckout", remote: false, why: "本机仓库操作" },
		avatar: { channel: "git:avatar", remote: false, why: "本机仓库操作" },
		avatars: { channel: "git:avatars", remote: false, why: "本机仓库操作" },
		commentOnPullRequest: { channel: "git:commentOnPullRequest", remote: false, why: "本机仓库操作" },
		reviewPullRequest: { channel: "git:reviewPullRequest", remote: false, why: "本机仓库操作" },
		branches: { channel: "git:branches", remote: false, why: "本机仓库操作" },
		switchBranch: { channel: "git:switchBranch", remote: false, why: "本机仓库操作" },
		createWorktree: { channel: "git:createWorktree", remote: false, why: "本机仓库操作" },
		removeWorktree: { channel: "git:removeWorktree", remote: false, why: "本机仓库操作" },
		pruneWorktrees: { channel: "git:pruneWorktrees", remote: false, why: "本机仓库操作" },
		stat: { channel: "git:stat", remote: false, why: "本机仓库操作" },
		commit: { channel: "git:commit", remote: false, why: "本机仓库操作" },
		status: { channel: "git:status", remote: false, why: "本机仓库操作" },
		repos: { channel: "git:repos", remote: false, why: "本机仓库操作" },
		worktrees: { channel: "git:worktrees", remote: false, why: "本机仓库操作" },
		init: { channel: "git:init", remote: false, why: "本机仓库操作" },
		log: { channel: "git:log", remote: false, why: "本机仓库操作" },
		commitDiff: { channel: "git:commitDiff", remote: false, why: "本机仓库操作" },
		commitDiffSummary: { channel: "git:commitDiffSummary", remote: false, why: "本机仓库操作" },
		diffRefs: { channel: "git:diffRefs", remote: false, why: "本机仓库操作" },
		stage: { channel: "git:stage", remote: false, why: "本机仓库操作" },
		unstage: { channel: "git:unstage", remote: false, why: "本机仓库操作" },
		discard: { channel: "git:discard", remote: false, why: "本机仓库操作" },
		commitStaged: { channel: "git:commitStaged", remote: false, why: "本机仓库操作" },
		generateCommitMessage: { channel: "git:generateCommitMessage", remote: false, why: "本机仓库操作" },
		createBranch: { channel: "git:createBranch", remote: false, why: "本机仓库操作" },
		deleteBranch: { channel: "git:deleteBranch", remote: false, why: "本机仓库操作" },
		push: { channel: "git:push", remote: false, why: "本机仓库操作" },
		pull: { channel: "git:pull", remote: false, why: "本机仓库操作" },
		fetch: { channel: "git:fetch", remote: false, why: "本机仓库操作" },
		cancelRemote: { channel: "git:cancelRemote", remote: false, why: "本机仓库操作" },
		releaseInfo: { channel: "git:releaseInfo", remote: false, why: "本机仓库操作" },
		bumpVersion: { channel: "git:bumpVersion", remote: false, why: "本机仓库操作" },
		triggerDryRun: { channel: "git:triggerDryRun", remote: false, why: "本机仓库操作" },
		listWorkflowRuns: { channel: "git:listWorkflowRuns", remote: false, why: "本机仓库操作" },
		workflowRunStatus: { channel: "git:workflowRunStatus", remote: false, why: "本机仓库操作" },
		publishReleaseTag: { channel: "git:publishReleaseTag", remote: false, why: "本机仓库操作" },
	},
	memory: {
		load: { channel: "memory:load", remote: false, why: "手机上没有编辑记忆的界面" },
		add: { channel: "memory:add", remote: false, why: "手机上没有编辑记忆的界面" },
		remove: { channel: "memory:remove", remote: false, why: "手机上没有编辑记忆的界面" },
		clear: { channel: "memory:clear", remote: false, why: "手机上没有编辑记忆的界面" },
	},
	/*
	 * 分组叫 `projectMemory`，channel 却在 `memory:` 域下。
	 *
	 * 不是不一致。channel 的形状是 `域:动作`，而域必须是一个小写词——`methods.test.ts` 在管这件
	 * 事，它的注释写得很好：「已知的一处例外」和「随便怎么写都行」是两回事。而项目记忆和用户
	 * 偏好记忆读写的是不同的地方、有各自的开关，在 `window.lyra` 上分开才说得清。
	 *
	 * 于是域共用、动作带前缀。这条测试是在 `git push` 的钩子里抓到我的——它值这个位置。
	 */
	projectMemory: {
		/*
		 * 后台抽取由桌面端跑，手机不参与。
		 *
		 * 它读的是那台机器上的会话文件、写的是那台机器上的记忆目录，而且是「空闲时跑一遍」的
		 * 后台活——手机端连着的时候，那台机器并不空闲。
		 */
		status: { channel: "memory:projectStatus", remote: false, why: "后台抽取跑在桌面端" },
		extract: { channel: "memory:projectExtract", remote: false, why: "后台抽取跑在桌面端" },
		list: { channel: "memory:projectList", remote: false, why: "记忆页面只在桌面端；手机上没有它" },
	},
	diff: {
		workspaceDiff: { channel: "diff:workspace", remote: false, why: "手机上没有审阅改动的界面" },
		blob: { channel: "diff:blob", remote: false, why: "手机上没有审阅改动的界面" },
	},
} as const satisfies Record<string, Record<string, Method>>;

/** Every channel name, flat. For the main process, which registers by channel. */
export const CHANNELS: readonly string[] = Object.values(METHODS).flatMap((group) =>
	Object.values(group).map((method) => method.channel),
);

/**
 * The methods the phone may call, as `group.method`.
 *
 * This is what `sync-rpc.ts` implements. A method here without an implementation is a hole; an
 * implementation without an entry here is unreachable. The test asserts both directions.
 */
export const REMOTE_METHODS: readonly string[] = Object.entries(METHODS).flatMap(([group, methods]) =>
	Object.entries(methods)
		.filter(([, method]) => method.remote)
		.map(([name]) => `${group}.${name}`),
);

/** Look one up by `group.method`, for code that has a name and wants the rest. */
export function methodFor(path: string): Method | undefined {
	const [group, name] = path.split(".");
	if (!group || !name) return undefined;
	return (METHODS as Record<string, Record<string, Method>>)[group]?.[name];
}
