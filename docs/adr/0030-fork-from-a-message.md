# ADR-0030：从一条消息分叉——撤回，做在一份副本上

- 状态：已采纳
- 日期：2026-09-28
- 相关：`packages/core/src/trajectory/fork.ts`（`forkSession`、`forkBeforeMessage`）、`trajectory/replay.ts`（`historyUpTo`）；契约 `sessions.forkBefore`；desktop `electron/ipc/sessions.ts`、`electron/sync-rpc.ts`、`src/store/turn-slice.ts`（`forkFrom`）、`src/features/conversation/UserMessage.tsx`；测试 `core/test/session-fork.test.ts`、`desktop/test/ui/message-fork.test.ts`；探针 `desktop/e2e/session-fork-probe.ts`

## 背景

用户要的是 Claude Code 桌面端那颗「Fork from here」：在自己说过的一句话上点一下，从那里开一个新会话，
这一个保持原样。Lyra 之前只有轨迹检查器里的「从这里分叉」——按日志 `seq` 切，对着的是一条轨迹记录，
在普通对话里够不着。

原来那条分叉路径还有两处缺口，普通对话里用起来就会撞上：

- **只复制消息。** 压缩边界不在消息里，在 `compacted` 事件里。一个压缩过的长对话分叉出去，新会话读回来
  没有边界，下一次请求带着全部原始历史——正是最常需要分叉的那种长对话，被分叉成一个模型接不住的请求。
- **不带 `modelSwitchedAt`。** 中途换过模型的对话，分叉里继承的助手消息还带着旧服务商的句柄（思考签名、
  加密推理），原样交给新模型，整条被拒。

## 决定

1. **语义等于撤回，只是做在副本上。** 新会话装着这条消息之前的全部；这条消息的文字、图片、附件、会话
   引用回到新会话的输入框（与撤回同一个 `draftFromUserMessage`），可以改了再发；原会话一个字不动。
   按钮在撤回、编辑之后、那排最右——Claude Code 放它的位置；提示语与轨迹里的「从这里分叉」同一句。
2. **开在按下的那一屏**（ADR-0023）：先把这一屏的会话请上台，再打开分叉，替换的是这一屏。
3. **跑着的时候也能分叉。** 分叉只读到这条消息为止的日志，正在跑的那一轮不改写它；撤回和编辑照旧要等。
4. **消息用「位置 + 时间戳」认。** 窗口只知道消息在转录里的下标，不知道 `seq`，而下标会漂（窗口先画出了
   日志里还没有的消息）。主进程按下标取，时间戳对不上就按时间戳找；两样都找不到就不分叉——不从错的地方分。
5. **分叉带上压缩和换模型的位置**，轨迹里那个分叉一起受益：
   - `historyUpTo` 走的是 `SessionStore.load` 的那一遍：截断照样生效，压缩事件按当时有几条消息放回原处，
     分叉读回来的边界与原会话在那一刻一模一样。只有那一刻仍然生效的边界保留 `kept`，其余只作分隔线——
     否则一个被撤回退掉的新边界不在了、更早那个旧边界却还带着 `kept`，就会在分叉里复活成边界。
   - `modelSwitchedAt` 取原位置和分叉消息数里小的那个：切点之后才换的模型，分叉继承的每一条都出自旧模型，
     而分叉接着用的是当前模型，所以全部剥掉。
6. **标题跟着界面语言。** 「{title}（分叉）」由渲染进程翻译好交给主进程；手机和桌面同一颗按钮
   （`remote: true`，和 `sessions.fork` 同一个理由：是副本，原会话不动）。

## 没做的

- **分叉进一个新的 worktree**（Claude Code 的 issue #49954 在要这个）。现在分叉和原会话共用同一个工作
  目录，两边都去改文件时会互相踩。
- 轨迹检查器那个分叉的标题仍是 core 默认的中文后缀——它的 `sessions.fork` 没有标题参数，这次没改它的签名。
