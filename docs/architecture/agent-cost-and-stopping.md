# Agent 效率与可靠性执行清单

> Lyra 自己跑 agent 循环时，会白花 token、会突然停下、会原地打转。这份文档是**为解决这三件事
> 准备的执行清单**：问题、目标、13 条待办、每条的验收标准，以及一个可重跑的度量脚本。
>
> 规矩只有一条：**每一项都必须由 `pnpm audit:sessions` 在真实会话上量出来的数字支撑，改完再量
> 一次对照。** 这条规矩是买来的——见第〇节那两次事故。



## 2026-09-16 实施结果与剩余验收

这节记录当前实现；后面的调查基线、收益猜测与原始清单保留作对照，不能当作修复后的实测结果。
对应 issue 仍在进行中：确定的缺陷已修复，长期成本与完成质量目标尚未满足验收条件。

| 项目 | 当前行为与决策 | 验证或剩余项 |
| --- | --- | --- |
| A1 结果老化 | `AgedToolPruner` 每 20 轮批量裁超过 8192 的结果；超过约 32k 字符节省的爆炸结果不等待批次。覆盖式 read / 同参去重见 `stale-results.ts`。`worthPruning` 按净收益：节省大于后缀即可改写热前缀。一次打断从最早可负担的改写点起裁完。skill 不裁，原日志不变 | 单测覆盖覆盖读、窗口包含、失败编辑、同参去重、净收益、爆炸结果不等待 20 轮。`audit:prune` 2026-09-16 23:00：老化+覆盖 52.29%，合并 grep 闸门 **53.93%**（25.86B → 11.92B 字符·请求 ≈ 7389M → 3404M token·轮） |
| A2 grep | 单行 2,000、总输出 12,000。窗口开在匹配附近，不是行首；省略处写下 `char_offset`，`read` 按这个地址翻页。rg 与 fallback 共用闸门，不拆 surrogate | 巨型单行两条路径 red/green；历史最大结果从 12,853,666 降至 11,999 字符 |
| A3 bash | 保持 60,000 字符上限；历史平均约 1,451 tokens，证据指向携带寿命而非普遍单次输出过大 | 不为追求数字降低可用信息量 |
| A4 skill | 完整注入文本（含参数与限制）SHA256 去重；每次执行前与模型实际历史同步，压缩丢失正文后可再加载；限制仍更新 | `skill-allowed-tools.test.ts` |
| A5 压缩 | 修正 `measureTotal` 漏计 cacheWrite；**裁决保留 0.8 比例**。20k 剩余缓冲在 32k 窗口会于 37% 触发、在 200k 窗口又晚于 80%。`compactionTriggerTokens` 把这条写死 | `compaction.test.ts`：200k→160k，32k→25600 |
| B1/B2 重复 | 保留 10 次兜底阈值；完整输出摘要替代前 400 字采样；成功 write/edit 清空精确/意图表，失败不清。切图/像素测距按活动族计数，写新的测距脚本不重置，纠正 5 次、10 次停 | `repetition.test.ts`；没有用编辑次数或 Todo 推断停机 |
| C1 归因 | **纠正原报告：运行时原已持久化所有 `agent_end.reason`，此前 audit 只数模型 `stopReason`，混淆了两层语义。** audit 现直接统计 runtime 事件与覆盖率 | 五种原因落盘测试；旧数据仅 71/266 个会话带事件，不能补造历史原因 |
| C2 通知 | max_turns 空清单退出、总续跑耗尽均有可见通知 | `resume.test.ts` |
| C3 deadline | 不引入无任务时长证据的自动 deadline；网络等待、编译和真实工作都可能很长 | 保留为未完成实验，不用新停止规则换取更低账单 |
| C4 用量 | 运行行标明本轮 fresh tokens 与缓存占比；会话卡片标明全程用量。分母为 input + cacheRead + cacheWrite，不含 output；续跑与子 agent 保留同一口径 | `turn-meter.test.ts` 与真实 Electron fixture |
| E1 并行 | 对实际 Gemini 服务做 8 次有界对照请求，独立文件场景均一次 3 个 read，依赖场景均先读 manifest；额外示例没有增益，因此不改生产提示词 | 简单场景证明能力，不足以证明真实复杂任务达到 ≥2.0 调用/轮；该目标未完成 |
| E2 shell 改道 | 无 shell 组合、变量、glob、升级或后台语义的简单 cat/ls/grep 在同轮执行内置工具；尊重开关、原 bash 与目标工具的 hooks/限制，保留 call id | `translated-tools.test.ts`，不再为这类确定改道支付一次纠错请求 |
| F1/F2 事后审计 | 增加编辑次数 P90 与样本数；F2 把需求重述从挫败词里拆出来单独计数，仍是关键词代理 | `audit:sessions` 现报挫败率与重述率；未经人工校准，不是任务成功率 |

额外修复：未完成 Todo 不再强制正文回复继续。空正文无工具最多纠正 3 次，工具调用不补充额度；
明确取消旧目标可用 `control_main({action:"pause",discardPlan:true})`，等待在途工具结束后清单清空并落盘，
旧派发任务不可被 Continue 恢复。普通暂停保留清单，不把未完成步骤伪装成完成。

### 可复跑的证据

- `pnpm audit:sessions`：2026-09-16 21:05 重跑 268 个有助手消息会话，27,132 回合；历史费用 $172.99、
  cacheRead 91.9%、关键词挫败代理 17/837=2.0%。修复不会改写过去的账单或用户发言，这些数字不表示修复无效，也不表示未来收益已验证。
- `pnpm audit:prune`：282 份日志、27,838 个请求；原携带 25,863,489,662 字符·请求，
  单独老化+覆盖后 12,340,319,558（52.29%），单独 grep 后 20,243,156,977（21.73%），
  合并后 11,915,060,980（下降 **53.93%**，约 7389M → 3404M token·轮）。
  这是生产裁剪策略的工具文本重放，未模拟模型行为、压缩或账单；历史发票不会改写。
- `pnpm probe:parallel`：真实模型服务实验，使用合成路径、不执行模型工具、不发送用户任务内容，
  默认 8 次请求；会产生少量模型费用。没有将本地 SSE UI fixture 当作真实模型收益证据。
- 回归入口：`node scripts/audit-regression.mjs` 中 `ISSUE-cost-loop`、`ISSUE-question`、`ISSUE-ui`。

**生产策略重放已过携带 ≥50%**：合并裁剪把工具结果携带从约 7389M 降到 3404M token·轮（≤3600M）。
按 3.5 字/token，这与第 1 节的 token·轮是同一口径。历史发票与 `audit:sessions` 读到的已落盘用量不会变。

**仍未通过**：复杂任务平均 ≥2.0 调用/轮（E1，Gemini 对照未证明）、修复后真实缓存与完成质量要用新任务样本验证、A5 比例/固定缓冲未裁决。不引入无证据的 deadline，不改写历史。旧文中的“15 分钟变 3 分钟”仍未证实。

### 关联架构文档索引

在动手实施本清单前，先阅读以下既有架构设计，避免破坏既定设计假设：
- [conversation-history.md](conversation-history.md)：会话历史持久化、消息信封结构、`toolCallId` 配对与投影机制。
- [retry-policy.md](retry-policy.md)：网络请求错误分类、指纹提取与退避重试策略。
- [interaction-quality.md](interaction-quality.md)：交互反馈、执行状态可见性与用户干预设计。
- [session-notifications.md](session-notifications.md)：长任务完成、中断与错误通知机制。
- [session-notifications.md](session-notifications.md)：长任务完成、中断与错误通知机制。
- [testing.md](testing.md)：运行时与 UI 测试规范、测试夹具约束。
- 对应立项在本地 `docs/issue/`（不进仓库）：2026-09-16-1600-01。
---

### 术语表

为避免理解歧义，本文档中使用的核心量化概念定义如下：
- **携带成本（Carried Cost）/ token·轮**：一条工具结果进入上下文后，在本次会话后续轮次中被重复发送的累计代价。计算公式为：`结果体积 (token) × 其后剩余的助手回合数 (after)`。
- **一次性体积 vs 携带成本**：一次性体积是工具当次产生的 token 数；携带成本是它对后续上下文窗口与账单的生命周期总压力。优化核心是压低产生得早且体积巨大的结果。
- **工具指纹（Tool Fingerprint）**：工具名与其调用参数的规范序列化哈希（`toolName:JSON.stringify(sorted(args))`），用于识别模型是否在用完全一致的输入重复调用。
- **续跑链（Continuation Chain）**：当模型单次请求达到轮次上限（如 200 轮）或单次任务未完结时，运行时自动注入合成提示词启动的后续回合链路（最多 10 次续跑）。
- **空转轮**：模型在某一轮没有输出有效文字内容、没有修改任何工作区文件，且所发出的工具调用指纹全部在之前见过的回合。
- **本轮 vs 全程（Meter 统计口径）**：
  - **本轮（Turn-level）**：从最后一条用户发言（含自动注入的真实续跑点）起累加的消耗量。
  - **全程（Session-level）**：整个会话文件自第一条消息起的历史总累加。
- **前缀缓存（Prompt Cache）**：LLM 服务商提供的 KV 缓存机制。只要请求消息序列从第 0 个字节起保持稳定前缀，已缓存部分即可按低价（约未命中单价的 1/10）计费。改写历史消息会导致该点之后的所有前缀缓存失效。

---

## 要解决什么

三类现象，都是使用者在真实工作中反复撞上的。原话摘录：

**一、原地打转，烧掉几小时得不出结果**

> 「我这个任务一直在执行，似乎死循环了……一个简单检查原因的需求，竟然出现了严重的死循环问题，
> 数个小时，一个简单查询都无法得出结果。有很多地方会造成 token 的巨量浪费。」

有据可查的最坏一例：会话 `86ff1d52` 跑了 648 轮、55M+ token、约 $15.51，其中 586/588 轮正文
是 0 个字。

**二、突然停止，而且不说为什么**

> 「现在的问题更加严重，就是执行执行者，就突然中断了。而且完全不知道原因。」
>
> 「就算花费 100 刀 10000 万刀，也不应该突然停止任务的。」

**三、慢**

> 「我要的是任务能高效完成迅速完成。」

### 这三件事背后的原则

来自 [AGENTS.md](../../AGENTS.md) 的第一原则：

**一、准确完成用户要的那件事。二、在做到第一条的前提下，更快、更省 token。**

**顺序不能反。** 第二条有个诱人的作弊方式——少做、早停、干脆不做，账单立刻好看，但那是把第一条
丢了去换第二条。本文档第〇节记的两次事故都是这么错的。**合法的省只有一种：同样的活，更少的
字节。** A 组每一条都标了「不改变模型拿到的信息」，就是这个意思。

---

## 目标

做完清单后应达到的状态。每一条都能用 `pnpm audit:sessions` 直接验证，不需要主观判断。
| # | 指标 | 现在（2026-09-16 基线） | 目标 | 在哪看 |
|---|---|---|---|---|
| 1 | 总携带成本 | 7,326M token·轮 | **降 ≥50%** | audit 第 1 节 |
| 2 | 单条最贵的结果 | 281M token·轮 | **≤20M** | audit 第 2 节 |
| 3 | grep 平均每次 | 3,010 token | **≤1,500** | audit 第 1 节 |
| 4 | 任何工具的单条结果 | grep 无上限（实测最高 495K token） | **都有字符闸门** | audit 第 2 节榜首 |
| 5 | 终止可归因 | 原 audit 漏读 runtime 结束事件（已纠正） | **100% 可从 jsonl 读出原因** | audit 第 6 节 |
| 6 | **用户挫败率** | 1.9%（822 条发言里 16 条在说「上一轮没做好」） | **不上升**（守卫线） | audit 第 9 节 |
| 7 | **代码单文件高频抖动均值** | 顺利组 4.4 次 vs 挫败组 7.4 次 | **不上升**（纯观测） | audit 第 9 节 |
| 8 | 并行度 | 1.06 调用/轮，并行率 3.1% | **≥2.0 调用/轮** | audit 第 7 节 |
| 9 | 被规则挡回、白费一轮的调用 | 44 次 | **0** | audit 第 7 节 |
| 10 | cacheRead 占输入侧 | 92.0% | **不下降**（下降=缓存被打断） | audit 第 8 节 |

第 6 条是**第一原则的守卫**：前五条都在省，它负责证明省的过程没有伤到「准确完成」。
**任何一次改动让挫败率显著上升，那次改动就是失败的，无论省了多少 token。**
（注：原设想的「Todo 遗留率」已被数据证伪，顺利会话遗留率同样达 26.9%，不作为质量评判指标，见「已证伪的猜想」）。
**任何一次改动让挫败率显著上升，那次改动就是失败的，无论省了多少 token。**

---

## 这份文档怎么用

**给接手的人 / 审核的人：**

- **所有数字都可复现。** 来源是本机 `~/.lyra/sessions` 下的真实会话（258 个 / 25,451 个助手
  回合），跑 `pnpm audit:sessions` 重新生成。**换一台机器数字会变**，绝对值没有跨机可比性，
  要对照就前后两次都在同一台机器上跑。
- **区分三种断言强度**，本文尽量标注：
  - **实测** —— 脚本在全量会话上跑出来的，或直接读源码确认的
  - **推断** —— 从实测数据合理外推，但没有直接证据
  - **未验证** —— 猜想，标注为待办
- **「已证伪的猜想」那张表不要重走。** 里面每一条都是量过之后发现是错的，包括两条是本文作者
  自己提出又自己推翻的。
- **诚实的空白清单在最后一节。** 哪些没做、为什么没做，都写在那里。审核时优先看它。

**环境前提：**

```bash
node --version    # 需要 ≥ 22（脚本用 --experimental-strip-types 直接跑 .ts）
pnpm install
pnpm audit:sessions          # 人读的报告
pnpm audit:sessions --json   # 机读，用于前后对照
```

会话数据在 `~/.lyra/sessions/<projectId>/<sessionId>.jsonl`，每行一个事件，
`{type:"message", message:{role, content, ...}}` 是主要形态。工具调用在 assistant 消息的
`content[]` 里（`type:"toolCall"`，带 `id`），结果是单独一行 `role:"toolResult"`，
**靠 `toolCallId` 配对，不要靠数组下标**——两边数量经常对不上。

### 本项目的关键坐标

清单里每一条都指向这些文件，先认路：

| 关心什么 | 文件 |
|---|---|
| 循环主体、`finish()` 的 5 种终止原因、溢出恢复 | [packages/core/src/agent/loop.ts](../../packages/core/src/agent/loop.ts) |
| 重复检测（`REPEAT_WARN` / `REPEAT_STOP` / `INTENT_WARN`） | [packages/core/src/agent/repetition.ts](../../packages/core/src/agent/repetition.ts) |
| 超大结果裁剪（`pruneToolResults` / `stripOversizedToolResults`） | [packages/core/src/runtime/prune.ts](../../packages/core/src/runtime/prune.ts) |
| 压缩（`THRESHOLD` 等 5 个常量、`filesSeen`） | [packages/core/src/runtime/compaction.ts](../../packages/core/src/runtime/compaction.ts) |
| 续跑（`MAX_CONTINUATIONS` / `STALLED_CONTINUATIONS`） | [packages/core/src/runtime/continuation.ts](../../packages/core/src/runtime/continuation.ts) |
| 整条续跑链共用的那只重复计数表 | [packages/core/src/runtime/turn-config.ts](../../packages/core/src/runtime/turn-config.ts) |
| 终止时写给用户的话 | [packages/core/src/runtime/session-turn.ts](../../packages/core/src/runtime/session-turn.ts) |
| 三个大头工具的输出闸门 | [grep.ts](../../packages/core/src/tools/grep.ts) / [bash.ts](../../packages/core/src/tools/bash.ts) / [read.ts](../../packages/core/src/tools/read.ts) |
| 界面怎么解释终止原因 | [packages/desktop/src/store/apply-event.ts](../../packages/desktop/src/store/apply-event.ts) |
| 本文所有数字的来源 | [scripts/session-audit.ts](../../scripts/session-audit.ts) |

跑测试与门禁：

```bash
node --experimental-strip-types --test packages/core/test/<name>.test.ts   # 单个文件
pnpm check          # lint + check:links + style + i18n + typecheck + arch + test
node scripts/audit-regression.mjs   # 每条历史修复的守卫，逐条跑
```

**已知的门禁噪音**：`knip` 有 4 个未接线导出（并行会话的附件菜单相关），与本清单无关。

---

## 〇、先读这个：两次拍脑袋的代价

改这套东西之前，先知道前两次是怎么错的。两次的错法一模一样：**凭直觉认定一个信号能区分「打转」
和「埋头干活」，没量就上线。**

| | 做了什么 | 后果 | 错在哪 |
|---|---|---|---|
| 一 | 「连着 60 轮不说话就停」 | 上线八小时掐断一次正常发版：63 次工具调用、63 个互不相同的指纹、改了 6 个文件 | 标定阈值时用的是 deepseek-flash（每轮都写字），而那次跑的是 gemini-3.8-flash-high（天生只调工具不写正文）。**拿一个模型的习惯定了一条对所有模型生效的硬停规则。** |
| 二 | 「花到 $5 就在对话里提醒，之后翻倍再提醒」 | 纯噪音，被要求全部拆除 | 人要的是任务跑完，不是被念账单。花销属于设置页。 |

后来把「空转轮」（没说话 + 没改动 + 全是见过的指纹）在全部会话上量了一遍：**烧掉 $15 的病态会话
最长只连续空转 8 轮，而一个完全正常的会话连续空转过 36 轮，另一个正常跑到 2376 轮。**

结论写死在 [repetition.ts](../../packages/core/src/agent/repetition.ts) 顶部：**打转和干活，在这些可
观测量上分不开。** 不要再发明「自动判断它是不是在打转」的启发式——
[deepseek-harness 的设计笔记明确把「无进展启发式」和「卡住模式检测」列为不做](#七外部参考)，
理由和我们量出来的一致。

### 由此得到的两条铁律

1. **省 token 只能从「同样的工作、更少的字节」下手，不能从「猜它在瞎忙、把它停掉」下手。**
   下面 A 组的每一条都不改变模型能拿到什么信息，只改变这些信息占多大地方。
2. **任何停止都必须留下可归因的原因。** 见 C 组。

---

## 一、基线（2026-09-16 实测，258 个真实会话 / 25,451 个助手回合）

```
pnpm audit:sessions
```

### 钱花在哪

一条工具结果的真实代价不是它自己的体积，而是 **体积 × 它之后还要被重新发送的轮数**（token·轮）。
一条 495K token 的结果出现在第 30 轮、会话跑到第 408 轮，就是 187M token·轮。

| 工具 | 次数 | 一次性 token | 平均每次 | 携带成本 | 占比 |
|---|---:|---:|---:|---:|---:|
| bash | 9,823 | 14,474,983 | 1,474 | 3,114M | **46.2%** |
| grep | 3,486 | 10,286,690 | 2,951 | 1,884M | **27.9%** |
| read | 7,442 | 6,158,435 | 828 | 1,530M | **22.7%** |
| skill | 86 | 533,705 | 6,206 | 113M | 1.7% |
| 其余全部 | — | — | — | ~106M | 1.5% |

**三个工具占 96.8%。** 优化任何其他东西都是在小数点后面做文章。

### 决定性的一条

| 量 | 值 |
|---|---|
| 超过裁剪线（8,192 字符）的结果 | **6.6%** 的条数 |
| 它们占携带成本 | **65.1%** |
| 单条最贵 | grep，**3,672K token**（12.8 MB，就是那条"12 MB 的消息"） |
| 次贵的一批 | 6 条 grep，各约 **495K token**，分别被携带 209–378 轮 |

### 时间花在哪（和钱是两件事）

**并行度：总体 1.07 个调用/轮，并行率 3.2%**（24,854 个有工具的回合）。一个回合只发一个命令，
就意味着 N 个命令要等 N 次模型思考——工具本身往往只花几十秒，人却等十几分钟。

按模型拆开差两个数量级，而**占 85% 轮次的两个 gemini 并行率接近零**：

| 模型 | 轮次占比 | 每轮调用 | 并行率 |
|---|---:|---:|---:|
| `gemini-3.8-flash-high` | 49% | 1.01 | **0.5%** |
| `gemini-3.7-flash-high` | 36% | 1.01 | **0.3%** |
| `grok-4.6` | 5% | 1.71 | 24.9% |
| `command/deepseek-v4-flash` | 0.1% | 2.35 | **82.4%** |

详见 E 组，那里有一个 15.8 分钟里只有 1.3 分钟在跑命令的活案例。

### 缓存与真实花销

| 量 | 值 |
|---|---|
| cacheRead | 2,801,462,534（**占输入侧 92.0%**） |
| 未命中的 input | 244,079,764 |
| cacheWrite | **0** —— 两条 openai 链路都不上报，**不能用作验收指标** |
| 输出 | 4,612,351 |
| 记录在案的花销合计 | **$133.23** |

**92% 命中缓存这件事会改变结论**：携带成本（token·轮）是排序用的相对指标，不是钱。
A1 省 50.6% 的携带量，换算成钱约 25%。

### 活案例：一小时、$18.64、根因是一行 JSON

会话 `afdc7f6d`（2026-09-16，Lyra 项目自己的一个 UI 动画任务）。使用者看到的是「跑了 59 分钟、
10.1M tokens、任务还在 1/5」。**它同时印证了 A1、A2，值得完整读一遍。**

| 指标 | 数值 | 依据与存档 |
|---|---|---|
| 助手轮次 | 291（会话后续继续运行至 557 轮） | [case-afdc7f6d-grep-blowup.json](data/case-afdc7f6d-grep-blowup.json) |
| 真实用户发言 | **3 条**（第 291 轮前；后续人工干预 1 条） | 同上，其余均为自动注入 |
| 历时 | 91 分钟 | 同上 |
| 累计输入侧 | **128.5M token**（全会话累计 215M+） | 同上 |
| 记录花销 | **$18.64**（全会话终局 $31.22） | 同上 |
| 工具结果合计 | 仅 **923K token** | 同上 |

> 完整脱敏证据见仓库存档：`docs/architecture/data/case-afdc7f6d-grep-blowup.json`。

**128.5M 的输入，工具结果却只有 923K。** 差 139 倍——钱不是花在「拿到了多少新信息」上，
是花在「同样的东西被重发了多少遍」上。

根因是**第 3 轮的一条 grep**：

```
参数： {"path":"packages", "description":"pattern:The user wants to merge all local code|..."}
结果： 1,730,054 字符（494K token），200 行
其中： 最长一行 1,706,940 字符 —— 占 98.7%
那一行：core/src/catalog/model-catalog.json:1:{"schema":1,...}
```

[model-catalog.json](../../packages/core/src/catalog/model-catalog.json) 是一个 **1,706,907 字节
的单行 JSON**（仓库里唯一一个这种文件，但一个就够了）。grep 的 `MAX_MATCHES = 200` 只限行数、
不限字符，于是整行吐出。

上下文曲线随之断崖：**第 3 轮 27,500 token → 第 6 轮 651,721 token**，之后 288 轮一直带着它，
峰值单轮 876,776 token。

**两条待办各自能消掉多少：**

- **A2**（grep 加单行上限）：这条结果从 494K token 降到约 7K，**省 98.6%**，而且是在它产生的
  那一刻就省下来——根本不会进上下文。
- **A1**（20 轮后裁剪）：494K × 288 轮 ≈ 142M token·轮 → 约 11M，**省 92%**。

**顺带暴露的两件事**（都没有单独立条目，但值得知道）：

1. 模型把 pattern 写进了 `description` 字段，`pattern` 字段根本没填。grep.ts 有个
   `extractGrepPattern()` 专门从 description 里往外抠——**这个兜底存在本身就说明模型经常填错**。
2. 291 轮里只有 3 条真实用户发言，其余是 Lyra 注入的「（自动继续）上一条回复是空的」3 次、
   「（自动提示）你已经用同样的参数调用 grep/read 多次」2 次。**自动纠正确实在工作**，
   但完全空回复只有 4 轮（1.4%），所以它不是这次的主要成本。

### 几条已经证伪的猜想（别再走一遍）

| 猜想 | 实测 | 结论 |
|---|---|---|
| `REPEAT_STOP=10` 在防死循环 | 258 个会话触发 **0 次**；实际见过的最高重复次数是 **6** | 这条停止线是**死代码** |
| 重复检测省了不少 token | 省 157K / 32,089K = **0.5%** | 整套机制的收益在小数点后 |
| read 反复重读浪费严重 | 60.4% 是"这个 path 之前读过"（改过再读是正常的），**参数一字不差的只有 1.8%**，115K token | 不是大头 |
| 模型不写 todo → 撞 200 轮上限即静默 break | ≥200 轮的 47 个会话里，todo_write 为 0 的有 **0 个** | 这条路径在真实数据上没发生过 |
| `parallel_tool_calls` 参数导致并行率低 | 真实端点四格对照，带不带都返回 3 个调用 | 与该参数无关，是模型行为 |
| 「跑了十几分钟没结果」= 死循环 | 案例 `1a9a4c2e`：120 轮里重复检测 **0 警告**、工具指纹全唯一，工具总耗时 1.3 分钟 / 会话 15.8 分钟 | **是串行，不是循环**。见 E1 |
| 「长会话 = 做得差」 | ≥200 轮的会话平均用户挫败率 **6.7%**，<50 轮的 **5.2%** | 差距很小，轮次多不等于质量差 |
| `cacheWrite` 可以用来验收缓存是否被打断 | 实测**恒为 0**，两条 openai 链路都不上报 | 只能看 `cacheRead` 占比 |
| 「提示词里加一句要求并行」能提高并行率 | `system.ts:132` **早就有这句话**，gemini 并行率仍是 0.3% | 这个方案**已被否定**，见 E1 |
| 「跑一小时 $18」是模型在死循环 | 案例 `afdc7f6d`：根因是第 3 轮一条 grep 撞上 1.7MB 单行 JSON，之后 288 轮都带着它 | **是一条结果的体积，不是循环** |
| 空回复自动续跑是成本大头 | 同一案例：完全空回复只有 4 轮（1.4%），自动续跑注入 3 次 | 机制在工作，但不是主要成本 |
| **Todo 遗留未完成 = 质量差/半途而废** | 两套挫败词表各算一次：**3/10 挫败 vs 28/104 顺利**（差异不显著）与 **2/24 挫败 vs 29/90 顺利**（方向相反）。**分子只有 2~3 个会话，两次结论都不稳** | **已证伪，但不是「无区分度」那种证伪**——是「没有任何证据支持这个方向，且样本不足以定论」。结果一样：严禁因 Todo 未勾满而拦截或提问，那会给 27%~32% 的正常会话制造多余阻碍 |
| **改同一文件 ≥3 次 = 代码打转，应注入反思提醒** | 实测顺利会话中同文件改动 ≥3 次比例高达 **71.0%**（加功能/修 bug/补测试动 3 次是常态）；注入提醒等于给 70%+ 的正常开发制造干扰噪音 | **已证伪**。严禁在运行时注入「频繁修改请反思」提醒；仅保留为事后 audit 观测指标（挫败组均值 7.4 次 vs 顺利组 4.4 次） |
---
## 二、执行清单

### 自动化干预准入铁闸（硬性门禁）

> **铁律**：任何提议**自动打断任务、向模型注入提醒、或拦截人类退出**的条目，必须先用 `scripts/session-audit.ts` 证明该信号在「挫败会话」与「顺利会话」之间具备**显著区分度**，并把两组对照数字白纸黑字写进证据。
>
> 凡是无法有效区分正常干活与病态打转的信号（如上述 Todo 遗留、改动 3 次），**一律只允许作为事后观测度量，严禁在运行时注入模型或打断人类**。第〇节的两次事故与上面的证伪猜想都是因为违背了这条原则。
>
> **给出区分度数字时，必须同时写明分组口径和分子大小。** 「30% vs 27%」在分子只有 3 个会话时
> 毫无意义——Todo 那条就是这么翻车的，两套词表给出了相反的方向。

### A 组 · 输出体积 —— 不改变模型拿到的信息，只改变它占多大地方

- [ ] **A1. 把超大结果的裁剪从「压缩时」提前到「产生 N 轮后」** ← 单条收益最大
      **现状**：[prune.ts](../../packages/core/src/runtime/prune.ts) 的 `pruneToolResults` 已经存在且
      参数合理（`PRUNE_THRESHOLD_CHARS = 8192` → 头 4096 + 尾 1024）。问题**纯粹是时机**：它只在
      [compaction.ts:310](../../packages/core/src/runtime/compaction.ts) 的压缩流程里跑，而压缩要等上
      下文用到 `THRESHOLD = 0.8`。在那之前，那条 495K token 的结果每一轮都全额重发。
      **证据**：`pnpm audit:sessions` 第 1、2、5 节。第 5 节直接把每条超大结果交给**生产的**
      `pruneToolResults` 裁一遍，量出裁剪后的真实大小，再按不同延迟算总账——

      | N（延迟轮数） | 0 | 5 | 12 | **20** | 40 | 80 |
      |---|---:|---:|---:|---:|---:|---:|
      | 省下携带成本 | 57.6% | 56.2% | 54.4% | **52.7%** | 48.6% | 41.2% |

      **曲线极平是这条的关键**：可以选一个保守得不可能影响模型工作的 N，仍拿到绝大部分收益。
      （这张表会随本机会话变化，改动前后各跑一次拿自己的数字，别引用这里的。）
      **落地位置（已经找好了，不用再调查）**：[loop.ts:250](../../packages/core/src/agent/loop.ts)。
      那里已经有一个**每轮都跑的轻量清理** `dropUneventful(messages, { lastRequestAt })`，就在
      `config.compact` 之前。它的注释里已经写明了这套分层：

      > Different from the pass inside compaction, which runs when the window is nearly full and
      > takes the cache hit because the alternative is a model call.

      **也就是说「每轮轻量清理 vs 窗口满时重压缩」这个分层已经存在**，A1 要做的是往轻量那一层
      加一件事，不是新建一层。
      **而且缓存问题已经有现成的解法**：[prune.ts](../../packages/core/src/runtime/prune.ts) 的
      `worthPruning(messages, index, timing)` 就是为此写的——它只在两种情况下放行：
      缓存已经过期（`CACHE_TTL_MS = 5 分钟`），或者改写点下面的内容很少
      （`CHEAP_SUFFIX_CHARS = 32_000`，「短尾巴重发很便宜，长尾巴等于把省下的又还回去」）。
      **A1 应当复用 `worthPruning`，而不是自己发明批量周期。** 这比「每 M 轮裁一次」更准：
      它判断的是这次改写到底会打断多少缓存，而不是拿轮数当代理指标。

      **改**：取 `N = 20`，对「产生于 20 轮之前、且超过 8192 字符」的工具结果套用已有的
      `pruneToolResults`，并用 `worthPruning` 决定这一次到底动不动手。
      **不新写裁剪逻辑，也不新写缓存判断**——两份都已经在 `prune.ts` 里。

      ⚠️ **但必须批量、低频地做，不能每轮都做——这是这一条最容易踩死的地方。**
      Lyra 大量依赖 prompt cache（本机累计 cacheRead **335M token**），而缓存是**前缀匹配**的：
      改写第 T−20 轮的一条消息，从那里往后的整段前缀全部失效，要重新 prefill。
      oh-my-pi 的 `append-only-context.ts` 正是为这件事存在的——"messages only grow; prior turns
      are never re-serialized"——它的注释里记着一次真实事故（issue #3406）：早期版本在任何一条
      消息被改写时清空整个日志，导致**每一轮都要重新 prefill 约 40k token**。
      它现在的做法是「保留最长字节稳定前缀，只重发分歧点之后的部分」。

      **算得过来的账**：省下的是**每一轮的 cacheRead**（一条 495K 裁成 5K，之后每轮都省），
      亏掉的是**偶发的一次 cacheWrite**。超大结果只有 1,736 条 / 25,456 轮 ≈ 每 15 轮才出现
      一条，所以触发频率本就不高。**但如果实现成「每轮扫一遍、够老就裁」，就会变成每轮触发一次
      失效**，那笔账立刻反过来。
      **所以**：裁剪要攒着一起做（每 M 轮一次，或与压缩对齐但把阈值从 0.8 降下来），一次把所有
      够老的都裁掉，让缓存**一次失效、之后长期受益**。
      **风险与缓解**：模型想回看 20 轮前的完整输出 → 保留的头 4096 字符通常就是答案所在，且
      `recall` 可以重新取；裁剪处要留一句说明它被裁过、去哪儿找。
      **不要做的**：不要按「总量超标」动态决定裁谁——那等于把压缩的复杂度搬进热路径。
      **⚠️ 收益要打折：省下的 token 量 ≠ 省下的钱【推断】。** 实测 `cacheRead` 占输入侧 **91.9%**，
      而缓存命中的单价约为未命中的十分之一。
      「省 50%~52% 的携带量」换算成钱大约是 **25% 上下**（注意：这是基于前缀缓存不被破坏的推断；
      若裁剪过于频繁破坏缓存，不仅不省反而倒贴）。
      **以 audit 第 8 节的 `$` 为准**（当前基线：记录在案的花销合计 **$160.37**），
      不要拿第 1 节的 token·轮 去估钱——那是用来排序「先优化谁」的相对指标。

      **验收看 `cacheRead` 占比，不要看 `cacheWrite`。** `cacheWrite` 实测**恒为 0**：
      `openai-chat-completions` 与 `openai-responses` 两条链路都不上报它
      （见 [openai-chat-completions.ts:550](../../packages/core/src/ai/openai-chat-completions.ts)
      直接写死 `cacheWrite = 0`），所以它**不能用作验收指标**。
      唯一可靠的缓存守卫是：**改动后 `cacheRead` 占比明显下降 = 前缀被反复打断**，回去改。

      **【回滚方案】**：
      在 `loop.ts` 中移除针对 20 轮前消息的裁剪钩子，完全退回由 `compaction.ts` 在窗口满 80% 时单一触发剪枝。
      回滚成本仅为 1 处调用移除，无持久化副作用。
- [x] **A2. grep 加字符闸门，且长行必须可寻址** ← 闸门已落地；行首截断会把命中藏起来，已改成匹配窗口 + `char_offset`
      **证据（原）**：[grep.ts](../../packages/core/src/tools/grep.ts) 曾经只有 `MAX_MATCHES = 200`，单行无上限。
      [model-catalog.json](../../packages/core/src/catalog/model-catalog.json) 是 1.7MB **单行** JSON，一次命中就被整行带进上下文。
      **现在**：单行 2000 字 + 总输出 12 000 字。窗口开在**匹配附近**，不是行首；省略处写下 `char_offset`，`read` 按这个地址翻页。`read` / `outline` / `bash` 不再把长行砍成行首并当成看过整行。grep 用 ripgrep `--json` 的匹配偏移，不二次搜索。
      对比：bash 有 [`MAX_OUTPUT_CHARS = 60_000`](../../packages/core/src/tools/bash.ts)。

      **不是假想的风险，是本仓库里正在发生的事**（详见上面「活案例」）：
      [model-catalog.json](../../packages/core/src/catalog/model-catalog.json) 是 1,706,907 字节的
      **单行** JSON。一次 grep 命中它，200 行的结果里这一行占了 98.7%，整条 494K token，
      然后被携带 288 轮。全量榜上那几条 ~495K 的 grep 是同一个成因。

      **改**：**单行上限**（截断超长行，标注截了多少字符）+ **总字符上限**。
      单行上限是主要的那一半——`MAX_MATCHES` 已经管住了行数，失控的一直是单行长度。
      截断要落在行边界，并说清「还有 N 个匹配没显示，缩小范围或加 path」——一个悄悄截断的搜索
      会让模型以为结果就这些。
      **验**：重跑 audit，grep 的「平均每次」应从 2,951 token 明显下降；第 2 节单条最贵榜上不应
      再出现 ~495K 的 grep。
      **顺带**：模型常把 pattern 填进 `description` 字段（活案例里就是），`extractGrepPattern()`
      是为此存在的兜底。这个兜底应该保留，但值得在结果里说一句「你的 pattern 是从 description
      里抠出来的」，否则模型不知道自己填错了。

      **【回滚方案】**：
      若单行截断导致模型读取代码片段时丢失必要字段（例如 JSON 被截断导致语法解析失败）：
      在 `grep.ts` 中恢复原有未截断输出，或者将单行上限阈值临时放宽（如从 2,000 字符放宽至 10,000 字符）。
      回滚仅涉及 `packages/core/src/tools/grep.ts` 单文件。
- [ ] **A3. 复核 bash 的 60,000 字符上限是否仍然合适**
      **证据**：bash 占携带成本 46.2%，平均每次 1,474 token（远低于上限），但存在 17K token 的
      单条被携带 2,280 轮的案例（39M token·轮）。
      **改**：上限本身可能不用动——A1 落地后，超过 8,192 字符的 bash 输出 20 轮后就会被裁。
      **先做 A1，再用数据决定 A3 要不要做。** 不要同时改两个，否则归因不了。

      **【回滚方案】**：
      若调低 bash 上限导致编译器输出或复杂 diff 截断过甚引发误判，在 `packages/core/src/tools/bash.ts` 中还原 `MAX_OUTPUT_CHARS = 60_000`。
- [ ] **A4. skill 注入的重复**
      **证据**：86 次调用、平均 6,206 token/次、携带 113M。同一个 skill 在一个会话里被注入多次，
      每次全文。
      **改**：同会话内同名 skill 第二次起只回一句「已在上文注入过」。
      **优先级低**：只占 1.7%。排在 A1/A2 之后，且要先确认 A1 是否已经顺带解决。

      **【回滚方案】**：
      若去重导致模型遗忘 skill 内包含的细化约束规则，在 `packages/core/src/tools/skill.ts` 中恢复全文注入逻辑。
- [ ] **A5. 压缩触发阈值：比例 vs 固定缓冲（先实测，别急着改）**
      **现状**：[compaction.ts:285](../../packages/core/src/runtime/compaction.ts)
      `used < model.contextWindow * THRESHOLD`，`THRESHOLD = 0.8`。
      **两个参考项目分成两派，不要以为我们是错的**：
      - opencode `overflow.ts`：**预留固定缓冲**，`usable = limit.input − min(20_000, maxOutputTokens)`。
        上下文越大越省——1M 窗口只留几万，而比例法要空出 200K。
      - deepseek-harness：**默认阈值比例就是 `0.8`**，和我们一模一样（保留历史比例 `0.16`、
        摘要 `maxTokens: 8192`、`compactionRetries: 1`）。
      **所以这条不是 bug，是一个需要数据裁决的选择。** 值得先量：我们实际用的模型里，
      contextWindow 有多大、0.8 空出来的那部分是不是真的浪费。
      **可以先抄的一点**：deepseek-harness 有 `modelPolicies`，**按精确 provider/model 覆盖**
      这些默认值。比「全局换一个数」稳妥得多——大窗口模型放宽，小窗口模型保持。
      **另一处值得核对**：opencode 把 `cache.read + cache.write` 也算进占用量，我们的 `used`
      是否也算了？没算的话压缩会偏晚。
      **依赖**：A1 做完后上下文占用会大幅下降，压缩频率自然降低，**这条的收益要在 A1 之后重估**。

      **【回滚方案】**：
      若固定缓冲导致小上下文窗口模型（如 32k/64k）过晚压缩导致溢出，在 `compaction.ts` 中还原 `used < model.contextWindow * 0.8` 的固定比例判断。
### B 组 · 死代码清理 —— 不是优化，是别让下一个人误以为它在工作

- [ ] **B1. `exhausted()` / `REPEAT_STOP` 的定位要重新写清楚**
      **证据**：258 个会话触发 0 次，实际最高重复只到 6，够不到 10。
      **不要做的**：**不要为了让它触发而调低阈值。** 阈值从 6 放宽到 10 正是因为 6 会误伤，
      调回去是走回头路。
      **要做的**：在 [repetition.ts](../../packages/core/src/agent/repetition.ts) 注释里写明"这条线
      在 N 个会话上从未触发，它是兜底而非主力防线"，免得下一个人以为死循环归它管。
      真正省 token 的是 `REPEAT_WARN=3` 那条「第 N 次，不再重贴」的纠正路径——虽然也只有 0.5%。

      **【回滚方案】**：仅涉及注释说明，无需回滚。
- [ ] **B2. `RepetitionWatch` 的三张表永不重置**
      **证据**：`counts` / `intents` / `warned` 只增不减，而
      [turn-config.ts:143](../../packages/core/src/runtime/turn-config.ts) 让整条续跑链（最多 10 次
      续跑 × 200 轮）共用一只表。
      **当前无害**（够不到线），**但语义是错的**：一个跑了 1,500 轮的会话，早期攒下的计数会一直
      压在后面的正常工作上。
      **参照**：oh-my-pi 的 `MAX_PAUSED_TURN_CONTINUATIONS` / `MAX_SOFT_TOOL_ESCALATIONS`
      都**遇到真实进展就重置**（"Resets whenever a turn carries tool calls"）。
      **改**：在有真实进展的回合（出现新指纹 / 文件被改动）衰减或重置计数。

      **【回滚方案】**：
      若重置计数器导致偶发死循环漏判，还原 `turn-config.ts` 中跨续跑表引用的单向累加逻辑。
### C 组 · 停止与归因 —— 回答「完全不知道原因」

- [x] **C1. 停止原因可查询（原根因已纠正）**
      `SessionLog` 原本就在 jsonl 持久化 `agent_end` 事件，五种 reason 均可写入。
      漏失的是 audit 对 runtime 事件的读取；模型的 `stopReason` 不能替代循环的停止原因。
      现补事件分布、历史覆盖率与五种原因落盘测试。旧日志没有事件时明确报缺失，不猜测补齐。

- [ ] **C2. `max_turns` 静默收尾**
      **证据**：[continuation.ts](../../packages/core/src/runtime/continuation.ts) 的 `max_turns` 分支
      里，`unfinished.length === 0` 直接 `break`，**这一路没有任何 notify**。
      对比：`stalled` 有提示（[session-turn.ts:162](../../packages/core/src/runtime/session-turn.ts)），
      「步数用尽继续执行」有提示，「连着两轮没推进」有提示。
      **注意**：清单为空时 break 通常是**正确**的（活干完了）。所以这里不是改逻辑，是**补一句话**。
      **不要做的**：不要因为"可能还有活"就无条件续跑——那会把一次正常结束变成一次空转。

      **【回滚方案】**：
      若补齐的提示导致自动化测试中产生多余的 notice 事件，在 `continuation.ts` 中撤销提示文本注入。
- [ ] **C3. 考虑用墙钟 deadline 替代/补充轮数上限**
      **证据 / 参照**：oh-my-pi 的 `agentLoop` **根本没有 maxTurns 的概念**，终止条件只有外部中断、
      **墙钟 deadline**、模型自己的 stopReason，外加两个针对特定病态的小计数器。
      我们是 `DEFAULT_MAX_TURNS = 200` × `MAX_CONTINUATIONS = 10`。
      **为什么值得考虑**：200 轮对 grok（1.70 调用/轮）和 gemini-flash（1.01 调用/轮）意味着完全
      不同的工作量，而墙钟对所有模型是同一把尺。
      **这一条要先做实验再动手**，不要直接改。它牵动续跑链的每一处。

      **【回滚方案】**：
      若墙钟判定在网络波动或长时间编译时误杀任务，撤销墙钟定时器，恢复轮数上限 `DEFAULT_MAX_TURNS`。
### E 组 · 并行度 —— 这一组治的是「慢」，不是「贵」

**前四组都在省钱，这一组省的是人等待的时间。** 两者不冲突，但对使用者的体感，这一组更直接。

- [ ] **E1. 一个回合只发一个工具调用** ← 「十几分钟还没结果」的头号原因
      **证据（全量 24,854 个有工具的回合）**：总体 **1.07 个/轮，并行率 3.2%**。按模型拆开，
      差距到了两个数量级：

      | 模型 | 有工具的轮次 | 每轮调用 | 并行率 |
      |---|---:|---:|---:|
      | `gemini-3.8-flash-high` | 12,131（49%） | 1.01 | **0.5%** |
      | `gemini-3.7-flash-high` | 8,845（36%） | 1.01 | **0.3%** |
      | `deepseek-v4-flash` | 2,054 | 1.20 | 12.4% |
      | `grok-4.6` | 1,265 | 1.71 | **24.9%** |
      | `command/deepseek-v4-flash` | 34 | 2.35 | **82.4%** |

      **两个 gemini 占了 85% 的轮次，并行率接近零。** 同一套代码、同一批工具，换个模型差 165 倍。

      **一个活的案例**（会话 `1a9a4c2e`，2026-09-16，任务是「把三个仓库的代码都合并到 main」）：

      | 指标 | 数值 | 依据与存档 |
      |---|---|---|
      | 回合数 | 120（其中 119 轮只发 1 个命令，1 轮发 4 个） | [case-1a9a4c2e-serialization.json](data/case-1a9a4c2e-serialization.json) |
      | 工具调用总耗时 | **1.45 分钟**（87.4 秒） | 同上，累加工具内部执行真实耗时 |
      | 人等了（墙钟耗时） | **16.4 分钟** | 同上，R1 至 R120 时间跨度 |
      | 工具耗时占比 | **8.8%**（模型思考与往返等待占 **91.2%**） | 同上 |
      | 重复检测 | 警告 **0 次**，工具指纹全部唯一（最高 ×1） | 同上 |

      > 完整脱敏证据见仓库存档：`docs/architecture/data/case-1a9a4c2e-serialization.json`。

      **91.2% 的时间在等模型逐轮思考与网络往返，不是在等命令执行。** 它没有打转——每条命令都在查真东西
      （三个仓库的分支状态、worktree、PR 列表、main↔dev 的 diff），只是一轮一轮串着来。
      按 5 个/轮估算：123 次调用只需 25 轮，理论推断时间可大幅缩减（**注：这是推断上限**，见后文强度标注）。
      全量同理：26,486 次调用现在用掉 24,854 轮，5 个/轮只需 5,298 轮（**省 78% 的轮次**）。
      **两条已经证伪的原因，动手前务必先读：**

      1. **不是 `parallel_tool_calls` 参数。** 真实端点四格对照过，带不带这个参数，同一个模型都
         返回 3 个调用。
      2. **不是「提示词里没说」。** [system.ts:132](../../packages/core/src/prompt/system.ts)
         **已经有这句话**，而且措辞已经很准确：

         > "Issue independent tool calls in one response so they run in parallel. Serialize only
         > when one call's output feeds the next."

         **这句话在，gemini 的并行率还是 0.3%。** 所以「在提示词里加一句要求并行」这个方案
         **已经被实践否定了**——别再加一遍。

      **剩下的方向**（都未验证，需要做实验）：
      - **按模型分发不同提示**：对并行率低的模型加强措辞、给出具体示例（「检查三个仓库的状态
        应当是一个回合里的三个 bash 调用」），并行率本来就高的模型不动。
      - **在工具描述里给批量示例**，而不是只在系统提示里说——模型读工具 schema 比读通用指令更认真。
      - **换个思路：接受某些模型就是不并行**，转而在**模型推荐**上做文章。数据支持这条：
        `command/deepseek-v4-flash` 是 2.35 个/轮，`grok-4.6` 是 1.71，而两个 gemini 是 1.01。
        「多仓库并行调查」这类任务推荐前者，可能比改提示词更快见效。
      **验收必须同时看用户挫败率（目标表第 6 条）不上升**——这正是第一原则的守卫要拦的东西。

      **【回滚方案】**：
      若催并行导致模型把具有前后依赖关系的调用挤进同一轮（如未读取文件就直接执行替换），立即从提示词中移除强调并行的措辞，还原 `packages/core/src/prompt/system.ts:132` 的基线用语。
      **验收必须同时看用户挫败率（目标表第 6 条）不上升**——这正是第一原则的守卫要拦的东西。

- [ ] **E2. 被规则挡回去的调用，白费一整轮**
      **证据**：全量 **40 次**；案例会话 `1a9a4c2e` 里 4 次。模型发 `cat` / `grep` / `ls` 的 shell
      命令，被规则拦下并回一句「用 `read` 读文件——它带行号……」。模型下一轮才改用工具。
      **一次拦截 = 两个回合做一件事**，而每个回合都是一次完整的模型请求。
      **改**：这些是**确定性可翻译**的——`cat <file>` 就是 `read`，`ls <dir>` 就是 `ls` 工具。
      与其拒绝再等一轮，不如**直接代为执行并在结果里说明「这次替你用 read 做了，下次直接用」**。
      **优先级**：只占 0.16% 的调用，收益小。但它是纯浪费，且改法明确。

      **【回滚方案】**：
      若自动转换在带管道、重定向或复杂 shell 参数的命令上产生误判，直接撤销重定向逻辑，恢复原有的错误拦截与文字提示。
- [ ] **C4. 同一屏上两个「tokens」是不同的量，界面没说**
      **现象**：使用者在一张截图里同时看到「10.3M tokens」（会话流底部）和「用量 13.4M」
      （会话悬停卡片），差 3.1M，据此判断「显示的是错误信息」。
      **查下来不是算错**，两处用的是同一个
      [`freshTokens`](../../packages/core/src/tokens.ts)（`input + cacheWrite + output`），
      差的是口径：

      | 位置 | 含义 | 实测验证 |
      |---|---|---|
      | 会话流底部 | **当前这一轮**（从最后一条用户发言起） | 从该发言起累加 = 11.1M（截图时 10.3M） |
      | 悬停卡片 | **整个会话累计** | 全会话累加 = 14.1M（截图时 13.4M） |

      底部那个 `meter` 是轮级的——[apply-event.ts](../../packages/desktop/src/store/apply-event.ts)
      里 `agent_end` 会冻结它，`retry` 靠 `carried` 才算同一轮。**两个数都是对的，只是没人告诉
      使用者它们量的不是同一件事。**
      **还有第二层落差**：`freshTokens` **不含 `cacheRead`**。同一会话真实流过 **137.2M** token
      （其中 cacheRead 123M），界面显示 14M，**差近 10 倍**。卡片旁边的「缓存 90%」是在说这件事，
      底部那行连这个提示都没有。
      **改**：给两处各加一个限定词（本轮 / 全程），底部那行补上缓存比例。
      **不要做的**：不要把 `cacheRead` 直接加进显示的总数——它的单价是十分之一，加进去会让人
      以为花了十倍的钱。真正要传达的是「流过多少」和「其中多少是便宜的」两件事。
      **为什么值得做**：这份文档的目标之一是让人能看出正在发生什么。使用者正是因为这两个数字
      对不上，才怀疑系统出了问题——而当时系统真正的问题在别处（见「活案例」）。
      **一个看不懂的仪表会让人把注意力放到错的地方。**

      **【回滚方案】**：
      若界面文案调整引发多语言翻译缺失或测试快照失败，还原 `packages/desktop/src/features/conversation/TurnProcess.tsx` 等组件的原有展示格式。
### D 组 · 结构性改造 —— 先做实验，不要直接改

- [ ] **D1. Ralph 模式（全新上下文迭代）值不值得**
      **参照**：deepseek-harness 的 Ralph——每个 Round 创建**全新子 agent**、不继承对话上下文，
      跨 Round 状态只靠共享工作区 + 一份**有界结构化报告**（`maxHandoffChars = 16384`，
      **过大时报告失败而不是静默截断**）。
      **为什么可能有用**：那个 648 轮 / 55M token / $15.51 的会话，如果每 N 轮重置上下文、只带一份
      16KB 报告，账单会低一个数量级。
      **为什么先别做**：这是架构级改动，而 A1 一条就能省一半。**先把 A 组做完，重新量，再判断
      还需不需要它。**

- [ ] **D2. 不要做的事（来自外部项目的明确结论）**
      - ✗ 通用 loop 抽象 ✗ 独立的模型评估器 ✗ 聚合预算（token / 货币 / 耗时）
      - ✗ 目标反思器 ✗ 自动无进展启发式 ✗ 卡住模式检测
      deepseek-harness 把这些明确列为**不做**，其中「无进展启发式」「卡住模式检测」两条与我们第〇节
      量出来的结论完全一致。Claude Code 有「每轮后用小模型评估器」，deepseek-harness **有意不抄**，
      理由是评估器的输入、工具访问、确定性检查、提供方选择、隔离与权限需要单独设计。

### F 组 · 完成质量 —— 只观测，不干预

针对原清单中「质量差」缺少具体条目的缺口，遵循**「纯事后观测，严禁无区分度运行时打断」**原则，建立以下两条观测与审计指标：

**这条原则是买来的，不是谨慎。** 本组最初提过第三条（「结束前若有未完成 todo 就强制确认」），
一分组就塌了：**没有任何证据支持「遗留 todo = 质量差」**，两套算法甚至给出相反的方向
（一套 3/10 vs 28/104，另一套 2/24 vs 29/90）。那条待办因此撤销，Todo 遗留率也从第 9 节移除。

**为什么两套算法对不上，比结论本身更值得记住**：挫败组的分子只有 **2~3 个会话**，加减一个样本
就摆动 4~10 个百分点；而「哪些会话算挫败」取决于一张**未经校准的正则词表**，换一张表分组就变
（两张表试过，只有「不对」一个词重合，挫败会话数从 10 个变成 24 个）。
**这不是 Todo 这一条的问题，是整个 F 组分组依据的问题，见「已知空白」。**

**任何新增条目在提议运行时干预之前，必须先给出该信号在两组之间的区分度数字，并说明分组口径
和分子大小**，否则就是第〇节那两次事故的第三次。

- [ ] **F1. 代码反复编辑抖动度（Code Thrashing Index）连续观测**
      **证据**：实测挫败会话的单文件最大编辑次数均值为 **7.4 次**，顺利会话为 **4.4 次**。两者存在连续分布差异，但在二元阈值（≥3次）上区分度不足（顺利会话同样有 71% 发生 ≥3 次修改，加功能/修 bug/补测试属正常节奏）。
      **改**：在 `scripts/session-audit.ts` 中将二元阈值改为**连续分布度量（输出单文件最大编辑次数的均值与 P90）**。**严禁在运行时注入「你修改频繁请反思」的提醒**，避免对 70%+ 的正常研发过程制造干扰。此指标仅用于体检报告追踪。
      **验**：audit 第 9 节连续输出均值，改动不引发挫败率上升。
      **【回滚方案】**：仅影响统计脚本，无运行时副作用。

- [ ] **F2. 需求重述与挫败语义提取自动化审计**
      **证据**：audit 第 9 节实测当前挫败信号占比为 1.9%（822 条真实输入中 16 条触发正则）。
      **改**：作为事后复盘与质量守卫红线，在 `pnpm audit:sessions` 中持续追踪挫败率变动趋势。**不把挫败识别做成实时的自动干预**（防止猜错打断）。
      **验**：audit 第 9 节挫败信号被精准归因，在 A 组或 E 组优化实施后，挫败率保持 ≤2.0% 不恶化。
      **【回滚方案】**：仅涉及统计与报告，无运行时回滚成本。

---

## 三、怎么反复检查

### 每一项改动的固定流程

```bash
# 1. 改之前，存一份基线
pnpm audit:sessions --json > /tmp/before.json

# 2. 改，并补上守卫测试（见第四节）

# 3. 改之后，同一台机器、同一批会话，再量一次
pnpm audit:sessions --json > /tmp/after.json
diff <(jq -S . /tmp/before.json) <(jq -S . /tmp/after.json)
```

**前后两次必须是同一台机器的同一批会话**——这个脚本读的是 `~/.lyra/sessions` 下的真实记录，
不同机器之间绝对值没有可比性。

**作者当时的那一份存在 [data/session-audit-baseline.json](data/session-audit-baseline.json)。**
它不是给你直接对照用的（你的机器数字不同），而是让你判断：自己跑出来的**量级和比例**是否与
它一致。若某一项差一个数量级，那不是数据漂移，是这份文档过时了或者哪里错了——优先查那一项。

### 每次都要问的七个问题

1. **省下的量对得上预期吗？** A1 预期省约 50% 携带量（换算成钱约 25%）。差一个数量级说明改错
   了地方。
2. **有没有哪条闸门从「从不触发」变成「频繁触发」？** 第 4 节的 `wouldStop` 从 0 变成非 0 是红灯。
3. **回合结束的原因分布变了吗？** 第 6 节的 `aborted` / `error` 占比上升 = 改出问题了。
4. **单条最贵榜的头部换人了吗？** 换了说明上一条生效了，该量下一个。
5. **模型的行为变了吗？** 调用次数、平均每次体积——如果模型开始更频繁地重读，说明裁得太狠。
6. **`cacheRead` 占比掉了吗？**（第 8 节，基线 92.0%）掉了就是前缀缓存被打断，多半是把裁剪
   写成了「每轮改写历史」。**注意 `cacheWrite` 恒为 0，看它没用。**
7. **并行度动了吗？**（第 7 节）做 E 组时它该上升；做其他组时它**不该变**——变了说明你顺手
   改到了提示词，那是另一个变量，会污染这次的归因。

### 每季度重跑一次

数据会随着使用漂移。上面所有「已证伪的猜想」都有保质期，**重跑一次比相信一个半年前的结论便宜**。

---

## 四、怎么测试

### 三层，缺一层都不算测过

| 层 | 测什么 | 怎么跑 |
|---|---|---|
| **单元** | 裁剪/截断的边界：刚好 8192、8193、空结果、全是长行、多字节字符不能从中间截断 | `node --experimental-strip-types --test packages/core/test/<name>.test.ts` |
| **接线守卫** | 这个函数**真的被调用了**——「代码在、功能不在」在这个项目里出现过十六次 | 见下 |
| **真实数据重放** | 在 258 个真实会话上重放，看总量和分布 | `scripts/session-audit.ts` |

### 接线守卫怎么写

单元测试只能证明函数本身对。它证明不了有人调它。写一条读源码的守卫：

```ts
// 反例：正则里的 [^)]* 会被嵌套括号截断，踩过。按行匹配。
const source = readFileSync("packages/core/src/runtime/<file>.ts", "utf8");
assert.ok(
  source.split("\n").some((line) => line.includes("pruneToolResults")),
  "裁剪没有接进请求组装——单测全绿也没用",
);
```

同样的手法也用于**防止拆掉的东西被加回来**：

```ts
assert.ok(!/SILENT_STOP/.test(source), "第〇节那条规则不许回来");
```

### 测试栈的既有坑

- 测试用 `node:test` + `--experimental-strip-types`；desktop 用 tsx + happy-dom
- **DOM 节点别交给 `assert.equal`**——失败时会卡死整个文件且不报是哪条，用 `assert.ok(!el)`
- **快照里的模板字符串反引号要转义**
- **`mount()` 是 async，别忘了 await**
- **单测别和真窗口探针同时跑**——成片失败且每条 800ms 是 CPU 竞争，不是你改坏了


### 测试夹具（Fixtures）的构建方法

验证长会话（如 A1 的延迟 N 轮裁剪、C1 的 200 轮终止落盘）不可能每次都人工跑几小时真会话。
必须使用确定的、轻量的合成会话生成夹具：

```ts
/**
 * 生成包含指定轮数与超大工具结果的合成会话日志，用于单元与基准测试。
 * 存放路径：packages/core/test/fixtures/synthetic-long-session.ts
 */
export function buildSyntheticSession(options: {
  rounds: number;
  injectOversizedAtRound?: number;
  oversizedChars?: number;
}): Message[] {
  const messages: Message[] = [
    { role: "user", content: [{ type: "text", text: "Task start" }], timestamp: 1000 }
  ];
  for (let r = 1; r <= options.rounds; r++) {
    const callId = `call_${r}`;
    const isBig = r === options.injectOversizedAtRound;
    messages.push({
      role: "assistant",
      content: [{ type: "toolCall", id: callId, name: "grep", arguments: { pattern: "test" } }],
      stopReason: "toolUse",
      timestamp: 1000 + r * 2000
    });
    messages.push({
      role: "toolResult",
      toolCallId: callId,
      toolName: "grep",
      content: [{
        type: "text",
        text: isBig
          ? "x".repeat(options.oversizedChars ?? 200_000)
          : `Normal match result at round ${r}`
      }],
      timestamp: 1000 + r * 2000 + 500
    });
  }
  return messages;
}
```

**跑法**：
```bash
# 在 packages/core/test/prune-e2e.test.ts 中直接调用 buildSyntheticSession({ rounds: 40, injectOversizedAtRound: 5 })
node --experimental-strip-types --test packages/core/test/prune-e2e.test.ts
```
---

## 五、怎么验证

**单测绿 ≠ 用户的问题解决了。** 验证要回到最初的三类现象：

| 现象 | 验证方式 | 通过标准 |
|---|---|---|
| 白花 token | audit 前后对照 | 携带成本下降幅度 ≥ 预期的一半；三大工具占比结构无异常变化 |
| 完成质量差 | 拿一个真实的复杂任务跑完整流程 | 模型没有因为信息被裁而反复重读同一个文件（audit 第 3 节的「一字不差」占比不应上升） |
| 突然停止 | 新会话的终止记录 | 每一次终止都能从 jsonl 里读出结构化原因（C1） |

### 全量门禁

```bash
pnpm check
```

= lint + check:links + style + i18n + typecheck + arch + test。
当前 knip 已通过；新增只读重放与模型探针脚本均在 package.json 登记真实命令入口。

### 回归守卫

```bash
node scripts/audit-regression.mjs
```

把每一条修复和证明它还在的那个东西写成一张表，逐条跑。
**这份清单里每完成一项，就往那张表里加一行。** 一条没有守卫的修复等于没修。

---

## 六、怎么算做完

一项打勾必须同时满足**五条**，缺一条都不算：

1. **有实测数字支撑动机**——不是「看起来应该更快」，是 audit 里的某个数。
2. **有单元测试覆盖边界**——至少包含空、刚好在线上、刚好过线、异常形状四种。
3. **有接线守卫**——证明它真的被调用，不只是被导出。
4. **改完重新量过**——前后 audit 对照，收益对得上预期，且第三节的五个问题都是绿的。
5. **注释里写清楚为什么是这个数**——阈值、延迟轮数、上限，每一个都要说明它是怎么定出来的，
   以及**改动它会破坏什么**。第〇节那两次事故的根源都是「一个没人知道怎么来的数字」。

### 顺序

**两条独立的线，治的不是同一个病：**

- **A 线治「贵」**：A1（省约 25% 的钱）→ A2 → 视情况 A3/A4/A5
- **E 线治「慢」**：E1（120 轮 → 25 轮，15 分钟 → 3 分钟）→ E2

**建议先走 E 线的 E1**，理由是：改的是提示词，不动核心逻辑，回滚只要删掉几句话；而使用者抱怨
的「十几分钟还没结果」正是它。A1 收益大但改的是请求组装的热路径，值得在更谨慎的状态下做。

**但 E1 有个前置条件**：它的风险是催并行会让模型把有依赖的步骤挤进一轮，而拦住这件事的守卫
是「用户挫败率不上升」（目标表第 6 条），**那个指标目前还没进 audit**（见已知空白第 1、2 条）。
**所以真正的第一步是把挫败率指标做进脚本**，否则 E1 没有验收依据。

完整顺序：

```
A2  →  重新量  →  挫败率指标进 audit  →  A1  →  重新量  →  E1（需先做实验）→  C1 → C2 → E2 → B1/B2
                                                                  ↑
                                                  之后再判断 A3/A4/A5/C3/D1
```

**A2 排第一**，因为它改动最小（给 grep 加个单行上限）、实证最硬（活案例里一行 JSON 吃掉 494K
token）、且不碰任何缓存或循环逻辑——做完立刻能在 audit 第 2 节看见效果。**先拿一个确定的胜利，
再去动热路径。**

**E1 往后挪了**，因为它原本的主方案（在提示词里要求并行）**已经被证伪**——那句话早就在
`system.ts:132`，而 gemini 的并行率仍是 0.3%。它现在需要先做实验，不再是「改几句话」那么轻。

一次只改一样，每次都量。**别在拿到新数字之前就规划下一步**——E1 做完之后，轮次少了，
携带成本会跟着降，A1 的收益要重估。

---

## 七、外部参考

以下结论来自**实际下载并阅读**源码/设计笔记，不是从文档摘要或记忆来的。标注了每一份的精确
坐标，接手的人可以自己拉下来核对。

### 仓库坐标与获取方式

| 项目 | GitHub | 默认分支 |
|---|---|---|
| oh-my-pi | https://github.com/can1357/oh-my-pi | `main` |
| deepseek-harness | https://github.com/deepseek-ai/deepseek-harness | **`master`** |
| opencode | https://github.com/anomalyco/opencode | **`dev`** |

**后两个的默认分支不是 `main`，用错分支一律 404。** opencode 同名仓库有好几个，认准
`anomalyco/opencode`（另一个 `opencode-ai/opencode` 是不同项目）。

```bash
git clone --depth 1 https://github.com/can1357/oh-my-pi.git
git clone --depth 1 --branch master https://github.com/deepseek-ai/deepseek-harness.git
git clone --depth 1 --branch dev https://github.com/anomalyco/opencode.git
```

读过的文件，精确路径：

| 文件 | 大小 | 本文引用处 |
|---|---|---|
| oh-my-pi `packages/agent/src/agent-loop.ts` | 3,545 行 | C3、B2 |
| oh-my-pi `packages/agent/src/append-only-context.ts` | 374 行 | **A1（必读）** |
| deepseek-harness `.agents/notes/implemented/feature/2026-07-16-harness-level-loop.zh.md` | 129 行 | C1、D1、D2 |
| deepseek-harness `.agents/notes/implemented/architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.zh.md` | 61 行 | A1、A5 |
| opencode `packages/opencode/src/session/overflow.ts` | 1 KB | A5 |

不想克隆整个仓库时，单文件和列目录：

```bash
# raw 地址 = raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>
curl -sO https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/agent/src/append-only-context.ts
curl -s https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/session/overflow.ts

# deepseek-harness 的笔记散在 .agents/notes/{implemented,proposed,archived,rejected}/<类别>/ 下，
# 共 1,026 份中文笔记。用递归树一次列全再筛，比逐层 contents 快得多：
curl -s "https://api.github.com/repos/deepseek-ai/deepseek-harness/git/trees/master?recursive=1" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>JSON.parse(d).tree
      .filter(x=>/\.agents\/notes\/.*\.zh\.md$/.test(x.path) && /goal|compact|overflow|loop/i.test(x.path))
      .forEach(x=>console.log(x.size, x.path)))'
```

**关于「pi」**：`can1357/oh-my-pi` 是一个 monorepo，`packages/` 下有 `agent`、`ai`、
`coding-agent`、`snapcompact`、`mnemopi`、`wire` 等。源码里的 `@oh-my-pi/pi-ai` 指的是其中的
`packages/ai`。所以「pi」和「oh-my-pi」**不是两个独立项目**，找 pi 的实现就在这个仓库里。
`snapcompact` 和 `mnemopi` 两个包看名字与压缩/记忆相关，**尚未读过**。

### oh-my-pi — `packages/agent/src/agent-loop.ts`（3,545 行）

- **没有 maxTurns/maxSteps 的概念。** 终止条件只有：外部 abort、**墙钟 deadline**、模型自己的
  stopReason。`stepCounter` 只用于遥测上报。
- 只有两个针对具体病态的小计数器，且**都会因真实进展而重置**：
  - `MAX_PAUSED_TURN_CONTINUATIONS = 8`（连续 `pause_turn` 无工具调用的重采样上限，
    "Resets whenever a turn carries tool calls"）
  - `MAX_SOFT_TOOL_ESCALATIONS = 3`（强制 toolChoice 的升级上限，"purely defensive"）
- `unpairedToolCallTail()`：续跑靠检测「尾部助手消息有未配对的工具调用」，而不是靠状态机。
- **对我们的启示**：C3（墙钟 vs 轮数）、B2（遇进展重置）。

### deepseek-harness — 设计笔记 `loop.zh.md` / `compaction.zh.md`

- 层级：同会话 `Goal → Goal Round → 轮次 → 步骤`；全新 agent `Ralph Run → Ralph Round → 全新子
  agent 轮次 → 步骤`。
- `defaultMaxGoalRounds = 256`（**只计已接纳的** Goal Round）；`blockedAfterConsecutiveRounds = 3`。
- 持久阶段只有 `active` / `paused` / `blocked` / `complete`。阻塞必须带 `GoalBlockReason`：
  稳定的 kebab-case `code` + 人类可读 `message`。`usage-limited` / `round-limit` / `queue-failed`
  都是**原因代码**而非生命周期阶段。
- 激活态 `armed` / `disarmed` **永不持久化**——重开会话绝不自行开始工作。
- Ralph：每 Round 全新子 agent、不继承对话上下文、`maxHandoffChars = 16384`，
  **过大时报告失败而不是静默截断**。
- **明确不做**：通用 loop 抽象、独立评估器、聚合预算、目标反思器、无进展启发式、卡住模式检测。
- 「外部产品只是比较对象，不是兼容目标。」
- **对我们的启示**：C1（结构化终止原因）、D1（Ralph）、D2（不做清单）。

### deepseek-harness — 「调用后压缩压力与上下文溢出恢复」（61 行，全文读过）

`.agents/notes/implemented/architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.zh.md`

**压缩流程和我们几乎一样**，顺序写得更清楚：

> 「压力达到条件后，可选的 `ctx.toolResultPruner` 会改写当前表层中过大的工具结果，……再通过
> 同一个 meter 重新计量；**若压力已降至安全水平则跳过模型调用**，否则从已剪枝表层选择范围并
> 生成摘要。」

对应我们 [compaction.ts:310-326](../../packages/core/src/runtime/compaction.ts)：先 `pruneToolResults`，
够了就直接返回、不调模型。**这块是对齐的。**

默认值：阈值比例 **`0.8`**（和我们相同）、保留历史 `0.16`、摘要 `maxTokens: 8192`、
`compactionRetries: 1`。另有 `modelPolicies` 可按精确 provider/model 覆盖（见 A5）。

**溢出恢复这条路径，以及其中防死循环的关键设计：**

- 适配器把提供方的上下文超限错误规范化为 `CONTEXT_WINDOW_EXCEEDED`
- 溢出路径**不要求容量元数据**，绕过常规压力阈值，先剪枝再尝试一次摘要
- `maxOverflowRetries` 默认 **`1`**
- **只有模型可见状态真的变了才授权重试**：

  > 「**只要 `compactIfNeeded` 返回结果就重试**——不予采纳，因为自定义后端可能报告成功却没有
  > 改变模型可见状态。**`replaceGeneration` 才是权威证明。**」

**我们已经有等价守卫，不用改**：[loop.ts:304](../../packages/core/src/agent/loop.ts) 的
`rejectedContent(assistant)` 分支里 `if (stripped !== messages)` ——没裁掉任何东西就不重试，
且没有循环（等价于 `maxOverflowRetries = 1`）。一次「什么都没改变的恢复」会用同样的历史问同样的
问题，被同样地拒绝，那正是一种死循环。

### oh-my-pi — `docs/compaction.md`

已落地：压缩摘要里保留「已读文件清单」。见
[compaction.ts](../../packages/core/src/runtime/compaction.ts) 的 `filesSeen()` 与
`<files-already-seen>` 段——分「只读过」「你改过」两类，并明说这不是禁止重读。

### oh-my-pi — `packages/agent/src/append-only-context.ts`（374 行）

**A1 的必读**。它存在的理由就是保住 provider 的前缀缓存：

> "Append-only context mode — stabilizes the byte prefix sent to the LLM across turns so provider
> prefix caches (DeepSeek, Anthropic, etc.) hit at the maximum possible rate."
>
> "**AppendOnlyLog** — messages only grow; **prior turns are never re-serialized.**"

两个机制：`StablePrefix`（system prompt + tool specs 冻结成固定字节序列，除非 `invalidate()`）、
`AppendOnlyLog`（消息只增不改）。

`syncMessages()` 处理三种情况，第三种直接对应我们的 A1：

> 3. **In-place rewrite** (per-turn pruning, ...): find the longest byte-stable prefix ... drop the
>    log down to that prefix, then append the diverged tail. **Earlier revisions cleared the whole
>    log on any digest change, which on llama.cpp / local backends forced a full ~40k-token
>    re-prefill every turn** that an extension, prune pass, or steering re-wrap rewrote a single
>    message (**issue #3406**).

**结论**：per-turn pruning 他们也做，但付出了「从改写点往后全部重新 prefill」的代价，并专门
写了一套「保留最长字节稳定前缀」来减损。**我们做 A1 必须批量低频，否则就是 #3406 重演。**

### opencode — `packages/opencode/src/session/overflow.ts`（1 KB，全文读过）

判定何时该压缩，和我们的做法**本质不同**：

```ts
const COMPACTION_BUFFER = 20_000
usable = model.limit.input
  ? model.limit.input - reserved            // reserved = min(20_000, maxOutputTokens)
  : context - maxOutputTokens
isOverflow = (tokens.total || input + output + cache.read + cache.write) >= usable
```

两点差别：

1. **预留固定缓冲，不是百分比。** 我们是 [compaction.ts:285](../../packages/core/src/runtime/compaction.ts)
   的 `used < model.contextWindow * THRESHOLD`（`THRESHOLD = 0.8`）。对 200K 上下文的模型两者
   接近；对 1M 上下文的模型，百分比法会白白空出 200K 而 opencode 只留输出需要的量。
   **上下文窗口越大，我们越吃亏**——空出来的地方本可以装历史，压缩因此触发得更频繁，而每次
   压缩既要花钱生成摘要，又让整个缓存前缀失效。
2. **把 `cache.read + cache.write` 算进占用量。** 值得核对我们的 `used` 是否也算了。

**对我们的启示**：新增条目 A5（见 A 组）。

### 尚未读的（做对应条目时再读，不要空读）

| 文件 | 做哪条时读 |
|---|---|
| `anomalyco/opencode` `session/compaction.ts`（21 KB） | A1、A5 |
| `anomalyco/opencode` `session/processor.ts`（27 KB）、`session.ts`（35 KB）、`run-state.ts`（5 KB） | C1、C3 |
| `can1357/oh-my-pi` `packages/snapcompact`、`packages/mnemopi` | A1、D1 |
| `can1357/oh-my-pi` `agent-loop.ts` 的其余部分（只按关键词读了控制流，3,545 行没通读） | C3 |

---

## 八、已知空白 —— 审核时优先看这里

这份清单**不完整**，下面是作者知道的洞。列出来是为了让审核的人知道该往哪补，而不是让它们
藏在字里行间。

### 调查上的空白

| # | 空白 | 影响 | 为什么还没做 |
|---|---|---|---|
| 1 | ~~「完成质量差」只有一个粗糙指标~~ | 部分 | **已补**：audit 第 9 节现有两个指标（挫败词匹配率、单文件最大编辑次数的连续分布），形成 F 组两条待办。**第三个（Todo 遗留率）试过并撤销**，见 F 组开头。**仍然是弱项**：两个都是代理量，不直接衡量「这件事做对了没有」 |
| 1b | **挫败判据本身未经校准** ← 新发现，优先级高于上面那条 | **大。它是 F 组的分组依据，也是目标表第 6 条这个「第一原则守卫」的全部内容** | 「哪条发言算挫败」是一张手写正则词表，没有人工标注做过准确率/召回率检验。实测两张词表只有「不对」一个词重合，认定的挫败会话数从 10 个变成 24 个，下游结论随之翻转。**动 F 组任何一条之前，先做这件事**：人工标注 100~200 条真实用户发言，量出当前正则的准确率与召回率，再决定词表怎么定。在此之前，F 组的所有分组数字都只能当方向性参考，不能当判据 |
| 2 | ~~用户挫败率没进 audit 脚本~~ | — | **已补**：已整合进 `scripts/session-audit.ts` 第 9 节及 JSON 格式输出 |
| 3 | ~~并行度没量~~ | — | **已补**：audit 第 7 节，并形成 E 组两条待办。这是排查一个真实会话（`1a9a4c2e`）时补上的——它暴露出并行度才是「慢」的头号原因，而清单原本一条都没有 |
| 4 | ~~prompt cache 没进 audit~~ | — | **已补**：audit 第 8 节。补的过程中发现 `cacheWrite` 恒为 0 不可用，A1 的验收标准已相应改写 |
| 5 | **压缩的其余 4 个参数没验证** | 小 | `SAFE_AFTER = 0.3`、`KEEP_BUDGET = 0.12`、`SUMMARY_INPUT = 0.4`、`PRUNE_MARGIN = 0.1` 都没查过是怎么定出来的、是否合适 |
| 6 | A1 落地位置已定 | 已实现 | `runAgent` 在 compaction 前调用会话级 `AgedToolPruner`；周期与真实重放收益见本文顶部 |

### 方法上的已知偏差

- **「携带成本」（token·轮）不等于账单。** 这个模型假设每条结果在其后每一轮都被全额重发，
  实测 **92.0% 命中 prompt cache**，价格约为未命中的十分之一。**它是用来排序「该先优化谁」的
  相对指标，不是成本预测**——A1 省 50.6% 的携带量，换算成钱约 25%。收益验证一律以 audit
  第 8 节的 `$` 为准。
- **字符换 token 用的是固定系数 3.5**，对中文、代码、JSON 的实际比值都不同。同样只用于相对比较。
- **`~/.lyra/sessions` 是一台机器上的一个人的使用样本。** 258 个会话足以发现量级问题
  （比如单条 3,672K token 的 grep），但不足以支撑「某个阈值应该是多少」这种精细结论。
  凡是要定阈值的条目（A5、C3），都应该在更多样本上重新量。

### 结论的强度分级

| 强度 | 哪些结论 |
|---|---|
| **实测**（脚本全量跑出，或直接读源码确认） | 钱花在哪的分布、grep 无字符闸门、`REPEAT_STOP` 触发 0 次、裁剪收益曲线、原 audit 只统计 4 种模型 stopReason（运行时五种原因原已落盘）、10 条已证伪的猜想（其中「Todo 遗留率」只能算**弱证伪**——分子 2~3 个会话，换词表结论就变，详见该条）、顺利会话同文件改动 ≥3 次高达 71%、我们的溢出恢复已有进展守卫、**并行度按模型的分布**、**cacheRead 占 92.0%**、**`cacheWrite` 恒为 0**、**案例 `1a9a4c2e` 的 120 轮 / 1.45 分钟工具耗时（87.4 秒）与 16.4 分钟人等墙钟耗时**、**单文件最大修改均值（挫败组 7.4 次 vs 顺利组 4.4 次）** |
| **推断**（数据合理外推，无直接证据） | **A1 预期省钱约 25%**（前提是前缀缓存不被破坏；若打断前缀缓存，此推断不成立）、A1 选 `N = 20`（曲线平缓所以保守取值，但没有实验证明 20 比 12 更好）、A4 skill 重复注入的成因、**E1 里「5 个/轮」这个目标值与 15 分钟变 3 分钟的理论推算**（拿它算收益只是为了给出量级，模型能否真正并发 5 个调用以及并发后是否引入任务依赖错乱未经验证） |
| **未验证**（猜想，待办） | A5 两种阈值流派孰优、C3 墙钟是否优于轮数、D1 Ralph 模式值不值得、**E1 提示词能否真的提高并行率**（这是 E1 的全部风险所在：如果模型的批量行为改不动，这条就不成立） |
