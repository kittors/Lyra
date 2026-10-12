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

一个自带模型配置的独立通用型 agent。桌面端用 Electron，手机端用 React Native，手机上看到、操作的就是电脑上的那些会话。

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
一次），`Lyra-<版本>.exe` 是 x64 与 arm64 合一的 Windows 安装包（三百五十 MB 左右，上面那两个各一百七十多
MB，能确定架构就别下它），`SHA256SUMS` 是全部文件的校验值。装好之后应用会自己检查更新，而且只
安装校验对得上的包。校验值读不到就不装，宁可不更新。

## 第一次打开

安装包没有花钱买来的证书，所以三个系统都会先拦一下。每种拦法的放行方式不一样：

### macOS 首次打开

发布包是 ad-hoc 签名的，没有 Apple 开发者证书，也没有公证。双击会被 Gatekeeper 拦下来，说
「无法打开，因为无法验证开发者」。两种放行方式，选一种：

- 打开「系统设置 → 隐私与安全性」，点「仍要打开」，再输入密码确认。（从 macOS 15 起，右键「打开」已经绕不过 Gatekeeper。）
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
`Lyra-<版本>-<架构>.exe`，一百七十多 MB，那是安装包**自己**，不是主程序。通常是安装时把目标目录选成了
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
选 API 格式（**Responses**、**Anthropic Messages** 或 **Chat Completions**，按供应商文档选）、填 API Key，
再手动添加或「拉取模型」至少一个模型，每个模型那一行的测试按钮能试通不通。拉取弹窗里取消勾选就是移除；
端点没列出的模型，在它的搜索框里敲 ID、按回车就能加——很多中转的 `/v1/models` 不列生图模型，多半就这么加。

## 能力

- **自定义模型**：任意数量的供应商，每个供应商挂任意数量的模型。对接 **Responses**（`/v1/responses`）、**Anthropic Messages**（`/v1/messages`）和 **Chat Completions**（`/v1/chat/completions`）三种格式。
- **21 个内置工具**，按代码里的分组：
  - 文件与代码：`read` `write` `edit` `ls` `glob` `grep` `symbol` `lsp`
  - 执行命令：`bash` `bash_output`
  - 会话与记忆：`todo_write` `task` `skill` `rule` `recall` `learn` `ask_user`
  - 网络、预览与画图：`web_fetch` `web_search` `preview` `image_generate`（配了生图模型才会给模型）

  桌面端每个会话另有 5 个 `browser_*` 工具，操作浏览器面板。
- **Skill**：`SKILL.md` + YAML frontmatter。只有名称和描述进系统提示，正文在模型调用 `skill` 工具时才注入。装几十个技能也不烧上下文。
- **MCP**：stdio / Streamable HTTP / SSE 三种传输，工具以 `mcp__<服务>__<工具>` 命名注入，不会和内置工具撞名。
- **子智能体**：`task` 工具把工作交给拥有独立上下文窗口的子 agent，只把结论带回主对话。内置七个：`general` `explore` `review` `verify` `plan` `simple` `reason`。可以写在 `.lyra/agents/*.md` 或 `~/.lyra/agents/*.md`，也可以在「设置 → 智能体」里新建。
- **侧边聊天**：在当前会话旁边再开一个临时对话。它读得到主会话聊了什么，但一个字也不写进去；需要动手的事交给主会话排队执行。
- **窗口**：顶上一条工具栏：后退、前进（⌘[ ⌘]，Windows/Linux 上 Alt+← Alt+→，鼠标侧键也行）、侧边栏开关、当前会话的标题和它的「…」菜单，最右边是终端、浏览器、Git 三个按钮和一个列出全部面板的 ⋮「面板」菜单。左边一列图标：对话、拉取请求、已安排、插件、设置；窗口窄到侧边栏变成抽屉时，这些入口收进抽屉里。侧边栏和对话在同一块圆角面板里。macOS 上侧边栏透出系统的毛玻璃材质，「设置 → 外观 → 毛玻璃侧边栏」可以关掉。
- **面板**：文件、文件内容、终端、Git、侧边聊天、子 Agent、任务、轨迹、浏览器，想开几个开几个。默认每个面板各占一格，开在对话旁边，可以拖到任一侧；「设置 → 外观 → 面板」选「标签页」则全部收进右侧一个面板。文件面板是带语法高亮的编辑器，终端是真的 pty。
- **多会话分屏**：一个窗口最多并排四个会话，每个会话有自己的一套面板。会话不会窄于 420 px、面板不窄于 300 px；窗口太窄时面板挤着画，不会被挪走。
- **Git**：改动可以平铺或按目录树看（会记住），还有历史、分支和流水线。提交时弹出一个窗口：说明留空，当前模型先写好填进框里；可以选提交到哪个分支，或填一个新分支名，真正提交时才创建；「提交并推送」一步做完。
- **回复按模型写的来画**：你的消息和回复都按 Markdown 排版，mermaid 围栏画成图，指向本地文件的路径收成只显示文件名的胶囊，完整路径在悬停提示里。对话里的文件可以右键（回复里的文件链接、交付卡片的文件行、「文件变更」里每个文件的标题行）：在 Lyra 里打开、用你选的编辑器或别的应用打开、在访达或资源管理器中显示、复制完整路径或相对路径。一条 12 MB 的消息打开、滚动都不会卡住窗口。
- **从一条消息分叉**：在自己发过的消息上点「从这里分叉」，新开一个会话，带着这条之前的全部内容，这条消息（连同图片、附件、会话引用）放回输入框等你改，原会话一个字不动。回合还在跑的时候也能分叉。
- **画图**：加一个生图模型（`gpt-image-*`、`dall-e-3`、`imagen-*`、Gemini 的 `*-image`、FLUX、Seedream 等按名字自动认出），在任何对话里说要画什么，对话模型把活交给 `image_generate`，图就画在对话里，一次最多并排四张。贴一张图，或者直接说对话里的那张（最新的是 `#1`），就能改。鼠标停在图上有「编辑」和「下载」。见[生成图片](docs/guide/image-generation.md)。
- **拉取请求、定时任务、插件市场**：从左侧图标栏进入。在「设置 → 代码托管」里连上账号后可以在应用里审拉取请求；可以让一段提示词在某个项目里每隔 N 分钟或每天定时跑；插件市场里装插件或 MCP 服务。
- **内置格式化**：⇧⌘F（Windows/Linux 上 Shift+Alt+F）排当前文件，「设置 → 代码格式化」可以设成每次保存都排（默认关）。网页那一系走 Prettier；Python（ruff）、Go（gofmt）、C/C++/C#/Java（clang-format）、Swift、Dart、PHP、Lua 等的官方格式化器打包在应用里，不用另装。Rust、Kotlin、Ruby 等少数语言仍用本机装好的工具，比如 rustfmt。
- **Lyra 开着时不让电脑休眠**：「设置 → 常规」里的开关。打开后不息屏、不因闲置而休眠，长任务可以跑一夜。合盖仍然会睡。
- **移动端同步**：手机上看到的就是电脑上的那些会话，逐条同步：可以查看进行中的回合、批准操作、继续追问。三条路径：同一个 Wi-Fi 下直连、经你自己的域名和 TLS、或者两端各自往外拨到中转服务碰头。

## 结构

```
packages/
  core/              agent 内核：provider 适配、agent loop、工具、skill、MCP、会话存储
  desktop/           Electron 应用（主进程 + preload + React 渲染进程）
  mobile/            Expo / React Native 应用
  contract/          两个进程之间那条线，223 个方法写在一处
  relay/             中转服务，部署在公网上，手机和电脑谁也连不上谁时走它。单文件，零依赖；Lyra 不提供公共实例
  agent-cli/         在本仓库 CI 里审 PR、分 issue 的 agent，跑的是同一个 AgentSession
  registry-shared/   插件目录的索引格式，桌面端与目录服务共用
```

`core` 与平台无关，桌面主进程和同步服务共用同一个 `AgentSession`，所以手机和电脑不会看到两份不同的状态。
哪些代码能 import 哪些，规则列在 [ARCHITECTURE.md](ARCHITECTURE.md)，`pnpm arch` 和 `pnpm lint` 守着。

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
| `~/.lyra/sessions/sessions.db` | 所有会话和它们花掉的钱（SQLite） |
| `~/.lyra/skills/`、`agents/`、`commands/`、`rules/`、`plugins/` | 用户级的技能、子智能体、斜杠命令、规则、插件 |
| `~/.lyra/memory.json` | 你的个人记忆，在「设置 → 个性化」里管 |
| `~/.lyra/projects/<id>/memory/` | 一个项目学到的东西：`learn` 记下的 `learned.md`，后台整理出的 `MEMORY.md`（默认关） |
| `~/.lyra/session-media/` | 对话里贴的、画出来的图 |
| `<项目>/.lyra/skills/`、`agents/`、`commands/`、`rules/`、`plugins/` | 项目级的同一套，优先级高于用户级 |
| `<项目>/.lyra/prompts/identity.md`、`guidelines.md` | 替换这个项目里系统提示词的身份句和内置准则 |
| `<项目>/LYRA.md`、`AGENTS.md`、`CLAUDE.md` | 项目指令：从工作目录往上直到仓库根，每一层取这三个里第一个存在的；越近的越靠后，冲突时听它的 |

Lyra 也读 Claude Code 的 `.claude/skills`、`.claude/commands`、`.agents/`，以及 Cursor、Windsurf、Cline、Copilot 的规则目录。

换机器只需要拷 `~/.lyra`，拷之前先退出应用。拷之前想清楚 `credentials.json` 和 `vault.key` 要不要一起走。两个都在
才解得开，只拷一个等于把 Key 丢了。

应用开着的时候，不要把 `~/.lyra` 放在 iCloud、Dropbox、OneDrive 这类同步盘里。会话库写入时旁边有一个 `-wal`
文件，同步程序只拷走其中一个，拷过去的库就打不开了。

## 扩展与机制

插件、技能、MCP、子智能体的目录结构与文件格式，以及浏览器、索引库、钩子、移动端同步
的工作方式：

- [扩展 Lyra](docs/guide/extending.md)：插件目录结构、`SKILL.md` 格式、MCP 服务、子智能体定义
- [内置能力](docs/guide/capabilities.md)：提问与 `@` 引用、子智能体与调度、浏览器与其安全边界、索引库、钩子、移动端同步的三条路径
- [全部指南](docs/guide/README.md)，包括[生成图片](docs/guide/image-generation.md)
- [架构](ARCHITECTURE.md)：包与包的关系、边界规则、决策记录

要点：**插件是一组技能的打包，不含 MCP 服务。** 一个只有 `.mcp.json` 的目录不是插件，它是
一个 MCP 服务。目录页把两者分开列，装 MCP 服务会把它的声明写进「设置 › 插件 › MCP」，那里是这台
机器上所有 MCP 服务的唯一去处，手动配的和装来的都在一起。

远程 MCP 服务只跟随同源重定向：地址如果跳到别的域名或端口就连不上，报错里写着跳去了哪儿，把地址改成那个
即可。这样写在 headers 里的令牌不会被带到另一个源。

## 外观

「设置 → 外观」的每一项改了就生效：

- 主题：系统 / 浅色 / 深色，带预览。浅色是完整实现，不是回退。
- 每个主题三个颜色（强调色、背景、前景），另有几组预设。其余色阶按对比度滑块派生，这样选了任何背景色都不会得到读不清的文字或看不见的边框。
- 代码外观：浅色/深色代码高亮、行内代码颜色、代码字体、字号、字重、行高、字距。
- UI 字体、UI 字号、UI 字重、使用指针光标。
- 对话宽度：自动（默认，随窗格变宽，最宽 1120 px）、标准、宽、超宽、铺满，或填一个数。
- 输入框默认高度；出错时显示一行还是完整的报错。
- 调用链：折叠（默认）或展开；面板：分栏（默认）或标签页。
- 减少动态效果：系统 / 开启 / 关闭。
- 差异标记：颜色 或 `+/-`（给色觉障碍用户）。
- 仅 macOS：字体平滑、毛玻璃侧边栏（默认开）。

## 系统提示词

结构学自 [pi](https://github.com/earendil-works/pi)：

```
身份（一句话；项目里的 .lyra/prompts/identity.md 可以替换它）
Available tools:            每个工具一行 snippet
Guidelines:                 基础规则（.lyra/prompts/guidelines.md 可替换）+ 已加载工具各自贡献的规则
Boundaries:                 不可越过的边界
Environment:                平台、shell、是否 git 仓库、模型
语气、<global_user_instructions>   「设置 → 个性化」里填了才有
<user_memory>               你让它记住的东西
<project_memory>            这个项目学到的东西
<available_skills>          名称 / 描述 / 目录，不含正文
<rules> / <rulebook>        总是生效的规则正文，以及其余规则的清单
<available_subagents>       名称 / 描述 / 可用工具，外加派活的积极程度和并发上限
<project_context>           AGENTS.md 等项目指令，用 XML 标签包裹
Current working directory: …
Scratch directory: …        临时文件放这里，随会话删除
## Addresses                session://、skill://、artifact:// 等 read 认得的地址
```

要点：

- 规则挂在贡献它的工具上（`Tool.guidelines`）。没加载 `bash` 的会话就不会看到关于 shell 命令的建议，也不会留下过时的指导。
- 提示里只放 `snippet`（一行），完整的 `description` 走供应商的 tool schema。同一份信息不重复占两次上下文。
- 技能只列名称、描述和目录，正文在模型调用 `skill` 工具时才注入。
- 子智能体清单是必要的：没有它，模型不知道 `subagent_type` 有哪些取值，即使用户点名 `explore` 也会退回 `general`（这是实测发现的）。
- 技能描述里的 `<` `&` 会被转义，一个恶意的 `description` 不能提前闭合 XML 标签往提示里塞指令。
- 日期不在系统提示词里：它以一小段 `<env>` 接在最后一条消息后面，跨天时只让末尾那一小段缓存失效。

`packages/core/test/system-prompt.test.ts` 覆盖了以上每一条。

## 面板

面板开在对话旁边。终端、浏览器、Git 三个在窗口顶栏最右端各有一个按钮（同时开着几个会话时，在各自的标题栏里），
旁边的 ⋮「面板」菜单列出全部面板和快捷键。默认每个面板各占一格，可以拖到对话的任一侧；「设置 → 外观 →
面板」选「标签页」，就全部收进右侧一个面板、每个一个标签。Windows/Linux 上 ⌘ 换成 Ctrl：

| 标签 | 快捷键 | 内容 |
| --- | --- | --- |
| 文件 | ⌘P | 文件树。点一个文件就把「文件内容」带出来 |
| 文件内容 | ⌥⌘P | 语法高亮编辑器。标题显示的是文件名，不是「文件内容」 |
| 终端 | ⌃` | 真实的 pty，不是命令回显 |
| Git | ⌘⇧R | 工作区改动（平铺或树形）、历史、分支、流水线；在弹窗里提交、推送 |
| 侧边聊天 | ⌥⌘S | 见上 |
| 子 Agent | ⌥⌘A | `task` 派出去的子 agent 各自在干什么 |
| 任务 | ⌘J | 当前的 todo 清单 |
| 轨迹 | ⌘L | 这一轮到底发了什么给模型：工具、技能、注入的上下文 |
| 浏览器 | ⌘T | 内置浏览器，边界见[内置能力](docs/guide/capabilities.md) |

还有一个「文件变更」面板不在菜单里，从交付卡片打开：看的是这一轮写了什么，不是工作区；可以弹出成独立窗口。

- **宽度可拖**：侧边栏边缘和面板之间的分隔线都能拖，方向键微调（按住 Shift 走大步）。双击侧边栏边缘回到默认宽度，双击面板之间的分隔线把两边平分。宽度记在本地，重启还在。
- **全屏**：面板可以铺满它所在的那一屏，Esc 退回。此时文件标签变成左树右文件。
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

一个总数只能告诉你快满了，分项才能告诉你该做什么：是开新对话、关掉某个 MCP 服务，还是去删一份没人再读的 `CLAUDE.md`。总数以上一轮回复的真实用量为准，之后新说的话和各分项的拆分是估算的；还没回复过、或刚压缩过时整个数都是估算，界面会标出来。超过 80% 转红，因为运行时到那个量级就开始把最早的对话摘要压缩掉了。弹层底部的「记忆文件」列出注入的每份指令文件和项目记忆各占多少，点一下就打开。

## 交互动效

界面上每个会变化的东西都有对应的动作提示，时长分三档：150、220、340ms；系统开了减少动态效果，或「设置 → 外观 → 减少动态效果」打开时就不动。

- **侧边栏**：`margin-left` 从 0 滑到负的当前宽度，配合淡出。开关在窗口顶栏里，排在后退、前进之后，不随侧边栏移动。图标内部的填充块表示当前状态；侧边栏收起时，开关上的小圆点表示有会话在等你、出错或已完成。⌘B（Ctrl+B）切换。
- **工具调用**：默认整轮收在一行下面，每次调用一行。在跑的那行文字上扫过一道光，旁边是秒数；跑完就安静下来，失败或被停止的留着标记；`+N −M` 统计带回弹弹入。「设置 → 外观 → 调用链」选「展开」，回到带边框的卡片：运行中边框转蓝、图标脉冲、右侧转圈、底部一条进度轨，完成时打勾。
- **等待模型**：一个小光球，图案随它在做的事变（想、读、写、改、跑命令、搜、跑测试、上网、排计划），旁边一句几秒换一次的短语、已用时间、token 数和估算的每秒 token 数。紧跟最后一条用户气泡。
- **审批与提问**：卡片排在输入框正上方，占自己的高度，对话在它上面滚动，不会被挡住。
- **消息操作**：时间、复制，以及自己消息上的撤回、编辑重发、从这里分叉，只在指针停在那条消息上时出现，位置固定，不撑开行高。
- **按钮**：悬停和按下改变底色，标签条按下时略微缩小。欢迎页输入框下面的提示词胶囊逐个展开，悬停时描边加深。

## 权限

三档，在输入框左下角随时切换：

- **请求批准** — 每次写文件、执行命令、访问网络都问
- **帮我批准** — 只读命令（`git status`、`ls`、`grep`…）自动放行，其余仍然问
- **完全访问** — 全部放行

「始终允许」的对象会记进 `settings.json` 的 `alwaysAllow`。

## 会话存储

会话存在一个 SQLite 库里。每个会话是一串只追加的记录，每条记录带单调递增的 `seq`：

```json
{"seq":3,"ts":1786230000000,"type":"message","message":{"role":"user",...}}
```

移动端按 `?since=N` 拉增量。每条记录的 `seq` 在写入它的那个事务里分配，并发的工具结果不会出现重号。否则手机同步时会静默丢消息（`packages/core/test/store.test.ts` 覆盖了这个回归）。回复在流式输出的过程中就在落盘，进程崩了也留得下已经收到的部分。删掉一条会话，它花掉的钱仍然算在用量页里。`pnpm dump:session <id>` 把一条会话的记录按上面的形状一行一条打印出来。

换库之前的版本把每个会话存成 `~/.lyra/sessions/<项目>/` 下的一个 JSONL 文件。装上带数据库的版本后第一次启动，会把它们导入进来，`seq` 原样保留，旧日志留在原地当备份；删掉一条会话时，它的旧日志也一起删，旧版的展示缓存导入后就清掉。为什么这样设计见 [ADR-0032](docs/adr/0032-sessions-in-sqlite.md)。

## 开发

改完一遍跑完：

```bash
pnpm check     # lint + links + style + i18n + typecheck + arch + test，一条顶七条
```

单独跑某一条：

```bash
pnpm lint          # oxlint，--deny-warnings：警告等于失败
pnpm typecheck     # 6 个包（relay 是纯 JS）
pnpm test          # 单元测试，含组件测试。用的是 node:test，不是 vitest/jest
pnpm arch          # 依赖方向，几秒
pnpm package       # 打出本机架构的安装包，release 之外唯一会跑 electron-builder 的地方
```

更细的约定在 [CONTRIBUTING.md](CONTRIBUTING.md)，包与包的边界在 [ARCHITECTURE.md](ARCHITECTURE.md)。
