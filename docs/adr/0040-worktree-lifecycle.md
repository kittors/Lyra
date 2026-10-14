# ADR-0040：工作树的后半生——收回、检出回来、合回去、同步进来

- 状态：已采纳
- 日期：2026-10-14
- 相关：desktop `electron/worktree-lifecycle.ts`（`worktreeState`、`reclaimWorktree`、`restoreWorktree`、
  `bringBackWorktree`）、`electron/worktree-merge.ts`（`mergeIntoBase`、`syncFromBase`、`abortSync`）、
  `electron/worktree-types.ts`、`electron/ipc/worktree.ts`、`electron/ipc/sessions.ts`（删除、归档、取消归档）、
  `electron/session-cleanup.ts`、`electron/git-worktrees.ts`（`cleanOldWorktrees`）、`electron/session-hub.ts`；
  core `session/types.ts`（`SessionWorktree.base`、`SessionMeta.worktreeError`）；渲染进程
  `src/features/modals/WorktreeMenu.tsx`、`useWorktreeState.ts`、`delete-session.tsx`、
  `src/features/composer/Composer.tsx`、`src/store/session-workspace.ts`；测试 `test/worktree-lifecycle.test.ts`、
  `test/worktree-merge.test.ts`、`test/git-worktrees.test.ts`、`test/ui/worktree-menu.test.ts`；探针
  `e2e/worktree-lifecycle-demo.ts`。改版前的工作树会话归位见 `electron/worktree-repair.ts`（同一批）。

## 背景

ADR-0038 让工作树按会话选，它的后半生没有做：

- 删除、归档会话不回收工作树，`~/.lyra/worktrees` 只增不减。
- 自动清理（`cleanOldWorktrees`）认不出哪些是 Lyra 建的：仓库的任何链接工作树都可能被收，而且带 `--force`，
  里面没提交的改动跟着没了。
- 工作树里做完的事回不到主分支，主分支上的新提交也进不来——只能自己开终端敲 git。
- 建不成工作树时弹一条 toast。这件事在这个会话的整个生命里都成立（它改的是你自己的检出），toast 说一次就没了；
  用户也明确说过不喜欢 toast。

## 决定

贯穿全部的一条，取自 Claude 桌面端：**分支比目录活得久。** 工作树是分支的一个检出，提交了的东西都在分支上，
目录可以收走、再原样检出回来。唯一会丢的是没提交的改动，没人点头就不丢。

**一、状态读自 git。** `worktree:state` 给出分支；基分支——切出时记下的 `SessionWorktree.base`，旧会话没记就按
`origin/HEAD` → `main` → `master`；领先、落后；没提交的文件数；是不是停在一次同步的中途；冲突的文件。

领先落后**不计合并提交**（`rev-list --no-merges`）。同步会在工作树的分支上留一个合并提交，合回去会在基分支上
留一个；计进去的话，刚合完的工作树显示「落后 1」，刚同步完的两个提交显示「领先 3」，都在邀请人去做一次什么都
不会带来的同步或合并。

输入框上，工作树会话的分支 chip 换成工作树 chip：⑂（开关和侧栏用的同一个记号）、分支名、`↑2 ↓1`，同步停在
冲突上时多一个琥珀色记号；目录被收走时变灰。它在打开会话、一轮结束（模型会提交）、窗口回到前台（人可能在终端里
提交了）时重读，不轮询。这颗 chip 不能切分支：工作树就是它的分支，在里面检出别的，会话的工作就去了它看不见的地方。

**二、收回与检出回来。**

- **删除会话**：目录收走；分支上的提交全在基分支里（`merge-base --is-ancestor`）时分支一起删，否则分支留着。
  目录里有没提交的改动就不收。删除确认框读一次状态，把会留下的说出来：「工作树里还有 2 个文件没提交，会留在
  `~/.lyra/worktrees/…`」「分支 … 上有 3 个提交没合并，分支会留着」；都没有就说「它的工作树会一起移除」。
- **归档会话**：同上。
- **取消归档**：在原来的路径检出回来——分支在就从分支，不在就从基分支新切（分支只在全部合进基分支之后才删，
  新切的不缺任何东西）。是原路径而不是今天的布局：会话自己的历史里按绝对路径提到文件，模型接着那段历史往下说。
- **会话启动时目录不在**（手删了、被清理了）：同样检出回来；检不出来就退回项目目录里跑，并记下原因（第四条）。
- **自动清理**只认分支是 `lyra/session-*` 的链接工作树，只收没有未归档会话在用的、干净的；不带 `--force`；
  分支留着。人自己建的工作树、项目目录本身，一律不碰——认不认得出是问 git 的（`git worktree list`），不看目录名。

**三、合回去与同步进来**，都在工作树 chip 的菜单里。

- **合并到基分支**：先要求提交，没提交的就说有几个。
  - 基分支检出在项目目录里：在那里 `merge --no-ff`，项目里的文件跟着变；有冲突立刻 `merge --abort`——人工作的
    那个检出里不留半截合并。
  - 基分支哪里都没检出：`merge-tree --write-tree` 算出结果，`commit-tree` 提交，带旧值 `update-ref` 挪分支——
    中间有新提交落进来就失败，而不是把它盖掉。谁的文件都不动。
  - 检出在另一个工作树里：拒绝，说出在哪。挪动它会把那个目录里的文件留在它自己的 HEAD 后面。
  - 目录被收走了照样能合：提交在分支上，而有改动的目录不会被收。
  - 冲突的结果说出文件和下一步：「先从 main 同步，在这里解决之后再合并」。
- **从基分支同步**：在工作树里 `merge`。冲突留在工作树里，那里才是解决它的地方；菜单列出文件，给两条路——
  **交给这个对话解决**（以人的名义发一句话，列出文件，要它保留两边的意图后提交），或者**放弃这次同步**
  （`merge --abort`）。
- 会话在跑时两样都拒绝：它们改的正是这一轮在读写的东西。都不推送。
- 结果写在菜单底部，不弹 toast。合并成功后底部多一行「归档这个对话」——合完、收起，是 Claude 那边最常走的一步。

**四、建不成工作树，要一直说。** 原因记在会话上（`SessionMeta.worktreeError`），输入框上分支后面一个琥珀色的
提醒，点开是「这个对话直接在项目目录里运行，改动会落在你自己的检出里」和 git 的原话。取代 ADR-0038 第四条的 toast：
说在人发消息之前会看的那一排上，并且一直在。

## 后果

真窗口探针 `e2e/worktree-lifecycle-demo.ts` 31/31：chip 从无标记到 `↑2↓1`；菜单的状态行；同步后 `↑2`（合并提交
不计）；合回 `main` 后项目目录里出现工作树的文件、最后一个提交有两个父提交、chip 回到无标记；两边都改 README 后
同步停在冲突上、合并点不了并说为什么、chip 带冲突记号；放弃后工作树 `git status` 干净；再同步交给对话，它解决并
提交，冲突记号消失；合回去再归档，目录没了、已合并的分支一起删、`main` 留着全部工作；取消归档在原路径检出回来；
有改动时归档不收目录；删除确认框说出 1 个没提交的文件和 1 个没合并的提交，长路径在框里折行；建不成工作树时输入框上
出现提醒、点开有原因、没有 toast。录像和截图在 `~/Desktop/Lyra工作树测试/`。

顺带修掉的：删除确认框打开时侧栏的悬停卡片会盖在它上面（逐 60ms 采样：对话框出现约 420ms 后卡片出现）。行的
菜单和确认框是 React 意义上行的子节点，指针落到确认框的遮罩上，React 算作「进入了这一行」，悬停卡片的计时器就
开始了。现在只认指针真的进到行自己的 DOM 里。

**没做的：**

- 推送、开 PR。
- 选基分支：只记切出时所在的分支。
- 「丢掉工作树里没提交的改动」：`reclaimWorktree` 有 `discardUncommitted`，界面上不给。
- 手机端：这组方法和分支菜单的一样 `remote: false`，没有在手机上验证。
- Windows 只有单测，没在真机上跑过。
