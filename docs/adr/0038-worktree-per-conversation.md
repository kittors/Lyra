# ADR-0038：工作树按会话选，算在原项目名下，建在 Lyra 自己的目录里

- 状态：已采纳
- 日期：2026-10-13
- 相关：core `session/types.ts`（`SessionMeta.worktree`）、`config/settings.ts`（`worktrees`）；desktop
  `electron/create-session.ts`、`electron/prompt-input.ts`（`initialPrompt`）、`electron/git-worktrees.ts`
  （`autoCreateSessionWorktree`）、`electron/session-hub.ts`、`electron/i18n.ts`（`worktree.notCreated`）、
  `src/features/composer/WorktreeToggle.tsx`、`src/features/conversation/SessionStatus.tsx`、`src/lib/session-home.ts`、
  `src/store/session-workspace.ts`、`src/lib/sidebar-grouping.ts`；测试 `test/git-worktrees.test.ts`、
  `test/create-session.test.ts`、`test/sidebar-grouping.test.ts`、`test/ui/worktree-toggle.test.ts`、
  `test/ui/worktree-conversation.test.ts`；探针 `e2e/worktree-choice-demo.ts`

## 背景

用户反馈三件事：Lyra 用工作树不如 Claude 顺手；开新会话时没法「这一次」选要不要工作树，只能在设置里一次定下
以后所有会话都开；开了之后「会在会话里面额外创建一个目录」。

查下来是四处各管一段、互相没接上：

- 只有一个全局开关。建会话时按它打 `workspaceSetup` 标记，首条消息激活时 `autoCreateSessionWorktree` **又问一遍**
  开关——即使界面上能选，选了也会被设置推翻。
- 工作树建在仓库**旁边**（`../<repo>-<id8>`），而会话的 `cwd` 改成了它。侧栏按 `cwd` 分组，那个路径不属于任何
  登记过的项目，于是每开一个工作树会话就多一个同名的项目文件夹，会话行在工作树建好的那一刻从原项目下跳过去。
  这就是「额外创建一个目录」：侧栏里多出的文件夹，加上磁盘上仓库旁边多出的那个。
- 仓库旁边不在主进程的路径白名单（`allowedRoots` 只收项目、草稿目录和 `~/.lyra/worktrees`）：文件树是空的，
  终端开在家目录，提交、删工作树都被拒。
- 建失败时悄悄回到项目目录里跑，标记照样清掉——要了副本的人改的是自己的检出。

## 决定

**一、按会话选，设置只是默认。** 新会话（还没发第一条、项目是 Git 仓库）的输入框上，项目和分支后面有一个开关
（`WorktreeToggle`，⑂ 加「工作树」，开着是强调色）。它从 `worktrees.autoCreateOnNewSession` 起步，选的结果随首条
消息走 `initial.worktree`（`initialPrompt` 白名单收它，手机那一路同一道门），`createStoredSession` 按它打标记。
`autoCreateSessionWorktree` 不再问设置：标记就是决定。定时任务没有输入框，由它自己那条路按设置决定。

开关挂在草稿上（`draftKey`）：换一个新会话、或者这个新会话换了项目，就回到设置的默认值。会话跑起来以后开关消失
——那时已经挪不进副本了。

**二、记下它出自哪个项目。** 建好之后 `SessionMeta.worktree = { project, branch }`。凡是「这个会话属于哪个项目」
的问题都先问它（`sessionHome`）：侧栏分组、「已清空的项目」、归档页、项目菜单的会话数、「归档这个项目的会话/移除
项目」、会话菜单里「移到项目」标当前项、行的拖动排序、悬停卡片上的项目名。复制路径、跑命令仍然用 `cwd`——文件在那里。

打开这样的会话，窗口的 `workspace` 仍是工作树（分支、改动、文件都是它的），名字取原项目、带上 `worktreeOf`
（`sessionWorkspace`）。从它开新会话回到原项目（`projectWorkspace`，分支随后重读）：从前会在工作树里再建一棵
（`Lyra-3f9a1c2e-9b0d77aa`）。侧栏上它空闲时行首画 ⑂、悬停说分支；在跑、等审批这些状态照旧优先。

`worktreeOf` 只由渲染进程按会话的 meta 填，主进程的 `workspace.info` 不猜：一棵人自己建、又作为项目打开的工作树
是一个独立的项目，不该被改名成主仓库。

**三、建在 `~/.lyra/worktrees`。** 不配 `rootDir` 时就在这里（设置页的提示、代码注释本来就这么写，只有行为是仓库
旁边），天然在白名单里；仓库旁边不再多出目录。项目是仓库的一个子目录时，会话落在工作树里的同一个子目录；那个子
目录没提交过（副本里没有）就落在工作树根。

**四、建不出来要说。** 回到项目目录里跑之前，对话里出一条提示（`worktree.notCreated`，七种语言），带上原因。

## 后果

`e2e/worktree-choice-demo.ts` 在真窗口里 14/14：开关默认跟设置、点一下切换；`pwd` 和 `git branch` 证明会话在
`~/.lyra/worktrees/demo-repo-xxxxxxxx` 的 `lyra/session-xxxxxxxx` 上跑；仓库旁边没有新目录；侧栏只有「演示仓库」
一个分组；项目 chip 是 `demo-repo`、分支 chip 是工作树的分支；窗口能列出工作树里的文件；点新对话回到 `main`；
不开开关就在项目目录里跑，不建工作树。改前同一脚本：仓库旁边多出 `demo-repo-9d377441`，侧栏多出 `demo-repo` 一组，
项目 chip 是 `demo-repo-9d377441`。

**没做的：**

- 改之前建出来的工作树会话没有 `worktree` 字段，仍在各自的分组里；它们在仓库旁边的目录也仍不在白名单里。要归位
  得做一次迁移（从 `cwd` 的 `.git` 指针认出主仓库），没有放在这次。
- 生命周期：删除或归档会话不回收它的工作树；自动清理（`cleanOldWorktrees`）仍分不清 Lyra 建的和人自己建的；没有
  「合并回主分支」「同步基分支」「选基分支」。
- 窄窗口抽屉、手机上没有专门验证开关的位置。
