/**
 * 这次审计整改修过的每一条，各自的守卫跑一遍。
 *
 * 为什么要有这个文件：整改摊在十几个提交里，每一条都配了测试，但那些测试散在七个包的 `test/`
 * 下面。`pnpm test` 全绿只说明「三千八百条里没有红的」，说不出「C1 那五个工具还在吗」——而问
 * 「那一条还在吗」才是回归测试要回答的问题。这里把问题和守它的东西写成一张表，跑完逐条报。
 *
 * 一条没有守卫的修复等于没修：下一个人重构到那里，没有任何东西会告诉他。所以这张表也是一份
 * 检查——某条修复在这里找不到守卫，那是需要补测试，不是需要放过。
 *
 * 用法：
 *   node scripts/audit-regression.mjs          单测与门禁，约一分钟，不弹窗口
 *   node scripts/audit-regression.mjs --window  再加上要真窗口的那几条（会抢焦点几分钟）
 *   node scripts/audit-regression.mjs --window --only=PREVIEW-fold-window,PREVIEW-height-window
 *                                              只跑点名的那几条——验一处修复，不必让每个探针都抢一遍焦点
 *
 * 真窗口那几条默认不跑，理由是它们会把窗口摆到屏幕上抢焦点，而其中依赖真实指针位置的探针在
 * 人正在用电脑时结果不可信（`screenshot-probe` 实测在 1 到 11 个问题之间跳，基线同样跳）。
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const withWindow = process.argv.includes("--window");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",");

/**
 * 一条修复，和证明它还在的那个东西。
 *
 * `id` 是审计报告里的编号，`what` 是当初错在哪——写成「症状」而不是「改了什么」，因为回归的时候
 * 人看见的是症状。
 */
const CHECKS = [
	{
		id: "ISSUE-cost-loop",
		what: "大结果无限携带、未完成清单强制续跑、技能重复注入及空回复重试重置",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/aged-prune.test.ts", "packages/core/test/stale-results.test.ts", "packages/core/test/prune-timing.test.ts", "packages/core/test/prune-live-session.test.ts", "packages/core/test/read-long-line.test.ts", "packages/core/test/long-line.test.ts", "packages/core/test/context.test.ts", "packages/core/test/grep-literal.test.ts", "packages/core/test/nudge.test.ts", "packages/core/test/repetition.test.ts", "packages/core/test/translated-tools.test.ts", "packages/core/test/skill-allowed-tools.test.ts", "packages/core/test/session-log.test.ts", "packages/core/test/resume.test.ts"]],
	},
	{
		id: "ISSUE-question",
		what: "Full Access 混淆回答与权限、跳过和多选缺少可信边界校验",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/ask-user.test.ts"]],
	},
	{
		id: "ISSUE-ui",
		what: "提问遮挡、清单残留、队列卸载重建、过程收起硬切和 Git 重复入口",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--import", "tsx", "--import", "./test/helpers/dom.ts", "--import", "./test/helpers/assets.mjs", "--test", "test/ui/approval-overlay.test.ts", "test/ui/message-queue-strip.test.ts", "test/ui/turn-process.test.ts", "test/ui/git-group-actions.test.ts"]],
	},
	{
		id: "C1",
		what: "recall/rule/learn/lsp/web_search 五个工具没被告知给模型",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/tool-registry.test.ts"]],
	},
	{
		id: "S2",
		what: "压缩缝只转四个参数，桌面端丢了 overhead/artifacts/summarizer",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/compaction-seam.test.ts", "packages/core/test/compaction-outline.test.ts"]],
	},
	{
		id: "S1",
		what: "主进程的 ipcMain.handle 没有任何东西和契约比对",
		run: ["pnpm", ["--filter", "@lyra/contract", "test"]],
	},
	{
		id: "H1",
		what: "命令分类器的七条绕过（env 包装、bash -c、git 全局选项、长选项、任意解释器管道、双引号里的 $()、换行）",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/risk-bypass.test.ts", "packages/core/test/risk.test.ts"]],
	},
	{
		id: "H2",
		what: "密钥读侧无审批，以及沙箱网络轴配了传不下去",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/sandbox-bash.test.ts"]],
	},
	{
		id: "ISSUE-escalate",
		what: "auto 模式下提权不问人就到沙箱外跑（策略判的是 escalate:…: 前缀串，认不出程序，rm -rf 也放行）",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/escalation-gate.test.ts", "packages/core/test/escalation.test.ts"]],
	},
	{
		id: "ISSUE-escalate-always",
		what: "提权卡片点了「以后不再问」，同样的提权从此在任何模式下都不问人就到沙箱外跑",
		run: ["node", ["--test", "--import", "./packages/desktop/test/setup.ts", "--experimental-strip-types", "packages/core/test/escalation-gate.test.ts", "packages/desktop/test/approval-response.test.ts"]],
	},
	{
		id: "H3",
		what: "七条 HTTP 写路由绕过手机白名单，sessions.create 的 cwd 不限项目",
		run: ["node", ["--test", "--import", "./packages/desktop/test/setup.ts", "--experimental-strip-types", "packages/desktop/test/sync-rpc.test.ts"]],
	},
	{
		id: "S3",
		what: "Anthropic 把半截流当完整回答；空闲闸只挂在一条链上",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/anthropic-truncated-stream.test.ts", "packages/core/test/anthropic-wire-stream.test.ts"]],
	},
	{
		id: "I3",
		what: "YAML 解析失败时把解析器的原话丢了",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/skill-frontmatter.test.ts"]],
	},
	{
		id: "I4-relay",
		what: "中转单连接内存无上限（超大帧头让缓冲永不清空）",
		run: ["node", ["--experimental-strip-types", "--test", "packages/relay/test/relay-security.test.ts"]],
	},
	{
		id: "I4-worktree",
		what: "删工作树失败后无条件 rm -rf，而那个 IPC 没有路径守卫",
		run: ["node", ["--test", "--import", "./packages/desktop/test/setup.ts", "--experimental-strip-types", "packages/desktop/test/git-worktrees.test.ts"]],
	},
	{
		id: "I1-i18n",
		what: "i18n 检查器的两个盲点（字符串里的 // 当注释、JSX 文本遇 > 就断）",
		run: ["node", ["--experimental-strip-types", "--test", "test/check-i18n.test.ts"]],
	},
	{
		id: "I1-scan",
		what: "硬编码中文（那四条漏网的）",
		run: ["node", ["scripts/check-i18n.mjs"]],
	},
	{
		id: "I2",
		what: "文档里七处过期数字",
		run: ["node", ["--experimental-strip-types", "--test", "test/docs-numbers.test.ts"]],
	},
	{
		id: "S5+I4-arch",
		what: "循环依赖没有棘轮；store 伸进功能域点名文件没人管",
		run: ["pnpm", ["arch"]],
	},
	{
		id: "S6",
		what: "十一条 React 编译器规则整块关掉且没有理由",
		run: ["pnpm", ["lint"]],
	},
	{
		id: "CORE-session-db",
		what: "流到一半被杀的回复丢失、删会话把花销一起删掉、分叉重复计费、删掉的会话被迟到的写入带回侧栏、旧日志导入丢记录或带回删过的会话",
		run: ["node", ["--experimental-strip-types", "--import", "./packages/core/test/setup.ts", "--test", "packages/core/test/session-db.test.ts", "packages/core/test/session-index-race.test.ts", "packages/core/test/session-legacy-import.test.ts"]],
	},
	{
		id: "POPOVER-first-frame",
		what: "项目多的时候，项目菜单每次打开先盖在按钮上闪一帧，再掉到按钮下面",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--import", "tsx", "--import", "./test/helpers/dom.ts", "--import", "./test/helpers/assets.mjs", "--test", "test/ui/popover-first-frame.test.ts"]],
	},
	{
		id: "PREVIEW-fold",
		what: "preview 做的页面跟着过程一起收进折叠，一轮跑完只剩「思考 1 次 · 生成预览」一行，要点开思考才看得到页面",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--import", "tsx", "--import", "./test/helpers/dom.ts", "--import", "./test/helpers/assets.mjs", "--test", "test/ui/preview-fold.test.ts", "test/turn-blocks.test.ts"]],
	},
	{
		id: "PREVIEW-height",
		what: "预览卡片在机器忙时锁死在 440：等待从挂上算起，超时把默认值当成量好的高度记下来，之后只许变高；固定高度的页面先报 256 再报 362，卡片缩过头又长回来，重开也弹一下；「重新运行」之后卡片永远空白",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--import", "tsx", "--import", "./test/helpers/dom.ts", "--import", "./test/helpers/assets.mjs", "--test", "test/ui/preview-height.test.ts", "test/preview-height-reporter.test.ts"]],
	},
	{
		id: "knip",
		what: "191 个未用导出，而 CI 里那条检查永远不会红",
		run: ["pnpm", ["knip"]],
	},
	{
		id: "VIEWER-flight",
		what: "点「编辑」图先放大到缩略图的四倍再缩回去；飞回缩略图时发白停几帧再突然变实",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--test", "--import", "./test/setup.ts", "--experimental-strip-types", "test/image-flight.test.ts"]],
	},
	{
		id: "VIEWER-redo",
		what: "标注完点「完成」进不了输入框；进去了一打字就被删；照着改时模型拿到的是之前画的那张",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/image-recent.test.ts", "packages/core/test/image-tool.test.ts"]],
	},
	{
		id: "RETRY-refusal",
		what: "服务商把拒绝写成回答流出来、中转再补一个泛泛的流内错误：被当成服务端故障每 5 秒重试一次，每次再流一遍同一段拒绝",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/failure-classify.test.ts", "packages/core/test/responses-refusal-stream.test.ts", "packages/core/test/image-generate.test.ts"]],
	},
	{
		id: "GALLERY-lineage",
		what: "画廊里一张图的生成链路：旧结果靠 #1 倒推、分叉的图归到原会话、撤回和删除的图不出现；链路排成一列，分支整段列、括线接回出处",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/image-lineage.test.ts", "packages/core/test/image-gallery.test.ts"]],
	},
	{
		id: "VIEWER-redo-ui",
		what: "投递到输入框的图（标注图、浏览器区域截图）在句子里没有标记，打第一个字就被当孤儿卸掉",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--import", "tsx", "--import", "./test/helpers/dom.ts", "--import", "./test/helpers/assets.mjs", "--test", "test/ui/split-composer-draft.test.ts"]],
	},
	{
		id: "GALLERY-switch",
		what: "进创作时侧栏收起的每一帧都把相册重排一遍、每张图 13 种尺寸；第一次进独立页先挂 300ms 骨架等一个早就到了的分包；再进一次整本相册重画",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--import", "tsx", "--import", "./test/helpers/dom.ts", "--import", "./test/helpers/assets.mjs", "--test", "test/ui/settled-width.test.ts", "test/ui/preloaded-screens.test.ts", "test/ui/gallery.test.ts"]],
	},
	{
		id: "WORKTREE-choice",
		what: "开新会话没法这一次选要不要工作树、选了也被设置推翻；工作树会话在侧栏多出一个同名项目、项目名变成工作树文件夹名、从它开新会话套出第二层工作树；工作树建在仓库旁边，文件树空、提交被拒",
		run: ["node", ["--experimental-strip-types", "--test", "--import", "./packages/desktop/test/setup.ts", "packages/desktop/test/git-worktrees.test.ts", "packages/desktop/test/create-session.test.ts", "packages/desktop/test/sidebar-grouping.test.ts"]],
	},
	{
		id: "WORKTREE-choice-ui",
		what: "同上，界面那一半：输入框上的开关、工作树会话的行首标记、打开它时的项目名、从它开的新会话回到原项目",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--import", "tsx", "--import", "./test/helpers/dom.ts", "--import", "./test/helpers/assets.mjs", "--test", "test/ui/worktree-toggle.test.ts", "test/ui/worktree-conversation.test.ts"]],
	},
	{
		id: "SESSION-spawn",
		what: "建议新会话：参数不合格画出空卡、点了才开始却打断了这一轮、子代理拿到会话级工具",
		run: ["node", ["--experimental-strip-types", "--test", "packages/core/test/session-ops.test.ts"]],
	},
	{
		id: "SESSION-spawn-ui",
		what: "建议卡片：点「开始」切走当前对话、开进工作树、spawnedFrom 没带下去；开始 → 已开始 · 打开 → 切过去；别的对话同一个调用 id 不算；关闭只收起",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--import", "tsx", "--import", "./test/helpers/dom.ts", "--import", "./test/helpers/assets.mjs", "--test", "test/ui/session-suggestion-card.test.ts"]],
	},
	{
		id: "SESSION-archive",
		what: "归档自己：在工具里当场归档会把正在说话的那一轮砍掉（aborted、最后一条结果落不进去）；收尾和排着的话还在跑就放掉会话；停下或出错也照样归档；spawnedFrom 被建会话的白名单吃掉、重开后没了",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--test", "--import", "./test/setup.ts", "--experimental-strip-types", "test/session-ops.test.ts"]],
	},
	{
		id: "WORKTREE-repair",
		what: "改版前建的工作树会话没有 worktree 字段：侧栏里各成一个同名项目、仓库旁边的目录不在白名单（文件树空、终端开在家目录、提交被拒）；归位时认错 submodule 和别人的工作树、写成 git 的路径写法多出一组、把旧会话顶到列表最上面",
		run: ["node", ["--experimental-strip-types", "--test", "--import", "./packages/desktop/test/setup.ts", "packages/desktop/test/worktree-repair.test.ts", "packages/desktop/test/worktree-roots.test.ts"]],
	},
	{
		id: "WORKTREE-lifecycle",
		what: "工作树的后半生：删除、归档不回收目录，自动清理带 --force 连没提交的改动一起删、认不出人自己建的工作树；合回 main 的冲突把项目目录留在半截合并里、挪分支时盖掉中间落进来的提交；收走的目录回不来；领先落后把合并提交算进去，刚合完显示「落后 1」",
		run: ["node", ["--experimental-strip-types", "--test", "--import", "./packages/desktop/test/setup.ts", "packages/desktop/test/worktree-lifecycle.test.ts", "packages/desktop/test/worktree-merge.test.ts", "packages/desktop/test/git-worktrees.test.ts"]],
	},
	{
		id: "CRED-values",
		what: "SSH 密码、私钥、令牌只能贴进对话：值进了发给模型的请求、会话库、事件和改过的文件，子智能体那一路不脱敏，命令能把保险库文件读出来自己解；ssh2 的 agent 一遇到 OpenSSH 8.9 的 session-bind 就整个登录失败",
		run: ["node", ["--experimental-strip-types", "--test", "--import", "./packages/core/test/setup.ts", "packages/core/test/credential-redact.test.ts", "packages/core/test/credential-askpass.test.ts", "packages/core/test/credential-agent.test.ts", "packages/core/test/credential-broker.test.ts", "packages/core/test/credential-tools.test.ts", "packages/core/test/credential-sentinel.test.ts", "packages/core/test/credential-guards.test.ts"]],
	},
	{
		id: "CRED-desktop",
		what: "凭据进主进程的闸门：卡片与保险箱的入参不逐字段重建、回给页面的结果带着值；贴进输入框的真值原样发给模型；手机上打一个引用就把存下的凭据交给了对话",
		run: ["node", ["--experimental-strip-types", "--test", "--import", "./packages/desktop/test/setup.ts", "packages/desktop/test/credential-input.test.ts", "packages/desktop/test/credential-screen.test.ts", "packages/desktop/test/vault-naming.test.ts"]],
	},
	{
		id: "CRED-ui",
		what: "凭据卡片与保险箱页：填的值走了审批通道、存过的不先问、手机上有输入框、必须每次问的还给「不再询问」；复制值经过渲染进程，钥匙复制出私钥；问密码时回复里的引用点不了、手机上也想复制",
		run: ["pnpm", ["--filter", "@lyra/desktop", "exec", "node", "--import", "tsx", "--import", "./test/helpers/dom.ts", "--import", "./test/helpers/assets.mjs", "--test", "test/ui/credential-card.test.ts", "test/ui/vault-view.test.ts", "test/ui/credential-ref.test.ts"]],
	},
	{
		id: "S7-annotate",
		what: "标注拆成三个文件之后还画得出来吗",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/annotator-probe.ts", "/tmp/regression-annot"]],
	},
	{
		id: "S7-capture",
		what: "截图浮层拆出两个 hook 之后，退出与连续两次捕获还对吗",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/screenshot-exit-probe.ts", "/tmp/regression-exit"]],
	},
	{
		id: "ISSUE-escalate-always-window",
		what: "跑起来的桌面端里，提权卡片还有「以后不再问」吗；设置里旧版本记下的那条还替人答吗",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/escalation-approval-probe.ts", "/tmp/regression-escalate"]],
	},
	{
		id: "C1-window",
		what: "那五个工具在跑起来的桌面端里真的出现在工具清单上吗",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/audit-fixes-demo.ts", "/tmp/regression-tools"]],
	},
	{
		id: "IMAGE-draw",
		what: "对话里画图：点阵按比例占位、图落地框不变、#1 改图、额度用完直说、生图模型不进对话列表",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/image-generation-demo.ts"]],
	},
	{
		id: "SIDEBAR-fling",
		what: "侧栏快甩时会话行和被推出的项目名整行画在标签条上下",
		window: true,
		run: ["node", ["--experimental-strip-types", "--test", "--test-name-pattern=fast fling", "packages/desktop/e2e/sidebar-tabs.test.ts"]],
	},
	{
		id: "POPOVER-first-frame-window",
		what: "跑起来的桌面端里，十五个项目的菜单连开五次，每次第一帧就在按钮下方、之后不再挪",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/popover-first-frame-probe.ts", "回归", "/tmp/regression-popover"]],
	},
	{
		id: "PREVIEW-fold-window",
		what: "跑起来的桌面端里，实时一轮、重新打开、「展开」排法三种情况下，预览页面都在折叠行外面，折叠里只剩一行「生成预览 <标题>」，卡片逐帧只朝一个方向收到页面的高度",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/preview-outside-fold-probe.ts", "live,stored,expanded", "after"]],
	},
	{
		id: "PREVIEW-height-window",
		what: "跑起来的桌面端里，页面晚两秒才报高度，卡片照样跟着页面而不是锁在 440；重新载入后卡片停在记下的高度，一帧不动",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/preview-outside-fold-probe.ts", "slow,reopen", "after"]],
	},
	{
		id: "VIEWER-flight-window",
		what: "跑起来的桌面端里：编辑/预览从缩略图大小起飞、不放大再缩；关闭实心落地；完成进输入框；照着改带上标注图；附件托盘收起有过程",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/viewer-flight-probe.ts", "--tag=回归"]],
	},
	{
		id: "PANE-image-fit-window",
		what: "文件面板打开大图，先按 100% 画出来再缩到适配",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/image-pane-fit-probe.ts", "--tag=回归"]],
	},
	{
		id: "SESSION-ops-window",
		what: "跑起来的桌面端里：真鼠标点「开始」，新会话进侧栏、第一条是那段提示词、当前对话不切走、卡片变「已开始」、重启后还是；归档自己那一轮正常收尾、进了归档、界面离开它",
		window: true,
		run: ["node", ["--experimental-strip-types", "packages/desktop/e2e/session-ops-demo.ts", "/tmp/regression-session-ops"]],
	},
];

const pass = [];
const fail = [];
const skipped = [];

for (const check of CHECKS) {
	if (only && !only.includes(check.id)) continue;
	if (check.window && !withWindow) {
		skipped.push(check);
		continue;
	}
	const [cmd, args] = check.run;
	process.stdout.write(`  ${check.id} … `);
	const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const ok = result.status === 0;
	(ok ? pass : fail).push({ ...check, output: `${result.stdout ?? ""}${result.stderr ?? ""}` });
	console.log(ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m");
}

console.log("");
for (const check of pass) console.log(`\x1b[32m✓\x1b[0m ${check.id.padEnd(14)} ${check.what}`);
for (const check of skipped) console.log(`\x1b[33m—\x1b[0m ${check.id.padEnd(14)} ${check.what}（要真窗口，加 --window）`);
for (const check of fail) {
	console.log(`\n\x1b[31m✗ ${check.id}\x1b[0m ${check.what}`);
	// 尾部够看出哪条断言红了，而不是把一整份测试输出倒出来。
	console.log(
		check.output
			.split("\n")
			.filter((line) => line.trim())
			.slice(-14)
			.map((line) => `    ${line}`)
			.join("\n"),
	);
}

console.log(
	`\n${fail.length === 0 ? "\x1b[32m" : "\x1b[31m"}${pass.length} 条守住，${fail.length} 条回归${
		skipped.length ? `，${skipped.length} 条没跑` : ""
	}\x1b[0m`,
);
process.exitCode = fail.length === 0 ? 0 : 1;
