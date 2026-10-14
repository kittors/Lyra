# ADR-0041：凭据按名字用——模型拿名字，值走自己的路，保险箱在桌面端闭环

- 状态：已采纳
- 日期：2026-10-14
- 相关：core `credentials/`（`broker.ts`、`saved.ts`、`redact.ts`、`markers.ts`、`askpass-*.ts`、`ssh-agent.ts`、
  `agent-protocol.ts`、`command-env.ts`、`store.ts`、`spec.ts`、`types.ts`）、`tools/request-credential.ts`、
  `tools/bash.ts`、`tools/edit.ts`、`tools/write.ts`、`tools/read-access.ts`、`agent/tool-run.ts`（出口遮蔽）、
  `runtime/approvals.ts`（`credential` 类审批、`mustAsk`）、`runtime/sub-agent.ts`、`sandbox/policy.ts`、
  `config/vault.ts`；desktop `electron/ipc/credentials.ts`、`electron/credential-input.ts`、
  `electron/credential-screen.ts`、`electron/askpass.ts`、`electron/browser-actions.ts`、`electron/browser-tools.ts`、
  `src/features/conversation/CredentialCard.tsx`、`src/features/vault/`；契约 `credentials.*`；探针
  `e2e/credentials-demo.ts`；
  现状说明见 [docs/architecture/credentials.md](../architecture/credentials.md)

## 背景

要 agent 登服务器、推代码、登网页，人只能把密码、私钥、令牌贴进对话。贴进去的值进了发给服务商的请求、会话库、
压缩摘要和推给界面（以及手机）的事件，命令输出里再打印一遍就再进一次。用户原话：「agent 会授权一个弹窗让用户
输入，不直接经过模型，模型是调用方法去间接使用这些密码密钥」，以及后来的「加一个保险箱……用户可以自由管理和维护
自己的敏感信息……后面问大模型，提供复制粘贴，但是大模型本身不知道」。

调研过的做法（明细在本地方案 `docs/plan/secure-credentials/`）：OpenHands 的 `request_secret` 与输出遮蔽、
Claude Code 沙箱的凭据掩码代理、Codex 的 credential broker、1Password 的 SSH agent 三档授权、Browser Use 的
敏感数据与域名核对、oh-my-pi 的占位符文本替换、GitHub Actions 的遮蔽形式表。

## 决定

**一、模型拿名字，不拿值。** 新工具 `request_credential`（名字、标题、用途、类型、可选的「只能用于」）在输入框上方
出一张卡片；值从卡片走专用的 `credentials.submit` 进主进程，不走审批通道——审批通道的东西会落库、会同步到手机。
卡片的审批只有「填了」和「拒绝」，`once` 只在 broker 真的拿到值之后才发出；没提交值就点了 `once` 当拒绝。

**二、用的时候只写名字，值按用途走不同的路。** `bash` 多一个 `credentials` 参数，`browser_act` 多一个 `credential`。

- 密码：askpass 小程序经 0700 临时目录里的 socket 向主进程取，**不进环境变量**——环境变量同一用户的进程都读得到
  （`ps eww` 实测）。只有命令文本里写了 `$NAME` 才放进去。
- 令牌：只能放环境变量 `$NAME`，没有别的用法。
- 私钥：Lyra 自己的 ssh-agent，命令只拿到 socket。`ssh2` 自带的 agent 服务端不跳过未知消息的正文，OpenSSH 8.9 起
  每次登录先发的 `session-bind` 会让整次认证失败——帧自己切，`ssh2` 只用来解析私钥。
- 网页：主进程在隔离世界里一段同步脚本里先核对 origin 再填，填完加文字遮罩。分成两步的话，页面能在两步之间
  自己跳走（browser-use#5815）。

**不做文本占位符替换。** 把 `{{secret}}` 换进命令文本是 oh-my-pi 的做法，它的 #13616、#10027 都出在这里：值进了
命令行、进了日志、进了 shell 历史。

askpass 只答它认得的问题：确认类一律拒（未知主机的指纹确认也会交给 askpass，实测）；有目的地的提示只由绑在那里或
哪都没绑的凭据回答；两个都能答就拒。拒绝的原因附在命令结果后面告诉模型。

**三、两层遮蔽。** 源头：`bash` 输出边流边换。出口：每个工具结果在发出 `tool_end` 之前统一过一遍，进度也过；
遮蔽出错就扣下整条结果。审批卡片的标题和说明也遮——`approval_request` 是落库的事件。形式照 GitHub Actions 的表，
外加 base64 三种对齐与私钥逐行；图片和长 base64 跳过，截图要原样到模型那里。遮蔽是尽力而为：模型故意把值编码成
认不出的样子打印出来，这一层挡不住，文档里明说。

**四、存储复用保险库**（ADR-0003），键 `credential:<名字>`。卡片默认不存（「存进保险箱」不勾）；存下的在新对话里
第一次用要点头一次（「每个对话问一次」），可按条改成每次问或不问——不问的话，被注入的模型能静默用上存过的所有凭据，
所以这是人在保险箱页自己选的，不是默认。受约束的命令读不到保险库的两个文件（Seatbelt `deny file-read*`、bwrap
挂空文件）；完全访问模式没有沙箱，读这两个文件要问，这改变了 full「从不问」的语义——只为这两个文件。

**五、子智能体共用父会话的凭据。** 显式传下去：一个子智能体若拿不到，它看见的输出就不经遮蔽。

**六、手机上只能拒绝。** `credentials.*` 全是 `remote: false`：中转看得见它转发的帧（ADR-0002），填进卡片的值不能走
那条路。手机上的卡片说「凭据只能在电脑上填写」；手机发来的消息照样把值换成引用，但手机上打的引用不交出凭据——
否则就绕过了「只在电脑上交出」这一条。

**七、保险箱页，让这件事在桌面端闭环。** 左侧图标栏「创作」下面一格，进去时会话侧栏收起。

- 手动添加、改名称和「只能用于」、改「交给对话前」、重新填写值、删除。**没有「显示」**：存进去的值没有一条路回到
  界面。
- 「复制引用」复制 `[credential:名字]`；人把它贴进对话，那条凭据就交给这个对话，不再出卡片——人自己交的，问他
  就是形式。模型认得这个写法（工具说明里有一句），要知道类型和地址就用这个名字调一次 `request_credential`，
  对话里已有的同名凭据直接回答它的真实类型，不再弹卡。
- 「复制密码 / 令牌」：主进程写剪贴板，30 秒后若还是它就清掉，值不经过渲染进程。SSH 密钥复制的是公钥那一行——
  复制一把钥匙几乎总是为了把公钥贴到服务器或代码托管上。
- 兜底：真值被贴进输入框发出去，发送前换成引用（6 个字符以上；更短的在消息里多半是数字）。新对话的第一条消息
  在会话有 id 之前就落库，所以换值与交出分两步。
- 改了「只能用于」或删掉，正在用它的对话立刻跟着变。
- 问「密码是多少」：模型用只读的 `list_credentials` 查到名字，在回复里写引用；消息里的引用画成一枚胶囊，
  点它由主进程复制。模型从头到尾只有名字，问的人拿到了值。
- 取代方案里原定的「设置 › 凭据」一节。

## 没有做的

- **出口代理、假值换真值**（Claude Code `sandbox.credentials`、Codex broker）。唯一挡得住「模型故意打印值」的做法，
  代价是本机 TLS 中间人和每条工具链信任它的 CA。API 令牌用得多了再上。
- **手机上填写**：要先做配对令牌派生密钥的端到端加密提交。
- **定时任务的提示词里写引用**：定时任务能不能从手机改还没厘清，先不让它交出凭据——现在它要用存下的凭据会出卡片等人。
- **保险箱里存着、这个对话没用过的值**不在遮蔽表里：命令把一个恰好存过的密码从别处的文件里打印出来，模型看得见。
- 首次连接的主机指纹交给卡片确认；ssh 签名逐次确认；从 1Password 选。
- **Windows 没在真机上验**：askpass 包装是 `.cmd`，socket 是命名管道；Windows 10 自带的 OpenSSH 8.1 不认
  `SSH_ASKPASS_REQUIRE`。

## 后果

- 真窗口探针 `e2e/credentials-demo.ts` 24/24（假模型记下它收到的每个请求）：卡片把模型的说法和「只能用于」分开
  摆、焦点在密码框、没有「不再询问」；填完之后命令经环境变量和 askpass 各拿到一次密码，输出到模型那里是
  `[credential:nas-root]`；勾了「存进保险箱」的出现在保险箱页；进保险箱时会话侧栏收起；手动添加时引用名跟着名称走；
  「复制密码」写进系统剪贴板、30 秒后清空；「复制引用」后在输入框里 ⌘V、发出去，存下的账号直接交给这个对话，
  没有出卡片，命令拿到用户名、密码在输出里是 `[credential:nas-admin]`；问「NAS 的 root 密码是多少」，模型调
  `list_credentials` 后在回复里写引用，回复里出现一枚写着名称的胶囊，点它剪贴板里就是那个密码。假模型收到的 7 个
  请求里两个密码都没出现，
  跑完时临时 profile 下没有任何文件含有它们的明文。录像和截图在 `~/Desktop/Lyra安全凭据测试/`。
- 哨兵测试拿一个高熵值走完「填 → bash 用 → 原文 / base64 / URL / JSON 各打印一次 → 子智能体再用 → 写进文件再读
  回来」，会话库、请求体、事件、文件里命中 0。去掉出口遮蔽、源头遮蔽、子智能体的传递或沙箱禁读，都有测试变红。
- 本机真 sshd 上用四种私钥（ed25519、RSA 的 sha2-256/512、ECDSA）经自己的 agent 登录成功。
- 契约多 6 个方法（236）；功能域多一个 `vault`（25）。
- 守卫登记在 `scripts/audit-regression.mjs`：`CRED-values`、`CRED-desktop`、`CRED-ui`。
