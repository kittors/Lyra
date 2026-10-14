# 凭据：模型只拿名字

密码、SSH 私钥、API 令牌、账号密码，模型拿到的是**名字和用法**，不是值。为什么这么定、比较过哪些做法，见
[ADR-0041](../adr/0041-credentials-by-name.md)。代码在 `packages/core/src/credentials/`。

## 值只在三个地方

1. `CredentialBroker` 的内存（`credentials/broker.ts`），按会话分开放；
2. 保险库（`config/vault.ts`，ADR-0003），键是 `credential:<名字>`，值是一条密封的 JSON 记录——只有人勾了「存进
   保险箱」或在保险箱页手动加的才在这里；
3. 一条命令运行期间的 askpass 小程序和 agent socket，命令结束就拆。

事件、工具结果、日志、错误信息里都没有值。`credential-sentinel.test.ts` 拿一个高熵哨兵把每条路走一遍，然后在
会话库、发给模型的请求、推给界面的事件、改过的文件里搜，命中必须是 0。

## 三条路进来

| 入口 | 走哪 | 进了之后 |
| --- | --- | --- |
| 模型调 `request_credential` | 输入框上方一张卡片（审批的 `kind: "credential"`）；值走专用的 `credentials.submit`，不走 `agent.approve` | 只在这个对话里有；勾「存进保险箱」才落盘 |
| 保险箱页手动添加 | `credentials.add` | 落盘；任何对话都要先经过它的「交给对话前」设置 |
| 人在消息里写 `[credential:名字]`（保险箱页「复制引用」） | 发送前 `credential-screen.ts` 认出来 | 存过的那条直接交给这个对话，不再出卡片 |

卡片的审批只认「填了」或「拒绝」：`once` 只在 broker 真拿到值之后才由主进程发出；没提交值的 `once` 一律当拒绝。
手机上卡片只能拒绝（`credentials.*` 全是 `remote: false`），手机上打的引用也不交出凭据，只把值换掉。

## 用的时候

模型只写名字：`bash` 的 `credentials: ["kzhy-root"]`，`browser_act` 的 `credential: "kzhy-root"`。

| 类型 | 命令拿到什么 |
| --- | --- |
| 密码 / 账号密码 | askpass：`SSH_ASKPASS`（`SSH_ASKPASS_REQUIRE=force`）、`SUDO_ASKPASS`、`GIT_ASKPASS` 指向一个包装脚本，它经 0700 临时目录里的 socket 问主进程。值不进环境变量，除非命令文本里写了 `$NAME` / `${NAME}` / `$env:NAME` / `%NAME%` |
| 令牌 | 环境变量 `$NAME`（`kzhy-root` 是 `$KZHY_ROOT`）——令牌没有别的用法 |
| SSH 私钥 | Lyra 自己的 ssh-agent，命令只拿到 `SSH_AUTH_SOCK`；私钥不落盘，签名用 `node:crypto` |
| 账号的用户名 | `$NAME_USERNAME`，它不是秘密 |

askpass 只回答它认得的问题（`askpass-answer.ts`）：确认类（`yes/no`、指纹）一律拒绝；带目的地的提示
（`user@host's password:`、git 的 `Password for 'https://…'`）只由绑在那里的、或者哪都没绑的凭据回答，绑定的优先；
没有目的地的（sudo、私钥口令）只由没绑的回答；两个都能答就拒绝。拒绝的原因作为一行说明附在命令结果后面，
模型据此改法，而不是盲试。

浏览器：主进程在隔离世界里**一段同步脚本**内先核对 origin 再填值，页面没有机会在两步之间跳走；填完的输入框
加 `-webkit-text-security: disc`，截图前再按值找一遍补上，截图里是圆点。

`edit` / `write` 把参数里的 `[credential:x]` 换回真值，所以读→改一个带凭据的文件不会把标记写进去；但往一个原本
没有这个值的文件里**写进**凭据，要人点头，而且每次都问（`mustAsk`）。

## 出口：两层遮蔽

- **源头**：`bash` 的输出边流边换（`StreamRedactor`），只扣住可能还会长成一个值的那一截尾巴。
- **出口**：`runTools` 里每个工具结果在 `afterToolCall` 之后、`tool_end` 之前过一遍 `Redactor`，进度更新也过；
  遮蔽本身抛错时整条结果不发，换成一句「没能检查，已扣下」。审批卡片的标题和说明也过一遍——`approval_request`
  是落库的事件。

认的形式是 GitHub Actions 的那一组（原文、JSON/URL/shell 转义、base64 的三种对齐、PowerShell 的 `&` 两半），
加私钥逐行。短于 6 个字符的值只认原文。图片、`data:` 链接和长 base64 串跳过——截图要原样到模型那里。
范围是**这个对话拿到过的**凭据；存在保险箱里、这个对话没用过的，不在遮蔽表里。

## 保险库本身

受约束的命令读不到保险库的两个文件：Seatbelt 末尾 `(deny file-read* (literal …))`，bwrap `--ro-bind /dev/null`。
完全访问模式没有沙箱，`read` 工具与命令文本里点名这两个文件时要人点头（`mustAsk`，「以后不再问」不给）。
网络被禁时 askpass 与 agent 的 socket 要单独放行，Seatbelt 里必须写真实路径（`/private/tmp/…`）。

## 保险箱页

左侧图标栏「创作」下面那一格（`features/vault/`）。和创作一样是独立的去处，进去时会话侧栏收起。

- 列表只有名字、类型、用户名和地址，**没有「显示」**。
- 「复制引用」复制 `[credential:名字]`，在渲染进程里做——它不是秘密。
- 「复制密码 / 令牌」由主进程写系统剪贴板，30 秒后若剪贴板还是它就清掉；值不经过渲染进程。SSH 密钥复制的是
  公钥那一行（`authorized_keys` 格式），私钥不出去。
- 编辑不回显值：要换值就「重新填写」这一类的全部字段。改了「只能用于」或删掉，正在用它的对话立刻跟着变
  （`follow`）。
- 「交给对话前」三档：每次使用都问、每个对话问一次（默认）、不问。

## 子智能体

子智能体共用父会话的 `CredentialAccess`（`runtime/sub-agent.ts` 显式传下去）：它看见的、能用的、被遮蔽的，和
父会话是同一份。

## 不承诺的

- 被注入的模型**用**这份能力干坏事——挡它的是授权和绑定目的地，不是遮蔽。
- 模型故意把值编码成认不出的形式打印出来。遮蔽是尽力而为，不是安全边界。
- 令牌和写了 `$NAME` 的密码在环境变量里，同一用户的其他进程读得到（`ps eww`，实测）。

## Windows

askpass 包装是 `.cmd`、socket 是命名管道，**都没在真机上验过**。Windows 10 自带的 OpenSSH 8.1 不认
`SSH_ASKPASS_REQUIRE`。

## 测试

| 守什么 | 在哪 |
| --- | --- |
| 哨兵走遍每条路、子智能体、读回 | `core/test/credential-sentinel.test.ts` |
| 遮蔽的形式、流式扣尾、跳过图片 | `core/test/credential-redact.test.ts` |
| askpass 回答规则 | `core/test/credential-askpass.test.ts` |
| agent 协议（含 OpenSSH 8.9+ 的 session-bind） | `core/test/credential-agent.test.ts` |
| 卡片、授权粒度、保险箱、发消息兜底 | `core/test/credential-broker.test.ts` |
| 工具参数、标记还原、写进文件要问 | `core/test/credential-tools.test.ts`、`credential-guards.test.ts` |
| IPC 入参逐字段重建、结果不带值、手机不交出 | `desktop/test/credential-input.test.ts`、`credential-screen.test.ts` |
| 卡片与保险箱页 | `desktop/test/ui/credential-card.test.ts`、`vault-view.test.ts` |

`node scripts/audit-regression.mjs --only=CRED-values,CRED-desktop,CRED-ui` 一次跑完。真窗口里从卡片到保险箱再到
贴引用走一遍是 `e2e/credentials-demo.ts`（先 `pnpm --filter @lyra/desktop build`；会用到系统剪贴板，跑完放回原来的文字）。
