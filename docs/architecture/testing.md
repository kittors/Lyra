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

### Windows 桌面回归

CI 的 `windows-ui` 在 push、PR 和手动执行时运行真实 Windows Electron，并纳入 `all-green`。
它跑 `desktop-compatibility.test.ts` 与 `transcript-stability.test.ts`：

- 100%、125%、150%、200% Chromium 显示缩放，深浅主题和 380px 起的窗口宽度。
- 从 Window Controls Overlay API 读取系统按钮区域，验证应用按钮没有进入它。
- 输入框边界、Tab 焦点标记、Windows 快捷键提示、终端标签和新建/关闭入口。
- 长对话滚动范围、思考行去重、历史展开状态、会话切换首帧和阅读位置。

设置 `LYRA_E2E_ARTIFACTS` 可以保存真实应用截图；CI 保留 7 天。测试使用临时项目和合成会话
日志，经真实应用加载，退出后清理。它不发送模型请求。

本地聚焦运行：

```bash
pnpm build
pnpm --filter @lyra/desktop exec node --test --test-concurrency=1 --experimental-strip-types e2e/desktop-compatibility.test.ts e2e/transcript-stability.test.ts
```

macOS 上运行这些测试可验证共享 Chromium 布局，不能证明 Windows 的 DirectWrite、GPU 驱动、
原生 IME 或多屏 DPI 切换都正常。Windows CI 的强制缩放也不替代跨显示器拖动的实机测试。
平台行为约束见 [Windows 桌面适配](windows-desktop.md)。

### 干净 main 上的既有红线

**不是回归，别当成自己弄坏的。** 2026-09-03 在 `495c646` 上测得：

| | 数量 |
| --- | --- |
| 通过 | 175 |
| 失败 | 17 |

失败集中在三个文件：`dock.test.ts` 9 条、`transcript.test.ts` 4 条、`failure-resume.test.ts`
4 条。改动之后只要红线仍在这三个文件里、总数不超过 17，就说明没有引入新问题。

### 时序敏感的那几条

有些测试在等固定的帧数或毫秒（`menu-usage-polish.test.ts` 里那条骨架屏的就是等 16 帧）。机器
上同时跑着别的东西时它们会假红。**先单独重跑那个文件两次再定性**，不要直接当成回归。

### 判断一条红线是不是自己弄的

完整跑一次 20 分钟，而且它自己的失败数会随机器负载浮动——同一份代码测出 17 条和 29 条都见过。
所以对照要在**同样的条件下**做，不是拿完整跑的总数去比：

```bash
# 同一个文件，两个分支各单跑一次
pkill -f "remote-debugging-port"          # 上一次没退干净的实例会占住调试端口
cd <你的分支>/packages/desktop && node --test --test-concurrency=1 --experimental-strip-types e2e/dock.test.ts
cd <main 的工作树>/packages/desktop && node --test --test-concurrency=1 --experimental-strip-types e2e/dock.test.ts
```

数字一样就没有回归。用 git worktree 开一个 main 的工作树，两边可以并排跑。

**端口占用是最常见的假红**，而且伪装得很好：四条测试在几毫秒内全部失败，看起来像启动就崩。
错误信息里会写「调试端口 XXXX 已被占用」，但它在一堆断言失败中间，容易被略过。

### CI 上的 e2e 有它自己的红线

比本地多，而且不是同一批——runner 的分辨率、字体、时序都和开发机不同。2026-09-03 观察到的是
**稳定 15 条**，在几个互不相关的 PR 上完全一致（`33713618484`、`33705889789` 与本次）。

所以判断 CI 上是不是回归，同样是比清单而不是比数量：

```bash
# 自己这次的
gh run view --job <你的 e2e job id> --log | grep '✖' | sed 's/.*✖/✖/;s/ ([0-9.]*ms)//' | sort -u > mine.txt
# 另一个近期 PR 的，作为基线
gh run view --job <别的 PR 的 e2e job id> --log | grep '✖' | sed 's/.*✖/✖/;s/ ([0-9.]*ms)//' | sort -u > base.txt
comm -23 mine.txt base.txt     # 只在你这边失败的，才需要看
```

差集里的每一条，先在本地单跑那个文件两次。`tree row not found` 这类「等某个元素出现」的失败在
CI 上尤其容易假红。
