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

`packages/desktop/e2e/`，跑真实的 Electron 窗口，经 DevTools 协议驱动。一次一个应用
（`--test-concurrency=1`）：三个窗口抢一台笔记本会让量布局的测试失败，而那是最糟的红——被测
的代码本身没问题。

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
