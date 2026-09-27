# ADR-0026：core 报的是哪条规则，说成哪种语言由宿主决定

- 状态：已采纳
- 日期：2026-09-27
- 相关：`packages/core/src/tools/risk-reasons.ts`（`RISK_REASONS`）、`tools/risk.ts` 与 `risk-tables.ts`、`risk-paths.ts`、`risk-network.ts`、`runtime/approvals.ts`（`ApprovalRequest.risk`）、`kernel/services.ts`（`ApprovalVerdict.code`）、desktop `features/conversation/approval-content.ts`（`riskSentence`）、`src/i18n/messages/*.ts` 的 `risk.*`

## 背景

官网的英文截图里，审批卡在 `git push --force` 上面写着「强制推送会覆盖远程历史」。风险规则（四个文件、
48 条）只有中文说明，而 auto 模式下审批闸门把这句话拼进 `ApprovalRequest.detail` 的第一行——到了界面
上它已经是一段定了语言的文本，界面没有机会再翻译它。

core 此前没有任何翻译机制：`Settings.uiLocale` 定义在 core 里，core 里却没有一处读它。最接近的先例是
`ai/failure.ts` 的 `kind`/`hint`——core 给枚举码，界面据码决定怎么呈现。

这句话的去向，逐个消费者查过：

- 审批卡。桌面和手机是同一份渲染进程，手机经同步拿到同一个事件。
- 会话日志与轨迹面板：`approval_request` 整个事件落盘。
- 网络拒绝的理由另外作为工具错误发给模型（`web.ts` 的 `Refused: …`）。命令和写入的理由不进模型的上下文。

## 决定

1. **规则给码。** 每条规则一个稳定的码（`force-push`、`recursive-delete`…），和它自己的中文措辞一起列在
   `RISK_REASONS`。判定结果带 `code`，需要填值的带 `params`（HTTP 方法、协议）；`reason` 仍是原来那句中文。
2. **闸门不再把理由写进 `detail`**，而是挂在 `ApprovalRequest.risk`（`{ text, code?, params? }`）上，随
   `approval_request` 事件、快照和同步原样过去。
3. **宿主按码翻译。** 渲染进程的七个目录各有 `risk.<码>`；审批卡在原来的位置（等宽正文的第一行）写出
   当前语言的句子，切换语言时跟着变。没有码的（插件的策略只给一句话）、或这个版本不认识的码，显示 `text`。
4. **core 自己的措辞不动。** 日志、轨迹、发给模型的拒绝文本仍是原来那句——它们记的是发生了什么，不是界面。

## 没有做的

- **没有把界面语言传进 core。** 那样 core 要持有七种语言的界面文案，而 [界面国际化](../architecture/i18n.md)
  的约定是翻译归宿主（渲染进程、主进程、Expo 外壳各有目录）。理由也会在生成那一刻定格成当时的语言：卡片
  开着时切语言不会变，写进日志的措辞随界面语言漂。码是稳定的、可测的，翻译留在已有检查管得到的地方。
- **读取越界的审批（`read-access.ts`）和提权卡片的标题没有改。** 它们把中文拼进 `title`/`reason`，
  走的不是这条路；要改时照同一个办法。

## 后果

- 加一条风险规则，三处都有东西拦：`RISK_REASONS` 里加码和中文措辞（规则表的值类型是码，写错名字 tsc
  报错）；七个目录各加 `risk.<码>`（`approval-content.ts` 把 `` `risk.${code}` `` 当作 `MessageKey`，少一条
  tsc 就红；目录完整性测试要求七种语言的键一样）；占位符在七种语言里要与中文措辞一致
  （`test/ui/approval-risk-language.test.ts`）。
- 旧的会话日志里理由在 `detail` 里，照旧显示；新日志的理由在事件的 `risk` 字段，轨迹面板把它放回条目
  详情的最上面，和从前看到的一样。
