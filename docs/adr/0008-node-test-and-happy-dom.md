# ADR-0008：测试用 node:test，组件测试加 happy-dom

- 状态：已采纳
- 日期：2026-09-03
- 相关：`packages/desktop/test/helpers/`、`docs/architecture/testing.md`

## 背景

这个仓库一直用 Node 自带的 `node:test`，不引测试框架。两千多条测试，跑完二十几秒。

但里面没有一条渲染过组件——`createRoot` 在整个 `test/` 目录里出现零次。所有断言都停在纯函数
上。凡是「点下去会怎样」「禁用时还能不能点」「读屏软件读到什么」，都只能靠人打开应用看一眼。

代价是有记录的。AGENTS.md 记着：标注工具条的按钮「有 tooltip」，而全应用的 tooltip 从来没显示
过——属性写 `data-ly-tip`，代码读 `dataset.dwTip`，一个改名时漏掉的字母。

## 决定

保持 `node:test`。为组件测试加两个东西，都不是测试框架：

- **happy-dom** 提供 DOM。
- **tsx** 负责加载 `.tsx`——`--experimental-strip-types` 不处理 JSX，而组件测试必须 import
  组件源文件。

只有 `test:ui` 用这条路径，主测试命令不变。

## 后果

**得到的**：界面行为可以被断言，而且快到可以每次提交都跑（24 条一秒内）。重构把基础组件挪进
新目录时，这些断言跟着走，用来证明搬完之后行为没变。

**接受的代价**：两条测试命令而不是一条。`pnpm test` 把它们串起来，所以日常没有区别。

**写法上的一条要求**：断言要对着用户能观察到的东西。`tooltip-contract.test.ts` 是范例——它不
断言「组件设置了 data-ly-tip」，而是断言「组件写出来的东西，能被读它的那个选择器找到」。只有
后者能抓住上面那次事故。

不引 vitest / jest / playwright：它们各自会带来一套 runner、一套 mock、一套配置，而现在缺的只
是一个 DOM。
