# 测试

三层，各自答不同的问题。

| 跑什么 | 答什么 | 多久 |
| --- | --- | --- |
| `pnpm test` | 规则对不对：分组、风险判定、路径、diff 解析、组件渲染出什么 | 约 25 秒 |
| `pnpm arch` | 谁可以 import 谁 | 约 2 秒 |
| `pnpm test:e2e` | 真实窗口里，点下去会怎样 | 约 20 分钟 |

## 单元测试

用 Node 自带的 `node:test`，不引测试框架。跑在 `--experimental-strip-types` 下，所以测试文件
是 `.ts` 而不能是 `.tsx`。

跨平台测试用 `node:fs` 遍历源码，不依赖 POSIX shell 或 `grep`；文件路径断言用 `node:path`
构造完整预期值。隔离用户目录时同时设置 `HOME` 与 `USERPROFILE`，清理文件前先释放会话。
能力监听用真实路径交给 `fs.watch`，避免 Windows 短路径通知导致 libuv 断言退出，并在 Linux
递归监听异步启动前拒绝不存在的目录。扩展入口经 `pathToFileURL` 加载，Windows 盘符和文件名中
的 `#`、`%` 都按文件路径处理。对应回归在 `capability-watch.test.ts` 与 `extension-host.test.ts`。

## 组件测试

在 `packages/desktop/test/ui/`，`pnpm --filter @lyra/desktop test:ui`。用 happy-dom 真的挂载再
断言，一秒跑完。写法用 `createElement` 而不是 JSX，辅助函数在 `test/helpers/mount.ts`。

断言要对着**用户能观察到的东西**——渲染出的属性、文字、可访问名——而不是内部状态。
`test/ui/tooltip-contract.test.ts` 是这个原则最清楚的例子：它不断言「组件设置了 data-ly-tip」，
而是断言「组件写出来的东西，能被 tooltip.ts 实际用的那个选择器找到」。这两句话听起来一样，
但只有后者能抓住那次真实事故——属性改了名，读的那一侧没跟上，全应用的 tooltip 静默失效。

见 [ADR-0008](../adr/0008-node-test-and-happy-dom.md)。

## 端到端

对话滚动与切换的回归约束见 [对话渲染与阅读位置](conversation-rendering.md)。聚焦验证可运行：

```bash
pnpm build
pnpm --filter @lyra/desktop exec node --test --experimental-strip-types e2e/transcript-stability.test.ts
```

`packages/desktop/e2e/`，跑真实的 Electron 窗口，经 DevTools 协议驱动。一次一个应用
（`--test-concurrency=1`）：三个窗口抢一台笔记本会让量布局的测试失败，而那是最糟的红——被测
的代码本身没问题。

测试直接启动 Electron 二进制，由 desktop 的 `package.json` 定位 `out/main/index.js`，保留
原来的 `app.getAppPath()`。运行前先 `pnpm build`；每个测试文件
不会再经 `electron-vite preview` 重建，因而测的是同一个构建，Windows 也不需要通过 shell
启动 `pnpm.cmd`。退出时 Windows 用 `taskkill /T` 回收 Electron 的进程树，启动失败同样清理
临时 profile。

CDP 求值先取得远程对象句柄，在同一连接内等待 Promise 或读取对象值，最后释放对象组。
Electron 43 携带的 V8 尚未包含 [536271637 的修复](https://chromium-review.googlesource.com/c/v8/v8/+/8123081)，
直接使用 `Runtime.evaluate(awaitPromise: true)` 只保留弱引用，GC 会让待完成求值报
`Promise was collected`。`cdp-lifetime.test.ts` 强制 GC 验证等待期间保活，并检查完成、拒绝及
序列化失败后的释放；不改变应用 IPC，也不重试失败的操作。

### Windows 桌面回归

CI 的 `windows-ui` 在 push、PR 和手动执行时运行真实 Windows Electron，并纳入 `all-green`。
它跑 `desktop-compatibility.test.ts`、`transcript-stability.test.ts`、`interaction-polish.test.ts`、
`session-startup.test.ts`、`definition-actions.test.ts`、`command-workflow.test.ts`、`visual-details.test.ts`、`agent-profiles-sidechat.test.ts`、`navigation-models.test.ts`、`model-menu-polish.test.ts`、`usage-dashboard.test.ts`、`workspace-quality.test.ts`、`browser-workspace.test.ts`、`menu-scroll.test.ts` 与 `cdp-lifetime.test.ts`：

- 100%、125%、150%、200% Chromium 显示缩放，深浅主题和 380px 起的窗口宽度。
- 从 Window Controls Overlay API 读取系统按钮区域，验证应用按钮没有进入它。
- 检查原生 overlay 与工具栏中心线，以及侧栏切换前后、终端标签增多后的图标和按钮对齐。
- 输入框边界、Tab 焦点标记、Windows 快捷键提示、终端标签和新建/关闭入口。
- 长对话滚动范围、思考行去重、历史展开状态、会话切换首帧和阅读位置。
- 问题刻度导航、设置路由、渐隐、跨 Tab 保留、Git Index 统计与 C# 高亮。
- 15 刻度邻域与首尾导航、问答预览、图片气泡与时间分隔、发版弹窗逐帧尺寸、模态焦点/嵌套/窄屏/减少动画，以及项目记忆开关与压缩占比。
- 子智能体的供应商/模型/思考等级选择、真实请求参数、375px 设置布局；侧聊早期记录和工具尾部检索、主会话压缩、切换、冷恢复与编辑重发。
- 慢 MCP 初始化前的首条提交、取消、折叠状态、同名隔离及后台完成。
- 最近创建默认排序、记忆文件真实打开、座右铭持久化、Chromium IME、截图开关主进程校验。
- 工程净差异与报告打开、hover 行高、后续编辑保护、实际服务 listener、跨会话停止拒绝与真实结束。
- Agent 驱动可见浏览器、原生输入与缩放后点击、标签保留、元素/框选截图、DevTools、书签与无效 IPC。
- 列表删除的悬停渐变、键盘确认、触摸可见性、固定布局，以及命令、技能目录和规则移入系统废纸篓。
- 斜杠命令的原生编辑、撤销、光标补全、参数装饰、长草稿滚动、菜单渐隐，以及压缩的参数传递、取消、结果与跨会话隔离。
- 模型菜单的收藏置顶、供应商折叠和内部滚动，以及用量页的离线计价、缓存分类、图表切换、模型目录同步和窄窗口重排。

设置 `LYRA_E2E_ARTIFACTS` 可以保存真实应用截图；CI 保留 7 天。测试使用临时项目和合成会话
日志，经真实应用加载，退出后清理。模型请求只发给测试启动的本地协议服务，不使用用户密钥。

本地聚焦运行：

```bash
pnpm build
pnpm --filter @lyra/desktop exec node --test --test-concurrency=1 --experimental-strip-types e2e/desktop-compatibility.test.ts e2e/transcript-stability.test.ts e2e/interaction-polish.test.ts e2e/session-startup.test.ts e2e/definition-actions.test.ts e2e/command-workflow.test.ts e2e/visual-details.test.ts e2e/agent-profiles-sidechat.test.ts e2e/navigation-models.test.ts e2e/model-menu-polish.test.ts e2e/usage-dashboard.test.ts e2e/workspace-quality.test.ts e2e/browser-workspace.test.ts e2e/menu-scroll.test.ts e2e/cdp-lifetime.test.ts
```

macOS 上运行这些测试可验证共享 Chromium 布局，不能证明 Windows 的 DirectWrite、GPU 驱动、
原生 IME 或多屏 DPI 切换都正常。Windows CI 的强制缩放也不替代跨显示器拖动的实机测试。
平台行为约束见 [Windows 桌面适配](windows-desktop.md)。

### macOS 原生标题栏

CDP 截图不包含原生红绿灯，无法发现它们与 HTML 图标之间的 1pt 偏差。有屏幕录制权限的
macOS 环境可运行 `pnpm --filter @lyra/desktop exec node --experimental-strip-types e2e/header-native-probe.ts`。
它启动隔离窗口，用系统截图取原生灯像素，与真实 DOM 图标中心线比较；截图中的灯高度也必须
落在有效范围，避免截图缺失产生假绿。`LYRA_E2E_ARTIFACTS` 可保留原始截图，临时 profile 自动清理。

### 定位端到端失败

每条失败都要解释，历史失败数量不能代替本次证据。先读断言针对的可见元素，再单独重跑；仍不能
区分实现回归与既有问题时，在隔离 worktree 对同一个测试、同样条件做比较。不要用总失败数相同
推断没有回归，也不要放宽断言阈值来接受一条未解释的失败。

Activity 会保留隐藏页面的 DOM。全局 `querySelectorAll` 可能读到已隐藏分区；视觉断言必须限定
当前页面，或使用 `checkVisibility({ visibilityProperty: true })`。工具组的详情需要先展开，
中途切换模型需要完成真实确认步骤；不能根据旧 UI 的行为读取未展示的内容。

测试只清理自己创建的 Electron 进程及临时目录。不要用全局 `pkill` 回收用户正在运行的应用。
同一机器一次运行一份 Electron E2E，运行期间不重建 `out`，避免删除仍在读取的懒加载 chunk。

首次读取的骨架屏要用真实慢输入或受控 deferred 响应验证；缓存命中不应被要求重播骨架。
数值证据与本次范围见 [交互质量与验证](interaction-quality.md)。


### 探针结果在跳的时候

**一个探针红了两次还定不了性，就停下来换方式，不要接着跑它。** 这一条是踩出来的：
`screenshot-probe` 的结果在 1 到 11 个问题之间跳，有人把它连续跑了八次试图"跑稳"，而同一段时间
里别的已修问题一条都没复测。八次跑完得到的信息和第二次一样多。

怎么定性：

1. **交替对照，不要连续跑同一版。** 基线跑一次、改动跑一次、再基线一次、再改动一次。连续跑同
   一版只能告诉你方差，分不出「改动引入的」和「环境漂移」——而环境在漂移，人一直在用这台电脑。
2. **认出依赖环境的断言。** 窗口开在 (0,0)，凡是量「指针底下是什么」的断言（取色放大镜、窗口
   高亮、悬停光标）在人动鼠标时就不可信。`screenshot-probe` 里波动的条目全是这一类，而稳定的
   那条（工具条宽度）两版一样。
3. **换一个不依赖环境的探针。** 同一块功能往往有好几个探针，挑那个不看指针的：验截图状态机用
   `screenshot-exit-probe` 和 `screenshot-restart-probe`，它们测退出与连续两次捕获，跟鼠标在
   哪无关。
4. **两版最好成绩相同，就不是这次引入的。** 比中位数、比最好成绩，不比某一次。

### 改完要跑的是一张表，不是一个探针

`pnpm test` 全绿只说明「三千八百条里没有红的」，说不出「那五个工具还在工具清单上吗」。
每一条修过的问题都该有一个守卫，而那些守卫散在七个包的 `test/` 下面。

**`node scripts/audit-regression.mjs`** 把问题和守它的东西写成一张表，逐条报。改完先跑它，
再去看单个探针；加 `--window` 跑要真窗口那几条（会抢焦点几分钟，跑之前问一句）。

往那张表里加一行的时机是修完一个 bug 的时候，不是下一个人回归的时候。某条修复在表里找不到
守卫，那是需要补测试——不是需要放过。

### 导航与模型配置的回归

`navigation-models.test.ts` 在真实 Electron 中加载隔离的 120 个问题和 60 个模型。点击采样从
真实鼠标 click 的捕获阶段开始，记录点击前刻度宽度及接下来 24 帧落点、刻度身份、宽度和
预览透明度；同时覆盖窗口内外目标、hover 未结束就点击、15 个刻度的数量上限。Markdown
断言读取真实 strong、h3、code 节点；不从 React 内部状态推断画面。

同一测试验证角色与子智能体的收藏/搜索菜单、420px 高度上限、375px 布局、明确配置的推理
等级，以及配置选择不修改当前会话模型。`model-menu.test.ts` 回归聊天侧原有搜索与收藏，
`agent-profiles-sidechat.test.ts` 检查子智能体实际 HTTP 请求和侧聊历史。各文件仍须串行执行，
构建完成后才能启动，使用 `LYRA_E2E_ARTIFACTS` 保存真实截图。`thinking-wire.test.ts` 另对
Responses、Chat Completions、Anthropic 的出站参数做断言，并覆盖无效自定义预算的请求前拒绝。

### 工作区交付与浏览器的隔离

[工作区工具](workspace-tools.md)的两组端到端测试启动本地协议服务提供确定的工具调用，实际执行
Lyra 工具、写入隔离 Git 仓库、启动并结束真实 HTTP 服务。浏览器页面为明确的本地 web fixture，
通过正式 BrowserPanel 渲染，截图不使用替代 UI。测试实例去掉 NODE_TEST_CONTEXT，避免子进程
中真正执行的 `node --test` 被上层测试环境静默跳过。用户配置、会话与密钥不用于这些测试。

### 用量统计与离线模型目录

`usage-pricing.test.ts`、`usage-scan.test.ts` 和 core 的 `model-catalog.test.ts`、`pricing.test.ts` 覆盖
输入、输出、缓存命中、缓存写入、长上下文阶梯价格，以及供应商返回、历史快照、手动价格和离线
目录的优先级。价格快照中的合法 0 必须保留；缺少任一费率的旧记录不能伪装成完整快照。目录匹配
以供应商端点和模型 ID 为边界，未知 relay 即使复用上游模型名也保持未匹配。

`usage-dashboard.test.ts` 使用真实 Electron 和隔离会话日志，验证首次骨架、费用与 Token 趋势切换、
模型与日期明细、刷新不清空页面、未计价提示，以及模型编辑器同步目录值。1440×900 下指标栏为
5 列，760×900 下为 2 列；两者都断言没有横向溢出。测试数据包含供应商返回成本、手动价格、
离线目录价格、只有历史总价和完全未计价五类记录，模型请求不会访问外网或用户供应商。

离线快照由仓库根目录的 `pnpm catalog:update` 从 models.dev 的公开 MIT 数据生成，JSON 同时记录
源仓库 commit 和更新时间。更新目录后必须运行目录、计价、扫描单测与用量页面 E2E；目录版本和
用户模型价格会进入用量缓存 key，任一变化都会使旧聚合缓存失效并从原始会话日志重新计价。
