<p align="center">
  <img src="assets/lyra.png" alt="Lyra" width="200">
</p>

<p align="center">
  <a href="https://github.com/kittors/Lyra/actions/workflows/ci.yml"><img src="https://github.com/kittors/Lyra/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href=".nvmrc"><img src="https://img.shields.io/badge/node-%E2%89%A524-brightgreen.svg" alt="Node ≥ 24"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>中文</strong>
</p>

一个自带模型配置的独立通用型 agent。桌面端用 Electron，手机端用 React Native，两端共用同一份会话数据。

不是 Claude Code 或 Codex 的前端壳。agent 内核、工具集、skill 与 MCP 全部从零实现，模型由你自己配，
插件和技能也由你自己装。

## 下载

装好的包在 [Releases](https://github.com/kittors/Lyra/releases/latest)，每个版本都带全部系统和
架构。挑你这台机器的那一个：

| 系统 | 架构 | 下载 |
| --- | --- | --- |
| macOS | Apple 芯片 | `Lyra-<版本>-arm64.dmg` |
| macOS | Intel | `Lyra-<版本>-x64.dmg` |
| Windows | x64 | `Lyra-<版本>-x64.exe` |
| Windows | Arm（骁龙笔记本、Surface Pro X） | `Lyra-<版本>-arm64.exe` |
| Linux | x64 | `Lyra-<版本>-x86_64.AppImage` 或 `Lyra-<版本>-amd64.deb` |
| Linux | arm64（树莓派、Ampere、Mac 上的 Linux 虚拟机） | `Lyra-<版本>-arm64.AppImage` 或 `Lyra-<版本>-arm64.deb` |
| Android | 通用 | `Lyra-<版本>-android.apk` |
| iOS | 通用 | `Lyra-<版本>-ios-unsigned.ipa`（要自己签名，见下） |

不知道自己是哪个架构：macOS 看「关于本机」的芯片一行，Windows 看「设置 → 系统 → 系统信息」的
「系统类型」，Linux 跑 `uname -m`（`x86_64` 取 x64，`aarch64` 取 arm64）。

AppImage 和 deb 二选一：AppImage 不用装，`chmod +x` 之后直接运行，哪个发行版都行；deb 是
Debian、Ubuntu 这一系的包管理器格式，`sudo apt install ./Lyra-<版本>-amd64.deb`。

剩下四个文件一般用不上：两个 `.zip` 是 macOS 应用内更新用的（更新时在原地换掉 app，不用你再拖
一次），`Lyra-<版本>.exe` 是 x64 与 arm64 合一的 Windows 安装包（两百多 MB，上面那两个各一百多
MB，能确定架构就别下它），`SHA256SUMS` 是全部文件的校验值。装好之后应用会自己检查更新，而且只
安装校验对得上的包。校验值读不到就不装，宁可不更新。

## 第一次打开

安装包没有花钱买来的证书，所以三个系统都会先拦一下。每种拦法的放行方式不一样：

### macOS 首次打开

发布包是 ad-hoc 签名的，没有 Apple 开发者证书，也没有公证。双击会被 Gatekeeper 拦下来，说
「无法打开，因为无法验证开发者」。两种放行方式，选一种：

- 在「访达」里右键点 Lyra.app → 打开 → 再点一次「打开」；或到「系统设置 → 隐私与安全性」点「仍要打开」。
- 或者去掉隔离标记：

```bash
xattr -dr com.apple.quarantine /Applications/Lyra.app
```

提示里如果写的是「已损坏」而不是「无法验证开发者」，那是 0.6.0 及更早的包。那些包根本没签名，
Gatekeeper 认定 bundle 被破坏，除了废纸篓没有别的选项。升级到之后的版本即可。

### macOS 升级后截图变黑或失败

截图走的是系统的「屏幕录制」权限。发布包是 ad-hoc 签名的，每次构建签出来的都不是同一个签名，
所以升级之后 macOS 有时认不出这还是同一个应用：授权明明还挂在「系统设置 → 隐私与安全性 →
屏幕录制」的列表里，截出来却是纯黑，或者直接报失败。

把这个应用的授权记录清掉，让它重新问一次：

```bash
tccutil reset ScreenCapture dev.lyra.app
```

跑完要**完全退出** Lyra（⌘Q，关窗口不算）再打开，下一次截图才会弹出新的授权请求。如果还是不弹，
到「系统设置 → 隐私与安全性 → 屏幕录制」里把 Lyra 的开关关掉再打开，必要时用列表下方的减号
先移除条目。

`dev.lyra.app` 是 Lyra 的 bundle id，别省。不带它的 `tccutil reset ScreenCapture` 会清掉
**所有**应用的屏幕录制授权，你的会议软件和录屏工具都得重新授权一遍。

### Windows 首次打开

Windows 安装包同样没有代码签名。第一次运行会撞上 SmartScreen 的蓝色弹窗「Windows 已保护你的电脑」，
点「更多信息」再点「仍要运行」即可。

如果安装向导走完了，勾了「运行 Lyra」却弹出「缺少快捷方式 / Windows 正在查找 Lyra.exe」，
或者开始菜单、桌面图标点下去是同一个报错，那说明 `Lyra.exe` 没能留在安装目录里。最常见的原因是
未签名的大体积程序被 Windows 安全中心判成可疑文件隔离掉了：到「Windows 安全中心 → 病毒和威胁防护
→ 保护历史记录」查有没有对应条目，有就选「允许」，然后重新运行一次安装包。

应用内更新走同一条路。安全中心也会拦 `%APPDATA%\@lyra\desktop\updates` 里正在写的安装包，
表现是下到快结束时报失败、浏览器里强制保留也留不住。排除项里加上这个目录，保护历史记录里
允许 Lyra，再点重试。已经下好的部分还在。

顺带说明一件容易认错的事：装进去的主程序固定叫 `Lyra.exe`，两百多 MB。安装目录里如果还有一个
`Lyra-<版本>-<架构>.exe`，一百多 MB，那是安装包**自己**，不是主程序。通常是安装时把目标目录选成了
安装包所在的文件夹。而只有几百 KB 的 `Uninstall Lyra.exe` 是卸载程序。这两个都不是用来启动应用的。

### 手机端装包

同一个 release 里，手机端两个文件：

- `Lyra-<版本>-android.apk`：直接装，第一次会问「是否允许安装未知来源的应用」。
- `Lyra-<版本>-ios-unsigned.ipa`：**未签名**，双击装不上。用 Sideloadly、AltStore 或 Xcode 的
  「Devices and Simulators」自己签一遍再装，免费 Apple ID 就够。这样发的原因是：签名装到别人手机
  上要 Apple 开发者账号，而一个谁都装不上的 `.ipa` 比没有更糟。

手机端只是个壳，它连的是你自己电脑上的 Lyra。会话、模型、密钥都在电脑上。装完在桌面端
「设置 → 移动端同步」里开服务，扫码配对。

## 先配一个模型

Lyra 不自带模型，所以第一次打开是发不出消息的。到「设置 → 模型设置」添加供应商：填 Base URL、
选 API 格式（**Responses** 或 **Anthropic Messages**，不支持 Chat Completions）、填 API Key，
再添加至少一个模型。

## 能力

- **自定义模型**：任意数量的供应商，每个供应商挂任意数量的模型。只对接 **Responses**（`/v1/responses`）和 **Anthropic Messages**（`/v1/messages`）两种格式，不支持 Chat Completions。
- **20 个内置工具**，按代码里的分组：
  - 文件与代码：`read` `write` `edit` `ls` `glob` `grep` `symbol` `lsp`
  - 执行命令：`bash` `bash_output`
  - 会话与记忆：`todo_write` `task` `skill` `rule` `recall` `learn` `ask_user`
  - 网络与预览：`web_fetch` `web_search` `preview`
- **Skill**：`SKILL.md` + YAML frontmatter。只有名称和描述进系统提示，正文在模型调用 `skill` 工具时才注入。装几十个技能也不烧上下文。
- **MCP**：stdio / Streamable HTTP / SSE 三种传输，工具以 `mcp__<服务>__<工具>` 命名注入，不会和内置工具撞名。
- **子智能体**：`task` 工具把工作交给拥有独立上下文窗口的子 agent，只把结论带回主对话。内置七个：`general` `explore` `review` `verify` `plan` `simple` `reason`，可用 `.lyra/agents/*.md` 扩展。
- **侧边聊天**：在当前会话旁边再开一个临时对话。它读得到主会话聊了什么，但一个字也不写进去；需要动手的事交给主会话排队执行。
- **右侧面板**：文件、文件内容、终端、Git、侧边聊天、子 Agent、任务、轨迹、浏览器九个标签页，可同时开着来回拖。文件带语法高亮编辑器，终端是真的 pty。
- **多会话分屏**：单窗口最多同时查看并排的四个会话。每个会话拥有独立的工具 Dock（会话至少 420 px、工具至少 300 px），空间不足时紧凑绘制，不再意外强行脱离出独立孤儿窗口。
- **居中 Git 提交与分支管理**：提交改动采用居中模态弹窗，与主输入框呼吸感一致；分支行可直接切换本地分支或就地新建分支，确认提交时才执行分支创建与切换；支持平铺与树形改动视图切换并持久化偏好。
- **回复按模型写的来画。** 用户气泡与回答均支持完整 Markdown 排版。mermaid 围栏会画成图。指向本地文件的链接收成单行胶囊，只显示文件名，完整路径在悬停提示里。一条十二兆的消息也能在一帧里画完。侧边聊天分离显示文本与底层模型附件记号，重新编辑时不回填附件代码。
- **内置格式化。** 保存文件可以走 Prettier，或应用里自带的那门语言的格式化器（Go、Ruff、C/C++、Dart、Swift、PHP 等），不用先装那些工具链。
- **运行期间不让电脑休眠。** 通用设置里的开关。合盖仍然会睡。
- **移动端同步**：手机重放同一份会话日志，可以查看进行中的回合、批准操作、继续追问。三条路径：同一个 Wi-Fi 下直连、经你自己的域名和 TLS、或者两端各自往外拨到中转服务碰头。

## 结构

```
packages/
  core/              agent 内核：provider 适配、agent loop、工具、skill、MCP、会话存储
  desktop/           Electron 应用（主进程 + preload + React 渲染进程）
  mobile/            Expo / React Native 应用
  contract/          两个进程之间那条线，215 个方法写在一处
  relay/             公网中转服务，手机不在同一个局域网时走它。单文件，零依赖
  agent-cli/         命令行入口
  registry-shared/   插件目录的索引格式，桌面端与目录服务共用
```

`core` 与平台无关，桌面主进程和同步服务共用同一个 `AgentSession`，所以手机和电脑不会看到两份不同的状态。
包与包之间的依赖方向有五条规则，`pnpm arch` 守着，见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 从源码跑

```bash
pnpm install
pnpm dev
```

手机端另开一个：

```bash
pnpm dev:mobile
```

在桌面端「设置 → 移动端同步」启用服务，把地址和令牌填进手机端的配对页。

想参与开发看 [CONTRIBUTING.md](CONTRIBUTING.md)；如果你是被叫来改这份代码的 agent，
看 [AGENTS.md](AGENTS.md)。

## 配置位置

| 路径 | 内容 |
| --- | --- |
| `~/.lyra/settings.json` | 供应商、模型、MCP、权限模式 |
| `~/.lyra/credentials.json` | API Key，加密存放；密钥本体在 `~/.lyra/vault.key` |
| `~/.lyra/sessions/` | 会话日志（JSONL，一行一条记录） |
| `~/.lyra/skills/`、`plugins/`、`rules/`、`commands/` | 用户级的技能、插件、规则、斜杠命令 |
| `~/.lyra/memory.json` | `learn` 工具记下来的东西 |
| `<项目>/.lyra/skills/`、`agents/`、`commands/`、`plugins/` | 项目级的同一套，优先级高于用户级 |
| `<项目>/LYRA.md`、`AGENTS.md`、`CLAUDE.md` | 项目指令，按此优先级取第一个存在的 |

换机器只需要拷 `~/.lyra`。拷之前想清楚 `credentials.json` 和 `vault.key` 要不要一起走。两个都在
才解得开，只拷一个等于把 Key 丢了。

## 扩展与机制

插件、技能、MCP、子智能体的目录结构与文件格式，以及浏览器、索引库、钩子、移动端同步
的工作方式：

- [扩展 Lyra](docs/guide/extending.md)：插件目录结构、`SKILL.md` 格式、MCP 服务、子智能体定义
- [内置能力](docs/guide/capabilities.md)：浏览器与其安全边界、索引库、钩子、移动端同步的三条路径
- [架构](ARCHITECTURE.md)：包与包的关系、五条边界规则、决策记录

要点：**插件是一组技能的打包，不含 MCP 服务。** 一个只有 `.mcp.json` 的目录不是插件，它是
一个 MCP 服务。目录页把两者分开列，装 MCP 服务会把它的声明写进「设置 › MCP」，那里是这台
机器上所有 MCP 服务的唯一去处，手动配的和装来的都在一起。

## 外观

「设置 → 外观」的每一项都真实生效，通过覆盖 CSS 变量实现：

- 主题：系统 / 浅色 / 深色，带预览。浅色是完整实现，不是回退。
- 只暴露三个颜色（强调色、背景、前景），其余色阶按对比度滑块派生。这样选了任何背景色都不会得到读不清的文字或看不见的边框。
- UI 字体 / 代码字体 / UI 字号 / 代码字号 / 半透明侧边栏 / 指针光标 / 字体平滑
- 减少动态效果：系统 / 开启 / 关闭
- 差异标记：颜色 或 `+/-`（给色觉障碍用户）

## 系统提示词

结构学自 [pi](https://github.com/earendil-works/pi)：

```
身份（一句话）
Available tools:      每个工具一行 snippet
Guidelines:           基础规则 + 已加载工具各自贡献的规则
Boundaries:           不可越过的边界
Environment:          平台、是否 git 仓库、日期、模型
<available_skills>    名称 / 描述 / 目录，不含正文
<available_subagents> 名称 / 描述 / 可用工具
<project_context>     AGENTS.md 等项目指令，用 XML 标签包裹
Current working directory: …
```

要点：

- 规则挂在贡献它的工具上（`Tool.guidelines`）。没加载 `bash` 的会话就不会看到关于 shell 命令的建议，也不会留下过时的指导。
- 提示里只放 `snippet`（一行），完整的 `description` 走供应商的 tool schema。同一份信息不重复占两次上下文。
- 技能只列名称、描述和目录，正文在模型调用 `skill` 工具时才注入。
- 子智能体清单是必要的：没有它，模型不知道 `subagent_type` 有哪些取值，即使用户点名 `explore` 也会退回 `general`（这是实测发现的）。
- 技能描述里的 `<` `&` 会被转义，一个恶意的 `description` 不能提前闭合 XML 标签往提示里塞指令。

`packages/core/test/system-prompt.test.ts` 覆盖了以上每一条。

## 面板

右侧面板是一条标签栏，九样东西可以同时开着、来回拖：

| 标签 | 快捷键 | 内容 |
| --- | --- | --- |
| 文件 | ⌘P | 文件树。点一个文件就把「文件内容」带出来 |
| 文件内容 | ⌥⌘P | 语法高亮编辑器。标题显示的是文件名，不是「文件内容」 |
| 终端 | ⌃` | 真实的 pty，不是命令回显 |
| Git | ⌘⇧R | 工作区 diff，支持平铺/树形切换，居中弹窗提交并支持就地选分支或新建分支 |
| 侧边聊天 | ⌥⌘S | 见上 |
| 子 Agent | ⌥⌘A | `task` 派出去的子 agent 各自在干什么 |
| 任务 | ⌘J | 当前的 todo 清单 |
| 轨迹 | ⌘L | 这一轮到底发了什么给模型：工具、技能、注入的上下文 |
| 浏览器 | ⌘T | 内置浏览器，边界见[内置能力](docs/guide/capabilities.md) |

- **宽度可拖**：侧边栏和面板的边缘都能拖，双击回到默认，方向键微调。宽度记在本地，重启还在。
- **分屏容纳**：单窗口最多容纳 4 个会话分屏，各分屏拥有独立的工具 Dock 槽位，拖拽面板始终留在本屏 Dock 内；窗口狭窄时按紧凑比例压缩绘制，保证内容可见且随时可拉宽恢复。
- **全屏**：面板可以铺满整个对话列。此时文件标签变成左树右文件；侧边栏收起的话，窗口那三个按钮会移进标签栏里，而不是浮在面板上。
- **编辑器**：语法高亮、自动换行开关（默认关）、横竖两条滚动条。滚动条画在内容上方，不占一像素宽度。

## 上下文占用

输入框里模型名左边有一个圆环，是这段对话占了模型上下文窗口多少。点开是分项：

```
上下文窗口              12.5k / 128.0k（10%）
■ 对话消息               8.6k    6.7%
■ 内置工具               2.5k    2.0%
■ 系统提示词             1.5k    1.2%
□ 剩余空间             115.5k   90.2%
```

一个总数只能告诉你快满了，分项才能告诉你该做什么：是开新对话、关掉某个 MCP 服务，还是去删一份没人再读的 `CLAUDE.md`。数字取自上一轮回复的真实用量而非估算，超过 80% 转红，因为运行时到那个量级就开始把最早的对话摘要压缩掉了。

## 交互动效

界面上每个会变化的东西都有对应的动作提示，时长控制在 140–260ms，并且整体受 `prefers-reduced-motion` 控制。

- **侧边栏**：`margin-left` 从 0 滑到负的当前宽度，配合淡出。收起/展开按钮固定在窗口左上角（交通灯右侧），不随侧边栏移动。图标内部的填充块表示当前状态。⌘B 可切换。
- **工具执行中**：卡片边框转为蓝色、图标脉冲、右侧显示秒表和旋转指示器、底部有一条来回移动的进度轨。
- **工具完成**：状态图标和 `+N −M` 统计用带回弹的 `scale` 弹入。
- **等待模型**：一条细弧在淡轨道上扫，旁边是已用时间和 token 数。单色，因为它旁边就是正文；排队与连续提问时，指示器紧跟最后一条用户气泡。
- **审批面板**：从输入框位置向上滑入。
- **消息操作与 Markdown 渲染**：用户气泡支持完整 Markdown 排版；侧边聊天过滤内部附件标记，避免模型专用展开正文污染气泡或编辑框；时间和复制按钮只在指针停在那条消息上时出现，位置固定不撑开行高。
- **按钮**：悬停变色，按下 `scale(0.9)`；建议卡片悬停上浮 2px。

## 权限

三档，在输入框左下角随时切换：

- **请求批准** — 每次写文件、执行命令、访问网络都问
- **帮我批准** — 只读命令（`git status`、`ls`、`grep`…）自动放行，其余仍然问
- **完全访问** — 全部放行

「始终允许」的对象会记进 `settings.json` 的 `alwaysAllow`。

## 会话日志格式

每个会话是一个 append-only 的 JSONL 文件，每条记录带单调递增的 `seq`：

```json
{"seq":3,"ts":1786230000000,"type":"message","message":{"role":"user",...}}
```

移动端按 `?since=N` 拉增量。并发的工具结果通过存储层的写队列串行分配 `seq`，不会出现重号。否则手机同步时会静默丢消息（`packages/core/test/store.test.ts` 覆盖了这个回归）。

## 开发

改完一遍跑完：

```bash
pnpm check     # lint + style + i18n + typecheck + arch + test，一条顶六条
```

单独跑某一条：

```bash
pnpm lint          # oxlint，--deny-warnings：警告等于失败
pnpm typecheck     # 7 个包
pnpm test          # 单元测试，含组件测试。用的是 node:test，不是 vitest/jest
pnpm arch          # 依赖方向，两秒
pnpm package       # 打出本机架构的安装包，release 之外唯一会跑 electron-builder 的地方
```

更细的约定在 [CONTRIBUTING.md](CONTRIBUTING.md)，包与包的边界在 [ARCHITECTURE.md](ARCHITECTURE.md)。
