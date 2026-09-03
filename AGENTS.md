# 给在这个仓库里干活的 agent

这份文件写给自动化——包括本仓库自带的那个 agent，以及任何被叫来改这份代码的模型。
人要看的东西在 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 一句话

Lyra 是一个 agent 运行时加两个前端。`packages/core` 平台无关，桌面端（Electron）
和移动端（Expo）驱动同一个 `AgentSession`。

## 改动之前

```bash
pnpm install
```

## 改动之后（必须全过）

```bash
pnpm lint        # oxlint，--deny-warnings：警告等于失败
pnpm typecheck   # 三个包
pnpm test        # 190 个单元测试
```

或者一条：`pnpm check`。

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

**不要为了让检查通过而放宽检查。** 规则报出来的如果是误报，加行内 `oxlint-disable-next-line`
并在同一行写明理由；不要去改 `.oxlintrc.json` 把规则关掉，除非你能说清楚这条规则
对整个仓库都不适用。

## 发版

打 tag 就是发版：推 `v*` 触发 `release.yml`，三平台各自构建，汇总成一个 release 并**直接发布**。

**打 tag 之前要跑一次 `Release dry run`**（`pnpm release:rehearse`，`pnpm release` 会验证它跑过）。 它跑的东西和 release
一模一样（三平台 lint/typecheck/test + `pnpm package`），只是不创建 release。绿了再打 tag。

为什么必须这一步：日常的 CI 不打包，而 `pnpm package` 是唯一会执行 electron-builder 的地
方。0.2.0 第一次发版就栽在这里——`executableName` 在 Linux 上不合法，这个配置错误在仓库里
待了很久，因为在此之前没有任何一条流程构建过 Linux 包。

发版是一条命令：

```bash
pnpm release:rehearse    # 触发 dry run 并等它跑完
pnpm release patch       # 写版本号、生成 CHANGELOG、提交、打 tag、推送
```

`pnpm release` 会自己检查「这个提交有没有绿色的 dry run」，没有就停下来——这一步以前靠记性。
版本号写在 8 个地方（7 个 package.json 加手机的 `app.json`），脚本一起改，`test/version-sync.test.ts`
守着它们不跑偏；新加一个包而忘了登记，那条测试会红。

以前汇总成草稿，要再手动 Publish 一次——结果 0.4.0、0.4.1、0.5.0、0.6.1 全都躺在草稿里：产
物齐全，客户端一个都收不到（更新检查跳过草稿和预发布）。手动的最后一步就是会被忘的一步。现
在 tag 一推、三平台绿了就直接发布，release notes 事后还能改，收不到的版本事后改不了。

## 硬约束

- **缩进 tab**，YAML/JSON 用 2 空格
- **注释用英文，解释为什么**，不复述代码做了什么
- **单文件尽量 300 行以内**，但拆分要有真实边界，不要对半切
- **不要动 `docs/`**：那是本地笔记，已经在 `.gitignore` 里
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

| 路径 | 是什么 |
| --- | --- |
| `packages/core/src/agent/` | 一轮循环、工具执行、重复检测 |
| `packages/core/src/runtime/` | 会话、日志、审批、任务队列、压缩 |
| `packages/core/src/tools/` | 内置工具。`risk*.ts` 判定哪些命令需要人来点头 |
| `packages/core/src/kernel/` | 插件内核：服务、事件、十条缝 |
| `packages/desktop/electron/` | 主进程：IPC、窗口、Git、同步服务 |
| `packages/desktop/src/` | 渲染进程 |
| `packages/mobile/` | Expo 应用 |

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
