# ADR-0039：会话级操作——建议新会话由人点了才开始，归档自己等这一轮说完再归

- 状态：已采纳
- 日期：2026-10-13
- 相关：core `runtime/session-ops.ts`（两个工具与 `SESSION_LEVEL_TOOLS`）、`runtime/sub-agent.ts`（摘除）、
  `session/types.ts`（`SessionMeta.spawnedFrom`）；desktop `electron/session-ops.ts`（`archiveAfterTurn`）、
  `electron/session-hub.ts`（注入与观察）、`electron/prompt-input.ts`、`electron/create-session.ts`、
  `src/store/turn-slice.ts`（`startSession`）、`src/features/conversation/SessionSuggestionCard.tsx`；
  测试 `core/test/session-ops.test.ts`、`desktop/test/session-ops.test.ts`、
  `desktop/test/ui/session-suggestion-card.test.ts`；探针 `desktop/e2e/session-ops-demo.ts`；
  指南 [内置能力 › 会话级操作](../guide/capabilities.md#会话级操作)；ADR-0023、ADR-0038

## 背景

用户拿 Claude Code 桌面版做参照：「这个会话发现一个新的点，可以在当前会话创建一个新会话出来去干这件事；
也可以自己归档自己当前的会话。」两件事都是对**对话本身**的操作，不是对工作区的——这是它们和其余工具
最大的区别，下面每一条取舍都从这里来。

## 决定

1. **桌面端宿主工具，不进 core 的内置工具表。** 两个工具的逻辑（参数校验、返回什么）在 core 的工厂
   `createSessionOpsTools(host)` 里，由 `session-hub.ts` 经 `AgentSessionOptions.extraTools` 注入，和浏览器
   工具同一条路。CI 里那个 agent（`agent-cli`）不传 `extraTools`，天然没有：它没有侧栏，也没有人去点卡片。
   放进 `core/src/tools/` 会被 `tool-registry.test.ts` 要求进每个会话的工具表，而那张表 CLI 也用。

2. **`spawn_session` 只提建议，立刻返回，不审批。** 参数是卡片标题（≤60 字，按字数算）、一两句说明、新会话
   的第一条消息（必须自足：文件路径和上下文写全，不引用这个对话）。返回的话写明「什么都还没开始、人点了
   才开始、继续手头的事」——一张在等点击的卡片，从模型那边看和一件正在进行的事没有区别，不说清楚它会等。
   卡片本身就是同意：开不开由人点，模型调用它不花任何东西，所以不再弹一道审批。
   卡片要的三样放在工具结果的 `details` 里，日志原样保存，重开会话卡片还在。

3. **「开始」不切走当前对话。** 抽出 `send` 里建会话的三步（列进侧栏并标成在跑、主进程接下这一轮后换上
   权威的 meta、没接下就标成失败），`send` 和新的 `startSession` 共用；`startSession` 不碰 `activeSessionId`，
   新会话在侧栏里、自己在后台跑，人还在读原来那个对话。目录取提建议那个对话的**项目**：跑在自己工作树里
   的对话 `cwd` 是工作树，项目在 `meta.worktree.project`（ADR-0038）。模型用默认模型，和「新对话」一样。

4. **「已开始」记在新会话身上，不记在卡片身上。** `SessionMeta.spawnedFrom = { sessionId, toolCallId }`，
   建会话时随 `initial` 下去、写进 meta。卡片按「会话列表里有没有一条的 `spawnedFrom` 指着我」判断自己是
   「开始」还是「已开始 · 打开」。会话列表本来就推给每个窗口和手机、重启后从库里读回，所以这个状态不需要
   另一份存储、不需要新的 IPC。比对要连 `sessionId` 一起：分叉出来的对话带着同一个调用 id，它的卡片不该
   说自己已经开过。新字段要过 `prompt-input.ts` 那道逐字段的白名单——漏掉它，字段会在主进程门口被悄悄丢掉
   （同类事故见 `ipc-whitelist-drops-new-fields`），所以有一条测试专门守它。手机传上来的也收：两个 id 不授予
   任何东西，伪造一对最多让某张卡显示成已开始。
   × 只是这台机器上收起来（localStorage 按调用 id 记），不写进会话。

5. **`archive_session` 不能在工具里当场归档。** 平常那条归档路（`sessions:setArchived`）先 `disposeSession`，
   而 dispose 会 `abort()`——砍掉的正是还在等这个工具返回的那一轮，它的最后一条结果落不进去，收尾报的是
   `aborted`。所以工具只交一张条子给宿主、返回 `terminate: true`（`agent/loop.ts` 读它，工具一返回这一轮就
   结束，模型不会被再问一句，说完的话要写在调用之前）；主进程在 `broadcast` 里看见这个会话的 `agent_end`
   之后才 `setArchived`，界面经 `session-changes.ts` 自己离开被归档的当前会话，手机经 session_changed 同步。
   放掉会话（dispose）要等它**闲下来**：`agent_end` 之后 `running` 还要真一段——收尾那次「刚才那句算不算
   纠正」的判断、排在这一轮后面的话——这时候 dispose 一样是 abort。等的时候人要是把它取消归档了，就不放。
   这一轮以 `aborted`/`error` 收尾就不归档，条子作废：停止键是更新的那句话，出错了要留在人看得见的地方。
   不审批：归档可以在 设置 › 已归档的聊天 里恢复。

6. **子代理拿不到这两个工具，无论定义怎么写。** 内置 `general` 是 `tools: "*"`，会拿到会话的全部工具（含
   `extraTools`）。子代理不是一个对话：它的 `ctx.sessionId` 是 `<父id>:sub:<8位>`；它提的建议画不出来（它的
   调用在它自己的转录里）；它要归档，归掉的是派它来的那个人的对话。所以 `runSubAgent` 按名字摘掉，`tools`
   里点名要也不给；`archive_session` 自己再认一次 `:sub:`，挡住别的路子把工具放回去。

7. **卡片问输入框问的那个问题，用自己的标题，说出它开的会话在做什么。** 和工作树（ADR-0038）合并时补上：
   - 「开始」旁边是输入框上那个 ⑂ 开关（`WorktreeToggle`，移进 `ui/inputs/`：两个域都要它，放进任何一个的正门都会经 dock 绕成环），项目是 Git
     仓库时才有，从同一个设置起步，开始以后消失。对应 Claude 卡片上的 Start with worktree。
   - 新会话的名字是卡片标题（`initial.title`，白名单按六十字截）。首条消息是写给模型的说明，截前六十个字
     放进侧栏读起来像半句话。它记作定下的名字（`titleSetByUser`）：人点「开始」就是采用了它；不这样，第一
     轮一开始就会按那段说明把它改掉（`resumePendingPrompt`）。人照样可以改名。
   - 开始以后按钮说那个会话在做什么：进行中、已完成、没跑完，看过之后回到「已开始」。读的是侧栏行首用的
     同一份 `activity`。人要找它开出去的会话时，看的就是这张卡，而不是一条盖在正在读的东西上的提示条。

## 没做的

- **后台会话跑完时的「…已完成」提示条**：应用原有的通知，卡片开出的会话跑完也会弹。卡片已经说了它的状态，
  这条提示条要不要为它让路，牵涉所有后台会话的通知，留给人定。
- **归档那一轮后面还排着话**：人在这一轮跑的时候又说了一句「做完再说」的话，它会在已归档的会话里接着跑完
  （dispose 等它），界面已经离开了。主进程看不见渲染进程的队列，也看不见会话私有的待发列表；真碰到再说。
- **手机上点「开始」**：走同一份界面、同一条 `sessions.create`，没有在手机上单独验过。

## 后果

- 两个工具出现在桌面端每个会话的系统提示工具表里（各一行），描述里写明什么时候不该用。
- `send` 少了三段手写的状态更新，换成和 `startSession` 共用的三个函数；行为不变，由既有的发送测试守着。
