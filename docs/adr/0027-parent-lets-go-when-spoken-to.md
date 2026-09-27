# ADR-0027：主会话等子代理时人一开口就放手，子代理在后台跑完、结果送回来

- 状态：已采纳
- 日期：2026-09-26
- 修订：[ADR-0024](0024-sub-agents-stop-at-checkpoints.md) 第 2 条（没写清单的子代理到检查点再给一段）
- 相关：`packages/core/src/runtime/delegation-waits.ts`、`runtime/session.ts`（`submit`、`flushDeliveries`）、`runtime/turn-config.ts`（`spawnSubAgent`、`refreshDispatchGate`）、`runtime/sub-agent.ts`（`admission`、`workingNote`、`planDemand`）、`runtime/sub-agents.ts`（`queued`、`background`、`awaitingApproval`）、`runtime/dispatch-guard.ts`（`acquire`、`concurrencyNote`）、`runtime/continuation.ts`（`planless`）、`runtime/approvals.ts`（`approval_settled`、`rejectWhere`）、`ai/cache-key.ts`、`tools/task.ts`；desktop `store/apply-event.ts`、`store/subAgents.ts`（`awaitingSubAgents`、`settled`）、`features/subagents/SubAgentBar.tsx`、`features/conversation/DeliveryRow.tsx`、`features/conversation/ApprovalOverlay.tsx`、`app/session-scope.tsx`（`useScopedWorking`）

## 背景

用户反馈原话：「四个子智能体为啥不能并行，以及我发送了新的消息，为啥还等待上面的子智能执行完成后才
执行呀」「多个智能体完成，回答竟然不是总结回答，竟然还带有 XX 智能体做了啥这样的回答」「依然卡死 60
轮」「所有的智能体完成任务，竟然这个没有自动消失」「目前我们的缓存命中率很低」。

量的是那场真实会话（`~/.lyra/sessions/63ca3825cb82944e/38630f77…`，四个 review 子代理跑在
`gemini-3.8-flash-high` 上，中转走 OpenAI Responses）：

| 症状 | 量到的 | 根子 |
| --- | --- | --- |
| 四个不并行 | 一轮派一个，四个排成一串 | 用户的并发上限是 1；提示词那句「一次派超过 N 个只会让结果更晚到」被读成「一轮只派一个」 |
| 插话要等 | 一句话等了两分多钟 | `task` 是同步调用，插话只在两轮之间有人取；窗口里排队的消息又要等这一轮收尾 |
| 卡在 60 轮 | 三个 61 轮、61 次调用，**一次并行都没有** | 只读审查者不写清单，检查点上没有判据可用，一刀切 |
| 缓存 76% | 每个子代理开头 3–5 次请求全是 0，中间隔三岔五掉回 0 | 请求里没有 `prompt_cache_key` / `session_id`，中转站的号池随机分账号（sub2api 的 `GenerateSessionHash` 就看这三样） |
| 回答按人头罗列 | 「子智能体 2：……」 | 子代理的报告交回时没有任何话说它是材料 |

## 决定

1. **一起派，排队归闸门。** 并发说明改成「互不依赖的在同一条回复里一起派，多出来的自动排队」。闸门在
   `runSubAgent` 里面等（`admission`）：先以 `queued` 上名单、再等名额，排着的时候也看得见、停得下
   （`acquire(signal)` 离队，停下的会话不会在之后把排着的放进来）。设置一改当场重算宽度
   （`refreshDispatchGate`），不等下一轮。
2. **人一开口，父会话放手。** `task` 的等待包一层 `DelegationWaits.hold`：人说话（插话，不是
   `followUp`）时正在等的派发当场交回「它转到后台了，结果会送到你这里，不要 resume、不要重派」，这一轮
   接着走，下一个回合开头就读到人的话。子代理不受打扰。窗口那一头：名单显示主会话在等子代理时，消息
   直接送进去（不排队），排着的队首也送进去。
3. **后台跑完，结果送回来。** 放了手的跑完后，攒 400ms（前后脚跑完的合成一条），作为一条
   `synthetic` 用户消息回到主会话：`content` 是结果原文套着 `<subagent_result>` 标签，`delivery` 字段
   给界面画成一行「结果已交回」。主会话在跑就插进这一轮，闲着就开一个回合。人按停的不送；整个会话被停
   之后什么都不送。
4. **结果是材料。** `task` 的指引、每份结果末尾、送达消息末尾都说同一件事：回答用户时按问题合并成
   一份，不要逐个转述。
5. **缓存键。** 两条 OpenAI 链的每个请求都带 `prompt_cache_key`（请求体）和 `session_id`（头）：主会话
   用会话 id，子代理用自己的登记 id（续跑也是同一个）。端点点名不认 `prompt_cache_key` 就学会不发
   （`DroppedParam` 的 `cache-key`），头照样带。
6. **子代理怎么干活。** 每个子代理的提示词末尾一段工作说明：每一轮把互不依赖的读取和搜索一起发，
   三步以上记清单，交回的是给父会话的材料。`todo_write` 对所有子代理可用（它是记事本，不是能力）。
7. **检查点宽限（修订 ADR-0024 第 2 条）。** 没写清单就撞上检查点的，再给一段，开头一句「列出剩下的
   步骤接着做，或者现在收尾」；之后按清单有没有往前推判断，跟主会话同一条判据。只给一次。
8. **授权说清是谁。** 子代理的授权请求带 `from`（哪个子代理、什么任务）；主窗口的卡片画它的脸和
   「子 Agent「…」在请求」，名单上它显示「等你授权」。后台子代理的授权不随主会话一轮收尾被收掉；每张
   卡怎么收场都发 `approval_settled`，窗口据此拿走；子代理停下时它还挂着的授权一并收回。
9. **界面收尾。** 输入框上方那一条在「都结束了、这一轮也收尾了」之后自己收起（记录还在，派发卡片一点
   照样翻到它）；后台子代理还在跑时，清单和「继续」不说「停在这一步」。

## 没有做的

- **不把 `task` 改成一直异步。** 大多数时候父会话就是要等结果才能往下做；一直异步是把一轮能做完的事
  拆成两轮，多一次请求、多一段要重读的前缀。只在有人说话时放手。
- **不替用户改并发上限。** 那位用户的上限是 1；单子底下说出「同时最多跑 N 个」，旁边是调整入口。
- **Anthropic 那条链不加缓存键。** 它用显式 `cache_control`；中转站在那条链上按 `metadata.user_id`
  粘账号，格式没验证过，不猜。
- **不做跨重启的后台送达。** 登记簿在内存里；重启之后转到后台的派发卡片按转录里有没有送达来画，没有的
  画成停下。

## 后果

- 真窗口 24/24（`packages/desktop/e2e/subagent-round3-demo.ts`，假模型走真的 Responses 适配器）：四个一起
  派、两个排队；插话 0.8s 得到回答，子代理还在后台跑；两批结果送回、合并；状态条自动收起；授权卡片署名；
  检查点宽限后跑完；主会话 9 个请求同一个键、6 个子代理各一个键、头和请求体一致。
- 核心：放手 / 送达 / 停止后不送（`delegation-detach.test.ts`），排队可叫停 / 授权署名 / 宽限只给一次
  （`sub-agent-queue.test.ts`），两条链的缓存键与学会不发（`cache-key.test.ts`）。

代价：

- 送达多开一轮（只在人插过话时才有）：那一轮的前缀是这场对话自己的，缓存键让它落在同一处。
- `SubAgentStatus` 多了 `queued`；`SubAgentSummary` 多了 `background`、`awaitingApproval`；`UserMessage`
  多了 `delivery`；`ApprovalRequest` 多了 `from`；事件多了 `approval_settled`。
