# 给在这个仓库里干活的 agent

这份文件写给自动化——包括本仓库自带的那个 agent，以及任何被叫来改这份代码的模型。
人要看的东西在 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 一句话

Lyra 是一个 agent 运行时加两个前端。`packages/core` 平台无关，桌面端（Electron）
和移动端（Expo）驱动同一个 `AgentSession`。

## 第一原则

**一、准确完成用户要的那件事。二、在做到第一条的前提下，更快、更省 token。**

顺序不能反。为了省 token 而少做、做错、半途停下，是把第一条丢了去换第二条——那不是优化，
是失败。反过来，第一条做到了之后，快和省就是这个产品的全部竞争力：同一件事，别人要三十轮、
五百万 token，我们要十轮、五十万。

这条原则在设计上意味着几件具体的事：

- **别让循环替人做决定。** 「它是不是卡住了」这个判断没有可靠信号——试过两次，两次都误伤真实
  工作（见 `packages/core/src/agent/repetition.ts` 顶上那段教训）。能确定的事才自动处理，
  不确定的交给人。
- **拦不如纠正。** 发现模型在原地打转时，第一反应是给它一句具体的、能据以改变行为的话，而不是
  直接结束这一轮。停下来既没告诉它该怎么办，也没把等结果的人放出来。
- **纠正无效才停。** 纠正过了还在重复，那就是真的走不下去了，继续跑只是烧钱——这时停是在执行
  第二条原则，不是违背第一条。
- **不要在对话里念账单。** 花销属于设置页。用户要的是任务跑完，不是每隔几轮被提醒一次花了多少。
- **先量再改。** 上面两次误伤的共同点是没有先量。`pnpm audit:sessions` 会在本机的真实会话上
  跑一遍成本体检，任何动到循环、截断、停止条件的改动，改前改后各跑一次、拿两份输出对照。

不确定某个机制该怎么设计时，先去看 `opencode`、`pi`、`oh-my-pi`、`deepseek-harness`
这些开源 agent 是怎么做的，再动手。这类问题它们大多已经踩过一遍。

具体该改什么、怎么验，见
[agent 的成本结构与停止机制](docs/architecture/agent-cost-and-stopping.md)——那份清单里的每一条
都配着实测数字和验收标准。

## 干活的方式

上面那条原则管的是产品怎么设计，这一节管的是**你自己**怎么花时间。三条都是从实际跑坏的会话
里总结的，每条都直接对应一段被浪费掉的上下文。

### 新界面要的文案，直接加词条，不要全库去找

遇到一个没见过的说法——「包含未暂存的更改」「提交并推送」——本能是 grep 全仓库找现成的键。
搜不到就换个词再搜一遍。这段搜索几乎总是白费的：**这句话是这次需求才有的，它当然不存在。**

分界很清楚：

- **通用词**（取消、保存、重试、关闭）大概率已有，值得找一次，找一次就够。
- **这次需求特有的句子**一律直接在 `packages/desktop/src/i18n/messages/` 七个语言文件里加
  新键，不要先去证明它不存在。

键名跟着功能域走（`git.*`、`dock.*`、`browser.*`），七种语言一次加齐——少一种，那个语言的
界面上就会出现一个英文键名。

### 一次交代好几件事时，干完一件再看下一件

一段需求里有五项，从最轻的那项开始做，**只读那一项需要的文件**。在改一个 CSS 类名的时候去
全库检索第四项要动的模块，是把两件事的上下文搅在一起：第一项的交付被推迟，第四项的信息到真
正做它的时候也已经被后来的内容挤掉了。

前置的轻量修复就地闭环、当场验证、立刻推进。需要跨项的全局判断时，把它当成单独的一项来做，
而不是塞进另一项的执行过程里。

### 注释写在哪，以及什么时候可以改它

这个仓库的注释密度是刻意的——它们记着踩过的坑，而那些坑大多不便宜。但长篇的设计论证读起来
像「这里不可碰」，于是每一次改动都先花一轮自我说服。两件事分开放：

- **代码里**：为什么这里必须这样、边界条件是什么、改坏过一次的是哪种写法。
- **`docs/architecture` 与 `docs/adr`**：演进史、方案比较、长篇取舍。代码里留一行指过去。

**围绕需求和缺陷的合理重构是受鼓励的**，不必被既有的视觉描述或设计论证捆住手脚。唯一要守的
规矩是：注释里明写着「为什么这里不同于别处」的那一段，改之前要正面回答它——说清楚那个理由为
什么不再成立，或者为什么这次的目标更重要。回答不了就先别动，这种地方通常有它的道理。

## 改动之前

```bash
pnpm install
```

## 改动之后（必须全过）

```bash
pnpm lint        # oxlint，--deny-warnings：警告等于失败
pnpm typecheck   # 7 个包
pnpm test        # 单元测试，含组件测试
node scripts/audit-regression.mjs   # 修过的每个 bug，各自的守卫跑一遍
pnpm arch        # 依赖方向，见 ARCHITECTURE.md 的「边界」
```

前三条是一条：`pnpm check`。`arch` 另跑，两秒。

### 三条命令全绿 ≠ 做完了

**必须在真实应用里验证到「看得见」。** `tsc` 通过只证明类型自洽，测试通过只证明被测的那部分
成立——凡是用户能看到、能点到的改动，都要在跑起来的应用里量一遍，量到具体的数。

这一条是用代价换来的，反复踩：

- 图片预览的放大动画交付时类型干净、组件挂载正确、入口都接上，而它从第一帧起就是死的——
  `getBoundingClientRect` 量到了被自己变换过的盒子，缩放比例算成 1。
- 标注工具条的按钮「有 tooltip」，而全应用的 tooltip 从来没显示过：属性写 `data-ly-tip`，
  代码读 `dataset.dwTip`，一个改名时漏掉的字母。
- 面板展开写了 `transition` 却是硬切，因为切换形态时 React 把它卸载重建了——过渡属于元素，
  而那是另一个元素。
- 市场卡片的图标是碎图：`img-src` 不允许远程地址，而这在任何静态检查里都不是错误。

怎么算「量一遍」：

- **拿到数，不要拿感觉。** 逐帧采样宽度、比对像素哈希、读 `getComputedStyle`。「看起来对」
  不是结论。
- **从用户能看见的东西取证**，不要读 React 内部状态。一笔画上去了 = 画面变了；撤销正确 =
  画面回到了那一状态的哈希。走 fibre 树读到过别的组件的 state，给出过完全错误的结论。
- **断言失败先怀疑断言。** 出现过三次「代码是对的、测试写错了」，也出现过一次据此回滚了正确
  的改动。
- **验完把测试数据清掉**，不要留在用户的目录里。

没条件验证的部分（比如受网络限制），**在交付时明说哪一步没验**，不要含糊过去。

### 验证要录一段视频，放到桌面上

**凡是在真窗口里验的，都录下来交给用户**，不要只把一串 ✅ 贴在回复里。视频写到
`~/Desktop/<这件事叫什么>测试/`，文件名带时间戳和通过数：

```
~/Desktop/Lyra输入历史测试/2026-09-12-06-18_方向键翻输入历史_12of12.mp4
```

录法在 `e2e/record.ts`：`startRecording` 开 CDP 的 `Page.startScreencast`、`encode` 合成。
照着 `e2e/input-history-demo.ts` 或 `e2e/attachments-demo.ts` 写，剧本部分换掉就行。

**拍窗口，不拍屏幕。** 抓全屏会把用户手边的私人窗口一起录进去——这不是美观问题。screencast
只拍这一个 `BrowserWindow`，其他窗口从来不在画面里。

一段验证视频要能自己站住：每一步之间留够停顿（一步一秒上下），让人来得及看清；断言照旧用
`check()` 打在终端上，两者说的是同一件事，视频回答「看起来对不对」，终端回答「量出来是多少」。
只有绿勾没有视频，等于让用户替你相信；只有视频没有断言，下次改坏了没人拦得住。

**不要为了让检查通过而放宽检查。** 规则报出来的如果是误报，加行内 `oxlint-disable-next-line`
并在同一行写明理由；不要去改 `.oxlintrc.json` 把规则关掉，除非你能说清楚这条规则
对整个仓库都不适用。

## 发版

打 tag 就是发版：推 `v*` 触发 `release.yml`，六个 runner 各自构建，汇总成一个 release 并**直接发布**。
一个 release 里 14 个文件：桌面端 11 个（macOS 的 dmg 与 zip 各 arm64/x64、Windows 的 exe
x64/arm64 加一个两架构合一的、Linux 的 AppImage 与 deb 各 x64/arm64），手机端 2 个
（`Lyra-x.y.z-android.apk` 签名的、`Lyra-x.y.z-ios-unsigned.ipa` 未签名的），加一份 `SHA256SUMS`。
怎么打包、为什么 iOS 不签名、Android 的钥匙为什么是一次性的决定，见
[docs/architecture/mobile-packaging.md](docs/architecture/mobile-packaging.md)。

**打 tag 之前要跑一次 `Release dry run`**（`pnpm release:rehearse`，`pnpm release` 会验证它跑过）。 它跑的东西和 release
一模一样（六个 runner 的 lint/typecheck/test + `pnpm package` + `expo prebuild` 与两端原生构建），
只是不创建 release。绿了再打 tag。

为什么必须这一步：日常的 CI 不打包，而 `pnpm package` 是唯一会执行 electron-builder 的地
方。0.2.0 第一次发版就栽在这里——`executableName` 在 Linux 上不合法，这个配置错误在仓库里
待了很久，因为在此之前没有任何一条流程构建过 Linux 包。手机端是同一类：`android/` 和 `ios/`
不在仓库里，每次都由 `expo prebuild` 从 `app.json` 生成，所以插件参数、权限文案、SDK 版本的问题
只有原生构建才会报出来。

Android 的签名要四个 secret（`ANDROID_KEYSTORE_BASE64` 等，`packages/mobile/scripts/make-release-keystore.sh`
一次生成并打印）。没配的话 `pnpm release` 在推 tag 之前就会停下——排练不会因此变红，而 release
会在签名那一步死掉，留下一个没有 release 的 tag。

发版是一条命令：

```bash
pnpm release:rehearse    # 触发 dry run 并等它跑完
pnpm release patch       # 写版本号、生成 CHANGELOG、提交、打 tag、推送
```

`pnpm release` 会自己检查「这个提交有没有绿色的 dry run」，没有就停下来——这一步以前靠记性。
版本号写在 9 个地方（根目录和 7 个包的 `package.json` 加手机的 `app.json`），脚本一起改，`test/version-sync.test.ts`
守着它们不跑偏；新加一个包而忘了登记，那条测试会红。

以前汇总成草稿，要再手动 Publish 一次——结果 0.4.0、0.4.1、0.5.0、0.6.1 全都躺在草稿里：产
物齐全，客户端一个都收不到（更新检查跳过草稿和预发布）。手动的最后一步就是会被忘的一步。现
在 tag 一推、六个 runner 绿了就直接发布，release notes 事后还能改，收不到的版本事后改不了。

### 发版文案是手写的，七种语言一种都不能少

`pnpm release` 生成的那一节是提交列表（`- **scope**: 提交标题 (sha)`），**那是原料，不是成品**。
真正发出去的是 CHANGELOG 里七个块：

```
<!-- lyra:notes en -->      <!-- lyra:notes zh-CN -->    <!-- lyra:notes zh-TW -->
<!-- lyra:notes ja -->      <!-- lyra:notes ko -->       <!-- lyra:notes fr -->
<!-- lyra:notes ru -->
```

GitHub Release 正文是这七段按写下的顺序排出来的全文，**英文必须在最上面**。客户端按当前语言只抽一段，顺序不影响它。

tag 说明和 GitHub Release 正文都由 `scripts/changelog-section.mjs` 从这里读，所以**改 CHANGELOG
就是改发布内容**。0.9.6 是写对了的样子，照它写。

七种语言是**各写一遍，不是把中文翻七份**。日语用日语的说法，法语用法语的句子结构；每种语言里
的产品名词要和该语言的界面文案对得上（对不上就是用户在设置里看到一个词、在更新说明里看到另一
个词）。

**写给用的人，不是写给改代码的人。** 一条说明先讲他遇到过的那个现象，再讲现在会怎样：

- ✅「项目放在软链下时，文件操作全部失效，而且一声不吭」——他试过，他知道这回事
- ❌「修复了 `resolveRealPath` 的路径比较逻辑」——他不看源码，这句对他没有信息

**不要 AI 味。** 具体指：

- 不写「全新」「极大提升」「显著优化」「更加流畅」「全方位」「赋能」「体验升级」这类词。
  说不出具体差别的形容词，一个都不要
- 不写「我们很高兴地宣布」「敬请期待」「让您的工作更高效」这种腔调
- 不用排比句凑气势，不给每条都套一样的句式
- 数字要真实：写「4px 到 6px」，不写「优化了间距」；写不出数字就老老实实讲现象
- 允许有具体的技术细节（`/var/…` 与 `/private/var/…` 这种），它让人相信问题真的被看清了
- 一条讲不清楚就分两条，不要硬塞进一个长句

改了代码就要重新排练，所以文案在排练期间写——那 15 分钟正好够。

## 硬约束

- **缩进 tab**，YAML/JSON 用 2 空格
- **注释用英文，解释为什么**，不复述代码做了什么
- **单文件尽量 300 行以内**，但拆分要有真实边界，不要对半切
- **`docs/plan` 与 `docs/notes` 是本地笔记**，在 `.gitignore` 里，不要当成文档改。
  `docs/architecture`、`docs/adr`、`docs/guide` 进仓库——改了行为要同步改它们
- **不要提交任何密钥**。模型配置在 `~/.lyra/settings.json`，不在仓库里
- 改了行为就补测试。规则性的代码（分组、风险判定、去重）尤其要测

## 跨平台

CI 的单元测试跑 Linux 和 Windows；macOS 只在 PR、tag 和手动触发时跑（计费是 Linux 的十倍）。

**Windows 不是「再跑一遍」，它是会以不同方式坏掉的那个平台。** 已经踩过的两种：

- 路径包含判断写成 `` p.startsWith(`${root}/`) ``。Linux/macOS 上对，Windows 上恒假，因为
  分隔符是 `\`。要判断包含就问 `path.relative()`，别自己拼分隔符。
- 测试用 `process.env.HOME` 做沙箱。`os.homedir()` 在 Windows 上读的是 `USERPROFILE`，于是
  沙箱没生效、测试摸到了真实用户目录。两个都要设。

命令文本里的路径是另一回事：`risk.ts` 分析的是 `cd /tmp` 这类字面量，那里的 `/` 是场景本身，
不要「顺手修掉」。

## 容易踩的坑

- **Node 的 `--experimental-strip-types` 不支持构造函数参数属性**。`constructor(private x: T) {}`
  能通过 tsc 但会让测试整个文件挂掉。写成显式字段赋值。
- **测试用 `node:test`**，不是 vitest/jest。别引测试框架。
- **core 不能 import 任何端上的东西**，反过来也一样：**渲染进程不能从 `@lyra/core`
  根入口导入"值"**。类型（`import type`）编译期就擦掉了，没有代价；值会把整个 index 拉进
  浏览器，而 index 一路连到 `node:fs`、`node:child_process`——bundle 加载、在第一个 Node
  内置模块上抛错、窗口一片空白。浏览器要用的东西走子入口：`@lyra/core/schedule`、
  `@lyra/core/trajectory-view`、`@lyra/core/activity`。
- **给 core 加了新的子入口，要重启 dev server**。Vite 缓存 exports 解析，不重启会报
  "not exported under the conditions"。
- **改了 core 要重启桌面端**，HMR 只覆盖渲染进程；主进程里的 core 代码不会热更新。
- **`position: sticky` 会被任何祖先的 `overflow: hidden` 破坏**。

## 目录

先看 [ARCHITECTURE.md](ARCHITECTURE.md)——包与包的关系、五条边界规则、以及「要做某件事去哪」。

| 路径 | 是什么 |
| --- | --- |
| `packages/core/src/agent/` | 一轮循环、工具执行、重复检测 |
| `packages/core/src/runtime/` | 会话、日志、审批、任务队列、压缩 |
| `packages/core/src/tools/` | 内置工具。`risk*.ts` 判定哪些命令需要人来点头 |
| `packages/core/src/kernel/` | 插件内核：服务、事件、十条缝 |
| `packages/desktop/electron/` | 主进程：IPC、窗口、Git、同步服务 |
| `packages/desktop/src/` | 渲染进程。10 个目录，见 ARCHITECTURE.md |
| `packages/desktop/src/features/` | 23 个功能域，跨域只经对方的 index |
| `packages/desktop/src/ui/` | 基础组件，不读 store 不调 service |
| `packages/desktop/src/lib/` | 纯逻辑，没有 React |
| `packages/desktop/src/services/` | 跟主进程说话的唯一出口 |
| `packages/contract/` | 渲染进程与主进程之间那条线，215 个方法写在一处 |
| `packages/desktop/shared/` | 两个进程共有的判断，谁也不依赖 |
| `packages/mobile/` | Expo 外壳：配对、扫码、承载桌面端界面的 WebView |
| `packages/relay/` | 中转服务。单文件，零依赖 |

## 提交

主题一行中文，说清楚解决了什么问题；正文讲为什么。不要写"修复若干问题"。

格式是 conventional commits，`commit-msg` 钩子会拦不合规的：

```
<type>(<scope>): <中文主题>

<为什么这次改动是必要的；踩过什么坑>
```

type 取 `feat` `fix` `perf` `refactor` `docs` `test` `chore` `ci` `build` `revert`；
scope 取 `core` `desktop` `electron` `ui` `mobile` `relay` `cli` `registry` `sync` `release` `deps`，
写错只警告不拦。前四个 type 会进 CHANGELOG，其余不进。
